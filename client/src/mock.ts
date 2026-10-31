// Fabricated CascadeEvent stream used when /api/health is unreachable or ?mock=1.
import type {
  AgentNode, AgentRole, CascadeEvent, DistrictPlan, DistrictState, HazardCell, HazardKind, InfraState, LngLat, Playbook, PlaybookChange, RegionConfig, Scenario, Score, SimSnapshot, TriggerSpec,
} from '../../shared/types.ts';

type Emit = (e: CascadeEvent) => void;
let emitter: Emit | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void) => { timers.push(setTimeout(() => { try { fn(); } catch (err) { console.warn('[mock]', err); } }, ms)); };
const emit = (e: CascadeEvent) => { try { emitter?.(e); } catch (err) { console.warn('[mock emit]', err); } };

export function startMock(onEvent: Emit): () => void {
  emitter = onEvent;
  later(300, () => emit({ type: 'log', text: 'Mock mode: server unreachable, streaming a fabricated Bay Area cascade.', level: 'warn' }));
  later(600, () => emit({ type: 'playbook.update', playbook: playbook }));
  return () => { emitter = null; timers.forEach(clearTimeout); timers = []; };
}

// ---- Region ----
const poly = (pts: [number, number][]): LngLat[] => pts.map(([lng, lat]) => ({ lng, lat }));
const BAYAREA: RegionConfig = {
  id: 'bayarea', name: 'San Francisco Bay Area', center: { lng: -122.25, lat: 37.8 }, zoom: 10.2,
  bbox: [-122.62, 37.45, -121.85, 38.05], grid: { cols: 48, rows: 40 },
  districts: [
    { id: 'oak', name: 'Oakland', centroid: { lng: -122.24, lat: 37.8 }, population: 440000, terrain: 'urban', polygon: poly([[-122.33, 37.74], [-122.17, 37.73], [-122.13, 37.82], [-122.22, 37.87], [-122.31, 37.83]]) },
    { id: 'brk', name: 'Berkeley Hills', centroid: { lng: -122.24, lat: 37.88 }, population: 120000, terrain: 'hills', polygon: poly([[-122.31, 37.83], [-122.22, 37.87], [-122.17, 37.91], [-122.25, 37.93], [-122.32, 37.9]]) },
    { id: 'sf', name: 'San Francisco', centroid: { lng: -122.43, lat: 37.76 }, population: 870000, terrain: 'urban', polygon: poly([[-122.52, 37.7], [-122.36, 37.7], [-122.36, 37.81], [-122.52, 37.81]]) },
    { id: 'ala', name: 'Alameda', centroid: { lng: -122.27, lat: 37.76 }, population: 78000, terrain: 'softsoil', polygon: poly([[-122.33, 37.74], [-122.23, 37.73], [-122.22, 37.78], [-122.31, 37.79]]) },
    { id: 'hay', name: 'Hayward', centroid: { lng: -122.08, lat: 37.67 }, population: 160000, terrain: 'valley', polygon: poly([[-122.17, 37.6], [-122.0, 37.62], [-122.02, 37.73], [-122.13, 37.73]]) },
    { id: 'rich', name: 'Richmond', centroid: { lng: -122.35, lat: 37.94 }, population: 115000, terrain: 'coast', polygon: poly([[-122.42, 37.9], [-122.32, 37.9], [-122.3, 37.98], [-122.42, 37.98]]) },
  ],
  infra: [
    { id: 'baybridge', name: 'Bay Bridge', kind: 'bridge', at: { lng: -122.35, lat: 37.8 }, districtIds: ['sf', 'oak'] },
    { id: 'highland', name: 'Highland Hospital', kind: 'hospital', at: { lng: -122.23, lat: 37.79 }, districtIds: ['oak'], capacity: 236 },
    { id: 'altabates', name: 'Alta Bates', kind: 'hospital', at: { lng: -122.26, lat: 37.86 }, districtIds: ['brk'], capacity: 340 },
    { id: 'coliseum', name: 'Coliseum Shelter', kind: 'shelter', at: { lng: -122.2, lat: 37.75 }, districtIds: ['oak', 'ala'], capacity: 8000 },
    { id: 'csueb', name: 'CSU East Bay Shelter', kind: 'shelter', at: { lng: -122.05, lat: 37.66 }, districtIds: ['hay'], capacity: 3000 },
    { id: 'oak-apt', name: 'Oakland Intl', kind: 'airport', at: { lng: -122.22, lat: 37.72 }, districtIds: ['oak', 'ala'] },
    { id: 'sfo', name: 'SFO', kind: 'airport', at: { lng: -122.38, lat: 37.62 }, districtIds: ['sf'] },
    { id: 'richmond-br', name: 'Richmond–San Rafael Br.', kind: 'bridge', at: { lng: -122.44, lat: 37.94 }, districtIds: ['rich'] },
    { id: 'posey', name: 'Posey Tube', kind: 'river_crossing', at: { lng: -122.27, lat: 37.79 }, districtIds: ['ala', 'oak'] },
    { id: 'sanmateo', name: 'San Mateo Bridge', kind: 'bridge', at: { lng: -122.22, lat: 37.59 }, districtIds: ['hay'] },
    { id: 'i880', name: 'I-880 Nimitz', kind: 'highway', at: { lng: -122.26, lat: 37.78 }, districtIds: ['oak'] },
    { id: 'moscone', name: 'Moscone Shelter', kind: 'shelter', at: { lng: -122.4, lat: 37.78 }, districtIds: ['sf'], capacity: 6000 },
  ],
  faults: [
    { id: 'hayward', name: 'Hayward Fault', line: poly([[-122.0, 37.56], [-122.1, 37.66], [-122.2, 37.78], [-122.26, 37.87], [-122.33, 37.96], [-122.4, 38.04]]) },
    { id: 'sanandreas', name: 'San Andreas Fault', line: poly([[-122.3, 37.45], [-122.42, 37.6], [-122.5, 37.72], [-122.56, 37.85], [-122.6, 38.0]]) },
  ],
  triggers: [
    { kind: 'quake', label: 'Earthquake', params: [{ name: 'magnitude', label: 'Magnitude (Mw)', min: 5.5, max: 8.0, step: 0.1, default: 7.0 }, { name: 'depthKm', label: 'Depth (km)', min: 3, max: 20, step: 1, default: 8 }] },
    { kind: 'fire', label: 'Wildfire ignition', params: [{ name: 'windKph', label: 'Wind (kph)', min: 5, max: 80, step: 5, default: 40 }, { name: 'humidity', label: 'Humidity (%)', min: 5, max: 60, step: 5, default: 15 }] },
  ],
  facts: [{ text: 'USGS: ~72% chance of M6.7+ in the Bay Area by 2043.', verified: true, source: 'USGS UCERF3' }],
  disclaimer: 'Simulation for demonstration only. Hazard footprints, infrastructure states and casualties are synthetic and not predictive.',
};
export function mockRegions(): RegionConfig[] { return [BAYAREA]; }

