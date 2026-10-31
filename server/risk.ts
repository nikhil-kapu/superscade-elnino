// Per-district risk assessment: a one-hour (2-tick) forecast from the recent trend, a severity tier, and the action it implies.
import type { DistrictState, RegionConfig, RiskForecast, RiskLabel } from '../shared/types.ts';

export interface RiskAssessment { severity: 0 | 1 | 2 | 3; label: RiskLabel; trend: 'rising' | 'steady' | 'falling' | 'settled'; forecast: RiskForecast; action: string }
export const RISK_LABELS: RiskLabel[] = ['monitoring', 'alert', 'evacuate', 'escalate'];
export const RISK_ACTIONS: Record<RiskLabel, string> = {
  monitoring: 'monitor only; no public alert',
  alert: 'alert district fire/medical services; stage shelters; warn at-risk cells',
  evacuate: 'evacuate at-risk cells to open shelters; dispatch crews; public warning',
  escalate: 'request regional helicopters/boats; alert every service; mass evacuation now',
};
const HORIZON = 2; // ticks = 1 simulated hour

export function assessDistrict(region: RegionConfig, hist: DistrictState[], prevSeverities: number[], hazardTicksLeft: number): RiskAssessment {
  const cur = hist[hist.length - 1];
  const prev = hist[Math.max(0, hist.length - 1 - HORIZON)];
  const pop = region.districts.find(d => d.id === cur.id)?.population ?? 100000;
  const growth = hazardTicksLeft > 0 ? 1.2 : 0.6; // the hazard is still being fed (rain/aftershocks) vs. draining
  const dF = cur.flooded - prev.flooded, dS = cur.stranded - prev.stranded, dFire = cur.fires - prev.fires, dL = cur.landslides - prev.landslides;
  const f: RiskForecast = {
    horizonTicks: HORIZON,
    flooded: Math.max(0, Math.round(cur.flooded + Math.max(dF, 0) * growth + (cur.flooded > 0 && hazardTicksLeft > 0 ? 2 : 0))),
    stranded: Math.max(0, Math.round(cur.stranded + Math.max(dS, 0) * growth)),
    fires: Math.max(0, Math.round(cur.fires + Math.max(dFire, 0) * growth)),
    cutOff: cur.cutOff || (cur.landslides + Math.max(dL, 0) > 6 && cur.flooded > 10),
    text: '',
  };
  const frac = f.stranded / pop;
  let sev: 0 | 1 | 2 | 3 = 0;
  if (f.stranded > 0.002 * pop || f.fires > 0 || f.flooded > 2 || cur.shaking > 0.4 || cur.landslides > 0) sev = 1;
  if (frac > 0.01 || f.fires >= 3 || f.flooded >= 8 || cur.shaking > 0.6) sev = 2;
  if (f.cutOff || frac > 0.03 || f.fires >= 8 || f.flooded >= 15) sev = 3;
  const last = prevSeverities[prevSeverities.length - 1];
  let trend: RiskAssessment['trend'] = last === undefined || sev === last ? 'steady' : sev > last ? 'rising' : 'falling';
  if (sev === 0 && prevSeverities.slice(-3).every(x => x === 0) && prevSeverities.length >= 3) trend = 'settled';
  const parts: string[] = [];
  if (f.flooded !== cur.flooded || cur.flooded) parts.push(`${f.flooded - cur.flooded >= 0 ? '+' : ''}${f.flooded - cur.flooded} flooded cells (→ ${f.flooded})`);
  if (f.fires || cur.fires) parts.push(`${f.fires} burning cells`);
  parts.push(`${f.stranded - cur.stranded >= 0 ? '+' : ''}${(f.stranded - cur.stranded).toLocaleString()} stranded (→ ${f.stranded.toLocaleString()})`);
  if (f.cutOff) parts.push(cur.cutOff ? 'district cut off' : 'likely cut off');
  if (cur.shaking > 0.4) parts.push(`shaking ${cur.shaking.toFixed(2)}`);
  f.text = `Next 1 h: ${parts.join(' · ')}`;
  return { severity: sev, label: RISK_LABELS[sev], trend, forecast: f, action: RISK_ACTIONS[RISK_LABELS[sev]] };
}
