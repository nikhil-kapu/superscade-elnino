import { useMemo, useState } from 'react';
import {
  CALL_ROLE_LABEL, ROLE_COLOR, SEVERITY_COLOR, maskNumber, type CallRow, SEVERITY_LABEL, TREND_GLYPH, agentCodeOf, alertChipText, shortModel, useStore,
  type AlertRow, type LiveAgent, type PlanExtra, type RiskRow, type VerdictRow,
} from '../store';

const FLASH_MS = 4000;

interface DistrictCardData {
  districtId: string;
  name: string;
  lead: LiveAgent;           // latest attempt
  attempts: number;
  helpers: LiveAgent[];
  verifier?: LiveAgent;
  plan?: PlanExtra;
  verdict?: VerdictRow;
  risk?: RiskRow;
  history: number[];
  alerts: { service: string; scope: string; message: string; key: string }[];
  tokens: number;
  severity: number;           // -1 = not assessed
  calls: CallRow[];
}

export default function DelegationTab() {
  const agents = useStore((s) => s.agents);
  const plans = useStore((s) => s.plans);
  const verdicts = useStore((s) => s.verdicts);
  const risks = useStore((s) => s.risks);
  const riskHistory = useStore((s) => s.riskHistory);
  const alerts = useStore((s) => s.alerts);
  const calls = useStore((s) => s.calls);
  const memory = useStore((s) => s.memory);
  const region = useStore((s) => s.region());
  const running = useStore((s) => s.running);
  const scenario = useStore((s) => s.scenario);
  const fly = useStore((s) => s.fly);
  const select = useStore((s) => s.selectAgent);
  useStore((s) => s.pulse); // re-render every 500 ms so flashes expire

  const chief = useMemo(() => [...agents.values()].filter((a) => a.role === 'chief').sort((a, b) => b.spawnedAt - a.spawnedAt)[0], [agents]);

  const cards = useMemo<DistrictCardData[]>(() => {
    const all = [...agents.values()];
    const byDistrict = new Map<string, LiveAgent[]>();
    all.filter((a) => a.role === 'district' && a.districtId).forEach((a) => byDistrict.set(a.districtId!, [...(byDistrict.get(a.districtId!) ?? []), a]));
    const alertsBy = new Map<string, AlertRow[]>();
    alerts.forEach((a) => alertsBy.set(a.districtId, [...(alertsBy.get(a.districtId) ?? []), a]));
    const out: DistrictCardData[] = [];
    byDistrict.forEach((leads, did) => {
      leads.sort((a, b) => b.spawnedAt - a.spawnedAt);
      const lead = leads[0];
      const leadIds = new Set(leads.map((l) => l.id));
      const kids = all.filter((a) => a.role !== 'district' && a.role !== 'chief' && ((a.parentId && leadIds.has(a.parentId)) || (a.districtId === did && ['route', 'firecrew', 'shelter', 'supply', 'airlift', 'verifier'].includes(a.role))));
      const helpers = kids.filter((a) => a.role !== 'verifier');
      const verifier = kids.filter((a) => a.role === 'verifier').sort((a, b) => b.spawnedAt - a.spawnedAt)[0];
      const plan = (plans.get(lead.id) ?? leads.map((l) => plans.get(l.id)).find(Boolean)) as PlanExtra | undefined;
      const verdict = verdicts.find((v) => (v.verdict.districtId ?? agents.get(v.agentId)?.districtId ?? plans.get(v.agentId)?.districtId) === did);
      const risk = risks.get(did);
      const evAlerts = (alertsBy.get(did) ?? []).map((a) => ({ service: a.service, scope: a.scope, message: a.message, key: String(a.id) }));
      const planAlerts = (plan?.alerts ?? []).map((a, i) => ({ ...a, key: 'p' + i }));
      // de-dup chips by service+scope (newest wins)
      const seen = new Set<string>();
      const chips = [...evAlerts, ...(evAlerts.length ? [] : planAlerts)].filter((a) => { const k = a.service + '|' + a.scope; if (seen.has(k)) return false; seen.add(k); return true; });
      const tokens = [lead, ...helpers].reduce((n, a) => n + a.tokens, 0);
      const severity = risk?.severity ?? (typeof plan?.severity === 'number' ? Math.max(0, Math.min(3, Math.round(plan.severity))) : -1);
      out.push({
        districtId: did, name: region?.districts.find((d) => d.id === did)?.name ?? did, lead, attempts: leads.length, helpers, verifier, plan, verdict, risk,
        history: riskHistory.get(did) ?? (severity >= 0 ? [severity] : []), alerts: chips, tokens, severity,
        calls: [...calls.values()].filter((x) => x.districtId === did).sort((a, b) => (a.role === b.role ? a.firstTs - b.firstTs : a.role === 'emergency_contact' ? -1 : 1)),
      });
    });
    return out.sort((a, b) => b.severity - a.severity || a.name.localeCompare(b.name));
  }, [agents, plans, verdicts, risks, riskHistory, alerts, calls, region]);

  const now = Date.now();
  const atRisk = cards.filter((c) => c.severity >= 2).length;
  const chiefThinking = chief && (chief.status === 'thinking' || chief.status === 'spawning');

  return (
    <>
      <section className="card dg-chief" style={{ ['--c' as any]: ROLE_COLOR.chief }}>
        <div className="section-row">
          <h3 className="section-title">Delegation board</h3>
          {running ? <span className="livetag"><i />LIVE</span> : scenario ? <span className="livetag done">complete</span> : null}
        </div>
        {!chief ? (
          <p className="muted empty">No chief yet. Start an incident — the chief assesses the hazard, then delegates one planner per hit district. Each planner forecasts its next hour, sets a severity tier, alerts services and plans the evacuation.</p>
        ) : (
          <button className="dg-chief-body" data-status={chief.status} onClick={() => { select(chief.id); fly(chief.at, 11); }}>
            <span className={'dg-chief-dot' + (chiefThinking ? ' live' : '')} />
            <span className="dg-chief-main">
              <span className="dg-chief-title">CHIEF <span className="muted">· {shortModel(chief.model)}</span></span>
              <span className="dg-chief-sub">delegating to <b>{cards.length}</b> district{cards.length === 1 ? '' : 's'}{atRisk ? <> · <b className="sev-text-2">{atRisk} at evacuate+</b></> : null}</span>
              {chief.note && <span className="dg-note">{chief.note}</span>}
            </span>
            <span className="dg-chief-right"><span className={'status-tag ' + chief.status}>{chief.status}</span><span className="mono muted small">{chief.tokens.toLocaleString()} tok</span></span>
          </button>
        )}
        {memory.length > 0 && (
          <ul className="dg-memory">{memory.slice(0, 3).map((m) => <li key={m.key}><span className="mono">{m.key}</span> {m.value.length > 110 ? m.value.slice(0, 110) + '…' : m.value}</li>)}</ul>
        )}
      </section>

      {cards.length > 0 && (
        <div className="dg-tree">
          {cards.map((c, i) => {
            const thinking = c.lead.status === 'thinking' || c.lead.status === 'spawning' || c.helpers.some((h) => h.status === 'thinking');
            const rejectFlash = c.verdict && !c.verdict.verdict.accepted && now - c.verdict.ts < FLASH_MS;
            const riseFlash = c.risk?.roseAt && now - c.risk.roseAt < FLASH_MS;
            const flash = rejectFlash || riseFlash;
            const flashKey = `${c.verdict?.id ?? 0}-${c.risk?.roseAt ?? 0}`;
            return (
              <div key={c.districtId} className={'dg-row' + (i === cards.length - 1 ? ' last' : '')}>
                <span key={flashKey} className={'dg-wire' + (thinking ? ' live' : '') + (flash ? ' flash' : '')} style={{ ['--sev' as any]: c.severity >= 0 ? SEVERITY_COLOR[c.severity] : 'var(--border-strong)' }} />
                <DistrictCard c={c} flash={!!flash} onFocus={() => { select(c.lead.id); fly(c.lead.at, 12); }} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function DistrictCard({ c, flash, onFocus }: { c: DistrictCardData; flash: boolean; onFocus: () => void }) {
  const sev = c.severity;
  const sevColor = sev >= 0 ? SEVERITY_COLOR[sev] : 'var(--faint)';
  const v = c.verdict;
  const vState = v ? (v.verdict.accepted ? 'ok' : 'bad') : c.verifier && (c.verifier.status === 'thinking' || c.verifier.status === 'spawning') ? 'auditing' : c.plan ? 'pending' : 'none';
  const p = c.plan;
  const modes = p ? { air: p.routes.filter((r) => r.mode === 'air').length, boat: p.routes.filter((r) => r.mode === 'boat').length, road: p.routes.filter((r) => r.mode === 'road').length } : undefined;
  return (
    <article className={'dg-card' + (flash ? ' flash' : '')} style={{ ['--sev' as any]: sevColor }} data-status={c.lead.status}>
      <header className="dg-head">
        <button className="dg-name" onClick={onFocus} title="Fly to district">{c.name}</button>
        {sev >= 0 ? (
          <span className={'sev-badge sev-' + sev} title={c.risk?.action ?? ''}>{SEVERITY_LABEL[sev]}{c.risk && <span className="trend">{TREND_GLYPH[c.risk.trend] ?? ''}</span>}</span>
        ) : <span className="sev-badge sev-none">awaiting assessment</span>}
      </header>
      <div className="dg-meta">
        <span className="dg-code mono" style={{ color: ROLE_COLOR.district }}>{agentCodeOf(c.lead)}</span>
        <span className="muted">{shortModel(c.lead.model)}</span>
        {c.attempts > 1 && <span className="dg-attempt mono">attempt {c.attempts}</span>}
        <span className={'status-tag ' + c.lead.status}>{c.lead.status}</span>
        {c.history.length > 1 && <Sparkline values={c.history} />}
      </div>

      {c.risk ? (
        <p className="dg-forecast"><span className="eyebrow">Next {Math.max(1, Math.round((c.risk.forecast?.horizonTicks ?? 2) * 0.5))} h</span> {c.risk.forecast?.text || c.risk.action}</p>
      ) : (
        <p className="dg-forecast muted">{c.lead.note ?? (c.lead.status === 'thinking' || c.lead.status === 'spawning' ? 'Forecasting the next hour…' : 'Awaiting risk assessment.')}</p>
      )}
      {c.risk?.action && c.risk.forecast?.text && <p className="dg-action">→ {c.risk.action}</p>}

      {c.alerts.length > 0 ? (
        <div className="dg-chips">{c.alerts.map((a) => <span key={a.key} className={'alert-chip ' + a.scope + ' svc-' + a.service} title={a.message}>{alertChipText(a)}</span>)}</div>
      ) : sev === 0 ? <div className="dg-chips"><span className="alert-chip quiet">no alerts · monitoring only</span></div> : null}

      {c.calls.length > 0 && <CallsRow calls={c.calls} />}

      {p && (
        <div className="dg-plan">
          <span className="eyebrow">Evacuation plan</span>
          <span className="mono">{p.routes.length} routes{modes && (modes.air || modes.boat) ? ` (${[modes.road && `${modes.road} road`, modes.air && `${modes.air} air`, modes.boat && `${modes.boat} boat`].filter(Boolean).join(', ')})` : ''} · {p.fireCrews} crews · airlift {p.airlift ? 'yes' : 'no'}{p.shelters.length ? ` · ${p.shelters.length} shelters` : ''}</span>
          {p.summary && <span className="dg-plan-sum">{p.summary}</span>}
        </div>
      )}

      <footer className="dg-foot">
        <span className={'vbadge2 ' + vState} title={v?.verdict.reasons.join(' · ')}>
          {vState === 'ok' ? '✓ accepted' : vState === 'bad' ? `✗ rejected${v?.verdict.reasons[0] ? ' — ' + v.verdict.reasons[0] : ''}` : vState === 'auditing' ? 'verifier auditing…' : vState === 'pending' ? 'awaiting verifier' : 'no plan yet'}
        </span>
        {c.helpers.length > 0 && <span className="dg-helpers">{c.helpers.map((h) => <span key={h.id} className="helper-chip" data-status={h.status} style={{ ['--c' as any]: ROLE_COLOR[h.role] ?? '#6b7280' }}>{h.role}</span>)}</span>}
        <span className="mono muted small dg-tok">{c.tokens.toLocaleString()} tok</span>
      </footer>
    </article>
  );
}

function CallsRow({ calls }: { calls: CallRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sel = calls.find((x) => x.key === open);
  return (
    <div className="dg-calls">
      <span className="eyebrow">Calls</span>
      <div className="dg-chips">
        {calls.map((x) => (
          <button key={x.key} className={'call-chip st-' + x.status + (open === x.key ? ' open' : '')} onClick={() => setOpen(open === x.key ? null : x.key)} title="Show the spoken script">
            <i className="call-dot" />📞 {CALL_ROLE_LABEL[x.role] ?? x.role} <span className="mono">{maskNumber(x.to, false)}</span> · {x.status === 'simulated' ? <span className="sim-badge">simulated</span> : x.status}
          </button>
        ))}
      </div>
      {sel && <blockquote className="call-script">“{sel.script || '(no script)'}”</blockquote>}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 54, h = 14, n = values.length;
  const x = (i: number) => (n <= 1 ? w : (i / (n - 1)) * w);
  const y = (v: number) => h - 1 - (v / 3) * (h - 2);
  let d = `M0 ${y(values[0])}`;
  values.forEach((v, i) => { if (i > 0) d += ` H${x(i).toFixed(1)} V${y(v).toFixed(1)}`; });
  const last = values[n - 1];
  return (
    <svg className="dg-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={`severity history ${values.join(',')}`}>
      <path d={d} fill="none" stroke={SEVERITY_COLOR[last] ?? '#8a817a'} strokeWidth="1.5" />
      <circle cx={x(n - 1)} cy={y(last)} r="2" fill={SEVERITY_COLOR[last] ?? '#8a817a'} />
    </svg>
  );
}
