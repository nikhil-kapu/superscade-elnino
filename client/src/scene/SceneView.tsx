import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Cell, HazardCell, LngLat, RegionConfig, SimSnapshot } from '../../../shared/types.ts';
import { useStore, agentColor, type LiveAgent } from '../store';
import { fetchCells } from '../api';
import { agentCode } from '../map/MapView';
import { PAL, World } from './world';
import { buildContext, buildFaults, buildPlaces, buildRivers, buildRoads, buildSea, buildTerrain, buildTrees, disposeObject, label, roadPolylines, setTreesHidden, type Terrain, type Trees } from './build';
import { Discs, SpreadPath, TriggerMarker, applyTints, buildDams, buildQuakeRings, burstRing, triggerText, type Effect } from './hazards';
import { buildBuildings, setBuildingsHazard, type Buildings } from './buildings';
import { FloodAnim, FlowParticles, Obstacles, RiverFlow, infoPill, riverPulse, splashRing } from './flow';
import { CITY_MODELS, loadCityModel } from './cityModel';

interface Rig {
  renderer: THREE.WebGLRenderer; css: CSS2DRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  root: THREE.Group; world?: World; terrain?: Terrain; trees?: Trees; buildings?: Buildings; context?: THREE.Group; faults?: THREE.Group; sea?: THREE.Mesh; rivers?: THREE.Group; roads?: THREE.Group; places?: THREE.Group; infra?: THREE.Group; city?: THREE.Group;
  flood?: FloodAnim; riverFlow?: RiverFlow; particles?: FlowParticles; obstacles?: Obstacles; lastFrame: number; slides?: Discs; fire?: Discs; fireLights: THREE.PointLight[]; quake?: THREE.Group; dams?: THREE.Group; spread?: SpreadPath; trigger: TriggerMarker;
  agents: THREE.Group; agentObjs: Map<string, { stem: THREE.Line; pill: ReturnType<typeof label>; link?: THREE.Line; top: THREE.Vector3 }>;
  effects: Effect[]; hiddenCells: Set<number>; lastTick?: number; lastSnapRef?: SimSnapshot; lastSpreadKey?: string; lastEventId: number; tweens: { t0: number; dur: number; step(t: number): void }[];
}

