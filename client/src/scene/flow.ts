// Water motion: scrolling river textures, tweened flood surface with downstream phase + ripples, flow particles, bridge obstacles.
import * as THREE from 'three';
import type { HazardCell, Infra, InfraState, LngLat } from '../../../shared/types.ts';
import { World, PAL } from './world';
import { disposeObject, label, type Terrain } from './build';

// ---------- textures ----------
export function streakTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 32);
  for (let i = 0; i < 60; i++) { const x = Math.random() * 256, y = Math.random() * 32, len = 14 + Math.random() * 40; const a = 0.08 + Math.random() * 0.22; const grad = g.createLinearGradient(x, y, x + len, y); grad.addColorStop(0, `rgba(230,240,255,0)`); grad.addColorStop(0.5, `rgba(240,248,255,${a})`); grad.addColorStop(1, `rgba(230,240,255,0)`); g.fillStyle = grad; g.fillRect(x, y, len, 1.2 + Math.random() * 1.5); }
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(60,110,190,${0.08 + Math.random() * 0.12})`; g.fillRect(Math.random() * 256, Math.random() * 32, 10 + Math.random() * 30, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16); grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(220,236,255,0.9)'); grad.addColorStop(1, 'rgba(180,210,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- river samples (for particle steering + pulses) ----------
export interface RiverSample { x: number; z: number; tx: number; tz: number; u: number; mesh: THREE.Mesh }
export class RiverFlow {
  samples: RiverSample[] = []; cellTan: (RiverSample | undefined)[]; private speeds: number[] = []; private offsets: number[] = []; tex: THREE.Texture;
  constructor(private world: World, public group: THREE.Group) {
    this.tex = streakTexture(); this.cellTan = new Array(world.cols * world.rows).fill(undefined);
    const t = new THREE.Vector3();
    group.children.forEach((m: any, k) => {
      const mesh = m as THREE.Mesh; const curve: THREE.CatmullRomCurve3 = mesh.userData.curve; const len: number = mesh.userData.length ?? 50;
      const tex = this.tex.clone(); tex.needsUpdate = true; tex.repeat.set(len / 6, 1);
      mesh.material = new THREE.MeshStandardMaterial({ color: PAL.river, map: tex, emissive: PAL.river, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
      this.speeds[k] = 0.25; this.offsets[k] = 0;
      const N = Math.max(8, Math.round(len)); // ~1 unit spacing
      for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N); curve.getTangent(i / N, t); const s: RiverSample = { x: p.x, z: p.z, tx: t.x, tz: t.z, u: i / N, mesh }; this.samples.push(s); const [ci, cj] = world.cellOf(p.x, p.z); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= world.cols || jj >= world.rows) continue; const idx = jj * world.cols + ii; if (!this.cellTan[idx] || (di === 0 && dj === 0)) this.cellTan[idx] = s; } }
    });
  }
  /** speed ∝ flood intensity near each river (base > 0 so rivers always run) */
  setFlood(grid: Float32Array) {
    this.group.children.forEach((m: any, k) => {
      let acc = 0, n = 0; for (const s of this.samples) if (s.mesh === m) { const [i, j] = this.world.cellOf(s.x, s.z); acc += grid[j * this.world.cols + i]; n++; }
      this.speeds[k] = 0.25 + 2.2 * (n ? acc / n : 0);
    });
  }
  boost = 1;
  tick(dt: number) {
    this.group.children.forEach((m: any, k) => { this.offsets[k] -= dt * this.speeds[k] * this.boost * 0.35; const mat = m.material as THREE.MeshStandardMaterial; if (mat.map) mat.map.offset.x = this.offsets[k]; mat.emissiveIntensity = 0.22 + Math.min(0.5, this.speeds[k] * 0.12); });
  }
  nearest(x: number, z: number): RiverSample | undefined { const [i, j] = this.world.cellOf(x, z); return this.cellTan[j * this.world.cols + i]; }
  dispose() { this.tex.dispose(); this.group.children.forEach((m: any) => { (m.material.map as THREE.Texture)?.dispose(); }); }
}

// ---------- flood surface: tweened between snapshots with a downstream phase delay ----------
export class FloodAnim {
  mesh: THREE.Mesh; rim: THREE.Mesh; prev: Float32Array; cur: Float32Array; private tmp: Float32Array; phase: Float32Array;
  private pos: THREE.BufferAttribute; private rimPos: THREE.BufferAttribute; private idx: Int32Array; private wts: Float32Array; private dir: Float32Array;
  private t0 = 0; tickMs = 700; private lastSnapAt = 0; private trigger?: [number, number]; private any = false;
  constructor(private world: World, terrain: Terrain) {
    const geo = terrain.mesh.geometry.clone(); geo.deleteAttribute('color'); this.pos = geo.attributes.position as THREE.BufferAttribute;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PAL.flood, emissive: '#1d4ed8', emissiveIntensity: 0.25, transparent: true, opacity: 0.75, roughness: 0.25, metalness: 0.1, depthWrite: false })); this.mesh.renderOrder = 2; this.mesh.name = 'flood';
    const rg = geo.clone(); this.rimPos = rg.attributes.position as THREE.BufferAttribute;
    this.rim = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: '#8ec5ff', emissive: '#60a5fa', emissiveIntensity: 0.5, transparent: true, opacity: 0.38, roughness: 0.3, depthWrite: false })); this.rim.renderOrder = 1; this.rim.name = 'flood-rim';
    const n = world.cols * world.rows; this.prev = new Float32Array(n); this.cur = new Float32Array(n); this.tmp = new Float32Array(n); this.phase = new Float32Array(n);
    // per-vertex bilinear cell indices/weights + downhill direction (precomputed once)
    const V = this.pos.count; this.idx = new Int32Array(V * 4); this.wts = new Float32Array(V * 4); this.dir = new Float32Array(V * 2);
    const { cols, rows, W, D } = world;
    for (let k = 0; k < V; k++) {
      const x = this.pos.getX(k), z = this.pos.getZ(k);
      const fi = (x / W + 0.5) * cols - 0.5, fj = (0.5 - z / D) * rows - 0.5;
      const i0 = Math.max(0, Math.min(cols - 1, Math.floor(fi))), j0 = Math.max(0, Math.min(rows - 1, Math.floor(fj))); const i1 = Math.min(cols - 1, i0 + 1), j1 = Math.min(rows - 1, j0 + 1);
      const tx = Math.max(0, Math.min(1, fi - i0)), tz = Math.max(0, Math.min(1, fj - j0));
      this.idx.set([j0 * cols + i0, j0 * cols + i1, j1 * cols + i0, j1 * cols + i1], k * 4); this.wts.set([(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz], k * 4);
      const [dx, dz] = world.downhill(x, z); this.dir.set([dx, dz], k * 2);
    }
    this.mesh.visible = this.rim.visible = false;
  }
  setTrigger(at?: LngLat) {
    if (!at) return; const [tx, tz] = this.world.toScene(at); this.trigger = [tx, tz];
    let mx = 1; const d = new Float32Array(this.phase.length);
    for (let j = 0; j < this.world.rows; j++) for (let i = 0; i < this.world.cols; i++) { const [x, z] = this.world.cellCenter(i, j); const dd = Math.hypot(x - tx, z - tz); d[j * this.world.cols + i] = dd; if (dd > mx) mx = dd; }
    for (let k = 0; k < d.length; k++) this.phase[k] = 0.6 * Math.pow(d[k] / mx, 0.7);
  }
  private blur(src: Float32Array, dst: Float32Array) {
    const { cols, rows } = this.world;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { let s = 0, w = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue; const wt = di === 0 && dj === 0 ? 2 : (di === 0 || dj === 0 ? 1 : 0.6); s += src[jj * cols + ii] * wt; w += wt; } dst[j * cols + i] = s / w; }
  }
  setSnapshot(hazards: HazardCell[], now: number) {
    // current interpolated state becomes the new "prev" so there is never a snap
    const f = this.frac(now); for (let k = 0; k < this.cur.length; k++) this.prev[k] = this.prev[k] + (this.cur[k] - this.prev[k]) * this.cellT(k, f);
    this.tmp.fill(0); let any = false; const cols = this.world.cols;
    for (const h of hazards) if (h.kind === 'flood') { this.tmp[h.j * cols + h.i] = Math.max(this.tmp[h.j * cols + h.i], h.intensity); any = true; }
    this.blur(this.tmp, this.cur); this.blur(this.cur, this.tmp); this.cur.set(this.tmp);
    if (this.lastSnapAt) this.tickMs = Math.max(300, Math.min(3000, now - this.lastSnapAt)); this.lastSnapAt = now; this.t0 = now;
    this.any = any || this.prev.some((v) => v > 0.02); this.mesh.visible = this.rim.visible = this.any;
  }
  private frac(now: number) { return Math.max(0, Math.min(1, (now - this.t0) / this.tickMs)); }
  private cellT(k: number, f: number) { return Math.max(0, Math.min(1, (f - this.phase[k]) / 0.4)); }
  /** current (tweened) flood intensity at a scene point */
  depthAt(x: number, z: number, now: number): number {
    const [i, j] = this.world.cellOf(x, z); const k = j * this.world.cols + i; return this.prev[k] + (this.cur[k] - this.prev[k]) * this.cellT(k, this.frac(now));
  }
  tick(now: number, layerOn: boolean) {
    if (!this.any || !layerOn) { this.mesh.visible = this.rim.visible = false; return; }
    this.mesh.visible = this.rim.visible = true;
    const f = this.frac(now); const h = this.world.heights; const pos = this.pos, rp = this.rimPos; const t = now / 1000;
    for (let k = 0; k < pos.count; k++) {
      const o = k * 4; let d = 0;
      for (let q = 0; q < 4; q++) { const c = this.idx[o + q]; d += (this.prev[c] + (this.cur[c] - this.prev[c]) * this.cellT(c, f)) * this.wts[o + q]; }
      if (d > 0.015) {
        const x = pos.getX(k), z = pos.getZ(k); const dx = this.dir[k * 2], dz = this.dir[k * 2 + 1];
        const ripple = 0.08 * Math.sin((x * dx + z * dz) * 1.6 - t * 3.2) + 0.03 * Math.sin((x - z) * 2.3 + t * 2.1);
        const y = h[k] + 0.08 + d * 1.1 + ripple * Math.min(1, d * 4);
        pos.setY(k, d > 0.04 ? y : h[k] - 3); rp.setY(k, y - 0.03);
      } else { pos.setY(k, h[k] - 3); rp.setY(k, h[k] - 3); }
    }
    pos.needsUpdate = true; rp.needsUpdate = true;
    const m = this.mesh.material as THREE.MeshStandardMaterial; m.emissiveIntensity = 0.22 + 0.08 * Math.sin(t * 1.7); m.opacity = 0.72 + 0.04 * Math.sin(t * 1.1);
  }
  dispose() { disposeObject(this.mesh); disposeObject(this.rim); }
}

// ---------- flow particles ----------
export class FlowParticles {
  points: THREE.Points; private pos: Float32Array; private life: Float32Array; private N: number; private tex: THREE.Texture; boost = 1; boostUntil = 0;
  constructor(private world: World, private rivers: RiverFlow, private flood: FloodAnim, n = 2500) {
    this.N = n; this.pos = new Float32Array(n * 3); this.life = new Float32Array(n);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.tex = dotTexture();
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.42, map: this.tex, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, color: '#cfe6ff', sizeAttenuation: true }));
    this.points.renderOrder = 7; this.points.frustumCulled = false;
    this.active = Math.min(n, this.rivers.samples.length * 3);
    for (let i = 0; i < n; i++) this.respawn(i, 0, true);
  }
  private flooded: number[] = []; private weights: number[] = []; private total = 0;
  private active = 0;
  setFlood(grid: Float32Array) { this.flooded = []; this.weights = []; this.total = 0; for (let k = 0; k < grid.length; k++) if (grid[k] > 0.08) { this.flooded.push(k); this.total += grid[k]; this.weights.push(this.total); } this.active = Math.min(this.N, 70 * this.flooded.length + this.rivers.samples.length * 3); }
  private respawn(i: number, now: number, init = false) {
    let x: number, z: number;
    if (!init && i >= this.active) { const o = i * 3; this.pos[o + 1] = -50; this.life[i] = 1 + Math.random(); return; } // density ∝ flooded area
    if (this.flooded.length && Math.random() < 0.75) {
      const r = Math.random() * this.total; let lo = 0, hi = this.weights.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (this.weights[mid] < r) lo = mid + 1; else hi = mid; }
      const k = this.flooded[lo]; const [cx, cz] = this.world.cellCenter(k % this.world.cols, Math.floor(k / this.world.cols)); x = cx + (Math.random() - 0.5) * this.world.cellW; z = cz + (Math.random() - 0.5) * this.world.cellD;
    } else if (this.rivers.samples.length) { const s = this.rivers.samples[Math.floor(Math.random() * this.rivers.samples.length)]; x = s.x + (Math.random() - 0.5) * 0.6; z = s.z + (Math.random() - 0.5) * 0.6; }
    else { const o = i * 3; this.pos[o] = 0; this.pos[o + 2] = 0; this.pos[o + 1] = -50; this.life[i] = 1 + Math.random(); return; } // nothing flowing yet: park it out of sight
    const o = i * 3; this.pos[o] = x; this.pos[o + 2] = z; this.pos[o + 1] = init ? -50 : this.world.heightAt(x, z) + 0.25; this.life[i] = 2 + Math.random() * 5;
  }
  /** burst of particles at a point (splash) */
  burst(x: number, z: number, count = 60) { for (let q = 0; q < count; q++) { const i = Math.floor(Math.random() * this.N); const o = i * 3; this.pos[o] = x + (Math.random() - 0.5) * 1.2; this.pos[o + 2] = z + (Math.random() - 0.5) * 1.2; this.pos[o + 1] = this.world.heightAt(x, z) + 0.3 + Math.random() * 0.8; this.life[i] = 1 + Math.random() * 2; } }
  tick(now: number, dt: number) {
    if (now > this.boostUntil) this.boost = 1;
    const w = this.world; const p = this.pos;
    for (let i = 0; i < this.N; i++) {
      const o = i * 3; let x = p[o], z = p[o + 2];
      this.life[i] -= dt;
      if (p[o + 1] < -40) { if (this.life[i] <= 0) this.respawn(i, now); continue; }
      const fl = this.flood.depthAt(x, z, now); const rs = this.rivers.nearest(x, z);
      if (this.life[i] <= 0 || (fl < 0.03 && !rs) || Math.abs(x) > w.W / 2 || Math.abs(z) > w.D / 2) { this.respawn(i, now); continue; }
      let [dx, dz] = w.downhill(x, z);
      if (rs) { const k = 0.65; dx = dx * (1 - k) + rs.tx * k; dz = dz * (1 - k) + rs.tz * k; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
      const speed = (1.2 + 6 * fl + (rs ? 1.0 : 0)) * this.boost;
      x += dx * speed * dt; z += dz * speed * dt;
      p[o] = x; p[o + 2] = z; p[o + 1] = w.heightAt(x, z) + 0.12 + fl * 1.1 + 0.1;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() { disposeObject(this.points); this.tex.dispose(); }
}

// ---------- obstacles: bridges & river crossings ----------
export interface ObstacleEvent { obj: THREE.Object3D; t0: number; dur: number; step(t: number): void }
export class Obstacles {
  group = new THREE.Group(); private blocks = new Map<string, { mesh: THREE.Mesh; infra: Infra; status: string }>();
  constructor(private world: World, rivers: RiverFlow) {
    this.group.name = 'obstacles';
    const geo = new THREE.BoxGeometry(world.cellW * 0.8, 0.22, 0.5);
    for (const inf of world.region.infra.filter((x) => x.kind === 'bridge' || x.kind === 'river_crossing')) {
      const [x, z] = world.toScene(inf.at); const rs = rivers.nearest(x, z);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 })); m.position.set(rs ? rs.x : x, world.heightAt(x, z) + 0.28, rs ? rs.z : z);
      if (rs) m.rotation.y = Math.atan2(rs.tx, rs.tz); // span across the river
      m.userData.infra = inf; this.group.add(m); this.blocks.set(inf.id, { mesh: m, infra: inf, status: 'open' });
    }
  }
  /** returns newly failed infra (for splash/pill effects) */
  update(states: InfraState[]): { infra: Infra; status: string; x: number; z: number }[] {
    const out: { infra: Infra; status: string; x: number; z: number }[] = [];
    for (const st of states) {
      const b = this.blocks.get(st.id); if (!b || b.status === st.status) continue; b.status = st.status;
      const bad = st.status === 'closed' || st.status === 'damaged';
      (b.mesh.material as THREE.MeshStandardMaterial).color.set(bad ? (st.status === 'closed' ? '#7a3b2a' : '#b07a52') : '#ffffff');
      b.mesh.rotation.z = bad ? (st.status === 'closed' ? 0.35 : 0.15) : 0; b.mesh.position.y += bad ? -0.15 : 0.15;
      if (bad) out.push({ infra: b.infra, status: st.status, x: b.mesh.position.x, z: b.mesh.position.z });
    }
    return out;
  }
  dispose() { disposeObject(this.group); }
}

export function splashRing(world: World, x: number, z: number, now: number, color = '#ffffff'): ObstacleEvent {
  const y = world.heightAt(x, z) + 0.4; const geo = new THREE.RingGeometry(0.5, 0.75, 48); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }); const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.renderOrder = 5;
  return { obj: m, t0: now, dur: 1200, step: (t) => { const s = 1 + t * 5; m.scale.set(s, 1, s); mat.opacity = 0.95 * (1 - t); } };
}
export function infoPill(world: World, x: number, z: number, text: string, now: number, dur = 6000): ObstacleEvent {
  const l = label('sc-pill sc-info', text); l.position.set(x, world.heightAt(x, z) + 1.6, z);
  return { obj: l, t0: now, dur, step: (t) => { (l.element as HTMLElement).style.opacity = String(t > 0.8 ? (1 - t) / 0.2 : 1); } };
}
/** bright pulse travelling downstream along the nearest river from a point */
export function riverPulse(world: World, rivers: RiverFlow, x: number, z: number, now: number): ObstacleEvent | undefined {
  let best: RiverSample | undefined, bd = Infinity; for (const s of rivers.samples) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
  if (!best) return undefined; const curve: THREE.CatmullRomCurve3 = best.mesh.userData.curve; const u0 = best.u;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshBasicMaterial({ color: '#dff6ff', transparent: true, opacity: 0.95 })); m.renderOrder = 6;
  const light = new THREE.PointLight('#9fdcff', 40, 12, 2); m.add(light);
  return { obj: m, t0: now, dur: 2500, step: (t) => { const u = u0 + (1 - u0) * t; const p = curve.getPoint(Math.min(1, u)); m.position.set(p.x, world.heightAt(p.x, p.z) + 0.5, p.z); const s = 1 + 0.6 * Math.sin(t * Math.PI); m.scale.setScalar(s); (m.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t * 0.6); } };
}
