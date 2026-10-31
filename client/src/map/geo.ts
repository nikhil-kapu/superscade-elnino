import type { HazardCell, LngLat, RegionConfig, RoutePlan, SimSnapshot } from '../../../shared/types.ts';
import type { LiveAgent } from '../store';
import { agentColor, shortModel, tickClock } from '../store';

export interface Feature { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: any } }
export interface FeatureCollection { type: 'FeatureCollection'; features: Feature[] }
export type FC = FeatureCollection;
export const empty = (): FC => ({ type: 'FeatureCollection', features: [] });
const ring = (pts: LngLat[]) => { const c = pts.map((p) => [p.lng, p.lat]); c.push(c[0]); return c; };

export function cellPolygon(region: RegionConfig, c: { i: number; j: number }): number[][] {
  const [w, s, e, n] = region.bbox;
  const dw = (e - w) / region.grid.cols, dh = (n - s) / region.grid.rows;
  const x = w + c.i * dw, y = s + c.j * dh;
  return [[x, y], [x + dw, y], [x + dw, y + dh], [x, y + dh], [x, y]];
}

export function hazardsFC(region: RegionConfig, hazards: HazardCell[] | undefined): FC {
  if (!hazards) return empty();
  return {
    type: 'FeatureCollection',
    features: hazards.map((h) => ({ type: 'Feature', properties: { kind: h.kind, intensity: h.intensity }, geometry: { type: 'Polygon', coordinates: [cellPolygon(region, h)] } })),
  };
}

/** Outline of the burning cluster: edges of fire cells not shared with another fire cell. */
export function frontFC(region: RegionConfig, hazards: HazardCell[] | undefined, kind: HazardCell['kind'] = 'fire'): FC {
  if (!hazards) return empty();
  const cells = hazards.filter((h) => h.kind === kind && h.intensity > 0.05);
  if (!cells.length) return empty();
  // morphological closing: dilate by one cell (8-neighbourhood) so sparse cells merge into one footprint, then outline it
  const key = (i: number, j: number) => i + ',' + j;
  const set = new Set<string>();
  for (const h of cells) for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) set.add(key(h.i + di, h.j + dj));
  const [w, s0, e, n] = region.bbox;
  const dw = (e - w) / region.grid.cols, dh = (n - s0) / region.grid.rows;
  const lines: number[][][] = [];
  set.forEach((k) => {
    const [i, j] = k.split(',').map(Number);
    const x = w + i * dw, y = s0 + j * dh;
    if (!set.has(key(i, j + 1))) lines.push([[x, y + dh], [x + dw, y + dh]]);
    if (!set.has(key(i, j - 1))) lines.push([[x, y], [x + dw, y]]);
    if (!set.has(key(i + 1, j))) lines.push([[x + dw, y], [x + dw, y + dh]]);
    if (!set.has(key(i - 1, j))) lines.push([[x, y], [x, y + dh]]);
  });
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind }, geometry: { type: 'MultiLineString', coordinates: lines } }] };
}

export function districtsFC(region: RegionConfig, snap?: SimSnapshot): FC {
  return {
    type: 'FeatureCollection',
    features: region.districts.map((d) => {
      const st = snap?.districts.find((x) => x.id === d.id);
      return { type: 'Feature', properties: { id: d.id, name: d.name, cutOff: !!st?.cutOff, stranded: st?.stranded ?? 0 }, geometry: { type: 'Polygon', coordinates: [ring(d.polygon)] } };
    }),
  };
}

export function linesFC(region: RegionConfig): FC {
  const fs: Feature[] = [];
  region.faults?.forEach((f) => fs.push({ type: 'Feature', properties: { kind: 'fault', name: f.name }, geometry: { type: 'LineString', coordinates: f.line.map((p) => [p.lng, p.lat]) } }));
  region.rivers?.forEach((f) => fs.push({ type: 'Feature', properties: { kind: 'river', name: f.name }, geometry: { type: 'LineString', coordinates: f.line.map((p) => [p.lng, p.lat]) } }));
  return { type: 'FeatureCollection', features: fs };
}

export function routesFC(routes: RoutePlan[]): FC {
  return {
    type: 'FeatureCollection',
    features: routes.map((r) => ({ type: 'Feature', properties: { id: r.id, mode: r.mode, label: r.label, capacity: r.capacity }, geometry: { type: 'LineString', coordinates: (r.path?.length ? r.path : [r.from, r.to]).map((p) => [p.lng, p.lat]) } })),
  };
}

export function agentLinksFC(agents: Map<string, LiveAgent>): FC {
  const fs: Feature[] = [];
  agents.forEach((a) => {
    const p = a.parentId ? agents.get(a.parentId) : undefined;
    if (!p) return;
    fs.push({ type: 'Feature', properties: { color: agentColor(a), status: a.status, depth: a.depth }, geometry: { type: 'LineString', coordinates: [[p.at.lng, p.at.lat], [a.at.lng, a.at.lat]] } });
  });
  return { type: 'FeatureCollection', features: fs };
}

export function agentHaloFC(agents: Map<string, LiveAgent>): FC {
  const fs: Feature[] = [];
  agents.forEach((a) => fs.push({ type: 'Feature', properties: { id: a.id, color: agentColor(a), status: a.status, depth: a.depth, role: a.role, label: `${a.role} · ${shortModel(a.model)}`, primary: a.depth <= 1 || a.role === 'verifier', r: a.depth === 0 ? 26 : a.depth === 1 ? 18 : 13 }, geometry: { type: 'Point', coordinates: [a.at.lng, a.at.lat] } }));
  return { type: 'FeatureCollection', features: fs };
}

