// World frame + terrain sampling for the procedural scene.
// Scene units: x = east, z = south (so +z is towards the viewer from the south-west camera), y = up.
import * as THREE from 'three';
import type { Cell, LngLat, RegionConfig } from '../../../shared/types.ts';

export const SCENE_W = 100; // bbox width in scene units

/** Small deterministic value noise (2 octaves + 1 detail) in arbitrary units. */
function hash(ix: number, iy: number) { let h = ix * 374761393 + iy * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y); const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
export function fbm(x: number, y: number, oct = 4) { let v = 0, amp = 0.5, f = 1, norm = 0; for (let o = 0; o < oct; o++) { v += amp * vnoise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.1; } return v / norm; }
export function seeded(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export type TerrainKind = Cell['terrain'];

export class World {
  readonly W = SCENE_W; readonly D: number;
  readonly cols: number; readonly rows: number;
  readonly bbox: [number, number, number, number];
  readonly cosLat: number;
  readonly elev: Float32Array;      // per cell, meters
  readonly kind: TerrainKind[];     // per cell
  readonly maxElev: number;
  readonly yScale: number;          // scene units per meter
  // heightmap built by the terrain mesh
  segX = 0; segZ = 0; heights: Float32Array = new Float32Array(0);

  constructor(public region: RegionConfig, public cells: Cell[], exaggeration = 1) {
    const [w, s, e, n] = region.bbox; this.bbox = region.bbox;
    this.cols = region.grid.cols; this.rows = region.grid.rows;
    this.cosLat = Math.cos(((s + n) / 2) * Math.PI / 180);
    this.D = ((n - s) / (e - w)) / this.cosLat * SCENE_W; // true N-S/E-W aspect (1° lng = cos(lat) × 1° lat)
    this.elev = new Float32Array(this.cols * this.rows); this.kind = new Array(this.cols * this.rows).fill('hills');
    let mx = 1;
    for (const c of cells) { const k = c.j * this.cols + c.i; if (k < 0 || k >= this.elev.length) continue; this.elev[k] = c.terrain === 'water' ? 0 : c.elev; this.kind[k] = c.terrain; if (c.elev > mx) mx = c.elev; }
    this.maxElev = mx;
    this.yScale = (0.11 * SCENE_W * exaggeration) / mx;
    // smooth the coarse sim grid (2 passes of a 3x3 kernel) so slopes read as hillsides, not mesas
    const tmp = new Float32Array(this.elev.length);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? this.elev : tmp, dst = pass === 0 ? tmp : this.elev;
      for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
        let acc = 0, wt = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= this.cols || jj >= this.rows) continue; const k = di === 0 && dj === 0 ? 3 : (di === 0 || dj === 0 ? 1.2 : 0.7); acc += src[jj * this.cols + ii] * k; wt += k; }
        dst[j * this.cols + i] = acc / wt;
      }
    }
  }
  // ---- coordinate conversions ----
  toScene(p: LngLat): [number, number] { const [w, s, e, n] = this.bbox; return [((p.lng - w) / (e - w) - 0.5) * this.W, (0.5 - (p.lat - s) / (n - s)) * this.D]; }
  toLngLat(x: number, z: number): LngLat { const [w, s, e, n] = this.bbox; return { lng: w + (x / this.W + 0.5) * (e - w), lat: s + (0.5 - z / this.D) * (n - s) }; }
  cellCenter(i: number, j: number): [number, number] { return [((i + 0.5) / this.cols - 0.5) * this.W, (0.5 - (j + 0.5) / this.rows) * this.D]; }
  cellOf(x: number, z: number): [number, number] { return [Math.max(0, Math.min(this.cols - 1, Math.floor((x / this.W + 0.5) * this.cols))), Math.max(0, Math.min(this.rows - 1, Math.floor((0.5 - z / this.D) * this.rows)))]; }
  get cellW() { return this.W / this.cols; }
  get cellD() { return this.D / this.rows; }
  // ---- grid samplers (fractional cell coords) ----
  private frac(x: number, z: number): [number, number] { return [(x / this.W + 0.5) * this.cols - 0.5, (0.5 - z / this.D) * this.rows - 0.5]; }
  /** bilinear elevation (meters) */
  elevAt(x: number, z: number): number {
    const [fi, fj] = this.frac(x, z);
    const i0 = Math.max(0, Math.min(this.cols - 1, Math.floor(fi))), j0 = Math.max(0, Math.min(this.rows - 1, Math.floor(fj)));
    const i1 = Math.min(this.cols - 1, i0 + 1), j1 = Math.min(this.rows - 1, j0 + 1);
    const tx = Math.max(0, Math.min(1, fi - i0)), tz = Math.max(0, Math.min(1, fj - j0));
    const e = this.elev;
    const a = e[j0 * this.cols + i0], b = e[j0 * this.cols + i1], c = e[j1 * this.cols + i0], d = e[j1 * this.cols + i1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  /** terrain kind weights of the 4 surrounding cells: [{kind, w}] */
  kindsAt(x: number, z: number): { k: TerrainKind; w: number }[] {
    const [fi, fj] = this.frac(x, z);
    const i0 = Math.max(0, Math.min(this.cols - 1, Math.floor(fi))), j0 = Math.max(0, Math.min(this.rows - 1, Math.floor(fj)));
    const i1 = Math.min(this.cols - 1, i0 + 1), j1 = Math.min(this.rows - 1, j0 + 1);
    const tx = Math.max(0, Math.min(1, fi - i0)), tz = Math.max(0, Math.min(1, fj - j0));
    return [
      { k: this.kind[j0 * this.cols + i0], w: (1 - tx) * (1 - tz) }, { k: this.kind[j0 * this.cols + i1], w: tx * (1 - tz) },
      { k: this.kind[j1 * this.cols + i0], w: (1 - tx) * tz }, { k: this.kind[j1 * this.cols + i1], w: tx * tz },
    ];
  }
  kindAt(x: number, z: number): TerrainKind { const [i, j] = this.cellOf(x, z); return this.kind[j * this.cols + i]; }
  /** scene-space terrain height (uses the built heightmap so decorations sit exactly on the mesh) */
  heightAt(x: number, z: number): number {
    if (!this.heights.length) return this.elevAt(x, z) * this.yScale;
    const fx = (x / this.W + 0.5) * this.segX, fz = (z / this.D + 0.5) * this.segZ;
    const x0 = Math.max(0, Math.min(this.segX - 1, Math.floor(fx))), z0 = Math.max(0, Math.min(this.segZ - 1, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - x0)), tz = Math.max(0, Math.min(1, fz - z0));
    const n = this.segX + 1, h = this.heights;
    const a = h[z0 * n + x0], b = h[z0 * n + x0 + 1], c = h[(z0 + 1) * n + x0], d = h[(z0 + 1) * n + x0 + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  /** downhill direction (unit XZ) at a point */
  downhill(x: number, z: number): [number, number] {
    const e = 0.6; const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z), dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const l = Math.hypot(dx, dz) || 1; return [-dx / l, -dz / l];
  }
}

// ---- palette ----
const C = (hex: string) => new THREE.Color(hex);
export const PAL = {
  bg: '#efe9df', valleyLo: C('#d9c9a8'), valleyHi: C('#c7b48c'), hills: C('#a3917a'), rock: C('#d8d2c6'), snow: C('#f4f1ea'),
  urban: C('#b5b2ac'), coast: C('#e3d7bd'), water: C('#3f80cf'), burn: C('#3a2b25'), quake: C('#b9a3e6'),
  tree1: '#2f4a2a', tree2: '#3f5f33', river: '#3f7fd6', sea: '#4f8fd8', road: '#4a4039', street: '#6f665e', roadLine: '#efe0b0', seaFar: '#8fb0d4', landFar: '#d8cfc0', fault: '#b91c1c', flood: '#2f6fd1', slide: '#6b4a2b', fire: '#ff6a1a', spread: '#f5c542', arrow: '#f26a1b',
};
const tmp = new THREE.Color();
export function baseColor(kind: TerrainKind, elevNorm: number, out: THREE.Color): THREE.Color {
  switch (kind) {
    case 'hills': { const t = Math.pow(Math.max(0, Math.min(1, elevNorm)), 2.2) * 0.85; out.copy(PAL.hills).lerp(PAL.rock, t); if (elevNorm > 0.88) out.lerp(PAL.snow, (elevNorm - 0.88) / 0.12 * 0.6); return out; }
    case 'valley': case 'softsoil': return out.copy(PAL.valleyLo).lerp(PAL.valleyHi, Math.max(0, Math.min(1, elevNorm * 1.5)));
    case 'urban': return out.copy(PAL.urban);
    case 'coast': return out.copy(PAL.coast);
    case 'water': return out.copy(PAL.water);
    default: return out.copy(PAL.hills);
  }
}
/** blended colour at a scene point */
export function colorAt(world: World, x: number, z: number, elevNorm: number, out: THREE.Color): THREE.Color {
  out.setRGB(0, 0, 0);
  for (const { k, w } of world.kindsAt(x, z)) { if (w <= 0) continue; baseColor(k, elevNorm, tmp); out.r += tmp.r * w; out.g += tmp.g * w; out.b += tmp.b * w; }
  return out;
}
