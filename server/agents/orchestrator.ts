// Recursive response team: chief -> district agents -> helpers; verifier gates every plan (Done Means Done).
import type { AgentNode, AgentRole, DistrictPlan, LngLat, Playbook, RoutePlan, VerifierVerdict, AlertSpec } from '../../shared/types.ts';
import type { SimApi } from '../sim/api.ts';
import { emit as busEmit } from '../bus.ts';
import type { CascadeEvent } from '../../shared/types.ts';
import { bootAgent, agentStatus, agentRemember, claimResources, releaseResources, initLedger } from '../infra/terse.ts';
import { ensureAgent, relaySend, relayReply, relayInbox, runChannel, shortRun, slug } from '../infra/relay.ts';

// ---- sponsor hooks: every agent gets a Terse durable actor + an Agent Relay identity ----
/** relay handle for an agent node (unique per run) */
function relayName(_runId: string, a: { id: string; role: string; districtId?: string }): string {
  // standing identities (pre-registered at boot, see prewarmRelay); messages are scoped to the run in the inbox
  if (a.role === 'chief') return 'chief';
  if (a.role === 'district') return `district-${slug(a.districtId ?? a.id)}`;
  if (a.role === 'verifier') return 'verifier';
  if (a.role === 'research') return 'research';
  return `${a.role}-${slug(a.districtId ?? a.id)}`;
}
function emit(ev: CascadeEvent) {
  if (ev.type === 'agent.spawn') {
    const handle = relayName(ev.runId, ev.agent);
    ev = { ...ev, agent: { ...ev.agent, terseActorId: `ResponderAgent/${ev.agent.id}`, relayHandle: handle } };
    const a = ev.agent;
    void bootAgent({ agentId: a.id, runId: ev.runId, role: a.role, label: a.label, districtId: a.districtId, model: a.model, parentId: a.parentId }).catch(() => {});
    if (['chief', 'district', 'verifier'].includes(a.role) || process.env.RELAY_HELPER_IDENTITIES === '1') void ensureAgent(ev.runId, handle).catch(() => null);
  } else if (ev.type === 'agent.status') {
    agentStatus(ev.agentId, ev.status, ev.note);
  } else if (ev.type === 'agent.plan') {
    agentRemember(ev.agentId, 'plan', ev.plan.summary);
  } else if (ev.type === 'verifier.verdict') {
    agentRemember(ev.agentId, 'verdict', `${ev.verdict.accepted ? 'ACCEPT' : 'REJECT'} ${ev.verdict.districtId ?? ''}: ${ev.verdict.reasons.join('; ')}`);
  }
  busEmit(ev);
}
/** relay message id of each district agent's latest plan post, so the verifier can reply in-thread */
const planPosts = new Map<string, Promise<string | null>>();
/** Terse ledger claims per district agent (released if the verifier rejects, so the re-plan can re-claim) */
const agentClaims = new Map<string, { resource: string; granted: number }[]>();
import { placeCall, callScripts, callsAvailable } from './telephony.ts';
import { chatJSON, isMock, MODELS } from './crusoe.ts';
import { researchDistrict } from './research.ts';

// ---- per-run bookkeeping ----
interface RunStats { chiefId: string; attempts: Map<string, number>; accepted: number; rejected: number; replans: number; errors: number; llmCalls: number; tokens: number }
const runs = new Map<string, RunStats>();
export function getRunStats(runId: string) {
  const s = runs.get(runId);
  return s ? { accepted: s.accepted, rejected: s.rejected, replans: s.replans, errors: s.errors, llmCalls: s.llmCalls, tokens: s.tokens } : { accepted: 0, rejected: 0, replans: 0, errors: 0, llmCalls: 0, tokens: 0 };
}
export function forgetRun(runId: string) { runs.delete(runId); }

// ---- tiny semaphore (RPM protection) ----
function semaphore(n: number) {
  let active = 0; const q: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>(r => q.push(r));
    active++;
    try { return await fn(); } finally { active--; q.shift()?.(); }
  };
}
const limit = semaphore(Number(process.env.AGENT_CONCURRENCY) || 6);

function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
function offset(at: LngLat, idx: number, scale = 0.03): LngLat {
  const a = (idx * 2.399) % (Math.PI * 2); // golden-angle fan
  return { lng: at.lng + Math.cos(a) * scale, lat: at.lat + Math.sin(a) * scale * 0.8 };
}
const S = (s: any, n = 400) => String(s ?? '').slice(0, n);

interface Assignment { districtId: string; priority: number; resourceHint: { fireCrews: number; airlift: boolean }; why: string }
interface RawRoute { toInfraId: string; mode: 'road' | 'air' | 'boat'; capacity: number; label: string }
interface RawPlan { summary: string; routes: RawRoute[]; fireCrews: number; shelters: string[]; airlift: boolean; helpersRequested: AgentRole[]; severity?: number; alerts?: { service?: string; scope?: string; message?: string }[] }
/** latest per-district risk assessment, written by the run loop every tick so planners see the one-hour forecast */
export const riskContext = new Map<string, { severity: number; label: string; trend: string; forecast: string; action: string }>();
/** districts the run loop re-dispatched because their risk rose; value = reason shown to the planner */
export const escalations = new Map<string, string>();
const ALERT_SERVICES = ['fire', 'police', 'medical', 'helicopter', 'boat', 'regional', 'public'] as const;

