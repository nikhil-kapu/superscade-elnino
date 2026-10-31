// Playbook (Version N+1): reflector proposes, held-out evaluator decides, kept changes persist.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentNode, Playbook, PlaybookChange, PlaybookParams, Scenario, Score } from '../../shared/types.ts';
import { emit } from '../bus.ts';
import { chatJSON, MODELS } from './crusoe.ts';
import { getRegion } from '../regions/index.ts';
import { simModule } from '../sim/engine.ts';

export const HELD_OUT_SEEDS = [101, 202, 303];
export const MAX_PROPOSALS_PER_EVOLVE = Number(process.env.EVOLVE_MAX_PROPOSALS) || 3;
const DATA_DIR = path.resolve(process.cwd(), 'server/data');
const FILE = process.env.PLAYBOOK_FILE ? path.resolve(process.env.PLAYBOOK_FILE) : path.join(DATA_DIR, 'playbook.json');

/** clamp ranges the reflector must respect */
const RANGES: Record<'evacuateShakingThreshold' | 'crewPerFireCell' | 'reserveCrewFraction' | 'floodEvacLeadTicks', [number, number]> = {
  evacuateShakingThreshold: [0.3, 0.8],
  crewPerFireCell: [0.25, 2],
  reserveCrewFraction: [0, 0.5],
  floodEvacLeadTicks: [0, 6],
};
const BOOL_KEYS = ['airliftWhenCutOff', 'prepositionSheltersSoftSoil'] as const;

function gen0(): Playbook {
  return {
    generation: 0,
    rules: [
      'Evacuate districts with shaking above 0.6 first',
      'Send fire crews only where fires are confirmed',
      'Use road routes by default',
    ],
    params: { evacuateShakingThreshold: 0.6, crewPerFireCell: 0.5, airliftWhenCutOff: false, prepositionSheltersSoftSoil: false, reserveCrewFraction: 0, floodEvacLeadTicks: 0 },
    history: [],
  };
}

let playbook: Playbook = load();

function load(): Playbook {
  try {
    if (fs.existsSync(FILE)) {
      const p = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Playbook;
      if (p && typeof p.generation === 'number' && p.params) return p;
    }
  } catch { /* fall through */ }
  return gen0();
}
function persist() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(playbook, null, 2)); } catch (e: any) { emit({ type: 'log', level: 'warn', text: `playbook persist failed: ${e.message}` }); }
}

export function getPlaybook(): Playbook { return playbook; }
export function resetPlaybook(): Playbook {
  playbook = gen0();
  persist();
  emit({ type: 'playbook.update', playbook });
  return playbook;
}

export function heldOutTrigger(regionId: string): Scenario['trigger'] {
  const region = getRegion(regionId);
  const kind = region.triggers[0]?.kind ?? (regionId === 'nepal' ? 'rain' : 'quake'); // the region's headline trigger
  const spec = region.triggers.find(t => t.kind === kind) ?? region.triggers[0];
  const params: Record<string, number> = {};
  for (const p of spec?.params ?? []) {
    params[p.name] = p.default; // held-out storms use the region's default magnitude / rainfall (Bay Area 6.9, Nepal 300 mm, SF 7.8)
  }
  if (kind === 'quake' && !Object.keys(params).some(k => /mag/i.test(k))) params.magnitude = 6.9;
  if (kind === 'rain' && !Object.keys(params).some(k => /(mm|rain|precip)/i.test(k))) params.mm = 300;
  const at = region.defaultTriggerAt ?? (regionId === 'bayarea' ? { lng: -122.25, lat: 37.8 } : region.center);
  return { kind: spec?.kind ?? kind, at, params };
}

function diffParams(a: PlaybookParams, b: PlaybookParams, rulesA: string[], rulesB: string[]): string {
  const out: string[] = [];
  for (const k of Object.keys(b) as (keyof PlaybookParams)[]) if (a[k] !== b[k]) out.push(`${k}: ${a[k]} -> ${b[k]}`);
  for (const r of rulesB) if (!rulesA.includes(r)) out.push(`+ rule: ${r}`);
  for (const r of rulesA) if (!rulesB.includes(r)) out.push(`- rule: ${r}`);
  return out.join('; ') || 'no change';
}
/** params-only part of a diff, used to detect repeats regardless of rule wording */
function paramDiff(a: PlaybookParams, b: PlaybookParams): string {
  return (Object.keys(b) as (keyof PlaybookParams)[]).filter(k => a[k] !== b[k]).map(k => `${k}: ${a[k]} -> ${b[k]}`).join('; ');
}

