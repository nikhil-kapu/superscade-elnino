// Phone notifications placed by a district agent when it escalates.
// Provider: TURTLE_API_URL + TURTLE_API_KEY (POST {to, context}) if configured; otherwise a simulated call that
// walks through dialing → connected → completed so the demo shows the behaviour without a telephony account.
import { emit } from '../bus.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

export interface CallRequest { runId: string; tick: number; districtId: string; agentId?: string; role: 'emergency_contact' | 'citizen'; script: string }
const PRIMARY_PHONE = process.env.EMERGENCY_CONTACT_PHONE || '+16172974930';
export const PHONES = {
  emergency_contact: PRIMARY_PHONE,
  citizen: process.env.CITIZEN_PHONE || PRIMARY_PHONE, // single demo number: resident calls go to the same phone
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function callsPlaced(runId: string) { if (placedThisRun.runId !== runId) return { emergency_contact: 0, citizen: 0 }; return { emergency_contact: placedThisRun.n.emergency_contact ?? 0, citizen: placedThisRun.n.citizen ?? 0 }; }
let placedThisRun: { runId: string; n: Record<string, number> } = { runId: '', n: {} };
const MAX_PER_ROLE = Number(process.env.CALL_MAX_PER_ROLE) || 1; // one emergency-contact call and one resident call per run
export const callLog: { to: string; role: string; districtId: string; script: string; status: string; at: number; callId?: string }[] = [];

const realCallRuns = new Set<string>();
/** real dialing is OPT-IN per run; everything else is simulated */
export function setRealCalls(runId: string, on: boolean) { if (on) realCallRuns.add(runId); else realCallRuns.delete(runId); }
const lastDialed = new Map<string, number>();
const COOLDOWN_MS = Number(process.env.CALL_COOLDOWN_MS) || 10_000; // only blocks an accidental double start
export function callsAvailable(runId: string, role: 'emergency_contact' | 'citizen' = 'emergency_contact') { if (placedThisRun.runId !== runId) placedThisRun = { runId, n: {} }; return MAX_PER_ROLE - (placedThisRun.n[role] ?? 0); }

export async function placeCall(req: CallRequest): Promise<void> {
  if (callsAvailable(req.runId, req.role) <= 0) return;
  placedThisRun.n[req.role] = (placedThisRun.n[req.role] ?? 0) + 1;
  const to = PHONES[req.role];
  const base = { type: 'call' as const, runId: req.runId, tick: req.tick, districtId: req.districtId, to, role: req.role, script: req.script, agentId: req.agentId };
  const entry = { to, role: req.role, districtId: req.districtId, script: req.script, status: 'queued', at: Date.now() } as (typeof callLog)[number];
  callLog.push(entry);
  emit({ ...base, status: 'queued' });
  emit({ type: 'log', level: 'warn', text: `[call] DIAL ${req.role} ${to} (${req.districtId}): ${req.script}` });
  // ---- provider 1: Twilio via the locally authenticated Twilio CLI (no secrets in .env) ----
  const twilioFrom = process.env.TWILIO_FROM || '+12193334586';
  // HARD OFF: real dialing only when ALLOW_REAL_CALLS=1 is set explicitly in the environment; otherwise every call is simulated.
  const realWanted = process.env.ALLOW_REAL_CALLS === '1' && (process.env.CALLS_PROVIDER === 'twilio' || realCallRuns.has(req.runId));
  const sinceLast = Date.now() - (lastDialed.get(to) ?? 0);
  if (realWanted && sinceLast < COOLDOWN_MS) emit({ type: 'log', level: 'warn', text: `[call] ${to} was dialed ${Math.round(sinceLast / 1000)}s ago; cooldown ${COOLDOWN_MS / 1000}s -> simulating this one` });
  if (realWanted && sinceLast >= COOLDOWN_MS && process.env.CALLS_PROVIDER !== 'simulated' && twilioFrom) {
    lastDialed.set(to, Date.now());
    try {
      const twiml = `<Response><Say voice="Polly.Joanna">${xml(req.script)}</Say><Pause length="1"/><Say voice="Polly.Joanna">This was an automated notification from the SUPERSCADE district response team. Goodbye.</Say></Response>`;
      emit({ ...base, status: 'dialing' });
      const { stdout } = await execFileP(process.env.TWILIO_BIN || 'twilio', ['api:core:calls:create', '--to', to, '--from', twilioFrom, '--twiml', twiml, '-o', 'json'], { timeout: 30000, maxBuffer: 1 << 20 });
      const data = JSON.parse(stdout.slice(stdout.search(/[\[{]/)));
      const call = Array.isArray(data) ? data[0] : data;
      const callId: string = call?.sid;
      entry.callId = callId; entry.status = 'dialing';
      emit({ type: 'log', level: 'warn', text: `[call] twilio ${req.role} ${to} -> ${callId} (${call?.status})` });
      // poll the call until it ends (max ~75 s)
      let last = String(call?.status ?? 'queued');
      for (let i = 0; i < 25; i++) {
        await sleep(3000);
        try {
          const r = await execFileP(process.env.TWILIO_BIN || 'twilio', ['api:core:calls:fetch', '--sid', callId, '-o', 'json'], { timeout: 20000 });
          const d = JSON.parse(r.stdout.slice(r.stdout.search(/[\[{]/)));
          const st = String((Array.isArray(d) ? d[0] : d)?.status ?? last);
          if (st !== last) {
            last = st;
            const mapped = st === 'in-progress' ? 'connected' : st === 'completed' ? 'completed' : ['busy', 'failed', 'no-answer', 'canceled'].includes(st) ? 'failed' : 'dialing';
            entry.status = mapped; emit({ ...base, status: mapped as any, callId });
            emit({ type: 'log', level: 'info', text: `[call] ${req.role} ${to}: ${st}` });
            if (mapped === 'completed' || mapped === 'failed') return;
          }
        } catch { /* transient CLI error; keep polling */ }
      }
      return;
    } catch (e: any) {
      emit({ type: 'log', level: 'warn', text: `[call] twilio failed (${String(e?.message ?? e).slice(0, 160)}); falling back` });
    }
  }
  const url = process.env.TURTLE_API_URL, key = process.env.TURTLE_API_KEY;
  if (url && key && process.env.ALLOW_REAL_CALLS === '1') {
    try {
      emit({ ...base, status: 'dialing' });
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ to, context: req.script, contact_name: req.role === 'emergency_contact' ? 'District emergency contact' : 'District resident' }) });
      const data: any = await res.json().catch(() => ({}));
      const callId = data.call_id ?? data.id ?? data.callId;
      entry.status = res.ok ? 'connected' : 'failed'; entry.callId = callId;
      emit({ ...base, status: res.ok ? 'connected' : 'failed', callId });
      if (res.ok) { await sleep(4000); entry.status = 'completed'; emit({ ...base, status: 'completed', callId }); }
      return;
    } catch (e: any) {
      emit({ type: 'log', level: 'warn', text: `[call] provider failed (${e?.message ?? e}); falling back to simulated call` });
    }
  }
  // simulated provider: the behaviour is real, the audio is not
  await sleep(600); entry.status = 'dialing'; emit({ ...base, status: 'dialing' });
  await sleep(2600); entry.status = 'connected'; emit({ ...base, status: 'connected' });
  await sleep(3200); entry.status = 'simulated'; emit({ ...base, status: 'simulated' });
}

/** Spoken scripts the district agent reads out. Kept short: ~15 s each. */
export function callScripts(districtName: string, severityLabel: string, forecast: string, plan: { shelters: string[]; routesLabel: string; airlift: boolean; fireCrews: number }) {
  const emergency = `This is the SUPERSCADE district response agent for ${districtName}. Severity is ${severityLabel}. ${forecast}. We are evacuating at-risk areas toward ${plan.routesLabel || 'the nearest open shelter'}${plan.fireCrews ? `, ${plan.fireCrews} fire crews are dispatched` : ''}${plan.airlift ? ', and we are requesting helicopter support' : ''}. Please mobilise district services and confirm shelter capacity.`;
  const citizen = `This is an emergency notification from the ${districtName} district response team. ${forecast.replace('Next 1 h:', 'In the next hour we expect')}. If you are in a low-lying or at-risk area, please leave now and go to ${plan.routesLabel || 'the nearest open shelter'}. Follow local authorities' instructions. This is a planning simulation message.`;
  return { emergency, citizen };
}
