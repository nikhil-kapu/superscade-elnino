// Agent team choreography: spawn pops + growing connectors, thinking traffic, verdict bubbles, plans materialising, stranded counters.
import * as THREE from 'three';
import type { DistrictPlan, HazardCell, LngLat, RegionConfig, RoutePlan, SimSnapshot } from '../../../shared/types.ts';
import { agentColor, shortModel, type LiveAgent, type VerdictRow } from '../store';
import { agentCode } from '../map/MapView';
import { World } from './world';
import { disposeObject, label } from './build';
import { dotTexture } from './flow';

const SHOW = new Set(['chief', 'district', 'verifier']);
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Node { a: LiveAgent; pos: THREE.Vector3; pill: ReturnType<typeof label>; stem: THREE.Line; link?: { line: THREE.Line; from: THREE.Vector3; to: THREE.Vector3; born: number; settled: boolean }; born: number; shown: boolean; nextPacket: number; rejects: number }
interface Packet { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number; color: [number, number, number]; arc: number }
interface Timed { obj: THREE.Object3D; until: number; step?: (k: number) => void; t0: number }
interface Unit { mesh: THREE.Object3D; curve: THREE.CatmullRomCurve3; speed: number; phase: number; mode: RoutePlan['mode']; rotor?: THREE.Object3D }
interface Crew { mesh: THREE.Mesh; target: [number, number]; cell: string; speed: number }

