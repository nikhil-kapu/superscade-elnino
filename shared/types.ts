// ===== SUPERSCADE shared contracts (server <-> client) =====
// Everything the sim, the agents, and the UI agree on lives here.

export type RegionId = 'bayarea' | 'nepal' | 'sanfrancisco';
export type HazardKind = 'quake' | 'fire' | 'burn' | 'landslide' | 'flood' | 'dam'; // burn = burned-out scar
export type InfraKind = 'bridge' | 'hospital' | 'shelter' | 'highway' | 'airport' | 'river_crossing' | 'eoc' | 'fire_station' | 'pump_station' | 'substation' | 'levee'; // eoc = emergency operations centre; pump_station = flood pumps / treatment plants; substation = power
export type InfraStatus = 'open' | 'damaged' | 'closed';
export type AgentRole = 'chief' | 'district' | 'route' | 'firecrew' | 'shelter' | 'supply' | 'airlift' | 'verifier' | 'research' | 'reflector';
export type AgentStatus = 'spawning' | 'thinking' | 'done' | 'rejected' | 'error';
export type RouteMode = 'road' | 'air' | 'boat';

export interface LngLat { lng: number; lat: number }

// ---- Region config: a region is just data; the engine is shared ----
export interface RegionConfig {
  id: RegionId;
  name: string;
  center: LngLat;
  zoom: number;
  bbox: [number, number, number, number]; // [west, south, east, north]
  grid: { cols: number; rows: number };
  districts: District[];
  infra: Infra[];
  faults?: Fault[];        // bayarea
  rivers?: River[];        // nepal
  landmask?: LngLat[][];   // optional land polygons: every cell outside all of them is water (sanfrancisco)
  defaultTriggerAt?: LngLat; // where the headline trigger lands when the UI/API gives no point (e.g. the 1906 epicentre)
  roads?: Road[];          // highways / arterials drawn as ribbons in the 3D scene (sanfrancisco)
  context?: RegionContext; // coarse land polygons, labels and roads around the sim bbox so the city sits in its geography
  triggers: TriggerSpec[]; // what a judge can start
  facts: Fact[];           // real-world notes shown in UI; verified flag
  disclaimer: string;
}
export interface District { id: string; name: string; centroid: LngLat; population: number; polygon: LngLat[]; terrain: 'urban' | 'hills' | 'valley' | 'coast' | 'softsoil'; elevRange?: [number, number] /* metres; overrides the terrain default (e.g. a built-up hill district that behaves as urban but renders as a ridge) */ }
export interface Infra { id: string; name: string; kind: InfraKind; at: LngLat; districtIds: string[]; capacity?: number; spanKm?: number /* bridge: road corridor radius over water (default 5.5 km bridge / 3 km river crossing) */ }
export interface Fault { id: string; name: string; line: LngLat[] }
export interface Road { id: string; name: string; kind: 'highway' | 'arterial'; line: LngLat[] } // drawn in the 3D scene; the sim routes on the grid, not on these
export interface RegionContext { bbox: [number, number, number, number]; land: LngLat[][]; labels?: { name: string; at: LngLat }[]; roads?: Road[] } // low-detail surroundings outside the sim bbox
export interface River { id: string; name: string; line: LngLat[] }
export interface TriggerSpec { kind: 'quake' | 'fire' | 'rain'; label: string; params: { name: string; label: string; min: number; max: number; step: number; default: number }[] }
export interface Fact { text: string; verified: boolean; source?: string }

// ---- Scenario: what the judge triggered ----
export interface Scenario {
  id: string;
  regionId: RegionId;
  seed: number;
  trigger: { kind: 'quake' | 'fire' | 'rain'; at: LngLat; params: Record<string, number> };
  ticks: number; // how long to simulate
}

// ---- Sim state (sent as snapshots) ----
export interface Cell { i: number; j: number; lng: number; lat: number; elev: number; terrain: District['terrain'] | 'water'; districtId?: string; pop: number }
export interface HazardCell { i: number; j: number; kind: HazardKind; intensity: number } // 0..1
export interface InfraState { id: string; status: InfraStatus; note?: string }
export interface DistrictState {
  id: string;
  shaking: number;        // 0..1
  fires: number;          // active fire cells
  flooded: number;        // flooded cells
  landslides: number;
  cutOff: boolean;        // no open road to shelter/hospital
  stranded: number;       // people with no plan
  evacuated: number;
  needs: string[];        // e.g. ["fire crew", "airlift", "shelter"]
}
export interface SimSnapshot {
  tick: number;
  hazards: HazardCell[];
  infra: InfraState[];
  districts: DistrictState[];
  score: Score;
}
export interface Score { stranded: number; firesUncovered: number; cutOffDistricts: number; evacuated: number; total: number } // total: higher is better