function logLLM(role: string, r: { model: string; ms: number; tokens: number; mock: boolean }, extra = '', st?: RunStats) {
  if (st) { st.llmCalls++; st.tokens += r.tokens; }
  emit({ type: 'log', level: 'info', text: `[llm ${role} ${r.model}${r.mock ? ' mock' : ''}] ${r.ms}ms ${r.tokens} tok ${extra}`.trim() });
}

// =====================================================================
export async function respond(sim: SimApi, playbook: Playbook, runId: string, districtIds: string[]): Promise<void> {
  if (!districtIds.length) return;
  const region = sim.region;
  let st = runs.get(runId);
  const chiefId = `chief-${runId}`;
  const firstCall = !st;
  if (!st) {
    st = { chiefId, attempts: new Map(), accepted: 0, rejected: 0, replans: 0, errors: 0, llmCalls: 0, tokens: 0 };
    runs.set(runId, st);
    const node: AgentNode = { id: chiefId, role: 'chief', model: MODELS.chief, label: `Chief (${region.name})`, at: region.center, status: 'spawning', depth: 0 };
    emit({ type: 'agent.spawn', runId, agent: node });
  }
  emit({ type: 'agent.status', runId, agentId: chiefId, status: 'thinking', note: `${firstCall ? 'initial' : 'cascade'} triage: ${districtIds.join(', ')}` });

  const dnames = districtIds.map(id => { const d = region.districts.find(x => x.id === id); const s = sim.districtState(id); return `${id} (${d?.name ?? id}, pop ${d?.population ?? '?'}, shaking ${s.shaking.toFixed(2)}, fires ${s.fires}, flooded ${s.flooded}, slides ${s.landslides}, cutOff ${s.cutOff}, stranded ${s.stranded})`; });
  // compact sitrep: drop per-infra shelter/hospital status lines (district agents get those) and cap length
  const sitrep = sim.describe().split('\n').filter(l => !/\b(shelter|hospital)s?\b/i.test(l) || /cut.?off|closed/i.test(l)).join('\n').slice(0, 1200);
  const chief = await chatJSON<{ assignments: Assignment[]; memoryNotes: string[] }>({
    role: 'chief',
    system: `You are the incident chief for ${region.name}. Triage affected districts and assign priorities and resource hints to district agents. Follow the playbook rules.`,
    user: `SITREP tick ${sim.tick}:\n${sitrep}\n\nPlaybook rules:\n- ${playbook.rules.join('\n- ')}\n\nAffected districts needing a plan:\n${dnames.join('\n')}\n\nResources available: fireCrews=${sim.resources.fireCrews}, helicopters=${sim.resources.helicopters}, boats=${sim.resources.boats}\nAssign every listed district. priority 1 = most urgent. Keep "why" under 12 words; at most 2 memoryNotes.`,
    schemaHint: '{"assignments":[{"districtId":string,"priority":1-5,"resourceHint":{"fireCrews":number,"airlift":boolean},"why":string}],"memoryNotes":[string]}',
    maxTokens: 1024,
    mock: () => mockChief(sim, districtIds),
  });
  logLLM('chief', chief, `${chief.data.assignments?.length ?? 0} assignments`, st);
  let assignments: Assignment[] = Array.isArray(chief.data.assignments) ? chief.data.assignments.filter(a => districtIds.includes(a.districtId)) : [];
  for (const id of districtIds) if (!assignments.some(a => a.districtId === id)) assignments.push({ districtId: id, priority: 3, resourceHint: { fireCrews: 1, airlift: sim.districtState(id).cutOff }, why: 'chief omitted; default assignment' });
  assignments.sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3));
  emit({ type: 'agent.status', runId, agentId: chiefId, status: 'done', note: assignments.map(a => `${a.districtId}:p${a.priority}`).join(' '), tokens: chief.tokens });
  // ---- Terse: stock this run's ResourceLedger once; Relay: chief posts triage + DMs each district agent ----
  if (firstCall) void initLedger(runId, region.id).catch(() => null);
  {
    const chiefHandle = relayName(runId, { id: chiefId, role: 'chief' });
    void relaySend(runId, chiefHandle, `#${runChannel(runId)}`, `TRIAGE tick ${sim.tick} (${region.name}): ${assignments.map(a => `${a.districtId} p${a.priority}`).join(', ')}`);
    for (const a of assignments) {
      const dName = relayName(runId, { id: a.districtId, role: 'district', districtId: a.districtId });
      void relaySend(runId, chiefHandle, `@${dName}`, `ASSIGNMENT ${a.districtId}: priority ${a.priority}. ${S(a.why, 160)}. Hint: crews ~${a.resourceHint?.fireCrews ?? 0}, airlift ${a.resourceHint?.airlift ? 'yes' : 'no'}. Claim scarce resources from the Terse ledger; check #${runChannel(runId)} for what other districts already took.`);
    }
  }
  for (const n of (chief.data.memoryNotes ?? []).slice(0, 6)) {
    const key = [...districtIds].sort((x, y) => y.length - x.length).find(id => String(n).toLowerCase().includes(id.toLowerCase())) ?? 'global';
    emit({ type: 'memory.update', key, value: S(n, 240) });
  }

  // research the top-priority district once per run (cheap)
  const tasks: Promise<unknown>[] = [];
  if (firstCall && assignments[0]) {
    const top = assignments[0];
    const d = region.districts.find(x => x.id === top.districtId);
    tasks.push(researchDistrict(region.id, d?.name ?? top.districtId, { runId, parentId: chiefId, at: d?.centroid, districtId: top.districtId }).catch(e => emit({ type: 'log', level: 'warn', text: `research failed: ${e.message}` })));
  }
  for (const a of assignments) tasks.push(limit(() => handleDistrict(sim, playbook, runId, st!, a, 1, []).catch(e => { st!.errors++; emit({ type: 'log', level: 'error', text: `district ${a.districtId} failed: ${e.message}` }); })));
  await Promise.all(tasks);
}

