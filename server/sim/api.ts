// Interface the agent layer and run loop code against. Implemented in server/sim/engine.ts.
import type { Cell, DistrictPlan, DistrictState, HazardKind, LngLat, PlaybookParams, RegionConfig, RouteMode, Scenario, Score, SimSnapshot, VerifierVerdict } from '../../shared/types.ts';

export interface SimEventLite { kind: HazardKind | 'infra'; text: string; at: LngLat; severity: 'info' | 'warn' | 'critical'; districtId?: string }

export interface SimApi {
  region: RegionConfig;
  scenario: Scenario;
  tick: number;
  cells: Cell[];
  resources: { fireCrews: number; helicopters: number; boats: number };
  /** advance one tick; returns notable events */
  step(): SimEventLite[];
  snapshot(): SimSnapshot;
  districtState(id: string): DistrictState;
  /** districts newly affected since last call (for spawning agents) */
  newlyAffectedDistricts(): string[];
  /** deterministic checks the verifier runs before the LLM check */
  checkPlan(plan: DistrictPlan): VerifierVerdict;
  /** apply an accepted plan: allocates crews, opens routes/airlift, moves people, affects score */
  applyPlan(plan: DistrictPlan): void;
  /** A* over grid: avoids hazard cells / closed infra; null if unreachable. mode 'air' ignores ground hazards */
  findRoute(from: LngLat, to: LngLat, mode: RouteMode): LngLat[] | null;
  /** nearest open shelter/hospital reachable by road from district; null if cut off */
  nearestSafeInfra(districtId: string): { id: string; path: LngLat[] } | null;
  score(): Score;
  /** plain-text situation report for LLM prompts (compact!) */
  describe(districtId?: string): string;
}

export interface SimModule {
  createSim(region: RegionConfig, scenario: Scenario): SimApi;
  /** deterministic policy driven by playbook params; used for held-out evaluation (no LLM) */
  autoRespond(sim: SimApi, params: PlaybookParams): void;
  /** run full scenario with autoRespond on given seeds; returns mean Score.total */
  evaluateHeldOut(region: RegionConfig, params: PlaybookParams, seeds: number[], trigger: Scenario['trigger']): Promise<{ mean: number; perSeed: { seed: number; score: Score }[] }>;
  makeScenario(region: RegionConfig, trigger: Scenario['trigger'], seed?: number): Scenario;
}