// ---- Agent plans ----
export interface RoutePlan { id: string; districtId: string; mode: RouteMode; from: LngLat; to: LngLat; path: LngLat[]; capacity: number; label: string }
export interface DistrictPlan {
  districtId: string;
  summary: string;
  routes: RoutePlan[];
  fireCrews: number;
  shelters: string[];     // infra ids
  airlift: boolean;
  helpersRequested: AgentRole[];
  severity?: number;                 // 0 monitoring · 1 alert · 2 evacuate · 3 escalate (district agent's own assessment)
  alerts?: AlertSpec[];              // emergency services the district agent notified
}
export type AlertService = 'fire' | 'police' | 'medical' | 'helicopter' | 'boat' | 'regional' | 'public';
export interface AlertSpec { service: AlertService; scope: 'district' | 'regional'; message: string }
export type RiskLabel = 'monitoring' | 'alert' | 'evacuate' | 'escalate';
export interface RiskForecast { horizonTicks: number; stranded: number; flooded: number; fires: number; cutOff: boolean; text: string }
export interface VerifierVerdict { accepted: boolean; reasons: string[]; districtId?: string; checks: { name: string; pass: boolean; detail: string }[] }

// ---- Playbook (Version N+1) ----
export interface Playbook {
  generation: number;
  rules: string[];                 // natural-language guidance the agents read
  params: PlaybookParams;          // structured knobs the fast evaluator uses
  history: PlaybookChange[];
}
export interface PlaybookParams {
  evacuateShakingThreshold: number;   // 0..1 shaking that triggers pre-emptive evacuation
  crewPerFireCell: number;            // crews allocated per burning cell
  airliftWhenCutOff: boolean;
  prepositionSheltersSoftSoil: boolean;
  reserveCrewFraction: number;        // 0..1 held back for cascades
  floodEvacLeadTicks: number;         // evacuate N ticks before predicted flood
}
export interface PlaybookChange { generation: number; summary: string; diff: string; kept: boolean; before: number; after: number; heldOutScenarios: string[] }

// ---- Live event stream (SSE) ----
export type CascadeEvent =
  | { type: 'run.start'; runId: string; scenario: Scenario; playbookGen: number }
  | { type: 'sim.snapshot'; runId: string; snapshot: SimSnapshot }
  | { type: 'sim.event'; runId: string; tick: number; kind: HazardKind | 'infra'; text: string; at: LngLat; severity: 'info' | 'warn' | 'critical' }
  | { type: 'agent.spawn'; runId: string; agent: AgentNode }
  | { type: 'agent.status'; runId: string; agentId: string; status: AgentStatus; note?: string; tokens?: number }
  | { type: 'agent.plan'; runId: string; agentId: string; plan: DistrictPlan }
  | { type: 'verifier.verdict'; runId: string; agentId: string; verdict: VerifierVerdict }
  | { type: 'score.update'; runId: string; score: Score }
  | { type: 'run.done'; runId: string; score: Score; summary: string }
  | { type: 'playbook.update'; playbook: Playbook; change?: PlaybookChange }
  | { type: 'district.risk'; runId: string; tick: number; districtId: string; severity: 0 | 1 | 2 | 3; label: RiskLabel; trend: 'rising' | 'steady' | 'falling' | 'settled'; forecast: RiskForecast; action: string }
  | { type: 'alert'; runId: string; tick: number; districtId: string; service: AlertService; scope: 'district' | 'regional'; message: string; agentId?: string }
  | { type: 'call'; runId: string; tick: number; districtId: string; to: string; role: 'emergency_contact' | 'citizen'; status: 'queued' | 'dialing' | 'connected' | 'completed' | 'failed' | 'simulated'; script: string; callId?: string; agentId?: string }
  | { type: 'memory.update'; key: string; value: string }
  | { type: 'log'; text: string; level: 'info' | 'warn' | 'error' }
  // ---- sponsor integrations (additive) ----
  /** a message observed on Agent Relay (DM, channel post, or threaded reply between agents) */
  | { type: 'relay.message'; runId?: string; id: string; from: string; to?: string; channel?: string; text: string; threadOf?: string; ts: number }
  /** a Terse ResourceLedger claim result (one durable actor per run serializes all claims) */
  | { type: 'terse.claim'; runId: string; agentId: string; districtId: string; resource: string; requested: number; granted: number; status: 'granted' | 'partial' | 'denied' | 'released'; remaining: Record<string, number>; total?: Record<string, number> }
  /** a durable Terse actor was booted for an agent */
  | { type: 'terse.actor'; runId: string; agentId: string; actor: string; ok: boolean; ms?: number };

export interface AgentNode {
  id: string;
  parentId?: string;
  role: AgentRole;
  model: string;
  label: string;
  districtId?: string;
  at: LngLat;           // where to draw it on the map
  status: AgentStatus;
  depth: number;
  /** Terse durable actor id backing this agent (additive) */
  terseActorId?: string;
  /** Agent Relay handle for this agent (additive) */
  relayHandle?: string;
}

// ---- HTTP API ----
// GET  /api/regions                 -> RegionConfig[]
// GET  /api/regions/:id/cells       -> Cell[]
// POST /api/run  {regionId, trigger, seed?} -> {runId}   (events stream on /api/events)
// GET  /api/events                  -> SSE of CascadeEvent
// GET  /api/playbook                -> Playbook
// POST /api/evolve                  -> runs reflector + held-out eval, emits playbook.update
// POST /api/reset                   -> clears playbook to gen 0