const AGENT_ROLES = new Set(['chief', 'district', 'verifier']);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export default function SceneView() {
  const ref = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const [mode3d, setMode3d] = useState(true);
  const [loading, setLoading] = useState(true);
  const regionId = useStore((s) => s.regionId);
  const regions = useStore((s) => s.regions);

  // ---- renderer / camera / lights (once) ----
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const css = new CSS2DRenderer(); css.setSize(el.clientWidth, el.clientHeight);
    Object.assign(css.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' } as CSSStyleDeclaration); el.appendChild(css.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(PAL.bg); scene.fog = new THREE.Fog(PAL.bg, 120, 260);
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 0.5, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotate = true; controls.autoRotateSpeed = 0.35; controls.addEventListener('start', () => { controls.autoRotate = false; }); controls.maxPolarAngle = 1.42; controls.minPolarAngle = 0.05; controls.minDistance = 8; controls.maxDistance = 320; controls.screenSpacePanning = false;
    scene.add(new THREE.HemisphereLight('#fff4e6', '#8a7a66', 1.15));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.2); sun.position.set(-70, 90, 70); scene.add(sun);
    const fill = new THREE.DirectionalLight('#dbe7ff', 0.45); fill.position.set(60, 40, -80); scene.add(fill);
    const root = new THREE.Group(); scene.add(root);
    const trigger = new TriggerMarker(); root.add(trigger.group);
    const agents = new THREE.Group(); agents.name = 'agents'; root.add(agents);
    const fireLights = Array.from({ length: 6 }, () => { const l = new THREE.PointLight('#ff7a1a', 0, 9, 2); root.add(l); return l; });
    const r: Rig = { renderer, css, scene, camera, controls, root, trigger, agents, agentObjs: new Map(), effects: [], hiddenCells: new Set(), fireLights, lastEventId: Number.MAX_SAFE_INTEGER, tweens: [], lastFrame: 0 };
    rig.current = r;

    // click → place trigger (raycast on terrain), ignore drags
    let down: [number, number] | undefined;
    const ray = new THREE.Raycaster();
    renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; down = undefined;
      const s = useStore.getState(); if (s.running || !r.terrain || !r.world) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hit = ray.intersectObject(r.terrain.mesh, false)[0]; if (!hit) return;
      const local = r.root.worldToLocal(hit.point.clone());
      s.setClickAt(r.world.toLngLat(local.x, local.z));
    });
    const onResize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); css.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); r.spread?.setResolution(w, h); };
    const ro = new ResizeObserver(onResize); ro.observe(el);

    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, r.lastFrame ? (t - r.lastFrame) / 1000 : 0.016); r.lastFrame = t;
      if (controls.autoRotate && (useStore.getState().running || useStore.getState().runId)) controls.autoRotate = false; // the idle orbit stops once an incident starts
      controls.update();
      r.trigger.tick(t);
      // water motion
      const fl = useStore.getState().layers.flood.on;
      r.riverFlow?.tick(dt); r.flood?.tick(t, fl); r.particles?.tick(t, dt); if (r.particles) r.particles.points.visible = fl || !!r.riverFlow;
      // tweens
      r.tweens = r.tweens.filter((tw) => { const k = Math.min(1, (t - tw.t0) / tw.dur); tw.step(ease(k)); return k < 1; });
      // transient effects
      r.effects = r.effects.filter((fx) => { const k = (t - fx.t0) / fx.dur; if (k >= 1) { r.root.remove(fx.obj); disposeObject(fx.obj); return false; } fx.step(k); return true; });
      if (r.quake) r.quake.children.forEach((c, i) => { const s = 1 + 0.025 * Math.sin(t / 500 + i); c.scale.set(s, 1, s); });
      if (r.fire) (r.fire.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.7 + 0.5 * Math.sin(t / 180);
      renderer.render(scene, camera); css.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      clearWorld(r); r.trigger.dispose(); disposeObject(r.agents); r.fireLights.forEach((l) => l.dispose());
      renderer.dispose(); renderer.domElement.remove(); css.domElement.remove(); rig.current = null;
    };
  }, []);

  // ---- world (region) build ----
  useEffect(() => {
    const r = rig.current; const region = regions.find((x) => x.id === regionId); if (!r || !region) return;
    let alive = true; setLoading(true);
    (async () => {
      const cells = await fetchCells(region); if (!alive || !rig.current) return;
      clearWorld(r); buildWorld(r, region, cells); frameCamera(r, true); setLoading(false);
      syncAll(r, useStore.getState(), true);
    })();
    return () => { alive = false; };
  }, [regionId, regions]);

  // ---- store → scene ----
  useEffect(() => {
    const unsub = useStore.subscribe((s) => { const r = rig.current; if (r?.world) syncAll(r, s, false); });
    return unsub;
  }, []);

  const toggleMode = () => {
    const r = rig.current; if (!r) return; const next = !mode3d; setMode3d(next);
    const sph = new THREE.Spherical().setFromVector3(r.camera.position.clone().sub(r.controls.target));
    const from = sph.phi, to = next ? 0.96 : 0.08, fromR = sph.radius, toR = next ? Math.max(fromR, 90) : Math.max(fromR, 130);
    r.tweens.push({ t0: performance.now(), dur: 800, step: (k) => { sph.phi = lerp(from, to, k); sph.radius = lerp(fromR, toR, k); r.camera.position.setFromSpherical(sph).add(r.controls.target); r.camera.lookAt(r.controls.target); } });
  };

  return (
    <div className="scene-root" ref={ref}>
      {loading && <div className="scene-loading">Building terrain…</div>}
      <div className="scene-legend" aria-label="Map legend">
        {([['#a3917a', 'Hills / open land'], ['#b5b2ac', 'Built-up ground'], ['#d9c9a8', 'Lowland & bay fill'], ['#e3d7bd', 'Coast & dunes'], ['#6f98c8', 'Water'], ['#4a4039', 'Highway'], ['#d9d2c6', 'Buildings'], ['#3f5f33', 'Trees'], ['#3a2b25', 'Burn scar'], ['#b9a3e6', 'Shaking']] as const).map(([c, t]) => <span key={t}><i style={{ background: c }} />{t}</span>)}
      </div>
      <div className="scene-controls">
        <button className={'sc-btn' + (!mode3d ? ' active' : '')} onClick={() => mode3d && toggleMode()}>2D</button>
        <button className={'sc-btn' + (mode3d ? ' active' : '')} onClick={() => !mode3d && toggleMode()}>3D</button>
        <button className="sc-btn" title="Reset view" onClick={() => rig.current && frameCamera(rig.current, false)}>⌂</button>
      </div>
    </div>
  );
}

