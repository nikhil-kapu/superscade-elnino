// Optional high-detail city model (GLB exported from TerraPrinter: OSM + Copernicus DEM + Overture buildings) used as the
// scene base for a region. The procedural sim terrain stays underneath (hidden) for raycasts and hazard heights; the GLB is
// fitted to its exact geographic selection and recoloured by height/slope (the export is a single-colour print mesh).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { World } from './world';

export interface CityModelSpec {
  url: string;
  bbox: [number, number, number, number]; // [west, south, east, north] of the TerraPrinter selection (stored in the GLB's extras.url `sel=`)
  zUp: boolean;      // 3D-print exports are Z-up millimetres
  ve: number;        // TerraPrinter vertical exaggeration used at export
  baseMm: number;    // print base thickness (mm): base top = sea level
  credit: string;
}

export const CITY_MODELS: Record<string, CityModelSpec> = {
  sanfrancisco: {
    url: '/models/sf.glb',
    bbox: [-122.52588, 37.68627, -122.35911, 37.83379],
    zUp: true, ve: 1.5, baseMm: 1.8677, // measured: flat water surface sits at z = 1.8677 mm in this export
    credit: 'City model made with TerraPrinter (terraprinter.com) · Map data © OpenStreetMap contributors (ODbL) · Elevation: Copernicus DEM GLO-30 (© DLR e.V. & Airbus), Mapzen · Buildings: Overture Maps Foundation',
  },
};

const C = (h: string) => new THREE.Color(h);
const COL = { water: C('#2f74c8'), shore: C('#285a8f'), ground: C('#cfc6b4'), roof: C('#ece7de'), wall: C('#d6cfc3'), hillLo: C('#9fae86'), hillHi: C('#7d8f63') };

/** per-vertex colours from height above the base + how up-facing the surface is (model space, Z up, mm) */
function colorize(geo: THREE.BufferGeometry, spec: CityModelSpec) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute; const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const n = pos.count; const col = new Float32Array(n * 3); const tmp = new THREE.Color();
  const upIdx = spec.zUp ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const h = (spec.zUp ? pos.getZ(i) : pos.getY(i)) - spec.baseMm;
    const up = nor ? Math.abs(nor.array[i * 3 + upIdx] as number) : 1;
    if (up < 0.35) tmp.copy(h < 0.08 ? COL.shore : COL.wall);           // vertical faces: building walls / print edge
    else if (h < 0.03) tmp.copy(COL.water);                            // flat at base level: bay / ocean / lakes
    else if (up > 0.985) tmp.copy(h < 0.35 ? COL.ground : COL.roof);   // flat: streets & lots, or roofs
    else tmp.copy(COL.hillLo).lerp(COL.hillHi, Math.min(1, h / 5));    // slopes: hills, greener with height
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

export async function loadCityModel(world: World, spec: CityModelSpec): Promise<THREE.Group | null> {
  const head = await fetch(spec.url, { method: 'HEAD' }).catch(() => null);
  if (!head || !head.ok || !(head.headers.get('content-type') ?? '').match(/gltf|octet|binary/)) return null;
  const t0 = performance.now();
  const gltf = await new GLTFLoader().loadAsync(spec.url);
  const model = gltf.scene;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    colorize(m.geometry, spec);
    m.material = mat; m.castShadow = false; m.receiveShadow = false; m.raycast = () => {}; // clicks go to the (hidden) sim terrain
  });
  if (spec.zUp) model.rotation.x = -Math.PI / 2; // Z-up print (x east, y north) -> Y-up scene (x east, -z north)
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const [x0, z0] = world.toScene({ lng: spec.bbox[0], lat: spec.bbox[3] }); // NW corner
  const [x1, z1] = world.toScene({ lng: spec.bbox[2], lat: spec.bbox[1] }); // SE corner
  const sx = (x1 - x0) / size.x, sz = (z1 - z0) / size.z;
  // vertical: model mm -> real metres (horizontal metres per mm / export exaggeration) -> scene units via the sim's yScale
  const metresPerMm = ((spec.bbox[3] - spec.bbox[1]) * 111_320) / size.z;
  const sy = (metresPerMm / spec.ve) * world.yScale;
  const inner = new THREE.Group();
  model.position.set(-center.x, -box.min.y, -center.z);
  inner.add(model);
  const g = new THREE.Group();
  g.name = 'city-model';
  g.add(inner);
  g.scale.set(sx, sy, sz);
  g.position.set((x0 + x1) / 2, -spec.baseMm * sy, (z0 + z1) / 2); // base top (sea level) at y = 0
  console.log(`[city-model] ${spec.url} ready in ${Math.round(performance.now() - t0)} ms`, { size: size.toArray().map((v) => +v.toFixed(2)), sx, sy, sz });
  return g;
}