/**
 * Coerce a raw reflector proposal: clamp ranges, drop values equal to current, keep at most 2 changed params.
 * Returns the new params plus which keys actually changed.
 */
export function coerceProposal(raw: any, base: PlaybookParams): { params: PlaybookParams; changed: (keyof PlaybookParams)[]; dropped: string[] } {
  const p = { ...base };
  const changed: (keyof PlaybookParams)[] = [];
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object') return { params: p, changed, dropped };
  for (const k of Object.keys(raw)) {
    if (k in RANGES) {
      const [lo, hi] = RANGES[k as keyof typeof RANGES];
      const v = Number(raw[k]);
      if (!Number.isFinite(v)) continue;
      const c = +Math.min(hi, Math.max(lo, v)).toFixed(3);
      if (c !== base[k as keyof PlaybookParams]) { (p as any)[k] = c; changed.push(k as keyof PlaybookParams); }
    } else if ((BOOL_KEYS as readonly string[]).includes(k)) {
      const v = typeof raw[k] === 'boolean' ? raw[k] : raw[k] === 'true' ? true : raw[k] === 'false' ? false : undefined;
      if (v === undefined) continue;
      if (v !== base[k as keyof PlaybookParams]) { (p as any)[k] = v; changed.push(k as keyof PlaybookParams); }
    }
  }
  while (changed.length > 2) { const k = changed.pop()!; (p as any)[k] = base[k]; dropped.push(String(k)); }
  return { params: p, changed, dropped };
}

function leverHint(kind: Scenario['trigger']['kind']): string {
  return kind === 'rain'
    ? 'Levers that affect THIS scenario type (rain/flood), in order of impact: floodEvacLeadTicks (PRIMARY: evacuate river/valley districts N ticks before predicted flooding; 0 means no pre-emptive evacuation; try 3-5) is the only lever that moves stranded counts when cutOff is 0 in the diagnosis above. airliftWhenCutOff and reserveCrewFraction only matter when the diagnosis shows cutOff > 0; if every seed shows cutOff 0 they are NO-OPS and must not be proposed. Quake-only levers (evacuateShakingThreshold, crewPerFireCell, prepositionSheltersSoftSoil) do nothing here.'
    : 'Levers that affect THIS scenario type (quake): evacuateShakingThreshold (lower = earlier evacuation of more districts), crewPerFireCell (higher = more fires covered, but uses scarce crews), prepositionSheltersSoftSoil (liquefaction zones). Flood-only levers (floodEvacLeadTicks, airliftWhenCutOff when no district is cut off, reserveCrewFraction) do nothing here.';
}

function diagnosis(res: { mean: number; perSeed: { seed: number; score: Score }[] }): string {
  return res.perSeed.map(p => `seed ${p.seed}: score ${p.score.total}, stranded ${Math.round(p.score.stranded)}, firesUncovered ${p.score.firesUncovered}, cutOff ${p.score.cutOffDistricts}, evacuated ${Math.round(p.score.evacuated)}`).join('\n') + `\nmean score ${res.mean.toFixed(1)} (higher is better)`;
}