// =====================================================================
function clearWorld(r: Rig) {
  for (const k of ['terrain', 'trees', 'buildings', 'context', 'faults', 'sea', 'rivers', 'roads', 'places', 'infra', 'quake', 'dams', 'city'] as const) {
    const o: any = (r as any)[k]; if (!o) continue; const obj: THREE.Object3D = o.mesh ?? o; r.root.remove(obj); disposeObject(obj); (r as any)[k] = undefined;
  }
  r.flood?.dispose(); r.flood = undefined; r.riverFlow?.dispose(); r.riverFlow = undefined; if (r.particles) { r.root.remove(r.particles.points); r.particles.dispose(); r.particles = undefined; } if (r.obstacles) { r.root.remove(r.obstacles.group); r.obstacles.dispose(); r.obstacles = undefined; } r.slides?.dispose(); r.slides = undefined; r.fire?.dispose(); r.fire = undefined; r.spread?.dispose(); r.spread = undefined;
  r.effects.forEach((fx) => { r.root.remove(fx.obj); disposeObject(fx.obj); }); r.effects = [];
  r.agentObjs.forEach((a) => { r.agents.remove(a.stem, a.pill); if (a.link) r.agents.remove(a.link); disposeObject(a.stem); disposeObject(a.pill); if (a.link) disposeObject(a.link); }); r.agentObjs.clear();
  r.renderer.domElement.parentElement?.querySelector('.city-credit')?.remove();
  r.hiddenCells = new Set(); r.lastTick = undefined; r.lastSnapRef = undefined; r.lastSpreadKey = undefined; r.world = undefined;
}

function buildWorld(r: Rig, region: RegionConfig, cells: Cell[]) {
  const world = new World(region, cells, 1); r.world = world;
  r.terrain = buildTerrain(world); r.root.add(r.terrain.mesh);
  r.sea = buildSea(world); if (r.sea) r.root.add(r.sea);
  r.context = buildContext(world); if (r.context) r.root.add(r.context);
  r.faults = buildFaults(world); r.root.add(r.faults);
  r.rivers = buildRivers(world); r.root.add(r.rivers);
  r.roads = buildRoads(world); r.root.add(r.roads);
  r.trees = buildTrees(world); r.root.add(r.trees.mesh);
  r.buildings = buildBuildings(world, cells, roadPolylines(world)); if (r.buildings) r.root.add(r.buildings.mesh);
  const pl = buildPlaces(world); r.places = pl.labels; r.infra = pl.infra; r.root.add(pl.labels, pl.infra);
  r.flood = new FloodAnim(world, r.terrain); r.root.add(r.flood.mesh, r.flood.rim);
  r.riverFlow = new RiverFlow(world, r.rivers);
  r.particles = new FlowParticles(world, r.riverFlow, r.flood); r.root.add(r.particles.points);
  r.obstacles = new Obstacles(world, r.riverFlow); r.root.add(r.obstacles.group);
  r.slides = new Discs(world, PAL.slide, 400, { radius: world.cellW * 0.42, streaks: true }); r.root.add(r.slides.mesh, r.slides.streaks!);
  r.fire = new Discs(world, PAL.fire, 900, { radius: world.cellW * 0.46, emissive: 2 }); r.root.add(r.fire.mesh);
  r.spread = new SpreadPath(world, new THREE.Vector2(r.renderer.domElement.clientWidth, r.renderer.domElement.clientHeight)); r.root.add(r.spread.group);
  r.scene.fog = new THREE.Fog(PAL.bg, world.W * (r.context ? 2.6 : 1.7), world.W * (r.context ? 5.2 : 3.6));
  // optional high-detail city model (TerraPrinter GLB) replaces the procedural ground; the sim terrain stays for raycasts + hazard heights
  const spec = CITY_MODELS[region.id];
  if (spec) void loadCityModel(world, spec).then((g) => {
    if (!g) return;
    if (r.world !== world) { disposeObject(g); return; }
    r.city = g; r.root.add(g);
    if (r.terrain) (r.terrain.mesh.material as THREE.Material).visible = false;
    const host = r.renderer.domElement.parentElement;
    if (host && !host.querySelector('.city-credit')) { const d = document.createElement('div'); d.className = 'city-credit'; d.textContent = spec.credit; host.appendChild(d); }
    syncAll(r, useStore.getState(), false);
    frameCamera(r, false); // glide in on the detailed city
  }).catch((e) => console.warn('[city-model] failed to load', e));
}