// =====================================================================
async function handleDistrict(sim: SimApi, playbook: Playbook, runId: string, st: RunStats, a: Assignment, attempt: number, rejectionReasons: string[]): Promise<void> {
  const region = sim.region;
  const district = region.districts.find(d => d.id === a.districtId);
  if (!district) return;
  const n = (st.attempts.get(a.districtId) ?? 0) + 1;
  st.attempts.set(a.districtId, n);
  const agentId = `d-${a.districtId}-${runId}-${n}`;
  const node: AgentNode = { id: agentId, parentId: st.chiefId, role: 'district', model: MODELS.district, label: `${district.name} planner${attempt > 1 ? ' (re-plan)' : ''}`, districtId: a.districtId, at: district.centroid, status: 'spawning', depth: 1 };
  emit({ type: 'agent.spawn', runId, agent: node });
  emit({ type: 'agent.status', runId, agentId, status: 'thinking', note: attempt > 1 ? `re-planning after rejection: ${rejectionReasons.join('; ').slice(0, 160)}` : `priority ${a.priority}: ${S(a.why, 120)}` });

  const infraState = new Map(sim.snapshot().infra.map(i => [i.id, i.status]));
  const km = (p: LngLat) => Math.round(Math.hypot((p.lng - district.centroid.lng) * 88, (p.lat - district.centroid.lat) * 111));
  const badInfra = (id: string) => rejectionReasons.some(r => r.includes(id) || r.includes(region.infra.find(i => i.id === id)?.name ?? '\u0000'));
  const infraForDistrict = region.infra
    .filter(i => infraState.get(i.id) !== 'closed' && !badInfra(i.id))
    .filter(i => i.districtIds.includes(a.districtId) || ((i.kind === 'shelter' || i.kind === 'hospital' || i.kind === 'airport') && km(i.at) <= 20))
    .sort((x, y) => km(x.at) - km(y.at)).slice(0, 10);
  // NOTE: hazard-adjacent shelters are deliberately still offered; the verifier (Done Means Done) must catch them.
  const offeredIds = new Set(infraForDistrict.map(i => i.id));
  const infraList = infraForDistrict.map(i => `${i.id} (${i.kind}, ${i.name}, ${km(i.at)} km, ${infraState.get(i.id) ?? 'open'}${i.capacity ? `, cap ${i.capacity}` : ''})`).join('\n');
  const state = sim.districtState(a.districtId);
  const myHandle = relayName(runId, { id: agentId, role: 'district', districtId: a.districtId });
  const inbox = relayInbox(runId, myHandle, 8);
  if (inbox.length) emit({ type: 'agent.status', runId, agentId, status: 'thinking', note: `read ${inbox.length} relay message(s) from inbox` });
  const relayBlock = `\n\nAGENT RELAY INBOX (messages other agents sent you; other districts' resource claims are already deducted from the shared Terse ledger, so plan around them):\n${inbox.length ? inbox.map(l => `- ${l}`).join('\n') : '- (no relay messages yet)'}`;

  const plan = await chatJSON<RawPlan>({
    role: 'district',
    system: `You are the district response agent for ${district.name}. The chief notified you of a risk in your district. 1) Read the one-hour forecast and judge SEVERITY 0-3 (0 monitoring: no public alert; 1 alert: notify district fire/medical, stage shelters; 2 evacuate: evacuate at-risk cells, open shelters, dispatch crews, public warning; 3 escalate: request regional helicopters/boats and alert every service immediately). 2) Notify the appropriate emergency services via alerts (do not alert everyone when severity is low). 3) Produce a concrete evacuation plan: routes to shelters/hospitals, fire crews, airlift. You may request up to 2 helper specialists (roles: route, firecrew, shelter, airlift, supply). Follow playbook rules.`,
    user: `${sim.describe(a.districtId)}\n\nRISK ASSESSMENT (chief's monitor): ${(() => { const r = riskContext.get(a.districtId); return r ? `severity ${r.severity} (${r.label}, ${r.trend}). ${r.forecast}. Suggested action: ${r.action}` : 'no forecast yet'; })()}${escalations.has(a.districtId) ? `\nESCALATION: ${escalations.get(a.districtId)} — your previous plan is no longer enough; produce a stronger one.` : ''}\n\nPlaybook rules:\n- ${playbook.rules.join('\n- ')}\n\nChief hint: priority ${a.priority}, fireCrews ~${a.resourceHint?.fireCrews ?? 0}, airlift ${a.resourceHint?.airlift ? 'yes' : 'no'}. ${S(a.why, 200)}\nResources: fireCrews=${sim.resources.fireCrews}, helicopters=${sim.resources.helicopters}, boats=${sim.resources.boats}\nInfra ids available:\n${infraList}\n${rejectionReasons.length ? `\nPREVIOUS PLAN REJECTED by verifier. Fix these: ${rejectionReasons.join('; ')}\n` : ''}Routes: toInfraId MUST be one of the ids listed above (nearest first), mode road|air|boat, capacity = total people to move, short label. Prefer the nearest open shelter/hospital; never route to infra marked damaged.${relayBlock}`,
    schemaHint: '{"severity":0|1|2|3,"alerts":[{"service":"fire"|"police"|"medical"|"helicopter"|"boat"|"regional"|"public","scope":"district"|"regional","message":string}],"summary":string,"routes":[{"toInfraId":string,"mode":"road"|"air"|"boat","capacity":number,"label":string}],"fireCrews":number,"shelters":[string],"airlift":boolean,"helpersRequested":[string]}',
    maxTokens: 1500,
    mock: () => mockDistrictPlan(sim, a, attempt, rejectionReasons),
  });
  logLLM('district', plan, `${a.districtId} attempt ${attempt}`, st);
  const raw = plan.data ?? ({} as RawPlan);
  const validRoles: AgentRole[] = ['route', 'firecrew', 'shelter', 'airlift', 'supply'];
  const helpers = (Array.isArray(raw.helpersRequested) ? raw.helpersRequested : []).map(h => String(h).toLowerCase() as AgentRole).filter(h => validRoles.includes(h)).filter((h, i, arr) => arr.indexOf(h) === i).slice(0, Number(process.env.HELPERS_PER_DISTRICT) || 2);
  const openInfra = (id: string) => offeredIds.has(id) || (region.infra.find(i => i.id === id) && infraState.get(id) !== 'closed' && !badInfra(id));

  // ---- helpers (depth 2), in parallel ----
  const helperOut: Record<string, any> = {};
  if (helpers.length) {
    emit({ type: 'agent.status', runId, agentId, status: 'thinking', note: `consulting helpers: ${helpers.join(', ')}` });
    await Promise.all(helpers.map((role, idx) => runHelper(sim, runId, st, agentId, district, role, idx, raw, infraList, state.fires).then(o => { helperOut[role] = o; })));
  }
  // merge helper outputs (simple overrides)
  let rawRoutes: RawRoute[] = Array.isArray(raw.routes) ? raw.routes.filter(r => r && r.toInfraId && openInfra(String(r.toInfraId))) : [];
  if (helperOut.route?.orderedInfraIds?.length) {
    const ordered: string[] = helperOut.route.orderedInfraIds.map(String).filter((id: string) => offeredIds.has(id));
    const byId = new Map(rawRoutes.map(r => [r.toInfraId, r]));
    rawRoutes = ordered.filter((id, i) => byId.has(id) || i === 0).map((id): RawRoute => byId.get(id) ?? { toInfraId: id, mode: 'road' as const, capacity: Math.max(500, state.stranded), label: `to ${id} (route helper)` }).concat(rawRoutes.filter(r => !ordered.includes(r.toInfraId)));
  }
  let fireCrews = Number.isFinite(+raw.fireCrews) ? Math.max(0, Math.round(+raw.fireCrews)) : 0;
  if (Number.isFinite(+helperOut.firecrew?.fireCrews)) fireCrews = Math.max(0, Math.round(+helperOut.firecrew.fireCrews));
  let shelters: string[] = (Array.isArray(raw.shelters) ? raw.shelters.map(String) : []).filter(openInfra);
  if (helperOut.shelter?.shelterIds?.length) shelters = helperOut.shelter.shelterIds.filter(openInfra);
  let airlift = !!raw.airlift;
  if (typeof helperOut.airlift?.yes === 'boolean') airlift = helperOut.airlift.yes;
  if (typeof helperOut.supply?.yes === 'boolean' && helperOut.supply.yes && !airlift) airlift = state.cutOff;

  // ---- resolve routes server-side ----
  const routes: RoutePlan[] = [];
  const notes: string[] = [];
  rawRoutes.slice(0, 4).forEach((r, i) => {
    const infra = region.infra.find(x => x.id === r.toInfraId);
    if (!infra) { notes.push(`dropped route to unknown ${r.toInfraId}`); return; }
    let mode = (['road', 'air', 'boat'].includes(r.mode) ? r.mode : 'road') as RoutePlan['mode'];
    let path = sim.findRoute(district.centroid, infra.at, mode);
    if (!path && mode === 'road' && airlift) { mode = 'air'; path = sim.findRoute(district.centroid, infra.at, 'air'); notes.push(`road to ${infra.id} blocked; switched to air`); }
    if (!path) { notes.push(`no ${mode} route to ${infra.id}; dropped`); return; }
    routes.push({ id: `${agentId}-r${i}`, districtId: a.districtId, mode, from: district.centroid, to: infra.at, path, capacity: Math.max(1, Math.round(+r.capacity || 200)), label: S(r.label || `to ${infra.name}`, 60) });
    if (!shelters.includes(infra.id) && (infra.kind === 'shelter' || infra.kind === 'hospital')) shelters.push(infra.id);
  });
  if (!shelters.length && routes.length === 0) {
    const near = sim.nearestSafeInfra(a.districtId);
    if (near) { const infra = region.infra.find(x => x.id === near.id)!; routes.push({ id: `${agentId}-rN`, districtId: a.districtId, mode: 'road', from: district.centroid, to: infra.at, path: near.path, capacity: 200, label: `nearest safe: ${infra.name}` }); shelters.push(near.id); notes.push('fallback to nearest safe infra'); }
  }
  // cheap sanity repairs only (unknown/unoffered infra already dropped above). Hazard-crossing routes and
  // shelters inside burning/flooded cells are intentionally LEFT IN so the verifier rejects and the district re-plans.
  if (fireCrews > sim.resources.fireCrews) { notes.push(`crews clamped ${fireCrews} -> ${sim.resources.fireCrews}`); fireCrews = sim.resources.fireCrews; }
  if (!routes.length) {
    const near = sim.nearestSafeInfra(a.districtId);
    if (near && !badInfra(near.id)) { const infra = region.infra.find(x => x.id === near.id)!; routes.push({ id: `${agentId}-rN`, districtId: a.districtId, mode: 'road', from: district.centroid, to: infra.at, path: near.path, capacity: Math.max(500, state.stranded), label: `nearest safe: ${infra.name}` }); if (!shelters.includes(near.id)) shelters.push(near.id); notes.push('repaired with nearest safe infra'); }
    else if (sim.resources.helicopters > 0) { airlift = true; notes.push('no viable road destination; airlift'); }
  }
  // ---- severity + emergency-service alerts (tiered: low severity must not alert everyone) ----
  const ctx = riskContext.get(a.districtId);
  let severity = Number.isFinite(+raw.severity!) ? Math.max(0, Math.min(3, Math.round(+raw.severity!))) : (ctx?.severity ?? 1);
  if (ctx && severity < ctx.severity - 1) severity = ctx.severity - 1; // planner may soften by one tier, not ignore a rising forecast
  const alerts: AlertSpec[] = (Array.isArray(raw.alerts) ? raw.alerts : [])
    .filter(x => x && ALERT_SERVICES.includes(String(x.service) as any))
    .map(x => ({ service: String(x.service) as AlertSpec['service'], scope: (x.scope === 'regional' ? 'regional' : 'district') as AlertSpec['scope'], message: S(String(x.message || ''), 140) }))
    .slice(0, 6);
  if (severity >= 1 && state.fires > 0 && !alerts.some(x => x.service === 'fire')) alerts.push({ service: 'fire', scope: 'district', message: `${state.fires} burning cells in ${district.name}; ${fireCrews} crews requested` });
  if (severity >= 2 && !alerts.some(x => x.service === 'public')) alerts.push({ service: 'public', scope: 'district', message: `Evacuation warning for at-risk cells in ${district.name}` });
  if (severity >= 3 && !alerts.some(x => x.scope === 'regional')) alerts.push({ service: state.flooded > 0 ? 'boat' : 'helicopter', scope: 'regional', message: `${district.name}: ${state.cutOff ? 'district cut off; ' : ''}requesting ${state.flooded > 0 ? 'boats' : 'helicopters'} from the regional pool now` });
  if (severity === 0) alerts.length = 0; // monitoring: no alerts
  for (const al of alerts) emit({ type: 'alert', runId, tick: sim.tick, districtId: a.districtId, service: al.service, scope: al.scope, message: al.message, agentId });
  if (alerts.length) emit({ type: 'agent.status', runId, agentId, status: 'thinking', note: `severity ${severity} · alerted ${alerts.map(x => `${x.service}${x.scope === 'regional' ? ' (regional)' : ''}`).join(', ')}` });
  escalations.delete(a.districtId);
  // ---- Terse ResourceLedger: claim scarce El Nino storm resources (one actor per run => no double-booking) ----
  const wants: [string, number][] = [
    ['swiftwater_teams', Math.min(3, Math.max(state.flooded > 0 ? 1 : 0, fireCrews))],
    ['helicopters', airlift ? 1 : 0],
    ['pump_crews', state.flooded > 0 ? 1 : 0],
    ['sandbag_trucks', severity >= 1 ? 1 + (state.landslides > 0 ? 1 : 0) : 0],
    ['shelter_beds', Math.min(6000, routes.reduce((t, r) => t + (r.capacity || 0), 0))],
  ];
  const claimLines: string[] = [];
  const claimed: { resource: string; granted: number }[] = [];
  await Promise.all(wants.filter(([, n]) => n > 0).map(async ([res, n]) => {
    const r = await claimResources(runId, agentId, a.districtId, res, n).catch(() => null);
    if (!r) return;
    if (r.granted > 0) claimed.push({ resource: res, granted: r.granted });
    claimLines.push(`${res} ${r.granted}/${r.requested} ${r.status}`);
    if (r.status !== 'granted') {
      notes.push(`ledger ${r.status}: ${res} ${r.granted}/${r.requested} (pool exhausted by other districts)`);
      emit({ type: 'log', level: 'warn', text: `[terse ledger] ${a.districtId} ${r.status} ${res}: got ${r.granted}/${r.requested}, ${r.remaining} left` });
    }
  }));
  if (claimed.length) agentClaims.set(agentId, claimed);
  if (claimLines.length) emit({ type: 'agent.status', runId, agentId, status: 'thinking', note: `Terse ledger: ${claimLines.join(', ')}` });
  const finalPlan: DistrictPlan = { districtId: a.districtId, summary: S(raw.summary || 'plan', 300) + (notes.length ? ` [${notes.join('; ')}]` : ''), routes, fireCrews, shelters, airlift, helpersRequested: helpers, severity, alerts };
  agentRemember(agentId, 'relay-inbox', inbox.join('\n') || '(empty)', sim.tick, 'relay');
  planPosts.set(agentId, relaySend(runId, myHandle, `#${runChannel(runId)}`, `PLAN ${district.name}${attempt > 1 ? ' (re-plan)' : ''} sev ${severity}: ${S(raw.summary || 'plan', 220)}${claimLines.length ? ` | Terse claims: ${claimLines.join(', ')}` : ''}`));

  // ---- verifier (Done Means Done) ----
  const verdict = await verify(sim, runId, st, agentId, district, finalPlan, attempt, n);
  if (verdict.accepted) {
    sim.applyPlan(finalPlan);
    // ---- phone notifications: escalated districts call the district emergency contact, then a resident ----
    if (Math.max(severity, ctx?.severity ?? 0) >= 2 && callsAvailable(runId, 'citizen') > 0) {
      const routesLabel = routes.map(r => r.label.replace(/^to /, '')).slice(0, 2).join(' or ');
      const scripts = callScripts(district.name, ['monitoring', 'alert', 'evacuate', 'escalate'][severity], ctx?.forecast ?? 'conditions are worsening', { shelters, routesLabel, airlift, fireCrews });
      emit({ type: 'agent.status', runId, agentId, status: 'thinking', note: `severity ${severity}: plan accepted — phoning residents with evacuation instructions` });
      void placeCall({ runId, tick: sim.tick, districtId: a.districtId, agentId, role: 'citizen', script: scripts.citizen })
        .catch(e => emit({ type: 'log', level: 'warn', text: `[call] ${a.districtId}: ${e?.message ?? e}` }));
    }
    st.accepted++;
    emit({ type: 'agent.plan', runId, agentId, plan: finalPlan });
    emit({ type: 'agent.status', runId, agentId, status: 'done', note: finalPlan.summary.slice(0, 200), tokens: plan.tokens });
    emit({ type: 'score.update', runId, score: sim.score() });
    return;
  }
  st.rejected++;
  for (const c of agentClaims.get(agentId) ?? []) void releaseResources(runId, agentId, a.districtId, c.resource, c.granted).catch(() => null);
  agentClaims.delete(agentId);
  emit({ type: 'agent.status', runId, agentId, status: 'rejected', note: verdict.reasons.join('; ').slice(0, 200), tokens: plan.tokens });
  if (attempt < 2) {
    st.replans++;
    emit({ type: 'log', level: 'warn', text: `[verifier] ${a.districtId} rejected (attempt ${attempt}); re-planning` });
    return handleDistrict(sim, playbook, runId, st, a, attempt + 1, verdict.reasons);
  }
  emit({ type: 'log', level: 'warn', text: `[verifier] ${a.districtId} rejected twice; applying best-effort plan` });
  st.errors++;
  sim.applyPlan(finalPlan);
  emit({ type: 'agent.plan', runId, agentId, plan: finalPlan });
  emit({ type: 'agent.status', runId, agentId, status: 'error', note: `best-effort applied after 2 rejections: ${verdict.reasons.join('; ').slice(0, 150)}` });
  emit({ type: 'score.update', runId, score: sim.score() });
}

