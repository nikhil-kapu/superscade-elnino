import { useEffect } from 'react';
import { useStore } from '../store';

/** Centre overlay shown for ~6 s after run.done: what the agent fleet achieved. */
export default function RunResultsCard() {
  const r = useStore((s) => s.results);
  const dismiss = useStore((s) => s.dismissResults);
  useEffect(() => {
    if (!r) return;
    const t = setTimeout(() => { if (useStore.getState().results?.id === r.id) dismiss(); }, 6500);
    return () => clearTimeout(t);
  }, [r, dismiss]);
  if (!r) return null;
  const f = (n: number) => n.toLocaleString();
  const tiles: [string, string, string?][] = [
    ['Score', f(r.score.total), 'accent'],
    ['Stranded', f(r.score.stranded), r.score.stranded > 0 ? 'bad' : 'good'],
    ['Evacuated', f(r.score.evacuated), 'good'],
    ['Agents spawned', `${r.agents}`, undefined],
    ['Districts delegated', `${r.delegated}`, undefined],
    ['Alerts issued', `${r.alerts}`, undefined],
    ['Districts escalated', `${r.escalated}`, r.escalated ? 'bad' : undefined],
    ['Calls placed', `${r.calls}`, undefined],
    ['Verifier', `${r.accepted}✓ · ${r.rejected}✗ · ${r.replans} re-plan`, undefined],
  ];
  return (
    <div className="results-overlay" onClick={dismiss} role="dialog" aria-label="Run results">
      <div className="results-card" key={r.id}>
        <div className="eyebrow">Run complete · what was achieved</div>
        <h2 className="results-title">{r.name}</h2>
        <div className="results-grid">{tiles.map(([k, v, tone]) => <div key={k} className={'rt' + (tone ? ' ' + tone : '')}><span className="eyebrow">{k}</span><b className="mono">{v}</b></div>)}</div>
        {r.summary && <p className="results-sum">{r.summary}</p>}
        <div className="results-foot muted small">{r.llmCalls} LLM calls · {f(r.tokens)} tokens · {r.levels} levels deep · click to dismiss</div>
        <div className="results-timer" />
      </div>
    </div>
  );
}
