import type { CascadeEvent, Cell, Playbook, RegionConfig, RegionId, TriggerSpec, LngLat } from '../../shared/types.ts';
import { startMock, mockRegions, mockEvolve, mockReset, mockRun, mockPlaybook } from './mock';

export type Mode = 'mock' | 'live';
let mode: Mode = 'live';
export const getMode = () => mode;
export const setLive = () => { mode = 'live'; };
let activeReopen: (() => void) | null = null;
/** force the event stream to reconnect (the server replays the running incident to late joiners) */
export function reconnectEvents() { activeReopen?.(); }
/** lightweight server probe used to detect an incident running on the server that this tab isn't attached to */
export async function pollHealth(): Promise<any | null> {
  try { const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3000); const r = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' }); clearTimeout(t); return r.ok ? await r.json() : null; } catch { return null; }
}

export function forcedMock(): boolean {
  try { return new URLSearchParams(location.search).get('mock') === '1'; } catch { return false; }
}

/** Probe /api/health; fall back to mock mode when unreachable. */
export async function detectMode(): Promise<{ mode: Mode; health?: any }> {
  if (forcedMock()) { mode = 'mock'; return { mode }; }
  // two attempts: the server can be briefly unresponsive while it is mid-LLM-call
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!r.ok) throw new Error('health ' + r.status);
      const health = await r.json().catch(() => ({}));
      mode = 'live'; // transport is live even if the server says it is mocking LLM calls
      return { mode: 'live', health };
    } catch { /* retry once */ }
  }
  mode = 'mock';
  return { mode: 'mock' };
}

export async function fetchRegions(): Promise<RegionConfig[]> {
  if (mode === 'mock') return mockRegions();
  try {
    const r = await fetch('/api/regions');
    if (!r.ok) throw new Error();
    return await r.json();
  } catch { return mockRegions(); }
}

export async function fetchPlaybook(): Promise<Playbook | undefined> {
  if (mode === 'mock') return mockPlaybook();
  try { const r = await fetch('/api/playbook'); if (r.ok) return await r.json(); } catch {}
  return undefined;
}

export async function postRun(body: { regionId: RegionId; trigger: { kind: TriggerSpec['kind']; at: LngLat; params: Record<string, number> }; realCalls?: boolean }, region?: RegionConfig) {
  if (mode === 'mock') return mockRun(body, region);
  const r = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('run failed ' + r.status);
  return r.json();
}

export async function postEvolve() {
  if (mode === 'mock') return mockEvolve();
  const r = await fetch('/api/evolve', { method: 'POST' });
  if (!r.ok) throw new Error('evolve failed ' + r.status);
  return r.json().catch(() => ({}));
}

export async function postReset() {
  if (mode === 'mock') return mockReset();
  const r = await fetch('/api/reset', { method: 'POST' });
  if (!r.ok) throw new Error('reset failed ' + r.status);
  return r.json().catch(() => ({}));
}

/** Subscribe to the live event stream (SSE) or the mock stream. Returns an unsubscribe. */
export function subscribe(onEvent: (e: CascadeEvent) => void, onStatus?: (s: 'open' | 'error') => void): () => void {
  if (mode === 'mock') return startMock(onEvent);
  let es: EventSource | null = null;
  let closed = false;
  let retry = 1000;
  const open = () => {
    if (closed) return;
    es?.close();
    es = new EventSource('/api/events');
    activeReopen = () => { if (!closed) open(); };
    es.onopen = () => { retry = 1000; onStatus?.('open'); };
    es.onmessage = (m) => {
      try { onEvent(JSON.parse(m.data)); } catch {}
    };
    es.onerror = () => {
      onStatus?.('error');
      es?.close();
      if (!closed) setTimeout(open, retry), (retry = Math.min(retry * 2, 10000));
    };
  };
  open();
  return () => { closed = true; es?.close(); };
}

/** Sim grid cells for a region (elevation + terrain type). Falls back to a synthetic grid in mock mode / offline. */
export async function fetchCells(region: RegionConfig): Promise<Cell[]> {
  if (mode !== 'mock') {
    try { const r = await fetch(`/api/regions/${region.id}/cells`); if (r.ok) return await r.json(); } catch {}
  }
  return synthCells(region);
}
function synthCells(region: RegionConfig): Cell[] {
  const [w, s, e, n] = region.bbox; const { cols, rows } = region.grid;
  const dw = (e - w) / cols, dh = (n - s) / rows;
  const inPoly = (p: LngLat, poly: LngLat[]) => { let inside = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const pa = poly[a], pb = poly[b]; if ((pa.lat > p.lat) !== (pb.lat > p.lat) && p.lng < ((pb.lng - pa.lng) * (p.lat - pa.lat)) / (pb.lat - pa.lat) + pa.lng) inside = !inside; } return inside; };
  const base: Record<string, [number, number]> = { hills: [160, 400], valley: [40, 120], urban: [15, 60], coast: [3, 25], softsoil: [3, 30], water: [0, 0] };
  const out: Cell[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const lng = w + (i + 0.5) * dw, lat = s + (j + 0.5) * dh;
    const d = region.districts.find((x) => inPoly({ lng, lat }, x.polygon));
    const terrain: Cell['terrain'] = d?.terrain ?? (region.id === 'bayarea' && lng < -122.2 && lat < 37.95 && lat > 37.45 ? 'water' : 'hills');
    const [lo, hi] = base[terrain];
    const h = (Math.sin(i * 0.9 + j * 0.37) * 0.5 + Math.sin(i * 0.23 - j * 0.71) * 0.3 + Math.sin((i + j) * 1.7) * 0.2 + 1) / 2;
    out.push({ i, j, lng, lat, elev: lo + (hi - lo) * h, terrain, districtId: d?.id, pop: d ? Math.round(d.population / 40) : 0 });
  }
  return out;
}