// =====================================================================
async function runHelper(sim: SimApi, runId: string, st: RunStats, parentId: string, district: { id: string; name: string; centroid: LngLat }, role: AgentRole, idx: number, raw: RawPlan, infraList: string, fires: number): Promise<any> {
  const id = `${parentId}-h-${role}`;
  const node: AgentNode = { id, parentId, role, model: MODELS[role], label: `${role} helper (${district.name})`, districtId: district.id, at: offset(district.centroid, idx + 1), status: 'spawning', depth: 2 };
  emit({ type: 'agent.spawn', runId, agent: node });
  emit({ type: 'agent.status', runId, agentId: id, status: 'thinking' });
  const q: Record<string, { ask: string; schema: string; mock: () => any }> = {
    route: { ask: 'Re-rank which shelters/hospitals this district should route to given current hazards and road closures. Return ordered infra ids, best first (max 3).', schema: '{"orderedInfraIds":[string],"why":string}', mock: () => { const near = sim.nearestSafeInfra(district.id); const ids = [near?.id, ...(raw.routes ?? []).map(r => r.toInfraId)].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3); return { orderedInfraIds: ids, why: 'nearest open shelter by road first' }; } },
    firecrew: { ask: `Justify how many fire crews to commit. Active fire cells: ${fires}. Planner proposed ${raw.fireCrews}.`, schema: '{"fireCrews":number,"why":string}', mock: () => ({ fireCrews: Math.max(fires ? 1 : 0, Math.ceil(fires * 0.6)), why: `${fires} burning cells, 0.6 crews per cell` }) },
    shelter: { ask: 'Which shelter/hospital ids have capacity for this district? Return ids with spare capacity (max 3).', schema: '{"shelterIds":[string],"why":string}', mock: () => ({ shelterIds: (raw.shelters ?? []).slice(0, 3), why: 'open shelters with listed capacity' }) },
    airlift: { ask: 'Should we commit helicopters to this district? Answer yes/no with capacity (people per tick).', schema: '{"yes":boolean,"capacity":number,"why":string}', mock: () => ({ yes: !!raw.airlift, capacity: raw.airlift ? 40 : 0, why: raw.airlift ? 'district cut off by road' : 'roads open' }) },
    supply: { ask: 'Does this district need an emergency supply drop? yes/no with capacity (tons per tick).', schema: '{"yes":boolean,"capacity":number,"why":string}', mock: () => ({ yes: !!raw.airlift, capacity: 2, why: 'supply with airlift if cut off' }) },
  };
  const spec = q[role] ?? q.supply;
  try {
    const r = await chatJSON<any>({
      role,
      system: `You are a ${role} specialist helping the ${district.name} district planner. Be concise and decisive.`,
      user: `${sim.describe(district.id)}\nDraft plan: ${S(JSON.stringify(raw), 600)}\nInfra:\n${infraList}\n\nQuestion: ${spec.ask}`,
      schemaHint: spec.schema,
      maxTokens: 1024,
      mock: spec.mock,
    });
    logLLM(role, r, district.id, st);
    emit({ type: 'agent.status', runId, agentId: id, status: 'done', note: S(r.data?.why ?? JSON.stringify(r.data), 160), tokens: r.tokens });
    void relaySend(runId, relayName(runId, { id, role, districtId: district.id }), `@${relayName(runId, { id: parentId, role: 'district', districtId: district.id })}`, `${role.toUpperCase()} finding for ${district.name}: ${S(JSON.stringify(r.data), 300)}`);
    return r.data;
  } catch (e: any) {
    emit({ type: 'agent.status', runId, agentId: id, status: 'error', note: e.message.slice(0, 160) });
    return {};
  }
}

