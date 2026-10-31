// Static scene content: terrain, sea, rivers, trees, roads, places. All derived from the region config + sim grid.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Infra, LngLat } from '../../../shared/types.ts';
import { PAL, World, colorAt, fbm, seeded } from './world';

const WINTER_GREEN = new THREE.Color('#6f8f4e');
export interface Terrain { mesh: THREE.Mesh; base: Float32Array; cellIdx: Int32Array; colors: THREE.BufferAttribute; }

export function buildTerrain(world: World): Terrain {
  const segX = world.cols * 4, segZ = world.rows * 4;
  const geo = new THREE.PlaneGeometry(world.W, world.D, segX, segZ);
  geo.rotateX(-Math.PI / 2); // now in XZ; row 0 is at z = -D/2 (north)
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const heights = new Float32Array(n);
  const cellIdx = new Int32Array(n);
  const col = new THREE.Color();
  const ys = world.yScale, maxE = world.maxElev;
  const winterGreen = world.region.id === 'bayarea';
  for (let k = 0; k < n; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const kind = world.kindAt(x, z);
    const e = world.elevAt(x, z);
    const en = e / maxE;
    let y: number;
    if (kind === 'water' && e <= 1) { y = -0.6; }
    else {
      // ridge noise: strong on hills, faint on flats
      const amp = kind === 'hills' ? 0.9 + 1.6 * en : kind === 'valley' || kind === 'softsoil' ? 0.3 : 0.2;
      const nz = fbm(x * 0.21 + 7.3, z * 0.21 + 2.1, 4) - 0.5;
      const ridge = 1 - Math.abs(fbm(x * 0.07, z * 0.07, 2) * 2 - 1); // soft ridgelines
      y = e * ys + nz * amp + (kind === 'hills' ? ridge * 0.9 * en : 0);
      if (kind !== 'hills') y = Math.max(y, 0.05);
    }
    pos.setY(k, y); heights[k] = y;
    colorAt(world, x, z, Math.max(0, Math.min(1, y / (maxE * ys))), col);
    if (winterGreen && kind === 'hills') col.lerp(WINTER_GREEN, 0.42 - 0.25 * Math.max(0, Math.min(1, en))); // El Niño winter: rain-green Bay Area hills
    const v = 1 + (fbm(x * 0.9, z * 0.9, 2) - 0.5) * 0.08;
    colors[k * 3] = col.r * v; colors[k * 3 + 1] = col.g * v; colors[k * 3 + 2] = col.b * v;
    const [ci, cj] = world.cellOf(x, z); cellIdx[k] = cj * world.cols + ci;
  }
  world.segX = segX; world.segZ = segZ; world.heights = heights;
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const colorAttr = new THREE.BufferAttribute(colors.slice(), 3);
  geo.setAttribute('color', colorAttr);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  return { mesh, base: colors, cellIdx, colors: colorAttr };
}

export function buildSea(world: World): THREE.Mesh | undefined {
  if (!world.kind.some((k) => k === 'water')) return undefined;
  const geo = new THREE.PlaneGeometry(world.W, world.D); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: PAL.sea, transparent: true, opacity: 0.85, roughness: 0.35, metalness: 0.05 });
  const m = new THREE.Mesh(geo, mat); m.position.y = -0.18; m.name = 'sea'; return m;
}

/** Flat ribbon along a Catmull-Rom curve, draped on the terrain. */
export function ribbon(world: World, pts: LngLat[], width: number, lift: number, color: string, emissive = 0, yAt?: (x: number, z: number) => number): THREE.Mesh | undefined {
  if (pts.length < 2) return undefined;
  const H = yAt ?? ((x: number, z: number) => world.heightAt(x, z));
  const v = pts.map((p) => { const [x, z] = world.toScene(p); return new THREE.Vector3(x, 0, z); });
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.5);
  const N = Math.max(24, Math.round(curve.getLength() * 2.5));
  const positions = new Float32Array((N + 1) * 2 * 3);
  const uvs = new Float32Array((N + 1) * 2 * 2);
  const idx: number[] = [];
  const t = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const p = curve.getPoint(i / N); curve.getTangent(i / N, t);
    const nx = -t.z, nz = t.x; const l = Math.hypot(nx, nz) || 1;
    const hw = width / 2;
    const ax = p.x + (nx / l) * hw, az = p.z + (nz / l) * hw, bx = p.x - (nx / l) * hw, bz = p.z - (nz / l) * hw;
    const y = H(p.x, p.z) + lift;
    positions.set([ax, Math.max(y, H(ax, az) + lift * 0.5), az, bx, Math.max(y, H(bx, bz) + lift * 0.5), bz], i * 6);
    uvs.set([i / N, 0, i / N, 1], i * 4);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, roughness: 0.4, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat); mesh.userData.length = curve.getLength(); mesh.userData.curve = curve; return mesh;
}

