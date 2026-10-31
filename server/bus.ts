import type { Request, Response } from 'express';
import type { CascadeEvent } from '../shared/types.ts';

const clients = new Set<Response>();
const history: CascadeEvent[] = [];

export function emit(ev: CascadeEvent) {
  history.push(ev);
  if (history.length > 2000) history.shift();
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
  if (ev.type === 'log' || ev.type === 'sim.event' || ev.type === 'verifier.verdict' || ev.type === 'run.done' || ev.type === 'playbook.update') {
    const brief = ev.type === 'log' ? ev.text : ev.type === 'sim.event' ? `[t${ev.tick}] ${ev.text}` : ev.type === 'verifier.verdict' ? `verifier ${ev.verdict.accepted ? 'ACCEPT' : 'REJECT'} ${ev.verdict.districtId ?? ''}` : ev.type;
    console.log(`[bus] ${brief}`);
  }
}

export function sseHandler(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  // replay recent playbook state so late joiners are in sync
  const lastPb = [...history].reverse().find(e => e.type === 'playbook.update');
  if (lastPb) res.write(`data: ${JSON.stringify(lastPb)}\n\n`);
  // late joiner while a run is in progress: replay run.start + state so the page attaches to it
  const types = history.map(e => e.type);
  const iStart = types.lastIndexOf('run.start'), iDone = types.lastIndexOf('run.done');
  if (iStart >= 0 && iStart > iDone) {
    res.write(`data: ${JSON.stringify(history[iStart])}\n\n`);
    const snap = [...history].reverse().find(e => e.type === 'sim.snapshot');
    if (snap) res.write(`data: ${JSON.stringify(snap)}\n\n`);
    for (const e of history.slice(iStart + 1)) if (['agent.spawn', 'agent.status', 'verifier.verdict', 'agent.plan', 'district.risk', 'alert', 'call'].includes(e.type)) res.write(`data: ${JSON.stringify(e)}\n\n`);
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}
