// Procedural cityscape: instanced building blocks on a street lattice inside every populated cell. Block count follows the
// cell's physical size, building height follows population density (downtown towers, low-rise suburbs), and burning /
// burned-out cells char and collapse their blocks. Purely visual — the sim knows nothing about buildings.
import * as THREE from 'three';
import type { Cell, HazardCell } from '../../../shared/types.ts';
import { World, seeded } from './world';
import type { RoadPoly } from './build';

export interface Buildings { mesh: THREE.InstancedMesh; byCell: Map<number, number[]>; heights: Float32Array; colors: Float32Array; state: Uint8Array /* per cell: 0 ok, 1 burning, 2 burned */; count: number }

const BUDGET = 14000;
const C_OK = new THREE.Color(), C_TOWER = new THREE.Color('#b9c3cc'), C_LOW = new THREE.Color('#d9d2c6'), C_MID = new THREE.Color('#c9c2b8');
const C_BURNING = new THREE.Color('#7a5a48'), C_BURNED = new THREE.Color('#3b332e');

function nearRoad(x: number, z: number, roads: RoadPoly[]): boolean {
  for (const r of roads) {
    const lim = r.halfW + 0.1;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1]; const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); const dx = x - (ax + t * vx), dz = z - (az + t * vz);
      if (dx * dx + dz * dz < lim * lim) return true;
    }
  }
  return false;
}

export function buildBuildings(world: World, cells: Cell[], roads: RoadPoly[] = []): Buildings | undefined {
  const [w, s, e, n] = world.bbox;
  const kmW = ((e - w) * 111.2 * world.cosLat) / world.cols, kmD = ((n - s) * 111.2) / world.rows; // physical cell size
  const areaKm2 = Math.max(0.01, kmW * kmD);
  const bx = Math.max(2, Math.min(7, Math.round(kmW / 0.11))), bz = Math.max(2, Math.min(7, Math.round(kmD / 0.11))); // ~110 m blocks
  const bw = world.cellW / bx, bd = world.cellD / bz;
  const rnd = seeded(4242 + world.cols * 13 + world.rows * 7);
  const exagg = 1.5; // buildings read better slightly taller than true scale on a 3D map
  const spots: { x: number; z: number; sx: number; sz: number; h: number; cell: number; tower: boolean; dens: number }[] = [];
  for (const c of cells) {
    if (c.terrain === 'water' || c.terrain === 'hills' || !c.pop) continue;
    const dens = c.pop / areaKm2; // people per km²
    if (dens < 600) continue;
    const k = c.j * world.cols + c.i;
    const [cx, cz] = world.cellCenter(c.i, c.j);
    const floorsBase = dens < 2500 ? 1.6 : dens < 6000 ? 3 : dens < 12000 ? 5 : 11;
    const pSkip = dens < 2500 ? 0.35 : dens < 6000 ? 0.14 : 0.07; // parks, lots, yards
    for (let a = 0; a < bx; a++) for (let b = 0; b < bz; b++) {
      if (rnd() < pSkip) continue;
      const x = cx - world.cellW / 2 + (a + 0.5) * bw + (rnd() - 0.5) * bw * 0.12;
      const z = cz - world.cellD / 2 + (b + 0.5) * bd + (rnd() - 0.5) * bd * 0.12;
      if (world.kindAt(x, z) === 'water') continue;
      if (roads.length && nearRoad(x, z, roads)) continue; // streets stay streets
      const r = rnd();
      const tower = dens >= 6000 && r < (dens >= 12000 ? 0.12 : 0.03);
      let floors = floorsBase * (0.55 + 1.2 * r * r);
      if (tower) floors = floorsBase * (2.2 + 2.5 * rnd());
      const metres = floors * 3.4;
      const h = Math.max(0.1, metres * world.yScale * exagg);
      spots.push({ x, z, sx: bw * (0.58 + 0.18 * rnd()), sz: bd * (0.58 + 0.18 * rnd()), h, cell: k, tower, dens });
    }
  }
  if (!spots.length) return undefined;
  while (spots.length > BUDGET) spots.splice(Math.floor(rnd() * spots.length), 1);
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0); // origin at the base
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0.02, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length); mesh.name = 'buildings'; mesh.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const byCell = new Map<number, number[]>(); const heights = new Float32Array(spots.length); const colors = new Float32Array(spots.length * 3);
  spots.forEach((sp, idx) => {
    const y = world.heightAt(sp.x, sp.z) - 0.12; // sink the base a little so blocks hug slopes
    p.set(sp.x, y, sp.z); sc.set(sp.sx, sp.h + 0.12, sp.sz); q.identity(); m.compose(p, q, sc); mesh.setMatrixAt(idx, m);
    const base = sp.tower ? C_TOWER : sp.dens >= 6000 ? C_MID : C_LOW;
    const v = 0.9 + 0.2 * ((idx * 7919) % 97) / 97; C_OK.copy(base).multiplyScalar(v);
    mesh.setColorAt(idx, C_OK); colors.set([C_OK.r, C_OK.g, C_OK.b], idx * 3); heights[idx] = sp.h + 0.12;
    let arr = byCell.get(sp.cell); if (!arr) byCell.set(sp.cell, (arr = [])); arr.push(idx);
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, byCell, heights, colors, state: new Uint8Array(world.cols * world.rows), count: spots.length };
}

/** Char burning cells, collapse burned-out ones, restore anything that recovered (time scrubbing). */
export function setBuildingsHazard(b: Buildings, world: World, hazards: HazardCell[]) {
  const next = new Uint8Array(b.state.length);
  for (const h of hazards) { const k = h.j * world.cols + h.i; if (h.kind === 'burn' && h.intensity > 0.3) next[k] = 2; else if (h.kind === 'fire' && h.intensity > 0.25 && next[k] !== 2) next[k] = 1; }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(); const col = new THREE.Color();
  let changed = false;
  for (let k = 0; k < next.length; k++) {
    if (next[k] === b.state[k]) continue;
    const idxs = b.byCell.get(k); if (!idxs) continue;
    for (const idx of idxs) {
      b.mesh.getMatrixAt(idx, m); m.decompose(p, q, sc);
      sc.y = next[k] === 2 ? Math.max(0.08, b.heights[idx] * 0.3) : b.heights[idx]; m.compose(p, q, sc); b.mesh.setMatrixAt(idx, m);
      if (next[k] === 2) col.copy(C_BURNED); else if (next[k] === 1) col.copy(C_BURNING); else col.setRGB(b.colors[idx * 3], b.colors[idx * 3 + 1], b.colors[idx * 3 + 2]);
      b.mesh.setColorAt(idx, col); changed = true;
    }
  }
  b.state = next;
  if (changed) { b.mesh.instanceMatrix.needsUpdate = true; if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true; }
}
