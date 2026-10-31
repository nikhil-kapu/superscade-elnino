// SUPERSCADE deterministic cascade engine. No LLM calls, no external deps. Rules are simple and believable, not real physics.
import type {
  Cell, District, DistrictPlan, DistrictState, HazardCell, Infra, InfraState, LngLat, PlaybookParams,
  RegionConfig, RouteMode, Scenario, Score, SimSnapshot, VerifierVerdict,
} from '../../shared/types.ts';
import type { SimApi, SimEventLite, SimModule } from './api.ts';

// ---------- utils ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function pointInPolygon(p: LngLat, poly: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
    const intersect = ((yi > p.lat) !== (yj > p.lat)) && (p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function distKm(a: LngLat, b: LngLat): number {
  const ky = 111.2, kx = 111.2 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dx = (a.lng - b.lng) * kx, dy = (a.lat - b.lat) * ky;
  return Math.sqrt(dx * dx + dy * dy);
}
function distToSegmentKm(p: LngLat, a: LngLat, b: LngLat): number {
  const kx = 111.2 * Math.cos(p.lat * Math.PI / 180), ky = 111.2;
  const px = p.lng * kx, py = p.lat * ky, ax = a.lng * kx, ay = a.lat * ky, bx = b.lng * kx, by = b.lat * ky;
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const L2 = vx * vx + vy * vy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
  const cx = ax + t * vx, cy = ay + t * vy;
  return Math.hypot(px - cx, py - cy);
}
function distToLineKm(p: LngLat, line: LngLat[]): number {
  if (line.length === 1) return distKm(p, line[0]);
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k++) best = Math.min(best, distToSegmentKm(p, line[k], line[k + 1]));
  return best;
}
/** position along polyline (km from start) of the nearest point on the line */
function alongLineKm(p: LngLat, line: LngLat[]): number {
  let best = Infinity, bestPos = 0, acc = 0;
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k], b = line[k + 1];
    const segLen = distKm(a, b);
    const d = distToSegmentKm(p, a, b);
    if (d < best) {
      best = d;
      // projection fraction
      const kx = 111.2 * Math.cos(p.lat * Math.PI / 180), ky = 111.2;
      const vx = (b.lng - a.lng) * kx, vy = (b.lat - a.lat) * ky, wx = (p.lng - a.lng) * kx, wy = (p.lat - a.lat) * ky;
      const L2 = vx * vx + vy * vy;
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
      bestPos = acc + t * segLen;
    }
    acc += segLen;
  }
  return bestPos;
}

const HAZ_FIRE = 0.3, HAZ_FLOOD = 0.4;
const STORM_INFRA_REGIONS = new Set<string>(['bayarea', 'sanfrancisco']); // regions whose rain trigger also degrades municipal infra
const INIT_RESOURCES = { fireCrews: 24, helicopters: 6, boats: 8 };

interface AppliedPlan { plan: DistrictPlan; tick: number }

// ---------- Sim ----------
class Sim implements SimApi {
  region: RegionConfig;
  scenario: Scenario;
  tick = 0;
  cells: Cell[] = [];
  resources = { ...INIT_RESOURCES };

  private cols: number; private rows: number; private west: number; private south: number; private cw: number; private ch: number;
  private rng: () => number;
  private n: number;
  // hazard fields
  private shake: Float32Array; private fire: Float32Array; private water: Float32Array; private landslide: Uint8Array;
  private burnTicks: Int16Array; private burnedOut: Uint8Array; private dam: Uint8Array; private damBurst: Int16Array;
  private shoreline: Uint8Array; private riverIdx: Int32Array; private flood: Float32Array; private channelCap: Float32Array; // riverIdx: -1 if not river, else order position
  private riverOrder: number[][] = []; // per river: ordered cell indices (upstream -> downstream)
  private infraState = new Map<string, InfraState>();
  private infraCell = new Map<string, number>();
  private distCells = new Map<string, number[]>();
  private distById = new Map<string, District>();
  private roadCost: Float32Array; private roadCostDirty = true;
  private plans = new Map<string, AppliedPlan[]>();
  private crews = new Map<string, number>();
  private evacRate = new Map<string, number>();
  private evacuated = new Map<string, number>();
  private airliftOn = new Set<string>(); private boatsOn = new Set<string>();
  private affectedSeen = new Set<string>();
  private threatPeak = new Map<string, number>();
  private strandedCum = 0; private uncoveredCum = 0; // accumulated harm over ticks (score is not just end-state)
  private strandedPeak = new Map<string, number>();
  private burnedCells = 0; // cells that burned out with no suppression (property damage)
  private fireTicksCum = 0; // burning cell-ticks in populated districts (exposure; faster suppression lowers it)
  private prepositioned = new Set<string>(); // softsoil districts with shelters pre-staged (plan.shelters)
  private dstates = new Map<string, DistrictState>();
  private dstateTick = -1;
  private pending: SimEventLite[] = [];
  private rainCells: Uint8Array;
  private rainDist = new Float32Array(0); // km from the storm centre (rain trigger)

  constructor(region: RegionConfig, scenario: Scenario) {
    this.region = region; this.scenario = scenario;
    this.rng = mulberry32(scenario.seed || 1);
    const [w, s, e, nn] = region.bbox;
    this.cols = region.grid.cols; this.rows = region.grid.rows; this.west = w; this.south = s;
    this.cw = (e - w) / this.cols; this.ch = (nn - s) / this.rows;
    this.n = this.cols * this.rows;
    this.shake = new Float32Array(this.n); this.fire = new Float32Array(this.n); this.water = new Float32Array(this.n);
    this.landslide = new Uint8Array(this.n); this.burnTicks = new Int16Array(this.n); this.burnedOut = new Uint8Array(this.n);
    this.dam = new Uint8Array(this.n); this.damBurst = new Int16Array(this.n); this.shoreline = new Uint8Array(this.n);
    this.riverIdx = new Int32Array(this.n).fill(-1); this.flood = new Float32Array(this.n); this.channelCap = new Float32Array(this.n); this.roadCost = new Float32Array(this.n); this.rainCells = new Uint8Array(this.n); this.rainDist = new Float32Array(this.n);
    for (const d of region.districts) { this.distById.set(d.id, d); this.distCells.set(d.id, []); }
    this.resources.fireCrews = Math.max(INIT_RESOURCES.fireCrews, region.districts.length * 3);
    this.buildCells();
    this.buildRivers();
    for (const inf of region.infra) {
      this.infraState.set(inf.id, { id: inf.id, status: 'open' });
      this.infraCell.set(inf.id, this.idxOf(inf.at));
    }
    for (const d of region.districts) { this.crews.set(d.id, 0); this.evacRate.set(d.id, 0); this.evacuated.set(d.id, 0); this.plans.set(d.id, []); }
    this.applyTrigger();
    this.computeDistrictStates();
  }

