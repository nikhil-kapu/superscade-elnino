// Hazard layers driven by a SimSnapshot: flood surface, landslides, dams, fire, burn/quake tints, quake rings, spread path, trigger marker.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { HazardCell, LngLat, Scenario, SimSnapshot } from '../../../shared/types.ts';
import { tickClock } from '../store';
import { hazardCentroid } from '../map/geo';
import { PAL, World } from './world';
import { disposeObject, label, type Terrain } from './build';

// ---------- flood surface ----------
export class FloodSurface {
  mesh: THREE.Mesh; private pos: THREE.BufferAttribute; private grid: Float32Array; private tmp: Float32Array;
  constructor(private world: World, private terrain: Terrain) {
    const geo = terrain.mesh.geometry.clone();
    this.pos = geo.attributes.position as THREE.BufferAttribute;
    geo.deleteAttribute('color');
    const mat = new THREE.MeshStandardMaterial({ color: PAL.flood, emissive: '#1d4ed8', emissiveIntensity: 0.25, transparent: true, opacity: 0.75, roughness: 0.3, metalness: 0.1, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.name = 'flood'; this.mesh.renderOrder = 2;
    this.grid = new Float32Array(world.cols * world.rows); this.tmp = new Float32Array(this.grid.length);
    this.update([]);
  }
  update(hazards: HazardCell[]) {
    const { cols, rows } = this.world; const g = this.grid; g.fill(0);
    let any = false;
    for (const h of hazards) if (h.kind === 'flood') { g[h.j * cols + h.i] = Math.max(g[h.j * cols + h.i], h.intensity); any = true; }
    this.mesh.visible = any;
    if (!any) return;
    // 3x3 blur, twice (approx Gaussian), keeps extent ~1 cell wider so the surface laps onto banks
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? g : this.tmp, dst = pass === 0 ? this.tmp : g;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        let s = 0, w = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue; const wt = di === 0 && dj === 0 ? 2 : (di === 0 || dj === 0 ? 1 : 0.6); s += src[jj * cols + ii] * wt; w += wt; }
        dst[j * cols + i] = s / w;
      }
    }
    const depthScale = 1.1, pos = this.pos, h = this.world.heights, W = this.world.W, D = this.world.D;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      const fi = (x / W + 0.5) * cols - 0.5, fj = (0.5 - z / D) * rows - 0.5;
      const i0 = Math.max(0, Math.min(cols - 1, Math.floor(fi))), j0 = Math.max(0, Math.min(rows - 1, Math.floor(fj)));
      const i1 = Math.min(cols - 1, i0 + 1), j1 = Math.min(rows - 1, j0 + 1); const tx = Math.max(0, Math.min(1, fi - i0)), tz = Math.max(0, Math.min(1, fj - j0));
      const d = (g[j0 * cols + i0] * (1 - tx) + g[j0 * cols + i1] * tx) * (1 - tz) + (g[j1 * cols + i0] * (1 - tx) + g[j1 * cols + i1] * tx) * tz;
      pos.setY(k, d > 0.04 ? h[k] + 0.08 + d * depthScale : h[k] - 3);
    }
    pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals();
  }
  dispose() { disposeObject(this.mesh); }
}

// ---------- instanced flat discs (landslide scars, fire) ----------
export class Discs {
  mesh: THREE.InstancedMesh; streaks?: THREE.InstancedMesh;
  constructor(public world: World, color: string, max: number, opts: { emissive?: number; streaks?: boolean; radius: number; sink?: number }) {
    const geo = new THREE.CircleGeometry(opts.radius, 14); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: opts.emissive ? color : '#000000', emissiveIntensity: opts.emissive ?? 0, roughness: 1, transparent: true, opacity: 0.95, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max); this.mesh.count = 0; this.mesh.renderOrder = 3;
    if (opts.streaks) {
      const sg = new THREE.PlaneGeometry(opts.radius * 0.7, opts.radius * 3.2); sg.rotateX(-Math.PI / 2); sg.translate(0, 0, opts.radius * 1.6);
      this.streaks = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: '#4a3119', roughness: 1, transparent: true, opacity: 0.8, depthWrite: false }), max); this.streaks.count = 0; this.streaks.renderOrder = 3;
    }
  }
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  update(cells: HazardCell[], lift = 0.06) {
    const n = Math.min(cells.length, this.mesh.instanceMatrix.count);
    for (let k = 0; k < n; k++) {
      const h = cells[k]; const [x, z] = this.world.cellCenter(h.i, h.j); const y = this.world.heightAt(x, z) + lift;
      const sc = 0.55 + h.intensity * 0.9;
      this.p.set(x, y, z); this.s.set(sc, 1, sc); this.q.identity(); this.m.compose(this.p, this.q, this.s); this.mesh.setMatrixAt(k, this.m);
      if (this.streaks) { const [dx, dz] = this.world.downhill(x, z); this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz)); this.s.set(sc, 1, sc * (0.8 + h.intensity)); this.m.compose(this.p, this.q, this.s); this.streaks.setMatrixAt(k, this.m); }
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.streaks) { this.streaks.count = n; this.streaks.instanceMatrix.needsUpdate = true; }
  }
  dispose() { disposeObject(this.mesh); if (this.streaks) disposeObject(this.streaks); }
}

