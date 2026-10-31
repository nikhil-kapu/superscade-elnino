// Run loop: one scenario at a time; ticks the sim every TICK_MS while the agent team plans CONCURRENTLY.
import type { Scenario } from '../shared/types.ts';
import type { SimApi } from './sim/api.ts';
import { emit } from './bus.ts';
import { getRegion } from './regions/index.ts';
import { simModule } from './sim/engine.ts';
import { getPlaybook } from './agents/playbook.ts';
import { respond, getRunStats, forgetRun, riskContext, escalations } from './agents/orchestrator.ts';
import { assessDistrict } from './risk.ts';
import { placeCall, callScripts, callsAvailable, callsPlaced, setRealCalls } from './agents/telephony.ts';
import type { DistrictState } from '../shared/types.ts';

export interface RunRequest { regionId: string; trigger?: { kind?: 'quake' | 'fire' | 'rain'; at?: { lng: number; lat: number }; params?: Record<string, number> }; seed?: number; realCalls?: boolean }

const PLANNING_DRAIN_TIMEOUT_MS = Number(process.env.PLANNING_DRAIN_TIMEOUT_MS) || 90_000;

let current: { runId: string; regionId: string; startedAt: number; sim?: SimApi } | null = null;
let lastRunSummary = 'No run yet.';
let lastRunRegion = 'nepal';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function getLastRunSummary() { return lastRunSummary; }
export function getLastRunRegion() { return lastRunRegion; }
export function isRunning() { return !!current; }
let stopRequested = false;
/** abort the current run at the next tick (used by the UI when a stray run blocks a fresh start) */
export function stopRun(): boolean { if (!current) return false; stopRequested = true; return true; }
export function currentRun() { return current ? { runId: current.runId, regionId: current.regionId, tick: current.sim?.tick ?? 0, startedAt: current.startedAt } : null; }

export function buildTrigger(regionId: string, t?: RunRequest['trigger']): Scenario['trigger'] {
  const region = getRegion(regionId);
  const kind = t?.kind ?? region.triggers[0]?.kind ?? (regionId === 'nepal' ? 'rain' : 'quake');
  const spec = region.triggers.find(x => x.kind === kind) ?? region.triggers[0];
  const params: Record<string, number> = {};
  for (const p of spec?.params ?? []) params[p.name] = p.default;
  for (const [k, v] of Object.entries(t?.params ?? {})) if (Number.isFinite(+v)) params[k] = +v;
  const at = t?.at && Number.isFinite(+t.at.lng) && Number.isFinite(+t.at.lat) ? { lng: +t.at.lng, lat: +t.at.lat } : (region.defaultTriggerAt ?? (regionId === 'bayarea' && kind === 'quake' ? { lng: -122.25, lat: 37.8 } : region.center));
  return { kind, at, params };
}

export function startRun(req: RunRequest): { runId: string } {
  if (current) { const e: any = new Error(`run ${current.runId} already in progress`); e.status = 409; throw e; }
  const region = getRegion(req.regionId);
  const trigger = buildTrigger(req.regionId, req.trigger);
  const seed = Number.isFinite(+req.seed!) ? +req.seed! : Math.floor(Math.random() * 1e6);
  const scenario = simModule.makeScenario(region, trigger, seed);
  const runId = `run-${Date.now().toString(36)}-${seed.toString(36)}`;
  current = { runId, regionId: region.id, startedAt: Date.now() };
  setRealCalls(runId, !!req.realCalls);
  emit({ type: 'log', level: req.realCalls ? 'warn' : 'info', text: req.realCalls ? '[call] real phone calls ENABLED for this run' : '[call] phone calls simulated for this run (tick the box on Start to dial for real)' });
  void loop(runId, scenario).catch(e => {
    emit({ type: 'log', level: 'error', text: `run ${runId} crashed: ${e?.stack ?? e}` });
    current = null;
  });
  return { runId };
}

