import { useState } from 'react';
import { useStore } from '../store';
import { postRun, reconnectEvents } from '../api';

/** Idle-state call to action: one click starts the region's headline incident with its default trigger. */
export default function StartOverlay({ onCustomize }: { onCustomize?: () => void }) {
  const runId = useStore((s) => s.runId);
  const running = useStore((s) => s.running);
  const region = useStore((s) => s.region());
  const triggerKind = useStore((s) => s.triggerKind);
  const params = useStore((s) => s.params);
  const clickAt = useStore((s) => s.clickAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [realCalls, setRealCalls] = useState<boolean>(() => { try { return localStorage.getItem('cascade.realCalls.v3') === '1'; } catch { return false; } }); // OFF by default (server also requires ALLOW_REAL_CALLS=1)
  const toggleCalls = (v: boolean) => { setRealCalls(v); try { localStorage.setItem('cascade.realCalls.v3', v ? '1' : '0'); } catch {} };
  if (runId || running || !region) return null;
  const spec = region.triggers.find((t) => t.kind === triggerKind) ?? region.triggers[0];
  const headline = spec?.kind === 'rain' ? `Start the ${region.name.split(' — ')[1]?.split('/')[0]?.trim() || region.name} cloudburst` : spec?.kind === 'quake' ? `Start the M${(params.magnitude ?? 6.9).toFixed(1)} earthquake` : 'Start the wildfire';
  const sub = spec?.kind === 'rain' ? `${params.rain_mm ?? 300} mm of rain over ${params.duration_ticks ?? 6} ticks · landslides → dams → flood` : spec?.kind === 'quake' ? 'shaking → bridge failures → gas-line fires' : 'wind-driven spread → burn scar';
  const start = async () => {
    if (!clickAt) return;
    setBusy(true); setErr(null);
    try { useStore.getState().resetRun(); await postRun({ regionId: region.id, trigger: { kind: spec.kind, at: clickAt, params }, realCalls }, region); }
    catch (e: any) { const msg = String(e?.message ?? 'Run failed'); if (/409/.test(msg)) { reconnectEvents(); setErr('An incident is already running on the server — attaching this tab to it…'); } else setErr(msg); } finally { setBusy(false); }
  };
  const stopAndStart = async () => {
    setBusy(true); setErr(null);
    try { await fetch('/api/stop', { method: 'POST' }); await new Promise(r => setTimeout(r, 4500)); await start(); }
    catch (e: any) { setErr(e?.message ?? 'Stop failed'); } finally { setBusy(false); }
  };
  return (
    <div className="start-overlay">
      <div className="start-card">
        <div className="start-eyebrow">Agent team ready · {region.districts.length} district agents on standby</div>
        <button className="start-btn" onClick={start} disabled={busy}>
          <span className="start-play">▶</span>
          <span><span className="start-title">{busy ? 'Starting…' : headline}</span><span className="start-sub">{sub}</span></span>
        </button>
        <label className="start-calls"><input type="checkbox" checked={realCalls} onChange={(e) => toggleCalls(e.target.checked)} /> <span>📞 Simulate phone calls to the district emergency contact and residents when a district escalates</span></label>
        <div className="start-row">
          <span className="start-hint">The chief will delegate to district agents, who forecast, alert services and plan evacuations live.</span>
          {onCustomize && <button className="start-link" onClick={onCustomize}>Customize incident…</button>}
        </div>
        {err && <div className="start-err">{err} {/already running/.test(err) && <button className="start-link" onClick={stopAndStart} disabled={busy}>Stop it and start fresh</button>}</div>}
      </div>
    </div>
  );
}