function frameCamera(r: Rig, instant: boolean) {
  const w = r.world; if (!w) return;
  const target = new THREE.Vector3(0, 1.5, r.context ? w.D * 0.14 : 0); // with surroundings drawn, centre a little south so the city sits above the start card
  const span = Math.max(w.W, w.D * 0.85);
  const dist = span * (r.context ? 1.42 : 1.3) * (r.city ? 0.72 : 1); // closer in when a detailed city model is loaded
  const polar = 0.96, az = -Math.PI / 4 + 0.15; // from the south-west, ~55° tilt
  const pos = new THREE.Vector3().setFromSphericalCoords(dist, polar, az).add(target);
  r.tweens = [];
  if (instant) { r.controls.target.copy(target); r.camera.position.copy(pos); r.camera.lookAt(target); return; }
  const t0 = r.controls.target.clone(), p0 = r.camera.position.clone();
  r.tweens.push({ t0: performance.now(), dur: 900, step: (k) => { r.controls.target.lerpVectors(t0, target, k); r.camera.position.lerpVectors(p0, pos, k); r.camera.lookAt(r.controls.target); } });
}

function flyTo(r: Rig, at: LngLat, zoom?: number) {
  const w = r.world; if (!w) return;
  const [x, z] = w.toScene(at); if (Math.abs(x) > w.W * 0.6 || Math.abs(z) > w.D * 0.6) return; // target belongs to another region (world still loading)
  const target = new THREE.Vector3(x, w.heightAt(x, z) + 1, z);
  const off = r.camera.position.clone().sub(r.controls.target); const sph = new THREE.Spherical().setFromVector3(off);
  const r0 = sph.radius, r1 = Math.min(r0, zoom && zoom >= 11.5 ? w.W * 0.42 : w.W * 0.6);
  const t0 = r.controls.target.clone();
  r.tweens.push({ t0: performance.now(), dur: 1200, step: (k) => { sph.radius = lerp(r0, r1, k); r.controls.target.lerpVectors(t0, target, k); r.camera.position.setFromSpherical(sph).add(r.controls.target); r.camera.lookAt(r.controls.target); } });
}