export function buildRivers(world: World): THREE.Group {
  const g = new THREE.Group(); g.name = 'rivers';
  for (const r of world.region.rivers ?? []) { const m = ribbon(world, r.line, world.cellW * 0.55, 0.12, PAL.river, 0.18); if (m) { m.userData.river = r; g.add(m); } }
  return g;
}

/** Thin dark draped line through lng/lat points (Catmull-Rom). */
export function drapedLine(world: World, pts: LngLat[], color: string, lift = 0.1, opacity = 0.9): THREE.Line | undefined {
  if (pts.length < 2) return undefined;
  const v = pts.map((p) => { const [x, z] = world.toScene(p); return new THREE.Vector3(x, 0, z); });
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.5);
  const N = Math.max(16, Math.round(curve.getLength() * 3));
  const arr = new Float32Array((N + 1) * 3);
  for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N); arr.set([p.x, world.heightAt(p.x, p.z) + lift, p.z], i * 3); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

export interface RoadPoly { pts: [number, number][]; halfW: number }
/** road polylines in scene coords (buildings keep clear of them) */
export function roadPolylines(world: World): RoadPoly[] {
  return (world.region.roads ?? []).map((r) => ({ pts: r.line.map((p) => world.toScene(p)), halfW: (r.kind === 'highway' ? 0.2 : 0.11) * world.cellW }));
}
export function buildRoads(world: World): THREE.Group {
  const g = new THREE.Group(); g.name = 'roads';
  const roads = world.region.roads ?? [];
  if (roads.length) {
    // real highways and arterials as draped ribbons; highways get a pale centre line. Over water the deck floats at sea level (bridges).
    const deck = (x: number, z: number) => Math.max(world.heightAt(x, z), 0.12);
    for (const r of roads) {
      const hw = r.kind === 'highway';
      const m = ribbon(world, r.line, (hw ? 0.34 : 0.22) * world.cellW, hw ? 0.16 : 0.12, hw ? PAL.road : PAL.street, 0, deck);
      if (m) { m.userData.road = r; g.add(m); }
      if (hw) { const c = ribbon(world, r.line, 0.045 * world.cellW, 0.2, PAL.roadLine, 0.15, deck); if (c) g.add(c); }
    }
    return g;
  }
  // fallback for regions without road data: plausible chains through the district centroids + highway spurs
  const ds = [...world.region.districts].sort((a, b) => a.centroid.lng - b.centroid.lng);
  const chain = ribbon(world, ds.map((d) => d.centroid), 0.16 * world.cellW, 0.1, PAL.street, 0); if (chain) g.add(chain);
  const ds2 = [...world.region.districts].sort((a, b) => a.centroid.lat - b.centroid.lat);
  const chain2 = ribbon(world, ds2.map((d) => d.centroid), 0.12 * world.cellW, 0.1, PAL.street, 0); if (chain2) g.add(chain2);
  for (const inf of world.region.infra.filter((x) => x.kind === 'highway')) {
    let best: { c: LngLat; d: number } | undefined;
    for (const d of world.region.districts) { const dist = Math.hypot(d.centroid.lng - inf.at.lng, d.centroid.lat - inf.at.lat); if (!best || dist < best.d) best = { c: d.centroid, d: dist }; }
    if (best) { const mid = { lng: (best.c.lng + inf.at.lng) / 2 + 0.01, lat: (best.c.lat + inf.at.lat) / 2 - 0.01 }; const l = ribbon(world, [best.c, mid, inf.at], 0.22 * world.cellW, 0.12, PAL.road, 0); if (l) g.add(l); }
  }
  return g;
}

