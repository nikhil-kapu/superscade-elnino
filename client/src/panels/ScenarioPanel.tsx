import { useState } from 'react';
import { useStore } from '../store';
import { postRun } from '../api';

const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString());

export default function ScenarioPanel({ compact, onStarted }: { compact?: boolean; onStarted?: () => void } = {}) {
  const region = useStore((s) => s.region());
  const triggerKind = useStore((s) => s.triggerKind);
  const setTrigger = useStore((s) => s.setTrigger);
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);
  const clickAt = useStore((s) => s.clickAt);
  const running = useStore((s) => s.running);
  const score = useStore((s) => s.score);
  const snapshot = useStore((s) => s.viewSnapshot());
  const live = useStore((s) => s.snapshot);
  const scenario = useStore((s) => s.scenario);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const spec = region?.triggers.find((t) => t.kind === triggerKind);

  const run = async () => {
    if (!region || !clickAt) return;
    setBusy(true); setErr(null);
    try {
      useStore.getState().resetRun();
      await postRun({ regionId: region.id, trigger: { kind: triggerKind, at: clickAt, params } }, region);
      onStarted?.();
    } catch (e: any) { setErr(e?.message ?? 'Run failed'); } finally { setBusy(false); }
  };
  const placeLabel = triggerKind === 'quake' ? 'epicenter' : triggerKind === 'fire' ? 'ignition point' : 'rain cell';

  const regions = useStore((s) => s.regions);
  const setRegion = useStore((s) => s.setRegion);
  const body = (
    <>
      <section className={compact ? 'popcard' : 'card'}>
        <h3 className="section-title">Scenario</h3>
        <label className="field"><span className="eyebrow">Region</span>
          <select value={region?.id ?? ''} disabled={running} onChange={(e) => setRegion(e.target.value as any)}>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </label>
        <div className="seg">
          {region?.triggers.map((t) => (
            <button key={t.kind} className={'seg-btn' + (t.kind === triggerKind ? ' active' : '')} disabled={running} onClick={() => setTrigger(t.kind)}>{t.label}</button>
          ))}
        </div>
        <div className="sliders">
          {spec?.params.map((p) => (
            <label key={p.name} className="slider">
              <div className="slider-head"><span>{p.label}</span><span className="mono">{(params[p.name] ?? p.default).toFixed(p.step < 1 ? 1 : 0)}</span></div>
              <input type="range" min={p.min} max={p.max} step={p.step} value={params[p.name] ?? p.default} disabled={running} onChange={(e) => setParam(p.name, Number(e.target.value))} />
            </label>
          ))}
        </div>
        <div className={'place-hint' + (clickAt ? ' set' : '')}>
          <span className="crosshair" />
          <div>
            <div>{clickAt ? `${placeLabel[0].toUpperCase() + placeLabel.slice(1)} placed` : `Click the map to place the ${placeLabel}`}</div>
            {clickAt && <div className="mono muted">{clickAt.lat.toFixed(4)}, {clickAt.lng.toFixed(4)}</div>}
          </div>
        </div>
        <button className="run-btn" onClick={run} disabled={!region || !clickAt || running || busy}>
          {running ? <><span className="spinner" /> Running · T+{live?.tick ?? 0}</> : busy ? 'Starting…' : 'START INCIDENT'}
        </button>
        {err && <div className="error">{err}</div>}
      </section>

      {!compact && <section className="card">
        <div className="section-row">
          <h3 className="section-title">Live score</h3>
          <span className="mono tickpill">T+{snapshot?.tick ?? 0}{scenario ? ` / ${scenario.ticks}` : ''}</span>
        </div>
        <div className="tiles">
          <Tile label="Stranded" value={fmt(score?.stranded)} tone="bad" />
          <Tile label="Evacuated" value={fmt(score?.evacuated)} tone="good" />
          <Tile label="Fires uncovered" value={fmt(score?.firesUncovered)} tone="warn" />
          <Tile label="Cut-off districts" value={fmt(score?.cutOffDistricts)} tone="bad" />
        </div>
        <div className="total-tile">
          <span className="eyebrow">Total score</span>
          <span className="mono total">{fmt(score?.total)}</span>
          <span className="muted small">higher is better</span>
        </div>
      </section>}
    </>
  );
  if (compact) return body;
  return <aside className="panel left">{body}{region && <p className="disclaimer">{region.disclaimer}</p>}</aside>;
}

function Tile({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={'tile tone-' + tone}>
      <span className="eyebrow">{label}</span>
      <span className="mono tile-value">{value}</span>
    </div>
  );
}