// ---- sync store → scene ----
let lastFly = -1;
function syncAll(r: Rig, s: ReturnType<typeof useStore.getState>, force: boolean) {
  const w = r.world; if (!w) return;
  const L = s.layers;
  // layer visibility (cheap)
  r.root.scale.y = L.terrain.on ? 1 : 0.12;
  if (r.trees) r.trees.mesh.visible = L.infra.on || L.terrain.on; if (r.infra) r.infra.visible = L.infra.on; if (r.roads) r.roads.visible = L.infra.on;
  if (r.places) r.places.visible = L.labels.on;
  if (r.buildings) r.buildings.mesh.visible = (L.buildings?.on ?? true) && (L.terrain.on || L.infra.on);
  if (r.obstacles) r.obstacles.group.visible = L.infra.on;
  if (r.slides) { r.slides.mesh.visible = L.landslide.on; r.slides.streaks!.visible = L.landslide.on; }
  if (r.fire) r.fire.mesh.visible = L.fire.on; r.fireLights.forEach((l) => (l.visible = L.fire.on));
  if (r.dams) r.dams.visible = L.dams.on; if (r.quake) r.quake.visible = L.shaking.on; if (r.spread) r.spread.group.visible = L.spread.on;
  r.agents.visible = L.agents.on; if (r.rivers) r.rivers.visible = L.lines.on || true; if (r.faults) r.faults.visible = L.lines.on;
  if (r.city) { r.city.visible = L.terrain.on || L.buildings?.on !== false; if (r.trees) r.trees.mesh.visible = false; if (r.buildings) r.buildings.mesh.visible = false; if (r.roads) r.roads.visible = false; }

  // trigger marker
  const sc = s.scenario; const at = sc?.trigger.at ?? s.clickAt;
  r.trigger.set(w, at, triggerText(sc), sc?.trigger.kind ?? 'none');

  // hazards: only when the viewed snapshot changes
  const snap = s.viewTick === 'live' ? s.snapshot : (s.snapshots.find((x) => x.tick === s.viewTick) ?? s.snapshot);
  const hz: HazardCell[] = snap?.hazards ?? [];
  if (force || snap !== r.lastSnapRef || r.lastTick !== snap?.tick) {
    r.lastSnapRef = snap; r.lastTick = snap?.tick;
    const now = performance.now();
    if (r.flood) { r.flood.setTrigger(sc?.trigger.at); r.flood.setSnapshot(hz, now); r.riverFlow?.setFlood(r.flood.cur); r.particles?.setFlood(r.flood.cur); }
    if (r.obstacles && snap) for (const f of r.obstacles.update(snap.infra)) {
      const ring = splashRing(w, f.x, f.z, now); r.root.add(ring.obj); r.effects.push(ring);
      r.particles?.burst(f.x, f.z, 60);
      const pill = infoPill(w, f.x, f.z, `${f.infra.name} · ${f.status}`, now); r.root.add(pill.obj); r.effects.push(pill);
    }
    r.slides?.update(hz.filter((h) => h.kind === 'landslide'), 0.05);
    const fires = hz.filter((h) => h.kind === 'fire').sort((a, b) => b.intensity - a.intensity);
    r.fire?.update(fires, 0.12);
    r.fireLights.forEach((l, i) => { const f = fires[i]; if (f) { const [x, z] = w.cellCenter(f.i, f.j); l.position.set(x, w.heightAt(x, z) + 1.6, z); l.intensity = 18 * f.intensity; } else l.intensity = 0; });
    applyTints(r.terrain!, w, hz, L.burn.on, L.shaking.on);
    if (r.buildings) setBuildingsHazard(r.buildings, w, hz);
    if (r.trees) { const hidden = new Set<number>(); for (const h of hz) if ((h.kind === 'burn' || h.kind === 'flood') && h.intensity > 0.3) hidden.add(h.j * w.cols + h.i); setTreesHidden(r.trees, hidden, r.hiddenCells); r.hiddenCells = hidden; }
    if (r.quake) { r.root.remove(r.quake); disposeObject(r.quake); r.quake = undefined; }
    if (sc?.trigger.kind === 'quake' && hz.some((h) => h.kind === 'quake')) { r.quake = buildQuakeRings(w, sc.trigger.at, hz); r.quake.visible = L.shaking.on; r.root.add(r.quake); }
    if (r.dams) { r.root.remove(r.dams); disposeObject(r.dams); r.dams = undefined; }
    if (hz.some((h) => h.kind === 'dam')) { r.dams = buildDams(w, hz); r.dams.visible = L.dams.on; r.root.add(r.dams); }
  }
  // spread path: trigger → centroid per tick up to the viewed tick
  const upTo = snap?.tick ?? -1; const key = `${s.runId}:${upTo}:${s.snapshots.length}`;
  if (r.spread && (force || key !== r.lastSpreadKey)) {
    r.lastSpreadKey = key;
    const kind: HazardCell['kind'] = sc?.trigger.kind === 'rain' ? 'flood' : 'fire';
    r.spread.update(sc?.trigger.at, s.snapshots.filter((x) => x.tick <= upTo), kind);
  }
  // dam-burst events → expanding ring
  if (s.events.length) {
    const newest = s.events[0].id;
    if (r.lastEventId === Number.MAX_SAFE_INTEGER) r.lastEventId = newest;
    else if (newest > r.lastEventId) {
      for (const e of s.events) { if (e.id <= r.lastEventId) break; if (e.kind === 'dam' && e.at && /burst|breach|fail|overtop|surge/i.test(e.text)) { const now = performance.now(); const fx = burstRing(w, e.at, now); r.root.add(fx.obj); r.effects.push(fx); const [px, pz] = w.toScene(e.at); const pulse = r.riverFlow && riverPulse(w, r.riverFlow, px, pz, now); if (pulse) { r.root.add(pulse.obj); r.effects.push(pulse); } if (r.particles) { r.particles.boost = 2.2; r.particles.boostUntil = now + 2500; } if (r.riverFlow) { r.riverFlow.boost = 2.5; setTimeout(() => { if (r.riverFlow) r.riverFlow.boost = 1; }, 2500); } } }
      r.lastEventId = newest;
    }
  }
  // agents
  syncAgents(r, s.agents, s.selectedAgentId);
  // fly
  if (s.flyTo && s.flyTo.n !== lastFly) { lastFly = s.flyTo.n; if (!force) flyTo(r, s.flyTo.at, s.flyTo.zoom); }
}