// ---- Playbook ----
let playbook: Playbook = {
  generation: 0,
  rules: [
    'Prioritise districts that are cut off from both a hospital and a shelter.',
    'Dispatch fire crews before evacuations when wind exceeds 30 kph.',
    'Never route evacuations across a bridge marked damaged.',
  ],
  params: { evacuateShakingThreshold: 0.6, crewPerFireCell: 1, airliftWhenCutOff: false, prepositionSheltersSoftSoil: false, reserveCrewFraction: 0.1, floodEvacLeadTicks: 2 },
  history: [],
};
export function mockPlaybook(): Playbook { return playbook; }
let lastScore = 0;
export async function mockEvolve() {
  const gen = playbook.generation + 1;
  const kept = gen % 3 !== 0;
  const before = lastScore || 412;
  const after = kept ? before + 60 + Math.round(Math.random() * 90) : before - 20 - Math.round(Math.random() * 40);
  const proposals = [
    { summary: 'Airlift automatically when a district is cut off', diff: 'airliftWhenCutOff: false → true', params: { airliftWhenCutOff: true } },
    { summary: 'Lower pre-emptive evacuation shaking threshold', diff: 'evacuateShakingThreshold: 0.6 → 0.45', params: { evacuateShakingThreshold: 0.45 } },
    { summary: 'Hold a larger crew reserve for cascades', diff: 'reserveCrewFraction: 0.1 → 0.25', params: { reserveCrewFraction: 0.25 } },
    { summary: 'Pre-position shelters on soft soil', diff: 'prepositionSheltersSoftSoil: false → true', params: { prepositionSheltersSoftSoil: true } },
  ];
  const p = proposals[(gen - 1) % proposals.length];
  emit({ type: 'log', text: `Reflector (Nemotron Super 120B) proposing playbook change for gen ${gen}…`, level: 'info' });
  await new Promise((r) => later(1800, r as () => void));
  emit({ type: 'log', text: 'Fast evaluator: 3 held-out scenarios × deterministic sim', level: 'info' });
  await new Promise((r) => later(1600, r as () => void));
  const change: PlaybookChange = { generation: gen, summary: p.summary, diff: p.diff, kept, before, after, heldOutScenarios: ['bayarea-quake-s17', 'bayarea-fire-s42', 'bayarea-quake-s99'] };
  playbook = {
    generation: kept ? gen : playbook.generation,
    rules: kept ? [...playbook.rules, p.summary + '.'] : playbook.rules,
    params: kept ? { ...playbook.params, ...p.params } : playbook.params,
    history: [...playbook.history, change],
  };
  if (kept) lastScore = after;
  emit({ type: 'playbook.update', playbook, change });
  emit({ type: 'memory.update', key: `gen${gen}`, value: `${p.summary}: ${kept ? 'kept' : 'discarded'} (${before} → ${after})` });
  return { ok: true };
}
export async function mockReset() {
  playbook = { ...playbook, generation: 0, history: [], rules: playbook.rules.slice(0, 3), params: { evacuateShakingThreshold: 0.6, crewPerFireCell: 1, airliftWhenCutOff: false, prepositionSheltersSoftSoil: false, reserveCrewFraction: 0.1, floodEvacLeadTicks: 2 } };
  emit({ type: 'playbook.update', playbook });
  return { ok: true };
}