// =====================================================================
async function verify(sim: SimApi, runId: string, st: RunStats, districtAgentId: string, district: { id: string; name: string; centroid: LngLat }, plan: DistrictPlan, attempt: number, n: number): Promise<VerifierVerdict> {
  const id = `v-${district.id}-${runId}-${n}`;
  const node: AgentNode = { id, parentId: districtAgentId, role: 'verifier', model: MODELS.verifier, label: `Verifier (${district.name})`, districtId: district.id, at: offset(district.centroid, 0, 0.035), status: 'spawning', depth: 2 };
  emit({ type: 'agent.spawn', runId, agent: node });
  emit({ type: 'agent.status', runId, agentId: id, status: 'thinking', note: 'deterministic checks' });
  const det = sim.checkPlan(plan);
  const checks = [...(det.checks ?? [])];
  let accepted = det.accepted;
  const reasons = [...(det.reasons ?? [])];
  let tokens = 0;
  if (isMock()) {
    await new Promise(r => setTimeout(r, 300 + (hash(id) % 300)));
    if (attempt === 1 && hash(district.id + ':7') % 10 < 3) { // seeded ~30% mock rejection so the re-plan loop is visible
      accepted = false;
      const reason = 'shelter capacity insufficient for projected evacuees; add a second destination';
      checks.push({ name: 'capacity-margin', pass: false, detail: reason });
      reasons.push(reason);
    } else if (!reasons.length) reasons.push('deterministic checks passed');
  } else {
    try {
      const r = await chatJSON<{ accepted: boolean; reasons: string[] }>({
        role: 'verifier',
        system: 'You are the Done-Means-Done verifier. Reject ONLY for real safety or feasibility problems: routes through hazards, destinations inside burning/flooded cells, exceeding available resources, ignoring cut-off status, or leaving people without any destination. If every deterministic check passed, accept unless you see a clear safety flaw; do not reject for wording, minor count mismatches, or stylistic issues.',
        user: `${sim.describe(district.id)}\n\nPlan: ${S(JSON.stringify({ ...plan, routes: plan.routes.map(r => ({ to: r.label, mode: r.mode, capacity: r.capacity, hops: r.path.length })) }), 900)}\nResources: fireCrews=${sim.resources.fireCrews}, helicopters=${sim.resources.helicopters}\nDeterministic checks: ${JSON.stringify(det.checks)}`,
        schemaHint: '{"accepted":boolean,"reasons":[string]}',
        maxTokens: 1024,
      });
      logLLM('verifier', r, district.id, st);
      tokens = r.tokens;
      const llmOk = !!r.data?.accepted;
      checks.push({ name: 'llm-review', pass: llmOk, detail: (r.data?.reasons ?? []).join('; ').slice(0, 200) });
      accepted = accepted && llmOk;
      reasons.push(...(r.data?.reasons ?? []).map(String).slice(0, 4));
    } catch (e: any) {
      checks.push({ name: 'llm-review', pass: true, detail: `LLM verifier unavailable (${e.message.slice(0, 80)}); deterministic only` });
      emit({ type: 'log', level: 'warn', text: `verifier LLM failed for ${district.id}: ${e.message}` });
    }
  }
  const verdict: VerifierVerdict = { accepted, reasons: reasons.slice(0, 6), districtId: district.id, checks };
  emit({ type: 'verifier.verdict', runId, agentId: id, verdict });
  void relayReply(runId, relayName(runId, { id, role: 'verifier' }), planPosts.get(districtAgentId) ?? null, `${accepted ? 'ACCEPT' : 'REJECT'} ${district.name}: ${verdict.reasons.join('; ').slice(0, 300)}`);
  emit({ type: 'agent.status', runId, agentId: id, status: accepted ? 'done' : 'rejected', note: verdict.reasons.join('; ').slice(0, 160), tokens });
  return verdict;
}