/** Low-detail surroundings: a wide sea plane, flat land polygons, context roads and faint place labels outside the sim bbox. */
export function buildContext(world: World): THREE.Group | undefined {
  const ctx = world.region.context; if (!ctx) return undefined;
  const g = new THREE.Group(); g.name = 'context';
  const [w, s, e, n] = ctx.bbox;
  const [x0, z0] = world.toScene({ lng: w, lat: n }), [x1, z1] = world.toScene({ lng: e, lat: s });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)), new THREE.MeshStandardMaterial({ color: PAL.seaFar, roughness: 0.55, metalness: 0.02 }));
  sea.rotateX(-Math.PI / 2); sea.position.set((x0 + x1) / 2, -0.26, (z0 + z1) / 2); sea.name = 'ctx-sea'; g.add(sea);
  const landMat = new THREE.MeshStandardMaterial({ color: PAL.landFar, roughness: 1 });
  for (const poly of ctx.land) {
    if (poly.length < 3) continue;
    const shape = new THREE.Shape(poly.map((p) => { const [x, z] = world.toScene(p); return new THREE.Vector2(x, -z); }));
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, landMat); m.position.y = 0.02; g.add(m);
  }
  const flat = () => 0.03;
  for (const r of ctx.roads ?? []) { const hw = r.kind === 'highway'; const m = ribbon(world, r.line, (hw ? 0.3 : 0.16) * world.cellW, 0.05, hw ? PAL.road : PAL.street, 0, flat); if (m) g.add(m); }
  for (const l of ctx.labels ?? []) { const [x, z] = world.toScene(l.at); const o = label('sc-place sc-ctx', `<span>${l.name}</span>`); o.position.set(x, 0.5, z); g.add(o); }
  return g;
}

/** Fault traces: dashed red lines, draped inside the sim bbox and flat over the context outside it. */
export function buildFaults(world: World): THREE.Group {
  const g = new THREE.Group(); g.name = 'faults';
  const inside = (x: number, z: number) => Math.abs(x) <= world.W / 2 && Math.abs(z) <= world.D / 2;
  const yOf = (x: number, z: number) => (inside(x, z) ? Math.max(-0.1, world.heightAt(x, z)) + 0.25 : 0.12);
  for (const f of world.region.faults ?? []) {
    const v = f.line.map((p) => { const [x, z] = world.toScene(p); return new THREE.Vector3(x, 0, z); });
    if (v.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.5);
    const N = Math.max(32, Math.round(curve.getLength() * 3)); const arr = new Float32Array((N + 1) * 3);
    for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N); arr.set([p.x, yOf(p.x, p.z), p.z], i * 3); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: PAL.fault, dashSize: 1.1, gapSize: 0.55, transparent: true, opacity: 0.9 })); line.computeLineDistances(); g.add(line);
    const mid = curve.getPoint(0.5); const o = label('sc-pill sc-fault', f.name); o.position.set(mid.x, yOf(mid.x, mid.z) + 1.0, mid.z); g.add(o);
  }
  return g;
}

export interface Trees { mesh: THREE.InstancedMesh; byCell: Map<number, number[]>; scales: Float32Array; positions: Float32Array; }
export function buildTrees(world: World): Trees {
  const cone = new THREE.ConeGeometry(0.24, 0.75, 6); cone.translate(0, 0.37 + 0.16, 0);
  const trunk = new THREE.CylinderGeometry(0.04, 0.06, 0.18, 5); trunk.translate(0, 0.09, 0);
  const cc = new Float32Array(cone.attributes.position.count * 3).fill(1);
  const tc = new Float32Array(trunk.attributes.position.count * 3); for (let i = 0; i < trunk.attributes.position.count; i++) tc.set([1.5, 1.0, 0.7], i * 3);
  cone.setAttribute('color', new THREE.BufferAttribute(cc, 3)); trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  cone.deleteAttribute('uv'); trunk.deleteAttribute('uv');
  const geo = mergeGeometries([trunk, cone], false)!;
  const rnd = seeded(1234 + world.cols * 7 + world.rows);
  const spots: { x: number; z: number; s: number; cell: number; c: number }[] = [];
  const budget = 7500;
  for (let j = 0; j < world.rows; j++) for (let i = 0; i < world.cols; i++) {
    const k = j * world.cols + i; const kind = world.kind[k];
    const count = kind === 'hills' ? 4 : kind === 'valley' ? 1 : 0;
    const [cx, cz] = world.cellCenter(i, j);
    for (let q = 0; q < count; q++) {
      const x = cx + (rnd() - 0.5) * world.cellW, z = cz + (rnd() - 0.5) * world.cellD;
      // thin out at the very top (rock/snow) and on steep noise
      const h = world.heightAt(x, z); if (h / (world.maxElev * world.yScale) > 0.8 && rnd() < 0.7) continue;
      spots.push({ x, z, s: 0.6 + rnd() * 0.7, cell: k, c: rnd() < 0.5 ? 0 : 1 });
    }
  }
  while (spots.length > budget) spots.splice(Math.floor(rnd() * spots.length), 1);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length); mesh.name = 'trees';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const byCell = new Map<number, number[]>(); const scales = new Float32Array(spots.length); const positions = new Float32Array(spots.length * 3);
  const c1 = new THREE.Color(PAL.tree1), c2 = new THREE.Color(PAL.tree2);
  spots.forEach((s, idx) => {
    const y = world.heightAt(s.x, s.z) - 0.05;
    p.set(s.x, y, s.z); sc.set(s.s, s.s, s.s); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    m.compose(p, q, sc); mesh.setMatrixAt(idx, m); mesh.setColorAt(idx, s.c ? c2 : c1);
    scales[idx] = s.s; positions.set([s.x, y, s.z], idx * 3);
    let arr = byCell.get(s.cell); if (!arr) byCell.set(s.cell, (arr = [])); arr.push(idx);
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, byCell, scales, positions };
}