// ---- Run ----
const cellOf = (r: RegionConfig, at: LngLat) => {
  const [w, s, e, n] = r.bbox;
  return { i: Math.floor(((at.lng - w) / (e - w)) * r.grid.cols), j: Math.floor(((at.lat - s) / (n - s)) * r.grid.rows) };
};
const lngLatOf = (r: RegionConfig, i: number, j: number): LngLat => {
  const [w, s, e, n] = r.bbox;
  return { lng: w + ((i + 0.5) / r.grid.cols) * (e - w), lat: s + ((j + 0.5) / r.grid.rows) * (n - s) };
};
const rnd = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

export async function mockRun(body: { regionId: string; trigger: { kind: TriggerSpec['kind']; at: LngLat; params: Record<string, number> } }, region?: RegionConfig) {
  timers.forEach(clearTimeout); timers = [];
  const r = region ?? BAYAREA;
  const runId = 'mock-' + Date.now().toString(36);
  const scenario: Scenario = { id: runId, regionId: r.id, seed: 17, trigger: body.trigger, ticks: 36 };
  const rand = rnd(17);
  const quake = body.trigger.kind === 'quake';
  const mag = body.trigger.params.magnitude ?? 7;
  const wind = body.trigger.params.windKph ?? 40;
  const epi = cellOf(r, body.trigger.at);
  const fireOrigin = quake ? { i: epi.i + 3, j: epi.j + 4 } : epi; // quake sparks fires in the hills
  const TICK = 650;
  let t0 = 200;
  emit({ type: 'log', text: `POST /api/run → ${runId}`, level: 'info' });
  later(t0, () => emit({ type: 'run.start', runId, scenario, playbookGen: playbook.generation }));

  const infraStatus: Record<string, InfraState['status']> = Object.fromEntries(r.infra.map((x) => [x.id, 'open']));
  const districtIds = r.districts.map((d) => d.id);
  const agents: AgentNode[] = [];
  const chief: AgentNode = { id: 'chief', role: 'chief', model: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B', label: 'Incident Chief', at: body.trigger.at, status: 'spawning', depth: 0 };
  const dist = (d: typeof r.districts[number]): AgentNode => ({ id: 'd-' + d.id, parentId: 'chief', role: 'district', model: 'nvidia/Nemotron-3.5-Lightning-30B-A3B', label: `${d.name} lead`, districtId: d.id, at: d.centroid, status: 'spawning', depth: 1 });
  const helper = (d: typeof r.districts[number], role: AgentNode['role'], k: number): AgentNode => ({
    id: `${role}-${d.id}`, parentId: 'd-' + d.id, role, model: role === 'verifier' ? 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B' : 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
    label: `${role} · ${d.name}`, districtId: d.id, at: { lng: d.centroid.lng + Math.cos(k * 1.3) * 0.035, lat: d.centroid.lat + Math.sin(k * 1.3) * 0.025 }, status: 'spawning', depth: 2,
  });
  const affected = quake ? ['oak', 'brk', 'ala', 'hay'] : ['brk', 'oak', 'rich'];

  let planned = false;
  let tokens: Record<string, number> = {};
  const bump = (id: string, n: number) => (tokens[id] = (tokens[id] ?? 0) + n);

  for (let tick = 0; tick <= scenario.ticks; tick++) {
    const at = t0 + 400 + tick * TICK;
    later(at, () => {
      // hazards
      const hazards: HazardCell[] = [];
      const seen = new Set<string>();
      const push = (c: HazardCell) => { const k = c.kind + c.i + ',' + c.j; if (!seen.has(k) && c.i >= 0 && c.j >= 0 && c.i < r.grid.cols && c.j < r.grid.rows && c.intensity > 0.08) { seen.add(k); hazards.push(c); } };
      if (quake) {
        const rad = Math.min(9, 3 + tick * 0.9) * (mag / 7);
        for (let di = -10; di <= 10; di++) for (let dj = -10; dj <= 10; dj++) {
          const d = Math.hypot(di, dj * 1.2);
          if (d <= rad) push({ i: epi.i + di, j: epi.j + dj, kind: 'quake', intensity: Math.max(0, 1 - d / rad) * Math.min(1, 0.4 + tick * 0.12) });
        }
        // landslides in the hills after tick 4
        if (tick > 4) for (let k = 0; k < 6; k++) push({ i: epi.i + 2 + k, j: epi.j + 6 + (k % 3), kind: 'landslide', intensity: Math.min(1, 0.3 + (tick - 4) * 0.08) });
        // soft-soil liquefaction/flood-ish along Alameda
        if (tick > 8) for (let k = 0; k < 5; k++) push({ i: epi.i - 2 - k, j: epi.j - 3, kind: 'flood', intensity: Math.min(0.8, 0.2 + (tick - 8) * 0.05) });
      }
      const fireStart = quake ? 3 : 0;
      if (tick >= fireStart) {
        const age = tick - fireStart;
        const growth = planned ? Math.max(1, 6 - (tick - 16) * 0.4) : 1 + age * (0.35 + wind / 120);
        for (let di = -8; di <= 8; di++) for (let dj = -8; dj <= 8; dj++) {
          const d = Math.hypot(di - age * 0.25, dj * 1.4); // wind drifts east
          if (d <= growth) push({ i: fireOrigin.i + di, j: fireOrigin.j + dj, kind: 'fire', intensity: Math.max(0.15, 1 - d / (growth + 0.5)) * (planned && tick > 20 ? 0.6 : 1) });
        }
      }
      // infra cascade
      if (quake && tick === 2) { infraStatus['baybridge'] = 'damaged'; infraStatus['i880'] = 'closed'; }
      if (quake && tick === 5) { infraStatus['posey'] = 'closed'; infraStatus['highland'] = 'damaged'; }
      if (tick === 7) infraStatus['altabates'] = 'damaged';
      if (planned && tick === 22) infraStatus['i880'] = 'damaged';
      if (planned && tick === 28) infraStatus['posey'] = 'damaged';

      const districts: DistrictState[] = r.districts.map((d) => {
        const hit = affected.includes(d.id);
        const idx = affected.indexOf(d.id);
        const sev = hit ? Math.max(0, 1 - idx * 0.22) : 0.1;
        const ramp = Math.min(1, tick / 10);
        const relief = planned ? Math.max(0, Math.min(1, (tick - 12) / 14)) : 0;
        const fires = hazards.filter((h) => h.kind === 'fire').length;
        const stranded = Math.round(d.population * 0.06 * sev * ramp * (1 - relief * 0.85));
        const evacuated = Math.round(d.population * 0.05 * sev * relief);
        const cutOff = hit && (d.id === 'ala' || d.id === 'brk') && tick >= 5 && !(planned && tick > 24);
        const needs: string[] = [];
        if (hit && fires > 10 && (d.id === 'brk' || d.id === 'oak')) needs.push('fire crew');
        if (cutOff) needs.push('airlift');
        if (stranded > 5000) needs.push('shelter');
        return { id: d.id, shaking: quake ? sev * ramp : 0, fires: d.id === 'brk' ? Math.round(fires * 0.6) : d.id === 'oak' ? Math.round(fires * 0.4) : 0, flooded: d.id === 'ala' && tick > 8 ? 5 : 0, landslides: d.id === 'brk' && tick > 4 ? 6 : 0, cutOff, stranded, evacuated, needs };
      });
      const stranded = districts.reduce((a, d) => a + d.stranded, 0);
      const evacuated = districts.reduce((a, d) => a + d.evacuated, 0);
      const firesUncovered = Math.round(hazards.filter((h) => h.kind === 'fire').length * (planned ? Math.max(0.1, 1 - Math.max(0, tick - 12) * 0.07) : 1));
      const cutOffDistricts = districts.filter((d) => d.cutOff).length;
      const score: Score = { stranded, evacuated, firesUncovered, cutOffDistricts, total: Math.round(1000 + evacuated / 10 - stranded / 60 - firesUncovered * 2 - cutOffDistricts * 40) };
      lastScore = score.total;
      const snapshot: SimSnapshot = { tick, hazards, infra: r.infra.map((x) => ({ id: x.id, status: infraStatus[x.id], note: infraStatus[x.id] !== 'open' ? 'post-shock inspection pending' : undefined })), districts, score };
      emit({ type: 'sim.snapshot', runId, snapshot });

      // notable sim events
      const ev = (kind: HazardKind | 'infra', text: string, at: LngLat, severity: 'info' | 'warn' | 'critical') => emit({ type: 'sim.event', runId, tick, kind, text, at, severity });
      if (quake && tick === 0) ev('quake', `M${mag.toFixed(1)} rupture on the Hayward Fault, depth ${body.trigger.params.depthKm ?? 8} km`, body.trigger.at, 'critical');
      if (quake && tick === 2) ev('infra', 'Bay Bridge: expansion joint damage, reduced to one deck', r.infra[0].at, 'warn');
      if (quake && tick === 2) ev('infra', 'I-880 Nimitz closed after section collapse', { lng: -122.26, lat: 37.78 }, 'critical');
      if (tick === fireStart) ev('fire', quake ? 'Gas-main ignitions in the Oakland hills' : `Ignition reported, wind ${wind} kph`, lngLatOf(r, fireOrigin.i, fireOrigin.j), 'critical');
      if (quake && tick === 5) ev('landslide', 'Slope failures above Claremont Canyon', lngLatOf(r, epi.i + 4, epi.j + 7), 'warn');
      if (quake && tick === 5) ev('infra', 'Posey Tube flooded — Alameda cut off from Oakland', { lng: -122.27, lat: 37.79 }, 'critical');
      if (tick === 6) ev('fire', `Fire front crossing ${wind > 30 ? 'Grizzly Peak' : 'Tunnel Rd'}, ${hazards.filter((h) => h.kind === 'fire').length} cells burning`, lngLatOf(r, fireOrigin.i + 2, fireOrigin.j), 'warn');
      if (quake && tick === 9) ev('flood', 'Liquefaction & shoreline flooding on Alameda west end', lngLatOf(r, epi.i - 4, epi.j - 3), 'warn');
      if (planned && tick === 20) ev('fire', 'Crews holding the northern fire line', lngLatOf(r, fireOrigin.i, fireOrigin.j + 2), 'info');
      if (planned && tick === 26) ev('infra', 'Posey Tube pumped, one lane reopened', { lng: -122.27, lat: 37.79 }, 'info');
      if (tick === scenario.ticks) {
        emit({ type: 'run.done', runId, score, summary: `${evacuated.toLocaleString()} evacuated, ${stranded.toLocaleString()} still stranded, ${cutOffDistricts} district(s) cut off at T+${tick}.` });
      }
    });
  }

  // ---- agent choreography (relative to run start) ----
  const T = (tick: number, extra = 0) => t0 + 400 + tick * TICK + extra;
  const spawn = (a: AgentNode, ms: number) => later(ms, () => { agents.push(a); emit({ type: 'agent.spawn', runId, agent: { ...a, status: 'spawning' } }); later(350, () => emit({ type: 'agent.status', runId, agentId: a.id, status: 'thinking', tokens: bump(a.id, 180) })); });
  const status = (id: string, st: AgentNode['status'], ms: number, note?: string) => later(ms, () => emit({ type: 'agent.status', runId, agentId: id, status: st, note, tokens: bump(id, 300 + Math.round(rand() * 900)) }));

  spawn(chief, T(1));
  later(T(1, 600), () => emit({ type: 'memory.update', key: 'incident', value: `${quake ? `M${mag.toFixed(1)} Hayward Fault quake` : 'Hills wildfire'} · ${affected.length} districts flagged by chief` }));
  const dAgents = affected.map((id) => dist(r.districts.find((d) => d.id === id)!));
  dAgents.forEach((a, k) => spawn(a, T(2, 250 + k * 420)));
  later(T(3), () => emit({ type: 'log', text: 'Chief delegated 4 districts in parallel (Lightning 30B)', level: 'info' }));
  status('chief', 'done', T(3, 300), 'Delegated; monitoring cascades');
  // research agent under chief
  spawn({ id: 'research', parentId: 'chief', role: 'research', model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', label: 'Research · You.com', at: { lng: body.trigger.at.lng - 0.06, lat: body.trigger.at.lat + 0.045 }, status: 'spawning', depth: 1 }, T(3, 600));
  status('research', 'done', T(5, 200), 'Found 2017 Tubbs fire evac data; Posey Tube pump capacity');
  later(T(5, 400), () => emit({ type: 'memory.update', key: 'research', value: 'Posey Tube pumps rated 10k gpm; Coliseum shelter 8k capacity (verified)' }));

  // helpers
  const brk = r.districts.find((d) => d.id === 'brk')!; const oak = r.districts.find((d) => d.id === 'oak')!; const ala = r.districts.find((d) => d.id === 'ala')!; const hay = r.districts.find((d) => d.id === 'hay')!;
  const helpers: AgentNode[] = quake
    ? [helper(brk, 'firecrew', 0), helper(brk, 'route', 1), helper(oak, 'shelter', 2), helper(oak, 'route', 3), helper(ala, 'airlift', 4), helper(ala, 'supply', 5), helper(hay, 'shelter', 6)]
    : [helper(brk, 'firecrew', 0), helper(brk, 'route', 1), helper(oak, 'shelter', 2), helper(r.districts.find((d) => d.id === 'rich')!, 'supply', 3)];
  helpers.forEach((h, k) => { spawn(h, T(4, 300 + k * 380)); status(h.id, 'done', T(7, 200 + k * 300)); });

  // verifier on Oakland's first plan → reject, then re-plan → accept
  const verifierOak = helper(oak, 'verifier', 7);
  verifierOak.at = { lng: oak.centroid.lng - 0.05, lat: oak.centroid.lat - 0.02 };
  const plansFor = (d: typeof r.districts[number], good: boolean): DistrictPlan => {
    const shelter = r.infra.find((x) => x.kind === 'shelter' && x.districtIds.includes(d.id)) ?? r.infra[3];
    const hospital = r.infra.find((x) => x.kind === 'hospital' && x.districtIds.includes(d.id)) ?? r.infra[1];
    const routes = [
      { id: `r-${d.id}-1`, districtId: d.id, mode: 'road' as const, from: d.centroid, to: shelter.at, path: [d.centroid, { lng: (d.centroid.lng + shelter.at.lng) / 2 + 0.01, lat: (d.centroid.lat + shelter.at.lat) / 2 - 0.008 }, shelter.at], capacity: 1200, label: `Bus corridor → ${shelter.name}` },
      ...(d.id === 'ala' || (!good && d.id === 'oak') ? [{ id: `r-${d.id}-air`, districtId: d.id, mode: 'air' as const, from: d.centroid, to: hospital.at, path: [d.centroid, hospital.at], capacity: 60, label: 'Helicopter medevac' }] : []),
      ...(d.id === 'ala' ? [{ id: `r-${d.id}-boat`, districtId: d.id, mode: 'boat' as const, from: { lng: -122.3, lat: 37.77 }, to: { lng: -122.39, lat: 37.79 }, path: [{ lng: -122.3, lat: 37.77 }, { lng: -122.34, lat: 37.775 }, { lng: -122.39, lat: 37.79 }], capacity: 400, label: 'Ferry shuttle → SF' }] : []),
      ...(d.id === 'brk' ? [{ id: `r-${d.id}-2`, districtId: d.id, mode: 'road' as const, from: { lng: -122.22, lat: 37.9 }, to: hospital.at, path: [{ lng: -122.22, lat: 37.9 }, { lng: -122.25, lat: 37.885 }, hospital.at], capacity: 300, label: `Ambulance loop → ${hospital.name}` }] : []),
    ];
    return { districtId: d.id, summary: good ? `${d.name}: ${routes.length} corridors, ${d.id === 'brk' ? 6 : 2} crews, shelter at ${shelter.name}` : `${d.name}: evacuate via I-880 to Coliseum (I-880 status not checked)`, routes: good ? routes : routes.map((x) => ({ ...x, path: [d.centroid, { lng: -122.26, lat: 37.78 }, shelter.at], label: 'Evac via I-880 (closed!)' })), fireCrews: d.id === 'brk' ? 6 : 2, shelters: [shelter.id], airlift: d.id === 'ala', helpersRequested: (d.id === 'ala' ? ['airlift', 'supply'] : ['route', 'shelter']) as AgentRole[] };
  };
  // Oakland first (bad) plan
  later(T(6), () => emit({ type: 'agent.plan', runId, agentId: 'd-oak', plan: plansFor(oak, false) }));
  spawn(verifierOak, T(6, 300));
  later(T(7, 400), () => {
    emit({ type: 'verifier.verdict', runId, agentId: 'd-oak', verdict: { accepted: false, districtId: 'oak', reasons: ['Route r-oak-1 uses I-880, which is CLOSED in the current snapshot', 'No airlift requested while Alameda neighbours are cut off'], checks: [{ name: 'routes-avoid-closed-infra', pass: false, detail: 'I-880 Nimitz: closed' }, { name: 'shelter-capacity', pass: true, detail: 'Coliseum 8000 ≥ 6200 expected' }, { name: 'crew-budget', pass: true, detail: '2 of 14 crews' }] } });
    emit({ type: 'agent.status', runId, agentId: 'verifier-oak', status: 'rejected', note: 'Rejected Oakland plan: closed highway', tokens: bump('verifier-oak', 900) });
    emit({ type: 'agent.status', runId, agentId: 'd-oak', status: 'rejected', note: 'Re-planning (attempt 2)', tokens: bump('d-oak', 600) });
  });
  status('d-oak', 'thinking', T(8, 200), 'Re-planning around I-880 closure');
  later(T(9, 300), () => {
    emit({ type: 'agent.plan', runId, agentId: 'd-oak', plan: plansFor(oak, true) });
    emit({ type: 'agent.status', runId, agentId: 'verifier-oak', status: 'thinking', tokens: bump('verifier-oak', 400) });
  });
  later(T(10, 300), () => {
    emit({ type: 'verifier.verdict', runId, agentId: 'd-oak', verdict: { accepted: true, districtId: 'oak', reasons: ['All routes avoid closed infra', 'Shelter capacity sufficient'], checks: [{ name: 'routes-avoid-closed-infra', pass: true, detail: 'ok' }, { name: 'shelter-capacity', pass: true, detail: 'Coliseum 8000 ≥ 6200' }, { name: 'crew-budget', pass: true, detail: '2 of 14 crews' }] } });
    emit({ type: 'agent.status', runId, agentId: 'verifier-oak', status: 'done', note: 'Accepted', tokens: bump('verifier-oak', 300) });
    emit({ type: 'agent.status', runId, agentId: 'd-oak', status: 'done', note: 'Plan accepted', tokens: bump('d-oak', 500) });
  });
  // other districts: plan + accept
  dAgents.filter((a) => a.districtId !== 'oak').forEach((a, k) => {
    const d = r.districts.find((x) => x.id === a.districtId)!;
    const v = helper(d, 'verifier', 8 + k); v.id = 'verifier-' + d.id; v.at = { lng: d.centroid.lng + 0.04, lat: d.centroid.lat - 0.03 };
    later(T(8, 500 + k * 500), () => emit({ type: 'agent.plan', runId, agentId: a.id, plan: plansFor(d, true) }));
    spawn(v, T(8, 700 + k * 500));
    later(T(10, 900 + k * 500), () => {
      emit({ type: 'verifier.verdict', runId, agentId: a.id, verdict: { accepted: true, districtId: d.id, reasons: ['Routes avoid closed infra', d.id === 'ala' ? 'Airlift + ferry cover the cut-off island' : 'Crew allocation within budget'], checks: [{ name: 'routes-avoid-closed-infra', pass: true, detail: 'ok' }, { name: 'crew-budget', pass: true, detail: 'ok' }] } });
      emit({ type: 'agent.status', runId, agentId: v.id, status: 'done', tokens: bump(v.id, 700) });
      emit({ type: 'agent.status', runId, agentId: a.id, status: 'done', note: 'Plan accepted', tokens: bump(a.id, 800) });
    });
  });
  later(T(12), () => { planned = true; emit({ type: 'log', text: 'Accepted plans applied to sim: 3 corridors, 10 crews, 1 airlift, 1 ferry', level: 'info' }); });
  later(T(12, 100), () => emit({ type: 'score.update', runId, score: { stranded: 31000, evacuated: 4200, firesUncovered: 40, cutOffDistricts: 2, total: 320 } }));
  // reflector observes at end
  const reflector: AgentNode = { id: 'reflector', parentId: 'chief', role: 'reflector', model: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B', label: 'Reflector', at: { lng: body.trigger.at.lng + 0.07, lat: body.trigger.at.lat + 0.05 }, status: 'spawning', depth: 1 };
  spawn(reflector, T(scenario.ticks - 3));
  status('reflector', 'done', T(scenario.ticks, 400), 'Observed run; ready to evolve playbook');
  return { runId };
}