export class AgentLayer {
  group = new THREE.Group(); nodes = new Map<string, Node>(); private packets: Packet[] = []; private pts: THREE.Points; private ppos: Float32Array; private pcol: Float32Array; private MAXP = 600;
  private timed: Timed[] = []; private lastVerdict = 0; private plansSeen = new Set<string>(); private routes: THREE.Line[] = []; private units: Unit[] = []; private crews: Crew[] = [];
  private counters = new Map<string, { el: HTMLElement; shown: number; target: number; peak: number }>();
  private evacRoutes: { curve: THREE.CatmullRomCurve3; districtId: string }[] = []; private nextEvac = 0; private strandedPrev = new Map<string, number>();
  extinguished = new Set<string>(); onExtinguish?: () => void;
  private tex = dotTexture();
  constructor(private world: World, private region: RegionConfig, private places: THREE.Group) {
    this.group.name = 'agent-layer';
    this.ppos = new Float32Array(this.MAXP * 3); this.pcol = new Float32Array(this.MAXP * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.ppos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.pcol, 3)); g.setDrawRange(0, 0);
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.75, map: this.tex, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.pts.renderOrder = 9; this.pts.frustumCulled = false; this.group.add(this.pts);
  }
  private scenePos(at: LngLat, lift: number) { const [x, z] = this.world.toScene(at); return new THREE.Vector3(x, this.world.heightAt(x, z) + lift, z); }
  private line(from: THREE.Vector3, to: THREE.Vector3, color: string, opacity: number): THREE.Line {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), from.clone()]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })); l.renderOrder = 8; return l;
  }
  private burst(pos: THREE.Vector3, cls: string, text: string, now: number, dur = 900) {
    const o = label('sc-burst ' + cls, text); o.position.copy(pos); this.group.add(o); this.timed.push({ obj: o, until: now + dur, t0: now });
  }
  private bubble(pos: THREE.Vector3, cls: string, html: string, now: number, dur = 5000) {
    const o = label('sc-bubble ' + cls, html); o.position.copy(pos).add(new THREE.Vector3(0, 2.4, 0)); this.group.add(o);
    this.timed.push({ obj: o, until: now + dur, t0: now, step: (k) => { (o.element as HTMLElement).style.opacity = String(k > 0.85 ? (1 - k) / 0.15 : 1); } });
  }

  // ---------------- sync ----------------
  sync(agents: Map<string, LiveAgent>, verdicts: VerdictRow[], plans: Map<string, DistrictPlan>, snap: SimSnapshot | undefined, selected: string | undefined, now: number) {
    const seen = new Set<string>();
    const chief = [...agents.values()].find((a) => a.role === 'chief');
    const chiefNode = chief && this.nodes.get(chief.id);
    // district agents first (helpers/verifiers position relative to them)
    const order = [...agents.values()].sort((a, b) => a.depth - b.depth);
    const sibIndex = new Map<string, number>();
    for (const a of order) {
      const isHelper = !SHOW.has(a.role);
      if (isHelper && a.role !== 'research' && a.role !== 'reflector' && !a.parentId) continue;
      if (a.role === 'reflector') continue;
      seen.add(a.id);
      let n = this.nodes.get(a.id);
      if (!n) {
        const parent = a.parentId ? this.nodes.get(a.parentId) : undefined;
        let pos: THREE.Vector3;
        if (a.role === 'chief') pos = this.scenePos(a.at, 9);
        else if (a.role === 'district') pos = this.scenePos(a.at, 5.6);
        else if (a.role === 'verifier') { pos = parent ? parent.pos.clone().add(new THREE.Vector3(this.world.cellW * 1.6, -0.9, 0.4)) : this.scenePos(a.at, 3.4); }
        else { // helpers fan out radially around their district pill
          const k = sibIndex.get(a.parentId ?? '') ?? 0; sibIndex.set(a.parentId ?? '', k + 1);
          const ang = -Math.PI / 2 + k * (Math.PI * 2 / 5) + 0.4; const r = this.world.cellW * 1.25;
          pos = parent ? parent.pos.clone().add(new THREE.Vector3(Math.cos(ang) * r, -1.4 - (k % 2) * 0.5, Math.sin(ang) * r * 0.7)) : this.scenePos(a.at, 3);
        }
        const base = new THREE.Vector3(pos.x, this.world.heightAt(pos.x, pos.z), pos.z);
        const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, pos]), new THREE.LineBasicMaterial({ color: agentColor(a), transparent: true, opacity: isHelper ? 0.35 : 0.7, depthTest: false })); stem.renderOrder = 8; stem.visible = false;
        const pill = label('agent-marker', `<div class="agent-pill"><i class="agent-dot"></i><div class="agent-text"><span class="agent-code"></span><span class="agent-model"></span></div><span class="agent-sub"></span></div>`); pill.position.copy(pos);
        (pill.element as HTMLElement).style.pointerEvents = 'none';
        n = { a, pos, pill, stem, born: now, shown: false, nextPacket: now + 300, rejects: 0 }; this.nodes.set(a.id, n); this.group.add(stem, pill);
        const from = parent?.pos ?? (a.role !== 'chief' && chiefNode ? chiefNode.pos : undefined);
        if (from) { const l = this.line(from, pos, agentColor(a), 1); n.link = { line: l, from: from.clone(), to: pos.clone(), born: now, settled: false }; this.group.add(l); }
        else { this.reveal(n, now); if (a.role === 'chief') { this.burst(pos, 'gold', '', now, 1200); } }
      }
      // status transitions
      const prev = n.a; n.a = a;
      if (prev.status !== a.status && a.status === 'thinking' && (prev.status === 'rejected') && a.role === 'district') n.rejects++;
      this.updatePill(n, selected, now);
      if (a.status === 'thinking' && n.shown && n.link && now >= n.nextPacket) { n.nextPacket = now + 400; this.packets.push({ from: n.link.from, to: n.link.to, t0: now, dur: 700, color: a.role === 'verifier' ? [1, 0.55, 0.2] : [1, 0.85, 0.35], arc: 0.6 }); }
    }
    // remove gone
    this.nodes.forEach((n, id) => { if (!seen.has(id)) { this.group.remove(n.stem, n.pill); if (n.link) { this.group.remove(n.link.line); disposeObject(n.link.line); } disposeObject(n.stem); disposeObject(n.pill); this.nodes.delete(id); } });
    // verdicts (newest first)
    const fresh = verdicts.filter((v) => v.id > this.lastVerdict).reverse();
    if (verdicts.length) this.lastVerdict = Math.max(this.lastVerdict, verdicts[0].id);
    for (const v of fresh) {
      const ver = agents.get(v.agentId); const did = v.verdict.districtId ?? ver?.districtId;
      const dn = [...this.nodes.values()].find((n) => n.a.role === 'district' && n.a.districtId === did) ?? (ver?.parentId ? this.nodes.get(ver.parentId) : undefined);
      if (!dn) continue;
      const el = dn.pill.element as HTMLElement;
      if (!v.verdict.accepted) {
        el.classList.add('shake', 'flash-red'); setTimeout(() => el.classList.remove('shake', 'flash-red'), 450);
        this.burst(dn.pos, 'red', '✕', now);
        this.bubble(dn.pos, 'reject', `<b>REJECTED</b> · ${esc(v.verdict.reasons[0] ?? 'plan failed verification')}`, now);
      } else {
        const plan = plans.get(dn.a.id); const sh = plan?.shelters?.[0] && this.region.infra.find((i) => i.id === plan.shelters[0])?.name;
        const cap = plan?.routes.reduce((s, r) => s + (r.capacity || 0), 0) ?? 0;
        const detail = plan ? `${plan.routes.length} route${plan.routes.length === 1 ? '' : 's'}${cap ? ` · ${cap}/tick` : ''}${sh ? ` · ${esc(sh)}` : ''}${plan.airlift ? ' · airlift' : ''}` : esc(v.verdict.reasons[0] ?? 'plan verified');
        this.burst(dn.pos, 'green', '✓', now);
        this.bubble(dn.pos, 'accept', `<b>ACCEPTED</b> · ${detail}`, now);
        if (plan) this.materialise(dn.a.id, plan, snap, now);
      }
    }
    // plans that arrive after acceptance (or without verdict) still materialise when the agent is done
    plans.forEach((p, id) => { const n = this.nodes.get(id); if (n && n.a.status === 'done') this.materialise(id, p, snap, now); });
    this.syncCounters(snap, now);
  }
  private reveal(n: Node, now: number) { n.shown = true; n.stem.visible = true; const el = n.pill.element as HTMLElement; requestAnimationFrame(() => el.classList.add('in')); }
  private updatePill(n: Node, selected: string | undefined, now: number) {
    const a = n.a; const el = n.pill.element as HTMLElement; const helper = !SHOW.has(a.role);
    el.dataset.status = a.status; el.dataset.depth = String(Math.min(a.depth, 2)); el.dataset.role = a.role; el.style.setProperty('--c', agentColor(a)); el.classList.toggle('selected', selected === a.id); el.classList.toggle('helper', helper);
    (el.querySelector('.agent-code') as HTMLElement).textContent = agentCode(a);
    (el.querySelector('.agent-model') as HTMLElement).textContent = shortModel(a.model).replace(/^Nemotron\s*/, '');
    const sub = el.querySelector('.agent-sub') as HTMLElement;
    sub.textContent = a.role === 'verifier' ? (a.status === 'rejected' ? 'REJECT' : a.status === 'done' ? 'ACCEPT' : 'AUDITING…')
      : a.role === 'district' ? (a.status === 'thinking' && n.rejects > 0 ? `re-planning · attempt ${n.rejects + 1}` : a.status === 'rejected' ? 'rejected' : a.status === 'done' ? 'plan ok' : a.status === 'thinking' ? 'planning' : '')
      : a.status === 'thinking' ? 'working' : a.status === 'done' ? 'done' : '';
    (n.stem.material as THREE.LineBasicMaterial).color.set(agentColor(a));
  }

  // ---------------- plans → terrain ----------------
  private materialise(agentId: string, plan: DistrictPlan, snap: SimSnapshot | undefined, now: number) {
    const key = agentId + ':' + plan.routes.map((r) => r.id).join(',') + ':' + plan.fireCrews; if (this.plansSeen.has(key)) return; this.plansSeen.add(key);
    const colors: Record<string, string> = { road: '#a3e635', air: '#ffffff', boat: '#22d3ee' };
    plan.routes.forEach((r, ri) => {
      const pts = (r.path?.length ? r.path : [r.from, r.to]).map((p) => { const [x, z] = this.world.toScene(p); return new THREE.Vector3(x, 0, z); });
      if (pts.length < 2 || pts[0].distanceTo(pts[pts.length - 1]) < 0.3) return;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5); const N = 48; const arr: THREE.Vector3[] = [];
      for (let i = 0; i <= N; i++) { const p = curve.getPoint(i / N); const lift = r.mode === 'air' ? 2.2 + Math.sin((i / N) * Math.PI) * 3 : 0.45; arr.push(new THREE.Vector3(p.x, this.world.heightAt(p.x, p.z) + lift, p.z)); }
      const lifted = new THREE.CatmullRomCurve3(arr, false, 'catmullrom', 0.1);
      const g = new THREE.BufferGeometry().setFromPoints(arr);
      const mat = r.mode === 'air' ? new THREE.LineDashedMaterial({ color: colors.air, dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.95, depthTest: false }) : new THREE.LineBasicMaterial({ color: colors[r.mode] ?? colors.road, transparent: true, opacity: 0.95, depthTest: false });
      const line = new THREE.Line(g, mat); if (r.mode === 'air') line.computeLineDistances(); line.renderOrder = 8; g.setDrawRange(0, 0); this.group.add(line); this.routes.push(line);
      const t0 = now + ri * 250; this.timed.push({ obj: line, until: t0 + 1000, t0, step: (k) => { g.setDrawRange(0, Math.max(2, Math.floor(ease(Math.max(0, k)) * (N + 1)))); }, });
      // unit proxy
      let mesh: THREE.Object3D; let rotor: THREE.Object3D | undefined;
      if (r.mode === 'air') { const grp = new THREE.Group(); grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.4 }))); rotor = new THREE.Group(); const bm = new THREE.MeshBasicMaterial({ color: '#2b2622' }); rotor.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.08), bm), new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 1.8), bm)); rotor.position.y = 0.5; grp.add(rotor); mesh = grp; }
      else if (r.mode === 'boat') mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 4, 8), new THREE.MeshStandardMaterial({ color: '#22d3ee', emissive: '#22d3ee', emissiveIntensity: 0.5 })), (mesh as THREE.Mesh).rotation.x = Math.PI / 2;
      else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.8), new THREE.MeshStandardMaterial({ color: '#a3e635', emissive: '#a3e635', emissiveIntensity: 0.35 }));
      mesh.visible = false; this.group.add(mesh);
      this.units.push({ mesh, curve: lifted, speed: r.mode === 'air' ? 0.22 : r.mode === 'boat' ? 0.12 : 0.15, phase: -0.2 - ri * 0.15, mode: r.mode, rotor });
      this.evacRoutes.push({ curve: lifted, districtId: plan.districtId });
    });
    // fire crews → nearest burning cells
    if (plan.fireCrews > 0 && snap) {
      const d = this.region.districts.find((x) => x.id === plan.districtId); if (!d) return;
      const [cx, cz] = this.world.toScene(d.centroid);
      const fires = snap.hazards.filter((h) => h.kind === 'fire' && !this.extinguished.has(h.i + ',' + h.j)).map((h) => { const [x, z] = this.world.cellCenter(h.i, h.j); return { h, x, z, d: Math.hypot(x - cx, z - cz) }; }).sort((a, b) => a.d - b.d);
      for (let k = 0; k < Math.min(plan.fireCrews, fires.length, 6); k++) {
        const f = fires[k]; const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: '#f97316', emissive: '#f97316', emissiveIntensity: 1 }));
        m.position.set(cx + (Math.random() - 0.5), this.world.heightAt(cx, cz) + 0.5, cz + (Math.random() - 0.5)); this.group.add(m);
        this.crews.push({ mesh: m, target: [f.x, f.z], cell: f.h.i + ',' + f.h.j, speed: 3 + Math.random() });
      }
    }
  }

  // ---------------- stranded counters under district labels ----------------
  private syncCounters(snap: SimSnapshot | undefined, now: number) {
    if (!snap) return;
    for (const ds of snap.districts) {
      const prev = this.strandedPrev.get(ds.id); this.strandedPrev.set(ds.id, ds.stranded);
      let c = this.counters.get(ds.id);
      if (!c) {
        if (ds.stranded <= 0) continue;
        const lab = this.places.children.find((o) => o.userData.districtId === ds.id) as any; if (!lab) continue;
        const el = document.createElement('span'); el.className = 'sc-stranded'; lab.element.appendChild(el); lab.element.classList.add('has-count');
        c = { el, shown: 0, target: ds.stranded, peak: ds.stranded }; this.counters.set(ds.id, c);
      }
      c.target = ds.stranded; c.peak = Math.max(c.peak, ds.stranded);
      if (prev != null && ds.stranded < prev) this.nextEvac = Math.min(this.nextEvac, now); // evacuees are moving
    }
  }

  // ---------------- per-frame ----------------
  tick(now: number, dt: number, snap: SimSnapshot | undefined) {
    // growing connectors + delayed reveal
    this.nodes.forEach((n) => {
      if (n.link && !n.link.settled) {
        const k = Math.min(1, (now - n.link.born) / 600); const p = n.link.from.clone().lerp(n.link.to, ease(k));
        (n.link.line.geometry as THREE.BufferGeometry).setFromPoints([n.link.from, p]);
        if (k >= 1) { n.link.settled = true; (n.link.line.material as THREE.LineBasicMaterial).opacity = SHOW.has(n.a.role) ? 0.45 : 0.25; if (!n.shown) this.reveal(n, now); }
      }
    });
    // timed objects
    this.timed = this.timed.filter((t) => { const k = Math.min(1, (now - t.t0) / Math.max(1, t.until - t.t0)); t.step?.(k); if (now >= t.until) { if ((t.obj as any).isCSS2DObject) { this.group.remove(t.obj); disposeObject(t.obj); } else t.step?.(1); return false; } return true; });
    // packets + evacuees → one Points buffer
    if (this.evacRoutes.length && now >= this.nextEvac) {
      this.nextEvac = now + 180;
      const r = this.evacRoutes[Math.floor(Math.random() * this.evacRoutes.length)]; const st = snap?.districts.find((d) => d.id === r.districtId);
      if (!st || st.stranded > 0 || (this.strandedPrev.get(r.districtId) ?? 0) > 0) { const a = r.curve.getPoint(0), b = r.curve.getPoint(1); this.packets.push({ from: a, to: b, t0: now, dur: 2600 + Math.random() * 800, color: [1, 0.93, 0.8], arc: 0 }); (this.packets[this.packets.length - 1] as any).curve = r.curve; }
    }
    let n = 0; const tmp = new THREE.Vector3();
    this.packets = this.packets.filter((p) => {
      const k = (now - p.t0) / p.dur; if (k >= 1 || n >= this.MAXP) return false;
      const curve: THREE.CatmullRomCurve3 | undefined = (p as any).curve;
      if (curve) curve.getPoint(k, tmp); else { tmp.copy(p.from).lerp(p.to, k); tmp.y += Math.sin(k * Math.PI) * p.arc; }
      this.ppos.set([tmp.x, tmp.y + (curve ? 0.25 + Math.sin(k * 40) * 0.05 : 0), tmp.z], n * 3); this.pcol.set(p.color, n * 3); n++; return true;
    });
    const g = this.pts.geometry; (g.attributes.position as THREE.BufferAttribute).needsUpdate = true; (g.attributes.color as THREE.BufferAttribute).needsUpdate = true; g.setDrawRange(0, n);
    // moving units
    for (const u of this.units) {
      u.phase += dt * u.speed; if (u.phase > 1.15) u.phase = -0.1; const k = Math.max(0, Math.min(1, u.phase)); u.mesh.visible = u.phase >= 0;
      u.curve.getPoint(k, tmp); const ahead = u.curve.getPoint(Math.min(1, k + 0.02));
      u.mesh.position.copy(tmp); if (u.mode === 'air') u.mesh.position.y += Math.sin(now / 250) * 0.15; u.mesh.lookAt(ahead.x, u.mesh.position.y, ahead.z); if (u.mode === 'boat') u.mesh.rotation.x = Math.PI / 2;
      if (u.rotor) u.rotor.rotation.y += dt * 25;
    }
    // fire crews
    this.crews = this.crews.filter((c) => {
      const dx = c.target[0] - c.mesh.position.x, dz = c.target[1] - c.mesh.position.z; const d = Math.hypot(dx, dz);
      if (d < 0.4) { this.extinguished.add(c.cell); this.onExtinguish?.(); this.burst(c.mesh.position.clone(), 'white', '', now, 700); this.group.remove(c.mesh); disposeObject(c.mesh); return false; }
      const s = Math.min(d, c.speed * dt); c.mesh.position.x += (dx / d) * s; c.mesh.position.z += (dz / d) * s; c.mesh.position.y = this.world.heightAt(c.mesh.position.x, c.mesh.position.z) + 0.5; return true;
    });
    // counters count-down tween
    this.counters.forEach((c) => {
      if (c.shown !== c.target) { c.shown = Math.abs(c.target - c.shown) < 2 ? c.target : lerp(c.shown, c.target, Math.min(1, dt * 4)); c.el.textContent = `${Math.round(c.shown).toLocaleString()} stranded`; c.el.classList.toggle('zero', c.target === 0 && c.shown < 1); }
      else if (!c.el.textContent) c.el.textContent = `${c.target.toLocaleString()} stranded`;
    });
  }
  dispose() { disposeObject(this.group); this.tex.dispose(); this.counters.forEach((c) => c.el.remove()); }
}
const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