async function loop(runId: string, scenario: Scenario) {
  const region = getRegion(scenario.regionId);
  const sim = simModule.createSim(region, scenario);
  current!.sim = sim;
  const playbook = getPlaybook();
  const tickMs = Number(process.env.TICK_MS) || 900;
  emit({ type: 'run.start', runId, scenario, playbookGen: playbook.generation });
  emit({ type: 'log', level: 'info', text: `[run] ${runId} ${region.name} ${scenario.trigger.kind} ${JSON.stringify(scenario.trigger.params)} seed ${scenario.seed} ticks ${scenario.ticks} playbook gen ${playbook.generation} tick ${tickMs}ms` });
  const t0 = Date.now();
  let eventCount = 0;
  const critical: string[] = [];

  // ---- concurrent planning: ticks never wait for the agents ----
  const respondedDistricts = new Set<string>();
  const pending = new Set<string>();
  // ---- per-district risk monitor: one-hour forecast, severity tier, escalation when risk rises ----
  const histories = new Map<string, DistrictState[]>();
  const severities = new Map<string, number[]>();
  const peakSeverity = new Map<string, number>();
  const settledLogged = new Set<string>();
  riskContext.clear(); escalations.clear();
  const hazardTicksLeft = () => scenario.trigger.kind === 'rain' ? Math.max(0, Number(scenario.trigger.params.duration ?? scenario.trigger.params.duration_ticks ?? 6) - sim.tick) : scenario.trigger.kind === 'quake' ? (sim.tick < 14 ? 1 : 0) : 1;
  const assessRisks = (snapDistricts: DistrictState[]) => {
    for (const d of snapDistricts) {
      const h = histories.get(d.id) ?? []; h.push(d); if (h.length > 6) h.shift(); histories.set(d.id, h);
      const hit = d.shaking > 0.2 || d.fires > 0 || d.flooded > 0 || d.landslides > 0 || d.cutOff || d.stranded > 0;
      if (!hit && !severities.has(d.id)) continue; // quiet district: nothing to assess yet
      const prevSev = severities.get(d.id) ?? [];
      const r = assessDistrict(region, h, prevSev, hazardTicksLeft());
      prevSev.push(r.severity); if (prevSev.length > 8) prevSev.shift(); severities.set(d.id, prevSev);
      riskContext.set(d.id, { severity: r.severity, label: r.label, trend: r.trend, forecast: r.forecast.text, action: r.action });
      emit({ type: 'district.risk', runId, tick: sim.tick, districtId: d.id, severity: r.severity, label: r.label, trend: r.trend, forecast: r.forecast, action: r.action });
      const peak = peakSeverity.get(d.id) ?? -1;
      if (r.severity >= 1 && !respondedDistricts.has(d.id) && !pending.has(d.id)) pending.add(d.id); // chief notifies the district agent on RISK, not only on impact
      if (r.severity >= 2 && r.severity > peak && peak >= 0 && respondedDistricts.has(d.id) && !pending.has(d.id)) {
        escalations.set(d.id, `risk rose to ${r.label} (${r.forecast.text})`);
        respondedDistricts.delete(d.id); pending.add(d.id);
        emit({ type: 'log', level: 'warn', text: `[risk] ${d.id}: severity rose to ${r.severity} (${r.label}) -> re-dispatching district agent with a stronger mandate` });
      }
      if (r.severity >= 2 && peak < 2 && callsAvailable(runId, 'emergency_contact') > 0) {
        // the moment a district reaches 'evacuate', its agent phones the district emergency contact with the forecast
        const name = region.districts.find(x => x.id === d.id)?.name ?? d.id;
        const scripts = callScripts(name, r.label, r.forecast.text, { shelters: [], routesLabel: '', airlift: false, fireCrews: 0 });
        emit({ type: 'log', level: 'warn', text: `[call] ${d.id}: severity ${r.severity} -> phoning the district emergency contact` });
        void placeCall({ runId, tick: sim.tick, districtId: d.id, role: 'emergency_contact', script: scripts.emergency.replace(' We are evacuating at-risk areas toward the nearest open shelter.', ' An evacuation plan is being prepared now.') });
      }
      if (r.severity > peak) peakSeverity.set(d.id, r.severity);
      if (r.trend === 'settled' && !settledLogged.has(d.id)) { settledLogged.add(d.id); emit({ type: 'log', level: 'info', text: `[risk] ${d.id}: risk settled; district agent stands down` }); }
      if (r.severity > 0) settledLogged.delete(d.id);
    }
  };
  let planning: Promise<void> | null = null;
  let planningWaves = 0;
  const startPlanning = () => {
    if (planning || !pending.size) return;
    const targets = [...pending]; // copy: respond() must never see a set we keep mutating
    pending.clear();
    targets.forEach(id => respondedDistricts.add(id));
    planningWaves++;
    const startTick = sim.tick;
    emit({ type: 'log', level: 'info', text: `[run] t${startTick}: ${targets.length} district(s) hit -> agent team responding (${targets.join(', ')})` });
    if (startTick > 0) emit({ type: 'log', level: 'info', text: 'agents planning while the cascade continues' });
    const ta = Date.now();
    planning = respond(sim, playbook, runId, targets)
      .catch(e => emit({ type: 'log', level: 'error', text: `respond failed: ${e?.message ?? e}` }))
      .then(() => {
        emit({ type: 'log', level: 'info', text: `[run] agents done in ${((Date.now() - ta) / 1000).toFixed(1)}s (started t${startTick}, now t${sim.tick})` });
        emit({ type: 'score.update', runId, score: sim.score() });
        planning = null;
        if (pending.size) startPlanning(); // districts that got hit while we were planning
      });
  };

  try {
    stopRequested = false;
    for (let tick = 0; tick < scenario.ticks; tick++) {
      if (stopRequested) { emit({ type: 'log', level: 'warn', text: `[run] stopped by operator at t${sim.tick}` }); break; }
      const events = sim.step();
      for (const ev of events) {
        eventCount++;
        if (ev.severity === 'critical' && critical.length < 8) critical.push(`t${sim.tick}: ${ev.text}`);
        emit({ type: 'sim.event', runId, tick: sim.tick, kind: ev.kind, text: ev.text, at: ev.at, severity: ev.severity });
      }
      const snapNow = sim.snapshot();
      emit({ type: 'sim.snapshot', runId, snapshot: snapNow });
      assessRisks(snapNow.districts);
      let fresh = sim.newlyAffectedDistricts().filter(id => !respondedDistricts.has(id) && !pending.has(id));
      if (tick === 0 && !fresh.length) {
        // tick 0: make sure the team mobilises for anything already affected
        fresh = sim.snapshot().districts.filter(d => d.shaking > 0.2 || d.fires > 0 || d.flooded > 0 || d.landslides > 0 || d.cutOff).map(d => d.id).filter(id => !respondedDistricts.has(id));
      }
      fresh.forEach(id => pending.add(id));
      startPlanning(); // no-op if a wave is already in flight; the pending set is picked up when it finishes
      emit({ type: 'score.update', runId, score: sim.score() });
      await sleep(tickMs);
    }
    // ticks are over; let in-flight agents finish so the summary includes every verdict
    if (planning || pending.size) {
      startPlanning();
      emit({ type: 'log', level: 'info', text: `[run] cascade finished; waiting for agents to finish planning (max ${PLANNING_DRAIN_TIMEOUT_MS / 1000}s)` });
      const drain = (async () => { while (planning) await planning; })();
      const timedOut = await Promise.race([drain.then(() => false), sleep(stopRequested ? 3000 : PLANNING_DRAIN_TIMEOUT_MS).then(() => true)]);
      if (timedOut) emit({ type: 'log', level: 'warn', text: '[run] agents still planning after timeout; finishing run with partial verdicts' });
      emit({ type: 'sim.snapshot', runId, snapshot: sim.snapshot() });
    }
    // ---- make sure both notifications went out at some point during the simulation ----
    try {
      const placed = callsPlaced(runId);
      const worst = [...peakSeverity.entries()].sort((a, b) => b[1] - a[1])[0];
      if (worst) {
        const dname = region.districts.find(x => x.id === worst[0])?.name ?? worst[0];
        const ctx = riskContext.get(worst[0]);
        const label = ['monitoring', 'alert', 'evacuate', 'escalate'][worst[1]] ?? 'alert';
        const sc = sim.score();
        const scripts = callScripts(dname, label, ctx?.forecast ?? `${Math.round(sc.stranded)} people stranded, ${Math.round(sc.evacuated)} evacuated`, { shelters: [], routesLabel: 'the nearest open shelter', airlift: false, fireCrews: 0 });
        if (!placed.emergency_contact) { emit({ type: 'log', level: 'warn', text: `[call] end of cascade: phoning the district emergency contact for ${worst[0]}` }); await placeCall({ runId, tick: sim.tick, districtId: worst[0], role: 'emergency_contact', script: scripts.emergency }); }
        if (!callsPlaced(runId).citizen) { emit({ type: 'log', level: 'warn', text: `[call] end of cascade: phoning residents of ${worst[0]}` }); await placeCall({ runId, tick: sim.tick, districtId: worst[0], role: 'citizen', script: scripts.citizen }); }
      }
    } catch (e: any) { emit({ type: 'log', level: 'warn', text: `[call] end-of-run notification failed: ${e?.message ?? e}` }); }
  } finally {
    const score = sim.score();
    const snap = sim.snapshot();
    const stats = getRunStats(runId);
    const strandedDistricts = snap.districts.filter(d => d.stranded > 0).map(d => `${d.id}(${Math.round(d.stranded)})`);
    const cutOff = snap.districts.filter(d => d.cutOff).map(d => d.id);
    const summary = [
      `Run ${runId} (${region.name}, ${scenario.trigger.kind} ${JSON.stringify(scenario.trigger.params)}, seed ${scenario.seed}, playbook gen ${playbook.generation}) finished ${scenario.ticks} ticks in ${((Date.now() - t0) / 1000).toFixed(1)}s; ${planningWaves} planning wave(s) ran concurrently with the cascade.`,
      `Score total ${score.total}: stranded ${Math.round(score.stranded)}, evacuated ${Math.round(score.evacuated)}, firesUncovered ${score.firesUncovered}, cutOffDistricts ${score.cutOffDistricts}.`,
      `Verifier: ${stats.accepted} accepted, ${stats.rejected} rejected, ${stats.replans} re-plans, ${stats.errors} best-effort/errors. LLM calls ${stats.llmCalls}, tokens ${stats.tokens}.`,
      `Stranded districts: ${strandedDistricts.join(', ') || 'none'}. Cut off: ${cutOff.join(', ') || 'none'}.`,
      `Sim events: ${eventCount}. Critical: ${critical.join(' | ') || 'none'}.`,
    ].join('\n');
    lastRunSummary = summary;
    lastRunRegion = region.id;
    emit({ type: 'run.done', runId, score, summary });
    forgetRun(runId);
    current = null;
  }
}
