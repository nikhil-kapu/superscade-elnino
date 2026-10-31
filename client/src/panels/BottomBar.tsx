import { useMemo } from 'react';
import { tickClock, useStore } from '../store';

function Chart({ values, color, label }: { values: number[]; color: string; label: string }) {
  const W = 200, H = 46;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * W},${H - (v / max) * (H - 6) - 2}`).join(' ');
  const last = values[values.length - 1] ?? 0;
  return (
    <div className="chart">
      <div className="chart-head"><span>{label}</span><span className="mono">{last.toLocaleString()}</span><span className="kebab">⋮</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke="#e6e0d6" />
        {values.length > 1 && <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity="0.16" />}
        {values.length > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="chart-axis mono"><span>T+0</span><span>{values.length ? `T+${values.length - 1}` : ''}</span></div>
    </div>
  );
}

export default function BottomBar() {
  const snapshots = useStore((s) => s.snapshots);
  const viewTick = useStore((s) => s.viewTick);
  const setViewTick = useStore((s) => s.setViewTick);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  const stepTick = useStore((s) => s.stepTick);
  const events = useStore((s) => s.events);
  const scenario = useStore((s) => s.scenario);
  const running = useStore((s) => s.running);
  const live = useStore((s) => s.snapshot);
  const tab = useStore((s) => s.tab);
  const plans = useStore((s) => s.plans);

  const maxTick = scenario?.ticks ?? Math.max(1, live?.tick ?? 1);
  const curTick = viewTick === 'live' ? (live?.tick ?? 0) : viewTick;
  const upto = useMemo(() => snapshots.filter((x) => x.tick <= curTick), [snapshots, curTick]);
  const count = (sn: typeof snapshots[number], k: string) => sn.hazards.filter((h) => h.kind === k).length;
  const charts = useMemo(() => {
    const kind = scenario?.trigger.kind ?? 'quake';
    const stranded = { label: 'People stranded', color: '#e8552b', values: upto.map((x) => x.score.stranded) };
    if (tab === 'response') {
      let crews = 0; plans.forEach((p) => (crews += p.fireCrews));
      return [
        { label: 'Crews deployed', color: '#16a34a', values: upto.map((x, i) => (i / Math.max(1, upto.length - 1)) * crews) },
        { label: 'People evacuated', color: '#2563eb', values: upto.map((x) => x.score.evacuated) },
        { label: 'Routes open', color: '#84cc16', values: upto.map((x, i) => Math.round((i / Math.max(1, upto.length - 1)) * [...plans.values()].reduce((a, p) => a + p.routes.length, 0))) },
      ];
    }
    if (kind === 'rain') return [
      { label: 'Inundated area (cells)', color: '#1d4ed8', values: upto.map((x) => count(x, 'flood')) },
      { label: 'Landslides (cells)', color: '#a16207', values: upto.map((x) => count(x, 'landslide')) }, stranded];
    if (kind === 'fire') {
      const fire = upto.map((x) => count(x, 'fire') + count(x, 'burn'));
      return [
        { label: 'Fire area (cells)', color: '#f26a1b', values: fire },
        { label: 'Rate of spread (cells/tick)', color: '#e8452b', values: fire.map((v, i) => Math.max(0, v - (fire[i - 1] ?? 0))) }, stranded];
    }
    return [
      { label: 'Shaking area (cells)', color: '#8b5cf6', values: upto.map((x) => count(x, 'quake')) },
      { label: 'Fires (cells)', color: '#f26a1b', values: upto.map((x) => count(x, 'fire')) }, stranded];
  }, [upto, scenario, tab, plans]);
  const simEvents = useMemo(() => events.filter((e) => e.tick !== undefined && e.kind !== 'log' && e.kind !== 'agent' && e.kind !== 'plan').slice(0, 40), [events]);

  return (
    <footer className="bottombar">
      <div className="tl-row">
        <span className="tl-title">Timeline</span>
        <div className="transport">
          <button className="tbtn" onClick={() => stepTick(-1)} disabled={!snapshots.length} title="Step back">‹</button>
          <button className="tbtn play" onClick={() => setPlaying(!playing)} disabled={!snapshots.length} title={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
          <button className="tbtn" onClick={() => stepTick(1)} disabled={!snapshots.length} title="Step forward">›</button>
          <select className="speed mono" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
          </select>
          <button className={'livebtn' + (viewTick === 'live' ? ' on' : '')} onClick={() => { setViewTick('live'); setPlaying(false); }} title="Follow newest tick"><i />LIVE</button>
        </div>
        <div className="scrub-track">
          <input type="range" min={0} max={maxTick} step={1} value={curTick} disabled={!snapshots.length} onChange={(e) => { setPlaying(false); setViewTick(Number(e.target.value)); }} />
          <div className="scrub-fill" style={{ width: `${(curTick / Math.max(1, maxTick)) * 100}%` }} />
          {live && <div className="scrub-live" style={{ left: `${(live.tick / Math.max(1, maxTick)) * 100}%` }} />}
          <div className="dots">
            {simEvents.map((e) => <i key={e.id} className={'evdot ' + e.severity} style={{ left: `${((e.tick ?? 0) / Math.max(1, maxTick)) * 100}%` }} title={`T+${e.tick} ${e.text}`} onClick={() => { setPlaying(false); setViewTick(e.tick!); }} />)}
          </div>
          <div className="now-pill mono" style={{ left: `${(curTick / Math.max(1, maxTick)) * 100}%` }}>T+{curTick} · {tickClock(curTick)}</div>
        </div>
        <span className="tl-range mono">T+0 – T+{maxTick}{running ? ' · running' : scenario ? ' · complete' : ''}</span>
      </div>
      <div className="tl-body">
        <div className="charts">{charts.map((c) => <Chart key={c.label} {...c} />)}</div>
        <div className="keyevents">
          <div className="ke-head"><span>Key events</span><span className="mono muted">{simEvents.length}</span></div>
          <ul>
            {simEvents.length === 0 && <li className="muted">Sim events will stream here.</li>}
            {simEvents.slice(0, 14).map((e) => (
              <li key={e.id} className={e.severity} onClick={() => { if (e.at) useStore.getState().fly(e.at); if (e.tick !== undefined) { setPlaying(false); setViewTick(e.tick); } }}>
                <i className="kdot" /><span className="x">{e.text}</span><span className="mono t">T+{e.tick} · {tickClock(e.tick ?? 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
