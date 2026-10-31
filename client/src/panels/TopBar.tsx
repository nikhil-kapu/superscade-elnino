import { useEffect, useRef } from 'react';
import { incidentName, shortId, tickClock, useStore } from '../store';
import ScenarioPanel from './ScenarioPanel';

export default function TopBar() {
  const region = useStore((s) => s.region());
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const scenario = useStore((s) => s.scenario);
  const runId = useStore((s) => s.runId);
  const incidents = useStore((s) => s.incidents);
  const viewIncident = useStore((s) => s.viewIncident);
  const show = useStore((s) => s.showNewIncident);
  const setShow = useStore((s) => s.setShowNewIncident);
  const agentsN = useStore((s) => s.agents.size);
  const plansN = useStore((s) => s.verdicts.filter((v) => v.verdict.accepted).length);
  const live = useStore((s) => s.snapshot);
  const running = useStore((s) => s.running);
  const riskN = useStore((s) => { let n = 0; s.risks.forEach((r) => { if (r.severity >= 2) n++; }); return n; });
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!show) return;
    const onDown = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setShow(false); };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
  }, [show, setShow]);

  const current = scenario ? `${incidentName(scenario, region)} (${shortId(runId)})` : 'No incident yet';
  const options = [
    ...(scenario && runId && !incidents.some((i) => i.runId === runId) ? [{ runId, label: current }] : []),
    ...incidents.map((i) => ({ runId: i.runId, label: `${i.name} (${shortId(i.runId)})` })),
  ];
  const endTick = scenario?.ticks ?? live?.tick ?? 0;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">SUPERSCADE</span>
        <span className="tagline">El Niño preparedness · a live AI agent team</span>
      </div>
      <div className="tb-sep" />
      <div className="incident-select" ref={popRef}>
        <select value={runId ?? '__none'} onChange={(e) => { if (e.target.value === '__new') { setShow(true); e.target.value = runId ?? '__none'; } else viewIncident(e.target.value); }} title="Switch incident">
          {!scenario && <option value="__none">No incident yet</option>}
          {options.map((o) => <option key={o.runId} value={o.runId}>{o.label}</option>)}
          <option value="__new">+ New incident…</option>
        </select>
        <button className={'newbtn' + (show ? ' on' : '')} onClick={() => setShow(!show)}>{scenario ? 'New' : 'New incident'}</button>
        {show && (
          <div className="popover">
            <div className="pop-head"><span className="eyebrow">New incident</span><button className="x" onClick={() => setShow(false)}>×</button></div>
            <ScenarioPanel compact onStarted={() => setShow(false)} />
          </div>
        )}
      </div>
      <span className="tb-loc">◎ {region?.name ?? '—'}</span>
      <span className="tb-range mono">▦ T+0 – T+{endTick} ({tickClock(endTick).slice(1)} h){running ? ` · now T+${live?.tick ?? 0}` : ''}</span>
      <nav className="pills" aria-label="Views">
        {([['incident', 'Incident', 0], ['agents', 'Agents', agentsN], ['response', 'Response', plansN], ['delegation', 'Delegation', riskN]] as const).map(([id, label, n]) => (
          <button key={id} className={'pill' + (tab === id ? ' active' : '') + (id === 'delegation' ? ' deleg' : '')} onClick={() => setTab(id)} title={id === 'delegation' ? 'How the chief delegates to district agents · badge = districts at Evacuate or Escalate' : undefined}>{label}{n > 0 && <span className={'count' + (id === 'delegation' ? ' hot' : '')}>{n}</span>}</button>
        ))}
      </nav>
      <div className="tb-deco sponsors">
        <span className="sponsor-badge" title="Every agent that spins up gets its own Terse Durable Actor (SQLite memory, one call at a time); a per-incident ledger actor hands out scarce resources without double-booking">⬢ Durable Actors · Terse</span>
        <span className="sponsor-badge" title="Agents message each other (assignments, plans, verdicts, resource contention) over Agent Relay channels, DMs and threads">⇄ Messaging · Agent Relay</span>
      </div>
    </header>
  );
}