// =====================================================================
// ---- mock generators (deterministic, sim-grounded) ----
function mockChief(sim: SimApi, districtIds: string[]) {
  const scored = districtIds.map(id => { const s = sim.districtState(id); const d = sim.region.districts.find(x => x.id === id); const sev = s.shaking * 2 + s.fires * 0.3 + s.flooded * 0.2 + s.landslides * 0.3 + (s.cutOff ? 1.5 : 0) + (d?.population ?? 0) / 500000; return { id, s, d, sev }; }).sort((a, b) => b.sev - a.sev);
  return {
    assignments: scored.map((x, i) => ({ districtId: x.id, priority: Math.min(5, i + 1), resourceHint: { fireCrews: Math.ceil(x.s.fires * 0.6), airlift: x.s.cutOff }, why: `${x.d?.name ?? x.id}: shaking ${x.s.shaking.toFixed(2)}, ${x.s.fires} fires${x.s.cutOff ? ', CUT OFF' : ''}` })),
    memoryNotes: scored.slice(0, 2).map(x => `${x.id}: ${x.s.cutOff ? 'cut off by road; airlift needed' : 'roads open; prioritise shelters'}${x.s.fires ? `; ${x.s.fires} fire cells` : ''}`),
  };
}
function mockDistrictPlan(sim: SimApi, a: Assignment, attempt: number, rejectionReasons: string[] = []): RawPlan {
  const s = sim.districtState(a.districtId);
  const bad = (id: string) => rejectionReasons.some(r => r.includes(id));
  const cap1 = Math.max(300, Math.ceil(s.stranded * (attempt > 1 ? 1.3 : 1.0)));
  const near = sim.nearestSafeInfra(a.districtId);
  const region = sim.region;
  const infraState = new Map(sim.snapshot().infra.map(i => [i.id, i.status]));
  const openShelters = region.infra.filter(i => (i.kind === 'shelter' || i.kind === 'hospital') && infraState.get(i.id) !== 'closed' && !bad(i.id));
  const d = region.districts.find(x => x.id === a.districtId)!;
  const dist = (p: LngLat) => Math.hypot(p.lng - d.centroid.lng, p.lat - d.centroid.lat);
  const sorted = [...openShelters].sort((x, y) => dist(x.at) - dist(y.at));
  const routes: RawRoute[] = [];
  if (near && !bad(near.id)) routes.push({ toInfraId: near.id, mode: 'road', capacity: cap1, label: `road to ${region.infra.find(i => i.id === near.id)?.name ?? near.id}` });
  const second = sorted.find(i => i.id !== near?.id);
  if (second && (attempt > 1 || s.cutOff)) routes.push({ toInfraId: second.id, mode: s.cutOff ? 'air' : 'road', capacity: s.cutOff ? 400 : Math.ceil(cap1 / 2), label: `${s.cutOff ? 'airlift' : 'road'} to ${second.name}` });
  if (!routes.length && sorted[0]) routes.push({ toInfraId: sorted[0].id, mode: 'air', capacity: 400, label: `airlift to ${sorted[0].name}` });
  const helpers: AgentRole[] = [];
  if (s.fires > 0) helpers.push('firecrew');
  if (s.cutOff) helpers.push('airlift'); else helpers.push('route');
  if (attempt > 1 && !helpers.includes('shelter')) helpers.push('shelter');
  return {
    summary: `${d.name}: evacuate via ${routes.map(r => r.label).join(' + ')}; ${Math.ceil(s.fires * 0.6)} crews${s.cutOff ? '; airlift (cut off)' : ''}${attempt > 1 ? '; added secondary destination after rejection' : ''}`,
    routes,
    fireCrews: Math.ceil(s.fires * 0.6),
    shelters: routes.map(r => r.toInfraId),
    airlift: s.cutOff || (attempt > 1 && rejectionReasons.some(r => /stranded/i.test(r))),
    helpersRequested: helpers.slice(0, 2),
  };
}