// ---------- vertex colour tints (burn scar, shaking) ----------
export function applyTints(terrain: Terrain, world: World, hazards: HazardCell[], burnOn: boolean, shakeOn: boolean) {
  const arr = terrain.colors.array as Float32Array; arr.set(terrain.base);
  const burn = new Float32Array(world.cols * world.rows), quake = new Float32Array(world.cols * world.rows); let any = false;
  for (const h of hazards) { if (h.kind === 'burn' && burnOn) { burn[h.j * world.cols + h.i] = h.intensity; any = true; } else if (h.kind === 'quake' && shakeOn && h.intensity > 0.3) { quake[h.j * world.cols + h.i] = h.intensity; any = true; } }
  if (any) {
    const B = PAL.burn, Q = PAL.quake;
    for (let k = 0; k < terrain.cellIdx.length; k++) {
      const c = terrain.cellIdx[k]; const b = burn[c], q = quake[c]; if (!b && !q) continue;
      const o = k * 3;
      if (b) { const t = 0.55 + 0.4 * b; arr[o] += (B.r - arr[o]) * t; arr[o + 1] += (B.g - arr[o + 1]) * t; arr[o + 2] += (B.b - arr[o + 2]) * t; }
      if (q) { const t = 0.4 * ((q - 0.3) / 0.7); arr[o] += (Q.r - arr[o]) * t; arr[o + 1] += (Q.g - arr[o + 1]) * t; arr[o + 2] += (Q.b - arr[o + 2]) * t; }
    }
  }
  terrain.colors.needsUpdate = true;
}

// ---------- quake rings ----------
export function buildQuakeRings(world: World, epi: LngLat, hazards: HazardCell[]): THREE.Group {
  const g = new THREE.Group(); g.name = 'quake-rings';
  const [ex, ez] = world.toScene(epi); const y = world.heightAt(ex, ez) + 0.35;
  [0.7, 0.5, 0.3].forEach((th, k) => {
    let r = 0; for (const h of hazards) if (h.kind === 'quake' && h.intensity >= th) { const [x, z] = world.cellCenter(h.i, h.j); r = Math.max(r, Math.hypot(x - ex, z - ez)); }
    if (r <= 0) return;
    const geo = new THREE.RingGeometry(r * 0.97, r * 0.97 + 0.35 - k * 0.08, 96); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#8b5cf6', transparent: true, opacity: 0.7 - k * 0.18, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(ex, y + k * 0.05, ez); m.userData.phase = k; m.renderOrder = 4; g.add(m);
  });
  return g;
}

// ---------- dams ----------
export function buildDams(world: World, hazards: HazardCell[]): THREE.Group {
  const g = new THREE.Group(); g.name = 'dams';
  const geo = new THREE.OctahedronGeometry(0.55);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.4, roughness: 0.3 });
  for (const h of hazards.filter((x) => x.kind === 'dam')) {
    const [x, z] = world.cellCenter(h.i, h.j); const y = world.heightAt(x, z) + 0.9;
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m);
    const l = label('sc-pill sc-dam', 'DAM'); l.position.set(x, y + 1.0, z); g.add(l);
  }
  return g;
}

// ---------- transient effects (dam burst ring) ----------
export interface Effect { obj: THREE.Object3D; t0: number; dur: number; step(t: number): void }
export function burstRing(world: World, at: LngLat, now: number): Effect {
  const [x, z] = world.toScene(at); const y = world.heightAt(x, z) + 0.4;
  const geo = new THREE.RingGeometry(0.8, 1.15, 64); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.renderOrder = 5;
  return { obj: m, t0: now, dur: 1500, step: (t) => { const s = 1 + t * 9; m.scale.set(s, 1, s); mat.opacity = 0.9 * (1 - t); } };
}

