import { useMemo } from 'react';
import { useStore } from '../store';

/** Live one-glance narration of what the agents are doing, newest line slides in at the bottom. */
export default function NarrationStrip() {
  const narration = useStore((s) => s.narration);
  const agents = useStore((s) => s.agents);
  const alerts = useStore((s) => s.alerts);
  const verdicts = useStore((s) => s.verdicts);
  const callsN = useStore((s) => s.calls.size);
  const tab = useStore((s) => s.tab);
  const lines = useMemo(() => narration.slice(0, 3).reverse(), [narration]);
  const acc = verdicts.filter((v) => v.verdict.accepted).length;
  return (
    <div className={'narration' + (tab === 'delegation' ? ' wide' : '')} aria-live="polite">
      <div className="nar-lines">
        {lines.length === 0 && <div className="nar-line idle"><i style={{ background: '#8a817a' }} /><span className="nar-text">Awaiting incident — the chief will narrate its delegation here.</span></div>}
        {lines.map((l, i) => (
          <div key={l.id} className={'nar-line tone-' + l.tone + (i === lines.length - 1 ? ' newest' : '')} style={{ opacity: 0.45 + (0.55 * (i + 1)) / lines.length }}>
            <i style={{ background: l.color }} />
            <b className="nar-who">{l.who}</b>
            <span className="nar-text">{l.text}</span>
          </div>
        ))}
      </div>
      <div className="nar-count mono">
        <span><b>{agents.size}</b> agents</span>
        <span><b>{alerts.length}</b> alerts</span>
        {callsN > 0 && <span><b>{callsN}</b> calls</span>}
        <span className="ok"><b>{acc}</b> verified</span>
        <span className="fail"><b>{verdicts.length - acc}</b> rejected</span>
      </div>
    </div>
  );
}