  // ----- grid helpers -----
  private idxOf(p: LngLat): number {
    const i = Math.max(0, Math.min(this.cols - 1, Math.floor((p.lng - this.west) / this.cw)));
    const j = Math.max(0, Math.min(this.rows - 1, Math.floor((p.lat - this.south) / this.ch)));
    return j * this.cols + i;
  }
  private center(idx: number): LngLat { const c = this.cells[idx]; return { lng: c.lng, lat: c.lat }; }
  private isBayWater(lng: number, lat: number): boolean {
    if (this.region.id !== 'bayarea' || this.region.landmask?.length) return false;
    if (lng < -122.52) return true; // Pacific
    if (lng >= -122.52 && lng <= -122.2 && lat >= 37.45 && lat <= 38.0) return true; // central bay
    if (lng >= -122.25 && lng <= -122.05 && lat >= 37.43 && lat <= 37.62) return true; // south bay
    return false;
  }
  /** regions with a landmask: anything outside the land polygons is water (and belongs to no district) */
  private outsideLandmask(p: LngLat): boolean {
    const mask = this.region.landmask;
    if (!mask?.length) return false;
    return !mask.some(poly => pointInPolygon(p, poly));
  }
  private buildCells() {
    const R = this.region;
    const cellsPer = new Map<string, number>();
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      const lng = this.west + (i + 0.5) * this.cw, lat = this.south + (j + 0.5) * this.ch;
      const p = { lng, lat };
      let d: District | undefined;
      let terrain: Cell['terrain'];
      if (this.outsideLandmask(p)) terrain = 'water';
      else {
        for (const dd of R.districts) if (pointInPolygon(p, dd.polygon)) { d = dd; break; }
        terrain = d ? d.terrain : (this.isBayWater(lng, lat) ? 'water' : 'hills');
      }
      const noise = this.rng();
      let elev = 0;
      switch (terrain) {
        case 'water': elev = 0; break;
        case 'hills': elev = 150 + 250 * noise; break;
        case 'urban': elev = 5 + 55 * noise; break;
        case 'softsoil': elev = 5 * noise; break;
        case 'valley': elev = 20 + 60 * noise; break;
        case 'coast': elev = 2 + 25 * noise; break;
      }
      if (d?.elevRange && terrain !== 'water') elev = d.elevRange[0] + (d.elevRange[1] - d.elevRange[0]) * noise;
      const idx = j * this.cols + i;
      this.cells.push({ i, j, lng, lat, elev, terrain, districtId: d?.id, pop: 0 });
      if (d) { this.distCells.get(d.id)!.push(idx); cellsPer.set(d.id, (cellsPer.get(d.id) ?? 0) + 1); }
    }
    for (const d of R.districts) {
      const idxs = this.distCells.get(d.id)!;
      if (idxs.length === 0) { // degenerate polygon: put the centroid cell in
        const idx = this.idxOf(d.centroid); idxs.push(idx); this.cells[idx].districtId = d.id; this.cells[idx].terrain = d.terrain;
      }
      const per = Math.round(d.population / idxs.length);
      for (const idx of idxs) this.cells[idx].pop = per;
    }
    for (let idx = 0; idx < this.n; idx++) {
      if (this.cells[idx].terrain === 'water') continue;
      for (const nb of this.neighbors(idx)) if (this.cells[nb].terrain === 'water') { this.shoreline[idx] = 1; break; }
    }
  }
  private buildRivers() {
    const rivers = this.region.rivers ?? [];
    rivers.forEach((river, r) => {
      const members: { idx: number; pos: number }[] = [];
      for (let idx = 0; idx < this.n; idx++) {
        const c = this.cells[idx];
        if (distToLineKm(c, river.line) <= 3) members.push({ idx, pos: alongLineKm(c, river.line) });
      }
      members.sort((a, b) => a.pos - b.pos);
      const order = members.map(m => m.idx);
      this.riverOrder.push(order);
      order.forEach((idx, k) => { if (this.riverIdx[idx] === -1) { this.riverIdx[idx] = r * 100000 + k; this.channelCap[idx] = 0.3 + 0.5 * (k / Math.max(1, order.length - 1)); } });
    });
    // river cells are local lows so overland flow drains into them
    for (let idx = 0; idx < this.n; idx++) {
      if (this.riverIdx[idx] < 0 || this.cells[idx].terrain === 'water') continue;
      let minNb = Infinity;
      for (const nb of this.neighbors(idx)) if (this.riverIdx[nb] < 0 && this.cells[nb].terrain !== 'water') minNb = Math.min(minNb, this.cells[nb].elev);
      if (minNb < Infinity) this.cells[idx].elev = Math.min(this.cells[idx].elev, Math.max(0, minNb - 15));
    }
  }
  private *neighbors(idx: number): Generator<number> {
    const i = idx % this.cols, j = (idx - i) / this.cols;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= this.cols || nj >= this.rows) continue;
      yield nj * this.cols + ni;
    }
  }
  private hazardAt(idx: number): boolean { return this.fire[idx] > HAZ_FIRE || this.flood[idx] > HAZ_FLOOD || this.landslide[idx] === 1; }
  private infraById(id: string): Infra | undefined { return this.region.infra.find(x => x.id === id); }
  private ev(kind: SimEventLite['kind'], text: string, at: LngLat, severity: SimEventLite['severity'], districtId?: string) {
    this.pending.push({ kind, text, at, severity, districtId });
  }

  // ----- trigger -----
  private applyTrigger() {
    const t = this.scenario.trigger;
    if (t.kind === 'quake') this.quake(t.params.magnitude ?? 6.9, t.at, false);
    else if (t.kind === 'fire') {
      const idx0 = this.idxOf(t.at);
      const seeds = [idx0, ...[...this.neighbors(idx0)].filter(() => this.rng() < 0.5)];
      for (const s of seeds) if (this.cells[s].terrain !== 'water') { this.fire[s] = 0.9; this.burnTicks[s] = 0; }
      this.ev('fire', `Fire ignites near ${this.cells[idx0].districtId ?? 'open land'}`, t.at, 'critical', this.cells[idx0].districtId);
    } else if (t.kind === 'rain') {
      const radiusKm = t.params.radius_km ?? 18; // regions may widen the storm footprint (Bay Area atmospheric river); Nepal keeps 18 km
      for (let idx = 0; idx < this.n; idx++) { const dk = distKm(this.cells[idx], t.at); this.rainDist[idx] = dk; if (dk <= radiusKm) this.rainCells[idx] = 1; }
      this.ev('flood', `Heavy rain begins (${t.params.rain_mm ?? 200} mm over ${(t.params.duration ?? t.params.duration_ticks ?? 8)} ticks)`, t.at, 'warn');
    }
    this.roadCostDirty = true;
  }

  private quake(M: number, epi: LngLat, aftershock: boolean) {
    const faults = this.region.faults ?? [];
    let line: LngLat[] = [epi];
    let fname = 'point source';
    let best = Infinity;
    for (const f of faults) { const d = distToLineKm(epi, f.line); if (d < best && d < 30) { best = d; line = f.line; fname = f.name; } }
    const base = clamp01((M - 4.5) / 3.5);
    const scale = 8 + 4 * (M - 6) + 10 * Math.max(0, M - 7); // long ruptures (M>7): strong shaking reaches further
    const epiScale = 80 + 40 * (M - 6);
    const sumByD = new Map<string, number>();
    for (let idx = 0; idx < this.n; idx++) {
      const c = this.cells[idx];
      const d = distToLineKm(c, line);
      let s = base * Math.exp(-d / Math.max(2, scale)) * Math.exp(-distKm(c, epi) / Math.max(20, epiScale));
      if (c.terrain === 'softsoil') s *= 1.5;
      s = clamp01(s);
      this.shake[idx] = aftershock ? Math.max(this.shake[idx] * 0.85, s) : s;
      if (c.districtId) sumByD.set(c.districtId, (sumByD.get(c.districtId) ?? 0) + s);
    }
    const meanShake = new Map<string, number>();
    for (const d of this.region.districts) meanShake.set(d.id, (sumByD.get(d.id) ?? 0) / Math.max(1, this.distCells.get(d.id)!.length));
    const label = aftershock ? `M${M.toFixed(1)} aftershock` : `M${M.toFixed(1)} earthquake on the ${fname}`;
    this.ev('quake', label, epi, aftershock ? 'warn' : 'critical');
    // infra damage
    for (const inf of this.region.infra) {
      const st = this.infraState.get(inf.id)!;
      const sHere = this.shake[this.infraCell.get(inf.id)!];
      const sDist = Math.max(sHere, ...inf.districtIds.map(id => meanShake.get(id) ?? 0));
      if (inf.kind === 'bridge' && sDist > 0.45 && st.status === 'open') {
        const special = /bay ?bridge|richmond/i.test(inf.name) ? 1.3 : 1.0;
        if (this.rng() < sDist * special * 0.9) { st.status = 'damaged'; st.note = 'quake damage, inspection required'; this.ev('infra', `${inf.name} damaged by shaking`, inf.at, 'critical', inf.districtIds[0]); }
      } else if (inf.kind === 'highway' && sHere > 0.6 && st.status === 'open') {
        st.status = 'closed'; st.note = 'pavement/overpass damage'; this.ev('infra', `${inf.name} closed`, inf.at, 'warn', inf.districtIds[0]);
      } else if ((inf.kind === 'hospital' || inf.kind === 'shelter') && sHere > 0.8 && st.status === 'open' && this.rng() < 0.3) {
        st.status = 'damaged'; st.note = 'structural damage'; this.ev('infra', `${inf.name} damaged`, inf.at, 'warn', inf.districtIds[0]);
      }
    }
    // fires & landslides
    for (const d of this.region.districts) {
      const ms = meanShake.get(d.id)!;
      const idxs = this.distCells.get(d.id)!;
      if (ms > 0.45 || aftershock) {
        const cand = idxs.filter(idx => this.shake[idx] > 0.5 && (this.cells[idx].terrain === 'urban' || this.cells[idx].terrain === 'softsoil') && this.fire[idx] === 0 && !this.burnedOut[idx]);
        let nFires = aftershock ? (ms > 0.45 && this.rng() < 0.5 ? 1 : 0) : 1 + Math.floor(this.rng() * 3);
        if (!aftershock && ms <= 0.45) nFires = 0;
        for (let k = 0; k < nFires && cand.length; k++) {
          const pick = cand.splice(Math.floor(this.rng() * cand.length), 1)[0];
          this.fire[pick] = 0.7 + 0.3 * this.rng(); this.burnTicks[pick] = 0;
          this.ev('fire', `Gas-line fire in ${d.name}`, this.center(pick), 'critical', d.id);
        }
      }
      let slides = 0;
      for (const idx of idxs) {
        if (this.cells[idx].terrain === 'hills' && this.shake[idx] > 0.5 && !this.landslide[idx] && this.rng() < 0.35 * this.shake[idx]) { this.landslide[idx] = 1; slides++; this.checkDam(idx); }
      }
      if (slides) this.ev('landslide', `${slides} landslide${slides > 1 ? 's' : ''} in ${d.name}`, d.centroid, 'warn', d.id);
    }
    this.roadCostDirty = true;
  }

  // ----- hazards per tick -----
  private stepFire() {
    const p = this.scenario.trigger.params;
    const wind = this.scenario.trigger.kind === 'fire' ? (p.wind_speed ?? 20) : 10;
    const windDir = this.scenario.trigger.kind === 'fire' ? (p.wind_dir_deg ?? 225) : 225;
    const dry = this.scenario.trigger.kind === 'fire' ? (p.dryness ?? 0.7) : 0.5;
    const b = ((windDir + 180) % 360) * Math.PI / 180;
    const ddi = Math.round(Math.sin(b)), ddj = Math.round(Math.cos(b));
    const pDown = Math.min(0.95, 0.55 * dry * Math.max(0.3, Math.min(1.8, wind / 20)));
    const pOther = 0.12 * dry;
    const terrainF = (t: Cell['terrain']) => t === 'water' ? 0 : t === 'hills' ? 1.6 : t === 'urban' ? 0.8 : t === 'softsoil' ? 0.8 : t === 'coast' ? 0.9 : 1.0;
    const burning: number[] = [];
    for (let idx = 0; idx < this.n; idx++) if (this.fire[idx] > 0) burning.push(idx);
    const newFire: number[] = [];
    for (const idx of burning) {
      const i = idx % this.cols, j = (idx - i) / this.cols;
      for (const nb of this.neighbors(idx)) {
        if (this.fire[nb] > 0 || this.burnedOut[nb]) continue;
        const ni = nb % this.cols, nj = (nb - ni) / this.cols;
        const isDown = (ni - i) === ddi && (nj - j) === ddj;
        const pr = (isDown ? pDown : pOther) * terrainF(this.cells[nb].terrain) * Math.min(1, this.fire[idx] + 0.3);
        if (pr > 0 && this.rng() < pr) newFire.push(nb);
      }
      this.burnTicks[idx]++;
      if (this.burnTicks[idx] >= 6) { this.fire[idx] = 0; this.burnedOut[idx] = 1; this.burnedCells++; }
      else if (this.burnTicks[idx] >= 3) this.fire[idx] = Math.max(0.2, this.fire[idx] - 0.12);
    }
    for (const nb of newFire) if (this.fire[nb] === 0 && !this.burnedOut[nb]) { this.fire[nb] = 0.6 + 0.4 * this.rng(); this.burnTicks[nb] = 0; }
    // crews suppress
    for (const d of this.region.districts) {
      const crews = this.crews.get(d.id) ?? 0;
      if (!crews) continue;
      const cells = this.distCells.get(d.id)!.filter(idx => this.fire[idx] > 0).sort((a, b2) => this.fire[b2] - this.fire[a]);
      let k = 0;
      for (const idx of cells) { if (k++ >= crews) break; this.fire[idx] = 0; this.burnedOut[idx] = 1; }
    }
    // events: district-level fire growth
    for (const d of this.region.districts) {
      const now = this.distCells.get(d.id)!.filter(idx => this.fire[idx] > 0).length;
      const prev = this.dstates.get(d.id)?.fires ?? 0;
      if (now > prev && now - prev >= 2) this.ev('fire', `Fire spreading in ${d.name}: ${now} cells burning`, d.centroid, now > 6 ? 'critical' : 'warn', d.id);
    }
    if (burning.length || newFire.length) this.roadCostDirty = true;
  }

  /** absorption before surface water becomes flood: river channel capacity, else terrain soak */
  private floodOf(idx: number): number {
    const w = this.water[idx];
    if (w <= 0) return 0;
    const cap = this.riverIdx[idx] >= 0 ? this.channelCap[idx] : (this.cells[idx].terrain === 'hills' ? 0.45 : this.cells[idx].terrain === 'valley' ? 0.15 : this.cells[idx].terrain === 'urban' ? 0.15 : 0.08);
    return Math.min(1, Math.max(0, w - cap) * 1.6);
  }
  private stepWater() {
    const t = this.scenario.trigger;
    const dur = (t.params.duration ?? t.params.duration_ticks ?? 8), mm = t.params.rain_mm ?? 200;
    const raining = t.kind === 'rain' && this.tick <= dur;
    // a storm with an explicit footprint (radius_km) builds outward from where it makes landfall; legacy (Nepal) rain covers its 18 km disc at once
    const grow = t.kind === 'rain' && t.params.radius_km != null;
    const rr = grow ? (t.params.radius_km as number) * Math.min(1, 0.35 + 0.65 * this.tick / Math.max(1, dur * 0.6)) : Infinity;
    const stormRegion = STORM_INFRA_REGIONS.has(this.region.id);
    const wet = (idx: number) => this.rainCells[idx] === 1 && (!grow || this.rainDist[idx] <= rr);
    if (raining) {
      const add = (mm / 300) * 0.09;
      for (let idx = 0; idx < this.n; idx++) {
        if (this.cells[idx].terrain === 'water') continue;
        this.water[idx] += wet(idx) ? add : add * 0.15;
      }
      // rain-saturated slopes fail (main landslide driver)
      const pSlide = 0.025 * (mm / 300);
      for (let idx = 0; idx < this.n; idx++) {
        const slope = this.cells[idx].terrain === 'hills' || (stormRegion && this.cells[idx].terrain !== 'water' && this.cells[idx].elev > 120); // El Niño regions: steep built-up hills (Twin Peaks) can fail too
        if (wet(idx) && slope && !this.landslide[idx] && this.rng() < pSlide * (this.cells[idx].terrain === 'hills' ? 1 : 0.5)) {
          this.landslide[idx] = 1;
          const d = this.cells[idx].districtId;
          this.ev('landslide', `Rain-triggered landslide${d ? ' in ' + this.distById.get(d)!.name : ''}`, this.center(idx), 'warn', d);
          this.checkDam(idx);
        }
      }
    }
    let any = false;
    // king tide (optional, only when the trigger sets tide_ft > 0): high-tide pulses push water onto low shoreline cells,
    // block creek mouths from draining, and undercut coastal bluffs while the storm surf is up
    const tideFt = t.kind === 'rain' ? (t.params.tide_ft ?? 0) : 0;
    const tideLevel = tideFt > 0 ? (tideFt / 7) * Math.max(0, Math.sin((this.tick - 1) * Math.PI / 4)) : 0; // peaks every 8 ticks (t3, t11, t19, ...)
    if (tideLevel > 0.05) {
      let inundated = 0;
      for (let idx = 0; idx < this.n; idx++) {
        const c = this.cells[idx];
        if (!this.shoreline[idx] || c.terrain === 'water' || c.terrain === 'hills') continue;
        if (c.terrain === 'softsoil' || (c.elev < 6 && c.terrain !== 'coast')) { this.water[idx] = Math.min(2.5, this.water[idx] + (c.terrain === 'softsoil' ? 0.32 : 0.22) * tideLevel); inundated++; }
        else if (c.terrain === 'coast' && raining && wet(idx) && !this.landslide[idx] && this.rng() < 0.08 * tideLevel) {
          this.landslide[idx] = 1; any = true;
          const d = c.districtId;
          this.ev('landslide', `Storm surf and king tide undercut a coastal bluff${d ? ' in ' + this.distById.get(d)!.name : ''}`, this.center(idx), 'warn', d);
        }
      }
      if (inundated && Math.sin((this.tick - 1) * Math.PI / 4) > 0.99) this.ev('flood', `King tide (${tideFt.toFixed(1)} ft) peaks: low bayfront and shoreline flooding, creek mouths backed up`, this.scenario.trigger.at, 'warn');
    }
    // overland flow to lowest neighbour; hills shed fast, flat terrain slowly. Effective height = elev + 20 m per unit water
    const next = Float32Array.from(this.water);
    for (let idx = 0; idx < this.n; idx++) {
      const w = this.water[idx];
      if (w <= 0.02) continue;
      any = true;
      const c = this.cells[idx];
      if (c.terrain === 'water') { next[idx] = 0; continue; }
      if (this.dam[idx]) continue; // dam holds water
      const isRiver = this.riverIdx[idx] >= 0;
      if (!isRiver) {
        let lowest = -1, lowH = c.elev + w * 20;
        for (const nb of this.neighbors(idx)) {
          const h = this.cells[nb].terrain === 'water' ? -50 : this.cells[nb].elev + this.water[nb] * 20;
          if (h < lowH) { lowH = h; lowest = nb; }
        }
        if (lowest >= 0 && !this.dam[lowest]) {
          const frac = c.terrain === 'hills' ? 0.6 : 0.35;
          const move = Math.min(w * frac, ((c.elev + w * 20) - lowH) / 40);
          next[idx] -= move; if (this.cells[lowest].terrain !== 'water') next[lowest] += move;
        }
      }
      next[idx] *= c.terrain === 'hills' ? 0.9 : 0.96; // infiltration / drainage
    }
    // river routing: conveyor downstream along river order
    for (const order of this.riverOrder) {
      for (let k = order.length - 1; k >= 0; k--) {
        const idx = order[k];
        if (this.dam[idx]) { next[idx] += 0.15; continue; } // lake forms behind the dam
        const w = next[idx]; if (w <= 0.01) continue;
        if (k + 1 < order.length) {
          const dn = order[k + 1];
          if (this.dam[dn]) continue; // blocked: pile up upstream
          const move = w * 0.7; next[idx] -= move; if (this.cells[dn].terrain !== 'water') next[dn] += move;
        } else next[idx] *= tideLevel > 0.3 ? 0.55 : 0.1; // river mouth drains out of the region (a high king tide backs it up)
      }
    }
    for (let idx = 0; idx < this.n; idx++) this.water[idx] = Math.min(2.5, Math.max(0, next[idx]));
    // dam bursts
    for (const order of this.riverOrder) {
      for (let k = 0; k < order.length; k++) {
        const idx = order[k];
        if (!this.dam[idx] || this.tick < this.damBurst[idx]) continue;
        this.dam[idx] = 0;
        for (let u = 1; u <= 8 && k + u < order.length; u++) { const dn = order[k + u]; if (this.cells[dn].terrain !== 'water') this.water[dn] = Math.min(2.5, this.water[dn] + 0.6 + this.channelCap[dn] * (1 - u * 0.08)); }
        this.water[idx] *= 0.3;
        const d = this.cells[idx].districtId;
        this.ev('dam', `Landslide dam bursts${d ? ' in ' + this.distById.get(d)!.name : ''}: flood surge downstream`, this.center(idx), 'critical', d);
        any = true;
      }
    }
    // recompute flood field; flood-saturated hills may slide (secondary driver)
    for (let idx = 0; idx < this.n; idx++) {
      this.flood[idx] = this.floodOf(idx);
      if (this.cells[idx].terrain === 'hills' && this.flood[idx] > 0.5 && !this.landslide[idx] && this.rng() < 0.08) {
        this.landslide[idx] = 1; any = true;
        const d = this.cells[idx].districtId;
        this.ev('landslide', `Flood-undercut landslide${d ? ' in ' + this.distById.get(d)!.name : ''}`, this.center(idx), 'warn', d);
        this.checkDam(idx);
      }
    }
    // flooded infra
    for (const inf of this.region.infra) {
      if (inf.kind !== 'bridge' && inf.kind !== 'river_crossing') continue;
      const st = this.infraState.get(inf.id)!;
      if (st.status !== 'closed' && this.flood[this.infraCell.get(inf.id)!] > 0.5) { st.status = 'closed'; st.note = 'flooded'; this.ev('infra', `${inf.name} closed by floodwater`, inf.at, 'critical', inf.districtIds[0]); }
    }
    // storm impacts on municipal services (El Niño regions only; Nepal keeps its original rules):
    // flooded / slid highways close, substations trip (outages), pump stations & levees are overwhelmed, facilities take water
    if (t.kind === 'rain' && STORM_INFRA_REGIONS.has(this.region.id)) {
      for (const inf of this.region.infra) {
        const st = this.infraState.get(inf.id)!; if (st.status === 'closed') continue;
        const idx = this.infraCell.get(inf.id)!; const fl = this.flood[idx];
        let slid = this.landslide[idx] === 1;
        if (!slid && inf.kind === 'highway') for (const nb of this.neighbors(idx)) if (this.landslide[nb]) { slid = true; break; }
        const d0 = inf.districtIds[0];
        const set = (status: 'damaged' | 'closed', note: string, text: string, sev: 'warn' | 'critical') => { if (st.status === status) return; st.status = status; st.note = note; this.ev('infra', text, inf.at, sev, d0); any = true; };
        switch (inf.kind) {
          case 'highway': if (slid) set('closed', 'landslide / debris flow', `${inf.name} closed: landslide / debris flow across the road`, 'critical'); else if (fl > 0.5) set('closed', 'flooded', `${inf.name} closed by flooding`, 'critical'); break;
          case 'substation': if (fl > 0.45) set('closed', 'flooded — outage', `${inf.name} flooded: PG&E de-energizes it, power outage spreading`, 'critical'); break;
          case 'pump_station': if (fl > 0.75) set('closed', 'flooded', `${inf.name} flooded and offline`, 'critical'); else if (fl > 0.35) set('damaged', 'overwhelmed', `${inf.name} overwhelmed: inflow exceeds pump capacity`, 'warn'); break;
          case 'levee': if (fl > 0.6) set('damaged', 'overtopped', `${inf.name} overtopped`, 'critical'); break;
          case 'airport': if (fl > 0.6) set('closed', 'flooded', `${inf.name} closed: runways flooded`, 'warn'); break;
          case 'hospital': case 'shelter': case 'eoc': case 'fire_station': if (fl > 0.7 || slid) set('damaged', slid ? 'landslide' : 'flooding', `${inf.name} ${slid ? 'hit by a landslide' : 'taking floodwater'}: operating degraded`, 'warn'); break;
        }
      }
    }
    // flood events per district
    for (const d of this.region.districts) {
      const now = this.distCells.get(d.id)!.filter(idx => this.flood[idx] > HAZ_FLOOD).length;
      const prev = this.dstates.get(d.id)?.flooded ?? 0;
      if (now >= prev + 3) this.ev('flood', `Flooding expands in ${d.name}: ${now} cells`, d.centroid, now > 8 ? 'critical' : 'warn', d.id);
    }
    if (any) this.roadCostDirty = true;
  }

  private checkDam(slideIdx: number) {
    for (const nb of this.neighbors(slideIdx)) {
      if (this.riverIdx[nb] < 0 || this.dam[nb] || this.cells[nb].terrain === 'water') continue;
      if (this.rng() >= 0.7) return;
      // keep dams spaced: none within 3 river cells
      const r = Math.floor(this.riverIdx[nb] / 100000), k = this.riverIdx[nb] % 100000, order = this.riverOrder[r];
      for (let u = -3; u <= 3; u++) if (k + u >= 0 && k + u < order.length && this.dam[order[k + u]]) return;
      this.dam[nb] = 1; this.damBurst[nb] = this.tick + 4 + Math.floor(this.rng() * 3);
      const d = this.cells[nb].districtId;
      this.ev('dam', `Landslide dams the river${d ? ' near ' + this.distById.get(d)!.name : ''}; water backing up`, this.center(nb), 'critical', d);
      return;
    }
  }

  // ----- step -----
  step(): SimEventLite[] {
    this.pending = [];
    this.tick++;
    if (this.scenario.trigger.kind === 'quake' && (this.tick === 6 || this.tick === 14)) {
      this.quake((this.scenario.trigger.params.magnitude ?? 6.9) - 1.2, this.scenario.trigger.at, true);
    }
    if (this.tick > 2) for (let idx = 0; idx < this.n; idx++) this.shake[idx] *= 0.95;
    this.stepFire();
    this.stepWater();
    // evacuation progress
    for (const d of this.region.districts) {
      const rate = (this.evacRate.get(d.id) ?? 0) + (this.airliftOn.has(d.id) ? 400 : 0) + (this.boatsOn.has(d.id) ? 400 : 0);
      const hp = this.hazardPop(d);
      const peak = Math.max(this.threatPeak.get(d.id) ?? 0, hp);
      this.threatPeak.set(d.id, peak);
      if (rate > 0) {
        const cap = Math.min(Math.round(d.population * 0.4), Math.max(Math.round(peak * 1.1) + 200, this.atRiskPop(d)));
        this.evacuated.set(d.id, Math.min(cap, (this.evacuated.get(d.id) ?? 0) + rate));
      }
    }
    this.computeDistrictStates();
    for (const d of this.region.districts) {
      const s = this.dstates.get(d.id)!;
      this.strandedCum += s.stranded;
      this.strandedPeak.set(d.id, Math.max(this.strandedPeak.get(d.id) ?? 0, s.stranded));
      this.fireTicksCum += s.fires;
      if ((this.crews.get(d.id) ?? 0) === 0) this.uncoveredCum += s.fires;
    }
    return this.pending;
  }

  // ----- district states -----
  private hazardPop(d: District): number {
    let pop = 0;
    for (const idx of this.distCells.get(d.id)!) {
      const c = this.cells[idx];
      // only a fraction of a ~2km cell's population is directly in the hazard footprint
      if (this.fire[idx] > HAZ_FIRE) pop += c.pop * 0.25;
      else if (this.flood[idx] > HAZ_FLOOD) pop += c.pop * 0.4 * this.flood[idx];
      else if (this.landslide[idx]) pop += c.pop * 0.3;
      else if (c.terrain === 'softsoil' && this.shake[idx] > 0.6) pop += c.pop * 0.15; // liquefaction / collapses displace people
    }
    return Math.round(pop);
  }
  /** population that could plausibly be moved pre-emptively: river/wet cells in a rain event, hard-shaken cells after a quake */
  private atRiskPop(d: District): number {
    let pop = 0;
    const rain = this.scenario.trigger.kind === 'rain';
    for (const idx of this.distCells.get(d.id)!) {
      const c = this.cells[idx];
      if (rain && (this.riverIdx[idx] >= 0 || this.flood[idx] > 0.05 || this.water[idx] > 0.2)) pop += c.pop * 0.4;
      else if (this.shake[idx] > 0.5 || this.fire[idx] > 0) pop += c.pop * 0.2;
    }
    return Math.round(pop);
  }
  private computeDistrictStates() {
    this.refreshRoadCost();
    const next = new Map<string, DistrictState>();
    for (const d of this.region.districts) {
      const idxs = this.distCells.get(d.id)!;
      let sh = 0, fires = 0, flooded = 0, slides = 0;
      for (const idx of idxs) { sh += this.shake[idx]; if (this.fire[idx] > 0) fires++; if (this.flood[idx] > HAZ_FLOOD) flooded++; if (this.landslide[idx]) slides++; }
      const shaking = sh / Math.max(1, idxs.length);
      const affected = shaking > 0.2 || fires > 0 || flooded > 0 || slides > 0;
      let cutOff = false;
      if (affected) {
        const safe = this.nearestSafeInfraInternal(d.id);
        cutOff = safe === null && !this.airliftOn.has(d.id) && !this.boatsOn.has(d.id);
      }
      const hp = this.hazardPop(d);
      const evacuated = this.evacuated.get(d.id) ?? 0;
      // pre-staged shelters in liquefaction-prone (softsoil) districts: fewer people end up with nowhere to go
      const stranded = Math.round(Math.max(0, hp - evacuated) * (this.prepositioned.has(d.id) && d.terrain === 'softsoil' ? 0.7 : 1));
      const needs: string[] = [];
      if (fires > 0 && (this.crews.get(d.id) ?? 0) < Math.ceil(fires * 0.5)) needs.push('fire crew');
      if (cutOff) needs.push('airlift');
      if (stranded > 0) needs.push('shelter');
      if (flooded > 0 && cutOff) needs.push('boats');
      if (this.region.infra.some(inf => inf.kind === 'bridge' && inf.districtIds.includes(d.id) && this.infraState.get(inf.id)!.status !== 'open')) needs.push('bridge inspection');
      next.set(d.id, { id: d.id, shaking: +shaking.toFixed(3), fires, flooded, landslides: slides, cutOff, stranded, evacuated, needs });
    }
    this.dstates = next; this.dstateTick = this.tick;
  }
  districtState(id: string): DistrictState {
    const s = this.dstates.get(id);
    if (!s) throw new Error('unknown district ' + id);
    return s;
  }
  newlyAffectedDistricts(): string[] {
    const out: string[] = [];
    for (const d of this.region.districts) {
      const s = this.dstates.get(d.id)!;
      const affected = s.shaking > 0.3 || s.fires > 0 || s.flooded > 0 || s.landslides > 0 || s.cutOff;
      if (affected && !this.affectedSeen.has(d.id)) { this.affectedSeen.add(d.id); out.push(d.id); }
    }
    return out;
  }

  // ----- routing -----
  private refreshRoadCost() {
    if (!this.roadCostDirty) return;
    this.roadCostDirty = false;
    const rc = this.roadCost;
    for (let idx = 0; idx < this.n; idx++) rc[idx] = this.cells[idx].terrain === 'water' ? -1 : 1;
    // bridge corridors across water
    for (const inf of this.region.infra) {
      const st = this.infraState.get(inf.id)!;
      if (inf.kind === 'bridge' || inf.kind === 'river_crossing') {
        if (st.status === 'closed') continue;
        const extra = st.status === 'damaged' ? 30 : 2;
        const r = inf.spanKm ?? (inf.kind === 'bridge' ? 5.5 : 3);
        for (let idx = 0; idx < this.n; idx++) if (this.cells[idx].terrain === 'water' && distKm(this.cells[idx], inf.at) <= r) rc[idx] = rc[idx] < 0 ? extra : Math.min(rc[idx], extra);
      } else if (inf.kind === 'highway' && st.status === 'closed') {
        for (let idx = 0; idx < this.n; idx++) if (rc[idx] > 0 && distKm(this.cells[idx], inf.at) <= 2.5) rc[idx] += 8;
      }
    }
    for (let idx = 0; idx < this.n; idx++) if (rc[idx] > 0 && this.hazardAt(idx)) rc[idx] += 50;
  }
  private cellCost(idx: number, mode: RouteMode): number {
    if (mode === 'air') return 1;
    if (mode === 'boat') {
      const c = this.cells[idx];
      if (c.terrain === 'water' || this.flood[idx] > 0.2 || this.shoreline[idx]) return 1;
      return -1;
    }
    return this.roadCost[idx];
  }
  private astar(start: number, goal: number, mode: RouteMode, maxExp = 20000): number[] | null {
    this.refreshRoadCost();
    if (start === goal) return [start];
    const g = new Float64Array(this.n).fill(Infinity);
    const came = new Int32Array(this.n).fill(-1);
    const closed = new Uint8Array(this.n);
    const gi = goal % this.cols, gj = (goal - gi) / this.cols;
    const h = (idx: number) => { const i = idx % this.cols, j = (idx - i) / this.cols; const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    // simple binary heap
    const heap: number[] = []; const f = new Float64Array(this.n).fill(Infinity);
    const push = (x: number) => { heap.push(x); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l; if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    g[start] = 0; f[start] = h(start); push(start);
    let exp = 0;
    while (heap.length) {
      const cur = pop();
      if (closed[cur]) continue;
      if (cur === goal) break;
      closed[cur] = 1;
      if (++exp > maxExp) return null;
      const ci = cur % this.cols, cj = (cur - ci) / this.cols;
      for (const nb of this.neighbors(cur)) {
        if (closed[nb]) continue;
        const cc = nb === goal ? 1 : this.cellCost(nb, mode);
        if (cc < 0) continue;
        const ni = nb % this.cols;
        const diag = ni !== ci && ((nb - ni) / this.cols) !== cj;
        const ng = g[cur] + cc * (diag ? 1.414 : 1);
        if (ng < g[nb]) { g[nb] = ng; came[nb] = cur; f[nb] = ng + h(nb); push(nb); }
      }
    }
    if (g[goal] === Infinity) return null;
    const path: number[] = [];
    for (let c = goal; c !== -1; c = came[c]) path.push(c);
    path.reverse();
    return path;
  }
  private simplify(path: number[]): LngLat[] {
    const out: LngLat[] = [];
    for (let k = 0; k < path.length; k++) if (k % 2 === 0 || k === path.length - 1) out.push(this.center(path[k]));
    return out;
  }
  findRoute(from: LngLat, to: LngLat, mode: RouteMode): LngLat[] | null {
    const p = this.astar(this.idxOf(from), this.idxOf(to), mode);
    return p ? this.simplify(p) : null;
  }
  private safeInfraList(): Infra[] {
    return this.region.infra.filter(inf => (inf.kind === 'shelter' || inf.kind === 'hospital') && this.infraState.get(inf.id)!.status === 'open' && !this.hazardAt(this.infraCell.get(inf.id)!));
  }
  private nearestSafeInfraInternal(districtId: string): { id: string; path: LngLat[] } | null {
    const d = this.distById.get(districtId); if (!d) return null;
    const from = this.idxOf(d.centroid);
    const cands = this.safeInfraList().map(inf => ({ inf, dist: distKm(inf.at, d.centroid) })).sort((a, b) => a.dist - b.dist).slice(0, 4);
    for (const { inf } of cands) {
      const p = this.astar(from, this.infraCell.get(inf.id)!, 'road', 6000);
      if (p) {
        // a route is only "safe" if its total cost is not dominated by hazard penalties
        let haz = 0; for (const idx of p) if (this.hazardAt(idx)) haz++;
        if (haz <= 1) return { id: inf.id, path: this.simplify(p) };
      }
    }
    return null;
  }
  nearestSafeInfra(districtId: string) { return this.nearestSafeInfraInternal(districtId); }

  // ----- plans -----
  private pathHitsHazard(path: LngLat[]): number {
    let n = 0;
    for (const p of path) if (this.hazardAt(this.idxOf(p))) n++;
    return n;
  }
  checkPlan(plan: DistrictPlan): VerifierVerdict {
    const checks: VerifierVerdict['checks'] = [];
    const d = this.distById.get(plan.districtId);
    if (!d) return { accepted: false, reasons: [`unknown district ${plan.districtId}`], districtId: plan.districtId, checks: [{ name: 'district', pass: false, detail: 'unknown district' }] };
    const st = this.dstates.get(d.id)!;
    // (a) routes
    for (const r of plan.routes ?? []) {
      const rec = this.findRoute(r.from, r.to, r.mode);
      if (!rec) checks.push({ name: `route:${r.id}`, pass: false, detail: `${r.mode} route "${r.label}" is unreachable (recomputed by sim)` });
      else {
        const haz = r.path?.length ? this.pathHitsHazard(r.path) : 0;
        if (haz > 1) checks.push({ name: `route:${r.id}`, pass: false, detail: `route "${r.label}" crosses ${haz} hazard cells (fire/flood/landslide)` });
        else checks.push({ name: `route:${r.id}`, pass: true, detail: `${r.mode} route ok (${rec.length} waypoints, capacity ${r.capacity})` });
      }
    }
    // (b) crews
    if (st.fires > 0) {
      const have = this.crews.get(d.id) ?? 0;
      const required = Math.max(0, Math.min(Math.ceil(st.fires * 0.5), this.resources.fireCrews + have) - have);
      const pass = (plan.fireCrews ?? 0) >= required;
      checks.push({ name: 'fireCrews', pass, detail: pass ? `${plan.fireCrews} crews for ${st.fires} burning cells (need ${required}, ${this.resources.fireCrews} available)` : `${st.fires} burning cells need >= ${required} more crews, plan has ${plan.fireCrews ?? 0} (${this.resources.fireCrews} available)` });
    }
    // (c) cut off
    if (st.cutOff) {
      const pass = !!plan.airlift || (plan.routes ?? []).some(r => r.mode === 'air' || r.mode === 'boat');
      checks.push({ name: 'cutOff', pass, detail: pass ? 'cut-off district has airlift/boat plan' : 'district is cut off by road but plan has no airlift or boat route' });
    }
    // (d) shelters
    for (const sid of plan.shelters ?? []) {
      const inf = this.infraById(sid);
      if (!inf || (inf.kind !== 'shelter' && inf.kind !== 'hospital')) { checks.push({ name: `shelter:${sid}`, pass: false, detail: `shelter "${sid}" does not exist` }); continue; }
      const s = this.infraState.get(sid)!;
      if (s.status !== 'open') { checks.push({ name: `shelter:${sid}`, pass: false, detail: `${inf.name} is ${s.status}` }); continue; }
      if (this.hazardAt(this.infraCell.get(sid)!)) { checks.push({ name: `shelter:${sid}`, pass: false, detail: `${inf.name} is inside a burning/flooded cell` }); continue; }
      checks.push({ name: `shelter:${sid}`, pass: true, detail: `${inf.name} open` });
    }
    // (e) stranded after plan
    const hp = this.hazardPop(d);
    const remaining = Math.max(1, this.scenario.ticks - this.tick);
    const projected = (this.evacuated.get(d.id) ?? 0) + (plan.routes ?? []).filter(r => r.mode === 'road').reduce((a, r) => a + (r.capacity ?? 0), 0)
      + ((plan.airlift || (plan.routes ?? []).some(r => r.mode === 'air')) ? 400 * remaining : 0) + ((plan.routes ?? []).some(r => r.mode === 'boat') ? 400 * remaining : 0);
    const strandedAfter = Math.max(0, hp - projected);
    const passE = strandedAfter < 0.15 * d.population;
    checks.push({ name: 'stranded', pass: passE, detail: `${strandedAfter} people would remain stranded of ${d.population} (${(100 * strandedAfter / d.population).toFixed(1)}%, limit 15%)` });
    const reasons = checks.filter(c => !c.pass).map(c => c.detail);
    return { accepted: reasons.length === 0, reasons, districtId: d.id, checks };
  }
  applyPlan(plan: DistrictPlan): void {
    const d = this.distById.get(plan.districtId); if (!d) return;
    const want = Math.max(0, Math.floor(plan.fireCrews ?? 0));
    const give = Math.min(want, this.resources.fireCrews);
    this.resources.fireCrews -= give;
    this.crews.set(d.id, (this.crews.get(d.id) ?? 0) + give);
    for (const r of plan.routes ?? []) {
      if (r.mode === 'boat') { if (this.resources.boats > 0 && !this.boatsOn.has(d.id)) { this.resources.boats--; this.boatsOn.add(d.id); } }
      else if (r.mode === 'air') { if (this.resources.helicopters > 0 && !this.airliftOn.has(d.id)) { this.resources.helicopters--; this.airliftOn.add(d.id); } }
      else this.evacRate.set(d.id, (this.evacRate.get(d.id) ?? 0) + Math.max(0, r.capacity ?? 0) * 0.2);
    }
    if (plan.airlift && !this.airliftOn.has(d.id) && this.resources.helicopters > 0) { this.resources.helicopters--; this.airliftOn.add(d.id); }
    if ((plan.shelters ?? []).some(id => { const inf = this.infraById(id); return inf && (inf.kind === 'shelter' || inf.kind === 'hospital') && this.infraState.get(id)!.status === 'open'; })) this.prepositioned.add(d.id);
    this.plans.get(d.id)!.push({ plan, tick: this.tick });
    this.computeDistrictStates();
  }
  /** internal: crews currently assigned to a district (used by autoRespond) */
  crewsIn(districtId: string) { return this.crews.get(districtId) ?? 0; }
  plansFor(districtId: string) { return this.plans.get(districtId) ?? []; }
  hasAirlift(districtId: string) { return this.airliftOn.has(districtId); }
  hasBoats(districtId: string) { return this.boatsOn.has(districtId); }
  maxWaterIn(districtId: string) { let m = 0; for (const idx of this.distCells.get(districtId) ?? []) m = Math.max(m, this.flood[idx]); return m; }
  inRainZone(districtId: string) { return (this.distCells.get(districtId) ?? []).some(idx => this.rainCells[idx]); }

  // ----- score / snapshot / describe -----
  score(): Score {
    let stranded = 0, firesUncovered = 0, cutOffDistricts = 0, evacuated = 0;
    for (const d of this.region.districts) {
      const s = this.dstates.get(d.id)!;
      stranded += s.stranded; evacuated += s.evacuated;
      if (s.cutOff) cutOffDistricts++;
      if ((this.crews.get(d.id) ?? 0) === 0) firesUncovered += s.fires;
    }
    // harm is cumulative: average stranded over elapsed ticks, and fire-cell-ticks left uncovered (/6 ~= cells burned without crews)
    if (this.tick > 0) { stranded = Math.round(Math.max(stranded, this.strandedCum / this.tick)); firesUncovered = Math.max(firesUncovered, Math.round(this.uncoveredCum / 6)); }
    // population-relative, concave stranded term so both a Bay Area quake (hundreds stranded of 4M) and a Nepal flood (tens of
    // thousands of 5M) register: 0.01% of region stranded ~= -40, 0.1% ~= -126, 1% ~= -400, capped at 650
    const totalPop = Math.max(1, this.region.districts.reduce((a, d) => a + d.population, 0));
    const strandedTerm = Math.min(650, 4500 * Math.sqrt(stranded / totalPop));
    // evacuation credit is a RATIO (moved / (moved + peak stranded)) so a bigger disaster cannot earn more credit
    let peakSum = 0; for (const d of this.region.districts) peakSum += this.strandedPeak.get(d.id) ?? 0;
    const evacCredit = evacuated > 0 ? 150 * Math.min(1, evacuated / Math.max(1, evacuated + peakSum)) : 0;
    // burned-out cells (never suppressed) are property damage crews could have prevented
    const burnTerm = Math.min(50, this.burnedCells * 2) + Math.min(100, this.fireTicksCum * 0.5);
    const total = Math.max(0, Math.round(1000 - strandedTerm - Math.min(300, firesUncovered * 8) - burnTerm - Math.min(200, cutOffDistricts * 40) + evacCredit));
    return { stranded: Math.round(stranded), firesUncovered: Math.round(firesUncovered), cutOffDistricts, evacuated: Math.round(evacuated), total };
  }
  snapshot(): SimSnapshot {
    const hazards: HazardCell[] = [];
    for (let idx = 0; idx < this.n; idx++) {
      const c = this.cells[idx];
      if (this.shake[idx] > 0.05) hazards.push({ i: c.i, j: c.j, kind: 'quake', intensity: +this.shake[idx].toFixed(2) });
      if (this.fire[idx] > 0.05) hazards.push({ i: c.i, j: c.j, kind: 'fire', intensity: +this.fire[idx].toFixed(2) });
      else if (this.burnedOut[idx]) hazards.push({ i: c.i, j: c.j, kind: 'burn', intensity: 0.8 });
      if (this.flood[idx] > 0.05) hazards.push({ i: c.i, j: c.j, kind: 'flood', intensity: +this.flood[idx].toFixed(2) });
      if (this.landslide[idx]) hazards.push({ i: c.i, j: c.j, kind: 'landslide', intensity: 0.8 });
      if (this.dam[idx]) hazards.push({ i: c.i, j: c.j, kind: 'dam', intensity: 1 });
    }
    return { tick: this.tick, hazards, infra: [...this.infraState.values()].map(s => ({ ...s })), districts: this.region.districts.map(d => ({ ...this.dstates.get(d.id)! })), score: this.score() };
  }
  describe(districtId?: string): string {
    const t = this.scenario.trigger;
    const res = `resources: ${this.resources.fireCrews} fire crews, ${this.resources.helicopters} helicopters, ${this.resources.boats} boats`;
    const infraLine = (inf: Infra) => { const s = this.infraState.get(inf.id)!; return `${inf.name} [${inf.kind}] ${s.status}${s.note ? ' (' + s.note + ')' : ''}`; };
    if (districtId) {
      const d = this.distById.get(districtId); if (!d) return `unknown district ${districtId}`;
      const s = this.dstates.get(d.id)!;
      const lines: string[] = [];
      lines.push(`${d.name} (${d.id}) — ${d.terrain}, pop ${d.population.toLocaleString()}, tick ${this.tick}/${this.scenario.ticks}`);
      lines.push(`shaking ${s.shaking.toFixed(2)} | fires ${s.fires} cells | flooded ${s.flooded} | landslides ${s.landslides} | cutOff ${s.cutOff ? 'YES' : 'no'}`);
      lines.push(`stranded ${s.stranded} | evacuated ${s.evacuated} | crews assigned ${this.crews.get(d.id)} | airlift ${this.airliftOn.has(d.id) ? 'on' : 'off'} | boats ${this.boatsOn.has(d.id) ? 'on' : 'off'}`);
      lines.push(`needs: ${s.needs.length ? s.needs.join(', ') : 'none'}`);
      const near = this.region.infra.map(inf => ({ inf, dist: distKm(inf.at, d.centroid) })).filter(x => x.dist <= 15 || x.inf.districtIds.includes(d.id)).sort((a, b) => a.dist - b.dist).slice(0, 7);
      lines.push('nearby infra: ' + near.map(x => `${infraLine(x.inf)} ${x.dist.toFixed(0)}km`).join('; '));
      const safe = this.nearestSafeInfraInternal(d.id);
      lines.push(safe ? `nearest safe infra by road: ${this.infraById(safe.id)!.name} (${safe.path.length} waypoints)` : 'NO safe shelter/hospital reachable by road');
      const plans = this.plans.get(d.id)!;
      if (plans.length) lines.push(`applied plans: ${plans.map(p => `t${p.tick}: ${p.plan.summary?.slice(0, 60) ?? ''}`).join(' | ')}`);
      lines.push(res);
      lines.push(`centroid lng ${d.centroid.lng.toFixed(3)} lat ${d.centroid.lat.toFixed(3)}`);
      return lines.slice(0, 15).join('\n');
    }
    const lines: string[] = [];
    lines.push(`${this.region.name} — tick ${this.tick}/${this.scenario.ticks} — trigger ${t.kind} ${Object.entries(t.params).map(([k, v]) => `${k}=${v}`).join(' ')} at ${t.at.lng.toFixed(2)},${t.at.lat.toFixed(2)}`);
    lines.push(res);
    const sc = this.score();
    lines.push(`score ${sc.total} (stranded ${sc.stranded}, firesUncovered ${sc.firesUncovered}, cutOff ${sc.cutOffDistricts}, evacuated ${sc.evacuated})`);
    const bad = this.region.infra.filter(inf => this.infraState.get(inf.id)!.status !== 'open');
    lines.push('infra not open: ' + (bad.length ? bad.map(infraLine).join('; ') : 'none'));
    lines.push('districts (shaking/fires/flooded/slides/cutOff/stranded/evac/crews):');
    for (const d of this.region.districts) {
      const s = this.dstates.get(d.id)!;
      lines.push(`- ${d.id} ${d.name} pop ${Math.round(d.population / 1000)}k: ${s.shaking.toFixed(2)}/${s.fires}/${s.flooded}/${s.landslides}/${s.cutOff ? 'CUTOFF' : 'ok'}/${s.stranded}/${s.evacuated}/${this.crews.get(d.id)}${s.needs.length ? ' needs ' + s.needs.join(',') : ''}`);
    }
    const shelters = this.region.infra.filter(inf => inf.kind === 'shelter' || inf.kind === 'hospital');
    lines.push('shelters/hospitals: ' + shelters.map(inf => `${inf.id}(${this.infraState.get(inf.id)!.status})`).join(' '));
    return lines.slice(0, 60).join('\n');
  }
}

// ---------- module API ----------
export function createSim(region: RegionConfig, scenario: Scenario): SimApi { return new Sim(region, scenario); }

export function makeScenario(region: RegionConfig, trigger: Scenario['trigger'], seed?: number): Scenario {
  const s = seed ?? (Date.now() % 100000);
  return { id: `${region.id}-${trigger.kind}-${s}-${Math.floor(Math.random() * 1e6).toString(36)}`, regionId: region.id, seed: s, trigger, ticks: Math.max(12, Number(process.env.SCENARIO_TICKS ?? 36)) };
}

export function autoRespond(simApi: SimApi, params: PlaybookParams): void {
  const sim = simApi as Sim;
  const region = sim.region;
  const isRain = sim.scenario.trigger.kind === 'rain';
  for (const d of region.districts) {
    const s = sim.districtState(d.id);
    const plans = sim.plansFor(d.id);
    const hasRoadRoute = plans.some(p => p.plan.routes.some(r => r.mode === 'road'));
    const floodThreat = isRain && (sim.maxWaterIn(d.id) > 0.2 || (sim.inRainZone(d.id) && sim.tick < params.floodEvacLeadTicks));
    const affected = s.shaking > 0.2 || s.fires > 0 || s.flooded > 0 || s.landslides > 0 || s.cutOff || floodThreat;
    if (!affected) continue;
    const routes: DistrictPlan['routes'] = [];
    let fireCrews = 0;
    let airlift = false;
    const shelters: string[] = [];
    if (s.fires > 0) {
      const target = Math.ceil(s.fires * params.crewPerFireCell);
      const allowed = Math.floor(sim.resources.fireCrews * (1 - params.reserveCrewFraction));
      fireCrews = Math.max(0, Math.min(target - sim.crewsIn(d.id), Math.max(allowed, s.fires > 3 ? 1 : 0)));
    }
    // the playbook's evacuation rule: shaking threshold (quake), any flooding / flood lead-time (rain), or severe stranding (>5% of pop)
    const shouldEvac = s.shaking > params.evacuateShakingThreshold || s.flooded > 0 || floodThreat || s.stranded > 0.05 * d.population;
    if (shouldEvac && !hasRoadRoute) {
      const safe = sim.nearestSafeInfra(d.id);
      if (safe) routes.push({ id: `auto-${d.id}-road`, districtId: d.id, mode: 'road', from: d.centroid, to: region.infra.find(i => i.id === safe.id)!.at, path: safe.path, capacity: 3000, label: `evacuate to ${safe.id}` });
    }
    if (s.cutOff && params.airliftWhenCutOff && !sim.hasAirlift(d.id) && sim.resources.helicopters > 0) airlift = true;
    if (s.cutOff && s.flooded > 0 && !sim.hasBoats(d.id) && sim.resources.boats > 0) {
      const shelter = region.infra.find(i => i.kind === 'shelter');
      if (shelter) routes.push({ id: `auto-${d.id}-boat`, districtId: d.id, mode: 'boat', from: d.centroid, to: shelter.at, path: [], capacity: 400, label: 'boat evacuation' });
    }
    if (params.prepositionSheltersSoftSoil && d.terrain === 'softsoil' && !sim.plansFor(d.id).some(p => p.plan.shelters.length)) {
      for (const inf of region.infra) if (inf.kind === 'shelter' && inf.districtIds.includes(d.id)) shelters.push(inf.id);
      if (!shelters.length) {
        const near = region.infra.filter(i => i.kind === 'shelter').map(i => ({ i, dist: distKm(i.at, d.centroid) })).sort((a, b) => a.dist - b.dist)[0];
        if (near && near.dist <= 20) shelters.push(near.i.id);
      }
    }
    if (!routes.length && !fireCrews && !airlift && !shelters.length) continue;
    sim.applyPlan({ districtId: d.id, summary: `auto: ${fireCrews} crews, ${routes.length} routes${airlift ? ', airlift' : ''}`, routes, fireCrews, shelters, airlift, helpersRequested: [] });
  }
}

export async function evaluateHeldOut(region: RegionConfig, params: PlaybookParams, seeds: number[], trigger: Scenario['trigger']): Promise<{ mean: number; perSeed: { seed: number; score: Score }[] }> {
  const perSeed: { seed: number; score: Score }[] = [];
  for (const seed of seeds) {
    const sc = makeScenario(region, trigger, seed);
    const sim = createSim(region, sc);
    for (let t = 0; t < sc.ticks; t++) { autoRespond(sim, params); sim.step(); }
    autoRespond(sim, params);
    perSeed.push({ seed, score: sim.score() });
  }
  const mean = perSeed.length ? perSeed.reduce((a, p) => a + p.score.total, 0) / perSeed.length : 0;
  return { mean: Math.round(mean * 10) / 10, perSeed };
}

export const simModule: SimModule = { createSim, autoRespond, evaluateHeldOut, makeScenario };
export default simModule;