export function pointFC(at?: LngLat): FC {
  if (!at) return empty();
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [at.lng, at.lat] } }] };
}

/** Cell-centre points for heatmap layers (fire / shaking / flood / burn glow) and dot layers (landslide / dam). */
export function hazardPointsFC(region: RegionConfig, hazards: HazardCell[] | undefined): FC {
  if (!hazards) return empty();
  const [w, s, e, n] = region.bbox;
  const dw = (e - w) / region.grid.cols, dh = (n - s) / region.grid.rows;
  return {
    type: 'FeatureCollection',
    features: hazards.map((h) => ({ type: 'Feature', properties: { kind: h.kind, intensity: h.intensity }, geometry: { type: 'Point', coordinates: [w + (h.i + 0.5) * dw, s + (h.j + 0.5) * dh] } })),
  };
}
export function burnFC(region: RegionConfig, hazards: HazardCell[] | undefined): FC {
  if (!hazards) return empty();
  return { type: 'FeatureCollection', features: hazards.filter((h) => h.kind === 'burn').map((h) => ({ type: 'Feature', properties: { intensity: h.intensity }, geometry: { type: 'Polygon', coordinates: [cellPolygon(region, h)] } })) };
}
export function hazardCentroid(region: RegionConfig, snap: SimSnapshot, kind: HazardCell['kind']): LngLat | undefined {
  const [w, s, e, n] = region.bbox;
  const dw = (e - w) / region.grid.cols, dh = (n - s) / region.grid.rows;
  let sx = 0, sy = 0, sw = 0;
  for (const h of snap.hazards) if (h.kind === kind) { const wt = 0.2 + h.intensity; sx += (w + (h.i + 0.5) * dw) * wt; sy += (s + (h.j + 0.5) * dh) * wt; sw += wt; }
  return sw ? { lng: sx / sw, lat: sy / sw } : undefined;
}
/** Spread path: ignition → fire centroid per tick, with time pins every 6 ticks. */
export function nearestPlace(region: RegionConfig, at: LngLat): string {
  let best: { name: string; d: number } | undefined;
  for (const x of region.infra) { const d = Math.hypot(x.at.lng - at.lng, x.at.lat - at.lat); if (!best || d < best.d) best = { name: x.name, d }; }
  for (const x of region.districts) { const d = Math.hypot(x.centroid.lng - at.lng, x.centroid.lat - at.lat) * 1.4; if (!best || d < best.d) best = { name: x.name, d }; }
  return best?.name ?? '';
}
/** Spread / surge path: trigger point → hazard centroid per tick, with time pins every 6 ticks naming the nearest place. */
export function spreadPathFC(region: RegionConfig, ignition: LngLat | undefined, snaps: SimSnapshot[], kind: HazardCell['kind'] = 'fire'): { line: FC; pins: FC } {
  if (!ignition || !snaps.length) return { line: empty(), pins: empty() };
  const pts: number[][] = [[ignition.lng, ignition.lat]];
  const pins: Feature[] = [];
  let prevRaw: LngLat | undefined;
  for (const sn of snaps) {
    const c = hazardCentroid(region, sn, kind);
    if (!c) continue;
    // smooth: average the last two ticks' centroids so the path doesn't jitter
    const sm = prevRaw ? { lng: (prevRaw.lng + c.lng) / 2, lat: (prevRaw.lat + c.lat) / 2 } : c;
    prevRaw = c;
    const prev = pts[pts.length - 1];
    if (Math.hypot(prev[0] - sm.lng, prev[1] - sm.lat) > 0.0015) pts.push([sm.lng, sm.lat]);
    if (sn.tick > 0 && sn.tick % 6 === 0) pins.push({ type: 'Feature', properties: { label: `T+${sn.tick} · ${tickClock(sn.tick)} · ${kind === 'flood' ? 'reaches' : 'near'} ${nearestPlace(region, sm)}`, tick: sn.tick }, geometry: { type: 'Point', coordinates: [sm.lng, sm.lat] } });
  }
  if (pts.length < 2) return { line: empty(), pins: { type: 'FeatureCollection', features: pins } };
  return { line: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] }, pins: { type: 'FeatureCollection', features: pins } };
}

/** Isoseismal rings: circles around the epicentre at the extent of shaking >= 0.7 / 0.5 / 0.3. */
export function isoseismalFC(epi: LngLat | undefined, hazards: HazardCell[] | undefined, region: RegionConfig): FC {
  if (!epi || !hazards) return empty();
  const [w, s, e, n] = region.bbox;
  const dw = (e - w) / region.grid.cols, dh = (n - s) / region.grid.rows;
  const cosLat = Math.cos((epi.lat * Math.PI) / 180);
  const radii = [0.7, 0.5, 0.3].map((th) => {
    let r = 0;
    for (const h of hazards) if (h.kind === 'quake' && h.intensity >= th) { const dx = (w + (h.i + 0.5) * dw - epi.lng) * cosLat, dy = s + (h.j + 0.5) * dh - epi.lat; r = Math.max(r, Math.hypot(dx, dy)); }
    return r;
  });
  const feats: Feature[] = [];
  radii.forEach((r, k) => {
    if (r <= 0) return;
    const ring: number[][] = [];
    for (let a = 0; a <= 64; a++) { const t = (a / 64) * Math.PI * 2; ring.push([epi.lng + (r * Math.cos(t)) / cosLat, epi.lat + r * Math.sin(t)]); }
    feats.push({ type: 'Feature', properties: { level: k }, geometry: { type: 'LineString', coordinates: ring } });
  });
  return { type: 'FeatureCollection', features: feats };
}