// ---------- spread / surge path ----------
export class SpreadPath {
  group = new THREE.Group(); private line?: Line2; private mat: LineMaterial;
  private arrowGeo = new THREE.ConeGeometry(0.32, 0.9, 8); private arrowMat = new THREE.MeshStandardMaterial({ color: PAL.arrow, emissive: PAL.arrow, emissiveIntensity: 0.5 });
  constructor(private world: World, res: THREE.Vector2) { this.group.name = 'spread'; this.mat = new LineMaterial({ color: new THREE.Color(PAL.spread).getHex(), linewidth: 3, worldUnits: false, transparent: true, opacity: 0.95, depthTest: false }); this.mat.resolution.copy(res); }
  setResolution(w: number, h: number) { this.mat.resolution.set(w, h); }
  update(trigger: LngLat | undefined, snaps: SimSnapshot[], kind: HazardCell['kind']) {
    this.group.children.slice().forEach((c) => { this.group.remove(c); disposeObject(c); }); this.line = undefined;
    if (!trigger || !snaps.length) return;
    const pts: THREE.Vector3[] = []; const [tx, tz] = this.world.toScene(trigger); pts.push(new THREE.Vector3(tx, 0, tz));
    const pins: { p: THREE.Vector3; tick: number }[] = []; let prev: LngLat | undefined;
    for (const sn of snaps) {
      const c = hazardCentroid(this.world.region, sn, kind); if (!c) continue;
      const sm = prev ? { lng: (prev.lng + c.lng) / 2, lat: (prev.lat + c.lat) / 2 } : c; prev = c;
      const [x, z] = this.world.toScene(sm); const last = pts[pts.length - 1];
      if (Math.hypot(last.x - x, last.z - z) > 0.6) pts.push(new THREE.Vector3(x, 0, z));
      if (sn.tick > 0 && sn.tick % 6 === 0) { const lp = pins[pins.length - 1]; if (!lp || Math.hypot(lp.p.x - x, lp.p.z - z) > 2.5) pins.push({ p: new THREE.Vector3(x, 0, z), tick: sn.tick }); else lp.tick = sn.tick; }
    }
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const N = Math.max(32, pts.length * 10); const arr: number[] = [];
    for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N); arr.push(p.x, this.world.heightAt(p.x, p.z) + 0.7, p.z); }
    const geo = new LineGeometry(); geo.setPositions(arr);
    this.line = new Line2(geo, this.mat); this.line.computeLineDistances(); this.line.renderOrder = 6; this.group.add(this.line);
    // arrows
    const nA = Math.min(12, Math.max(2, Math.floor(curve.getLength() / 4)));
    const up = new THREE.Vector3(0, 1, 0), tan = new THREE.Vector3();
    for (let a = 1; a <= nA; a++) {
      const t = a / (nA + 1); const p = curve.getPoint(t); curve.getTangent(t, tan); tan.y = 0; tan.normalize();
      const m = new THREE.Mesh(this.arrowGeo, this.arrowMat); m.position.set(p.x, this.world.heightAt(p.x, p.z) + 0.75, p.z); m.quaternion.setFromUnitVectors(up, tan); m.renderOrder = 6; this.group.add(m);
    }
    for (const pin of pins) {
      const l = label('sc-pin', `<i></i>T+${pin.tick} · ${tickClock(pin.tick)}`); l.position.set(pin.p.x, this.world.heightAt(pin.p.x, pin.p.z) + 1.2, pin.p.z); this.group.add(l);
    }
  }
  dispose() { this.group.children.slice().forEach((c) => disposeObject(c)); this.mat.dispose(); this.arrowGeo.dispose(); this.arrowMat.dispose(); }
}

// ---------- trigger marker ----------
export function triggerText(sc: Scenario | undefined): string {
  if (!sc) return 'Trigger here';
  const p = sc.trigger.params;
  const find = (re: RegExp) => { const k = Object.keys(p).find((x) => re.test(x)); return k ? p[k] : undefined; };
  if (sc.trigger.kind === 'rain') { const mm = find(/rain|mm|precip/i); return mm != null ? `Rain cell · ${mm} mm` : 'Rain cell'; }
  if (sc.trigger.kind === 'quake') { const m = find(/mag/i); return m != null ? `Epicenter · M${Number(m).toFixed(1)}` : 'Epicenter'; }
  return 'Ignition';
}
export class TriggerMarker {
  group = new THREE.Group(); private ring: THREE.Mesh; private sphere: THREE.Mesh; private label: ReturnType<typeof label>; private light: THREE.PointLight;
  constructor() {
    this.group.name = 'trigger';
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.2 }));
    const rg = new THREE.RingGeometry(0.9, 1.1, 48); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.light = new THREE.PointLight('#fff1cc', 30, 14, 2); this.light.position.y = 1.2;
    this.label = label('sc-pill sc-trigger', ''); this.label.position.set(0, 1.9, 0);
    this.group.add(this.sphere, this.ring, this.light, this.label); this.group.visible = false;
  }
  set(world: World, at: LngLat | undefined, text: string, kind: 'rain' | 'quake' | 'fire' | 'none') {
    if (!at) { this.group.visible = false; return; }
    const [x, z] = world.toScene(at); this.group.position.set(x, world.heightAt(x, z) + 0.5, z); this.group.visible = true;
    (this.label.element as HTMLElement).textContent = text; (this.label.element as HTMLElement).dataset.kind = kind;
  }
  tick(t: number) { const ph = (t / 1400) % 1; const s = 1 + ph * 3.5; this.ring.scale.set(s, 1, s); (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - ph); (this.sphere.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + 0.6 * Math.sin(t / 300); }
  dispose() { disposeObject(this.group); }
}