// ---- mock reflector: deterministic candidate schedule; skips anything already tried ----
type Proposal = { rules: string[]; params: PlaybookParams; summary: string };
function mockCandidates(cur: Playbook, kind: Scenario['trigger']['kind']): Proposal[] {
  const mk = (mut: (p: PlaybookParams, rules: string[]) => void, summary: string): Proposal => { const params = { ...cur.params }; const rules = [...cur.rules]; mut(params, rules); return { rules, params, summary }; };
  const add = (rules: string[], r: string) => { if (!rules.includes(r)) rules.push(r); };
  const quake: Proposal[] = [
    mk((p, r) => { p.evacuateShakingThreshold = 0.45; r[0] = 'Evacuate districts with shaking above 0.45 first'; }, 'Districts just under the 0.6 threshold stayed put and stranded people; lower the evacuation threshold.'),
    mk((p, r) => { p.crewPerFireCell = 1.0; r[1] = 'Allocate one crew per burning cell; fires spread faster than crews arrive'; }, 'Fires went uncovered; double crews per fire cell.'),
    mk((p, r) => { p.prepositionSheltersSoftSoil = true; add(r, 'Pre-position shelters in soft-soil districts before shaking'); }, 'Soft-soil districts liquefied; pre-position shelters.'),
    mk((p, r) => { p.evacuateShakingThreshold = 0.35; p.crewPerFireCell = 0.75; r[0] = 'Evacuate districts with shaking above 0.35 first'; }, 'Earlier evacuation with modest crew increase.'),
    mk((p, r) => { p.reserveCrewFraction = 0.2; add(r, 'Hold 20% of crews in reserve for aftershock fires'); }, 'Cascades arrived with no crews left; keep 20% in reserve.'),
    mk((p, r) => { p.airliftWhenCutOff = true; add(r, 'If a district is cut off by road, request airlift immediately'); }, 'Cut-off districts stranded people; enable airlift when cut off.'),
  ];
  const rain: Proposal[] = [
    mk((p, r) => { p.floodEvacLeadTicks = 3; add(r, 'Evacuate flood-prone valleys 3 ticks before predicted inundation'); }, 'Flood evacuations started late; add 3-tick lead.'),
    mk((p, r) => { p.airliftWhenCutOff = true; add(r, 'If a district is cut off by road, request airlift immediately'); }, 'Cut-off districts stranded people; enable airlift when cut off.'),
    mk((p, r) => { p.floodEvacLeadTicks = 5; p.airliftWhenCutOff = true; }, 'Longer flood lead plus airlift for cut-off valleys.'),
    mk((p, r) => { p.reserveCrewFraction = 0.2; add(r, 'Hold 20% of crews in reserve for landslide cascades'); }, 'Keep crews in reserve for cascades.'),
    mk((p, r) => { p.floodEvacLeadTicks = 1; }, 'Minimal flood lead.'),
  ];
  return kind === 'rain' ? rain : quake;
}
function mockProposal(cur: Playbook, kind: Scenario['trigger']['kind'], avoidParamDiffs: Set<string>): Proposal {
  for (const c of mockCandidates(cur, kind)) {
    const d = paramDiff(cur.params, c.params);
    if (d && !avoidParamDiffs.has(d)) return c;
  }
  // everything tried: nudge a numeric lever
  const params = { ...cur.params, crewPerFireCell: +Math.min(2, cur.params.crewPerFireCell + 0.25).toFixed(2) };
  return { rules: cur.rules, params, summary: 'Minor crew tuning (all scheduled proposals already tried).' };
}

/**
 * One evolve() call: diagnose held-out runs with current params, then ask the reflector for up to
 * MAX_PROPOSALS_PER_EVOLVE proposals, evaluating each on held-out seeds. Stops at the first kept one.
 * Emits playbook.update after every attempt (kept:false for discards).
 */