/** Hide/restore trees for a set of cells (burned / flooded). */
export function setTreesHidden(trees: Trees, hidden: Set<number>, prev: Set<number>) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let changed = false;
  const apply = (cell: number, hide: boolean) => {
    const idxs = trees.byCell.get(cell); if (!idxs) return;
    for (const idx of idxs) {
      trees.mesh.getMatrixAt(idx, m); m.decompose(p, q, sc);
      const s = hide ? 0.0001 : trees.scales[idx]; sc.set(s, s, s); m.compose(p, q, sc); trees.mesh.setMatrixAt(idx, m); changed = true;
    }
  };
  prev.forEach((c) => { if (!hidden.has(c)) apply(c, false); });
  hidden.forEach((c) => { if (!prev.has(c)) apply(c, true); });
  if (changed) trees.mesh.instanceMatrix.needsUpdate = true;
}

export function label(cls: string, html: string): CSS2DObject {
  const el = document.createElement('div'); el.className = cls; el.innerHTML = html;
  const o = new CSS2DObject(el); return o;
}

export function buildPlaces(world: World): { labels: THREE.Group; infra: THREE.Group } {
  const labels = new THREE.Group(); labels.name = 'places';
  for (const d of world.region.districts) {
    const [x, z] = world.toScene(d.centroid);
    const o = label('sc-place', `<span>${d.name.split(/ \(| \/ /)[0]}</span>`); o.position.set(x, world.heightAt(x, z) + 0.6, z); o.userData.districtId = d.id; labels.add(o);
  }
  const infra = new THREE.Group(); infra.name = 'infra';
  if (world.region.infra.some((x) => FACILITY_KINDS.has(x.kind))) { buildFacilities(world, infra); return { labels, infra }; }
  const show: Infra['kind'][] = ['hospital', 'shelter', 'airport'];
  const dotGeo = new THREE.SphereGeometry(0.22, 10, 8);
  const dotMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.5 });
  for (const inf of world.region.infra.filter((x) => show.includes(x.kind))) {
    const [x, z] = world.toScene(inf.at); const y = world.heightAt(x, z) + 0.2;
    const dot = new THREE.Mesh(dotGeo, dotMat); dot.position.set(x, y, z); dot.userData.infraId = inf.id; infra.add(dot);
    const o = label('sc-infra', `<i></i><span>${inf.name}</span>`); o.position.set(x, y, z); o.userData.infraId = inf.id; infra.add(o);
  }
  return { labels, infra };
}