function syncAgents(r: Rig, agents: Map<string, LiveAgent>, selected?: string) {
  const w = r.world!; const seen = new Set<string>();
  const chief = [...agents.values()].find((a) => a.role === 'chief');
  const tops = new Map<string, THREE.Vector3>(); let n = 0;
  agents.forEach((a) => {
    if (!AGENT_ROLES.has(a.role) && a.id !== selected) return;
    seen.add(a.id); n++;
    const [x, z] = w.toScene(a.at); const h = w.heightAt(x, z); const lift = (a.role === 'chief' ? 8.5 : a.role === 'verifier' ? 3.2 : 5.4) + (a.role === 'chief' ? 0 : (n % 3) * 0.9);
    const top = new THREE.Vector3(x, h + lift, z); tops.set(a.id, top);
    let o = r.agentObjs.get(a.id);
    if (!o) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, h, z), top]);
      const stem = new THREE.Line(g, new THREE.LineBasicMaterial({ color: agentColor(a), transparent: true, opacity: 0.85 }));
      const pill = label('agent-marker in', '<div class="agent-pill"><i class="agent-dot"></i><span class="agent-code"></span><span class="agent-sub"></span></div>'); pill.position.copy(top);
      pill.element.addEventListener('click', () => useStore.getState().selectAgent(a.id)); (pill.element as HTMLElement).style.pointerEvents = 'auto';
      o = { stem, pill, top }; r.agentObjs.set(a.id, o); r.agents.add(stem, pill);
    }
    const el = pill_el(o.pill); el.dataset.status = a.status; el.dataset.depth = String(Math.min(a.depth, 2)); el.dataset.role = a.role; el.style.setProperty('--c', agentColor(a)); el.classList.toggle('selected', selected === a.id);
    (el.querySelector('.agent-code') as HTMLElement).textContent = agentCode(a);
    (el.querySelector('.agent-sub') as HTMLElement).textContent = a.role === 'verifier' ? (a.status === 'rejected' ? 'REJECT' : a.status === 'done' ? 'ACCEPT' : 'auditing') : a.role === 'district' && a.status === 'rejected' ? 'rejected' : '';
    (o.stem.material as THREE.LineBasicMaterial).color.set(agentColor(a));
  });
  // connectors district → chief
  r.agentObjs.forEach((o, id) => {
    if (!seen.has(id)) { r.agents.remove(o.stem, o.pill); if (o.link) r.agents.remove(o.link); disposeObject(o.stem); disposeObject(o.pill); if (o.link) disposeObject(o.link); r.agentObjs.delete(id); return; }
    const a = agents.get(id)!; const ct = chief && tops.get(chief.id);
    if (a.role === 'district' && ct && !o.link) {
      const g = new THREE.BufferGeometry().setFromPoints([o.top, ct]);
      o.link = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#2b2622', transparent: true, opacity: 0.35 })); r.agents.add(o.link);
    }
  });
}
const pill_el = (o: ReturnType<typeof label>) => o.element as HTMLElement;