export async function evolve(regionId: string, lastRunSummary: string): Promise<PlaybookChange> {
  const region = getRegion(regionId);
  const trigger = heldOutTrigger(regionId);
  const cur = playbook;
  const proposedGen = cur.generation + 1;
  const runId = `evolve-${proposedGen}-${Date.now().toString(36)}`;
  const agentId = `reflector-${runId}`;
  const node: AgentNode = { id: agentId, role: 'reflector', model: MODELS.reflector, label: `Reflector gen ${cur.generation} -> ${proposedGen}`, at: region.center, status: 'spawning', depth: 0 };
  emit({ type: 'agent.spawn', runId, agent: node });
  emit({ type: 'agent.status', runId, agentId, status: 'thinking', note: `held-out baseline on seeds ${HELD_OUT_SEEDS.join(',')} (${trigger.kind})` });

  const t0 = Date.now();
  const before = await simModule.evaluateHeldOut(region, cur.params, HELD_OUT_SEEDS, trigger);
  const baselineDiag = diagnosis(before);
  emit({ type: 'log', level: 'info', text: `[evolve] baseline gen ${cur.generation} mean ${before.mean.toFixed(1)} on ${trigger.kind} seeds ${HELD_OUT_SEEDS.join(',')}` });

  // never re-propose anything discarded before (this click or earlier ones)
  const priorDiscards = cur.history.filter(h => !h.kept).map(h => `${h.diff} (scored ${h.before} -> ${h.after})`);
  const avoid = new Set<string>(cur.history.filter(h => !h.kept).map(h => h.diff.split('; ').filter(s => !s.startsWith('+ rule') && !s.startsWith('- rule')).join('; ')));
  const thisCall: string[] = [];
  let lastChange: PlaybookChange | null = null;

  for (let attempt = 1; attempt <= MAX_PROPOSALS_PER_EVOLVE; attempt++) {
    emit({ type: 'agent.status', runId, agentId, status: 'thinking', note: `proposal ${attempt}/${MAX_PROPOSALS_PER_EVOLVE}` });
    const feedback = [...priorDiscards.map(d => `Previously discarded (do NOT repeat): ${d}`), ...thisCall].join('\n');
    const res = await chatJSON<{ rules: string[]; params: Partial<PlaybookParams>; summary: string }>({
      role: 'reflector',
      system: 'You are the after-action reflector for a disaster-response agent team. Propose ONE focused playbook improvement: change at most 2 params, every changed value must differ from the current value, and pick levers that matter for this scenario type. Update the rules text to match. Be concrete and brief.',
      user: `Region: ${region.name}. Held-out scenario type: ${trigger.kind} ${JSON.stringify(trigger.params)}.\n\nCurrent playbook gen ${cur.generation}:\nrules=${JSON.stringify(cur.rules)}\nparams=${JSON.stringify(cur.params)}\n\nHeld-out runs with CURRENT params (deterministic evaluator):\n${baselineDiag}\n\n${leverHint(trigger.kind)}\nRanges: evacuateShakingThreshold 0.3-0.8, crewPerFireCell 0.25-2, reserveCrewFraction 0-0.5, floodEvacLeadTicks 0-6; booleans: airliftWhenCutOff, prepositionSheltersSoftSoil.\n\nLast live run summary:\n${lastRunSummary.slice(0, 1200)}\n${feedback ? `\n${feedback}\n` : ''}\nReturn the FULL params object (unchanged keys repeated) with at most 2 keys changed.`,
      schemaHint: '{"rules": string[], "params": {evacuateShakingThreshold:number, crewPerFireCell:number, airliftWhenCutOff:boolean, prepositionSheltersSoftSoil:boolean, reserveCrewFraction:number, floodEvacLeadTicks:number}, "summary": string}',
      maxTokens: 1024,
      mock: () => mockProposal(cur, trigger.kind, avoid),
    });
    emit({ type: 'log', level: 'info', text: `[llm reflector ${res.model}${res.mock ? ' mock' : ''}] ${res.ms}ms ${res.tokens} tok (proposal ${attempt})` });

    const { params: newParams, changed, dropped } = coerceProposal(res.data?.params, cur.params);
    const newRules = Array.isArray(res.data?.rules) && res.data.rules.length ? res.data.rules.map(String).slice(0, 10) : cur.rules;
    let summary = String(res.data?.summary ?? 'reflector proposal').slice(0, 400);
    if (dropped.length) summary += ` [kept first 2 param changes; dropped ${dropped.join(', ')}]`;

    let after = before;
    let kept = false;
    const pd = paramDiff(cur.params, newParams);
    if (!changed.length) {
      summary += ' [no param actually changed]';
    } else if (avoid.has(pd)) {
      summary += ' [repeat of a discarded proposal]';
    } else {
      after = await simModule.evaluateHeldOut(region, newParams, HELD_OUT_SEEDS, trigger);
      kept = after.mean > before.mean;
    }
    const change: PlaybookChange = {
      generation: proposedGen,
      summary,
      diff: diffParams(cur.params, newParams, cur.rules, newRules),
      kept,
      before: +before.mean.toFixed(2),
      after: +after.mean.toFixed(2),
      heldOutScenarios: HELD_OUT_SEEDS.map(s => `${regionId}-${trigger.kind}-seed${s}`),
    };
    lastChange = change;
    if (kept) {
      playbook = { generation: proposedGen, rules: newRules, params: newParams, history: [...playbook.history, change] };
      persist();
      emit({ type: 'log', level: 'info', text: `[evolve] KEPT gen ${proposedGen} (proposal ${attempt}): ${change.diff} (${change.before} -> ${change.after}) in ${Date.now() - t0}ms` });
      emit({ type: 'agent.status', runId, agentId, status: 'done', note: `kept: ${change.diff}`.slice(0, 200), tokens: res.tokens });
      emit({ type: 'playbook.update', playbook, change });
      return change;
    }
    playbook = { ...playbook, history: [...playbook.history, change] };
    persist();
    if (pd) avoid.add(pd);
    thisCall.push(`Proposal ${attempt} changed {${pd || 'nothing'}} and scored ${change.before} -> ${change.after} on held-out: no gain. Do not repeat it; pick a different lever.`);
    emit({ type: 'log', level: 'warn', text: `[evolve] DISCARDED proposal ${attempt}/${MAX_PROPOSALS_PER_EVOLVE} for gen ${proposedGen}: ${change.diff} (${change.before} -> ${change.after})` });
    emit({ type: 'agent.status', runId, agentId, status: 'rejected', note: `discarded: ${change.diff}`.slice(0, 200), tokens: res.tokens });
    emit({ type: 'playbook.update', playbook, change });
  }
  emit({ type: 'agent.status', runId, agentId, status: 'error', note: `no improvement found in ${MAX_PROPOSALS_PER_EVOLVE} proposals; playbook stays at gen ${cur.generation}` });
  return lastChange!;
}