// ---- municipal facility markers (regions with El Niño service infra: EOCs, pumps, substations ...) ----
const FACILITY_KINDS = new Set<Infra['kind']>(['eoc', 'fire_station', 'pump_station', 'substation', 'levee']);
export const FACILITY_COLOR: Partial<Record<Infra['kind'], string>> = {
  hospital: '#ffffff', eoc: '#f5b301', shelter: '#22c55e', pump_station: '#06b6d4', substation: '#facc15', fire_station: '#ea580c', bridge: '#c0362c', airport: '#e5e7eb', levee: '#8b6b4a',
};
const MAJOR = new Set<Infra['kind']>(['eoc', 'bridge']); // always-labelled; the rest show their name on hover (keeps the regional view readable)
function facilityMesh(kind: Infra['kind'], s: number): THREE.Object3D | undefined {
  const g = new THREE.Group();
  const mat = (c: string, e = 0.25) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: e, roughness: 0.55 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, x = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  switch (kind) {
    case 'hospital': { // white pillar with a red cross on top
      add(new THREE.BoxGeometry(0.42 * s, 1.0 * s, 0.42 * s), mat('#ffffff', 0.35), 0.5 * s);
      const red = mat('#dc2626', 0.5);
      add(new THREE.BoxGeometry(0.62 * s, 0.14 * s, 0.18 * s), red, 1.08 * s); add(new THREE.BoxGeometry(0.18 * s, 0.14 * s, 0.62 * s), red, 1.08 * s);
      break;
    }
    case 'eoc': { // gold beacon on a mast
      add(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 1.3 * s, 6), mat('#4a4039', 0), 0.65 * s);
      add(new THREE.OctahedronGeometry(0.32 * s), mat('#f5b301', 0.9), 1.45 * s);
      break;
    }
    case 'shelter': add(new THREE.ConeGeometry(0.38 * s, 0.6 * s, 4), mat('#22c55e', 0.3), 0.3 * s); break; // tent
    case 'pump_station': add(new THREE.CylinderGeometry(0.26 * s, 0.26 * s, 0.5 * s, 12), mat('#06b6d4', 0.4), 0.25 * s); break;
    case 'substation': {
      add(new THREE.BoxGeometry(0.42 * s, 0.32 * s, 0.42 * s), mat('#facc15', 0.45), 0.16 * s);
      add(new THREE.CylinderGeometry(0.03 * s, 0.05 * s, 0.9 * s, 4), mat('#6b7280', 0), 0.6 * s, 0.12 * s, 0.12 * s);
      break;
    }
    case 'fire_station': add(new THREE.BoxGeometry(0.45 * s, 0.45 * s, 0.32 * s), mat('#ea580c', 0.4), 0.22 * s); break;
    case 'bridge': { // two towers
      const m = mat('#c0362c', 0.3);
      add(new THREE.BoxGeometry(0.12 * s, 1.1 * s, 0.12 * s), m, 0.55 * s, -0.22 * s); add(new THREE.BoxGeometry(0.12 * s, 1.1 * s, 0.12 * s), m, 0.55 * s, 0.22 * s);
      break;
    }
    case 'airport': add(new THREE.SphereGeometry(0.26 * s, 12, 8), mat('#e5e7eb', 0.4), 0.26 * s); break;
    case 'levee': add(new THREE.BoxGeometry(0.8 * s, 0.18 * s, 0.22 * s), mat('#8b6b4a', 0.1), 0.09 * s); break;
    default: return undefined; // highway chokepoints: the road ribbons already show them
  }
  return g;
}
function buildFacilities(world: World, infra: THREE.Group) {
  const s = Math.max(0.8, world.cellW * 0.55);
  for (const inf of world.region.infra) {
    const m = facilityMesh(inf.kind, s); if (!m) continue;
    const [x, z] = world.toScene(inf.at); const y = Math.max(world.heightAt(x, z), 0.1);
    m.position.set(x, y, z); m.userData.infraId = inf.id; infra.add(m);
    const major = MAJOR.has(inf.kind);
    const o = label(`sc-fac${major ? '' : ' minor'}`, `<i></i><span style="--fc:${FACILITY_COLOR[inf.kind] ?? '#fff'}">${inf.name}</span>`);
    o.position.set(x, y + (inf.kind === 'eoc' ? 1.7 : 1.2) * s, z); o.userData.infraId = inf.id; infra.add(o);
  }
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c: any) => {
    if (c.isCSS2DObject && c.element?.parentNode) c.element.parentNode.removeChild(c.element);
    if (c.geometry) c.geometry.dispose?.();
    if (c.material) { const ms = Array.isArray(c.material) ? c.material : [c.material]; ms.forEach((m: any) => m.dispose?.()); }
  });
}
