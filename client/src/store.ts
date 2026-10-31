import { create } from 'zustand';
import { useSponsor } from './panels/SponsorPanel';
import type {
  AgentNode, AgentStatus, CascadeEvent, District, DistrictPlan, Fault, LngLat, Playbook, RegionConfig, RegionId,
  Scenario, Score, SimSnapshot, TriggerSpec, VerifierVerdict,
} from '../../shared/types.ts';
import type { Mode } from './api';

export interface LiveAgent extends AgentNode { tokens: number; note?: string; spawnedAt: number; updatedAt: number }
export interface TimelineEntry {
  id: number; ts: number; tick?: number; kind: string; text: string; severity: 'info' | 'warn' | 'critical' | 'error'; at?: LngLat;
}
export interface VerdictRow { id: number; agentId: string; verdict: VerifierVerdict; ts: number }
export interface NarrationLine { id: number; ts: number; role: string; color: string; who: string; text: string; tone: 'info' | 'good' | 'bad' | 'gold' }
export interface Celebration { id: number; kept: boolean; fromGen: number; toGen: number; before: number; after: number; diff: string; summary: string; heldOut: number }
export interface RunResults { id: number; name: string; score: Score; summary: string; agents: number; levels: number; accepted: number; rejected: number; replans: number; llmCalls: number; tokens: number; alerts: number; escalated: number; delegated: number; calls: number }
// ---- per-district risk + alerts (server events that may or may not be present; typed locally so the client compiles either way) ----
export type RiskLabel = 'monitoring' | 'alert' | 'evacuate' | 'escalate';
export type RiskTrend = 'rising' | 'steady' | 'falling' | 'settled';
export interface DistrictRiskEvent { type: 'district.risk'; runId: string; tick: number; districtId: string; severity: 0 | 1 | 2 | 3; label: RiskLabel; trend: RiskTrend; forecast: { horizonTicks: number; stranded: number; flooded: number; fires: number; cutOff: boolean; text: string }; action: string }
export type AlertService = 'fire' | 'police' | 'medical' | 'helicopter' | 'boat' | 'regional' | 'public';
export interface AlertEvent { type: 'alert'; runId: string; tick: number; districtId: string; service: AlertService; scope: 'district' | 'regional'; message: string; agentId?: string }
export interface AlertRow extends AlertEvent { id: number; ts: number }
export interface RiskRow extends DistrictRiskEvent { ts: number; roseAt?: number }
export type PlanExtra = DistrictPlan & { severity?: number; alerts?: { service: string; scope: string; message: string }[] };
export type CallStatus = 'queued' | 'dialing' | 'connected' | 'completed' | 'failed' | 'simulated';
export interface CallEvent { type: 'call'; runId: string; tick: number; districtId: string; to: string; role: 'emergency_contact' | 'citizen'; status: CallStatus; script: string; callId?: string; agentId?: string }
export interface CallRow extends CallEvent { key: string; ts: number; firstTs: number }
/** "+14155554930" -> "+1 ••• 4930" (never show the full number) */
export function maskNumber(to: string, withCc = true): string {
  const digits = (to ?? '').replace(/\D/g, '');
  const last4 = digits.slice(-4) || '????';
  const cc = withCc && /^\s*\+/.test(to ?? '') && digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  return `${cc ? '+' + cc + ' ' : ''}••• ${last4}`;
}
export const CALL_ROLE_LABEL: Record<string, string> = { emergency_contact: 'District emergency contact', citizen: 'Citizen' };
export const SEVERITY_LABEL = ['Monitoring', 'Alert', 'Evacuate', 'Escalate'] as const;
export const SEVERITY_COLOR = ['#8a817a', '#d99a0b', '#ea6a1a', '#dc2626'] as const;
export const TREND_GLYPH: Record<string, string> = { rising: '↑', steady: '→', falling: '↓', settled: '✓' };
export const SERVICE_ICON: Record<string, string> = { fire: '🚒', police: '🚓', medical: '🚑', helicopter: '🚁', boat: '🚤', regional: '📡', public: '📣' };
export function alertChipText(a: { service: string; scope: string }): string {
  if (a.service === 'public') return `${SERVICE_ICON.public} public warning`;
  const svc = a.service === 'boat' ? 'boats' : a.service;
  return `${SERVICE_ICON[a.service] ?? '•'} ${svc} · ${a.scope === 'regional' ? (a.service === 'helicopter' ? 'regional request' : 'regional') : 'district'}`;
}
export function agentCodeOf(a: { role: string; districtId?: string }): string {
  const d = (a.districtId ?? '').toUpperCase().slice(0, 4);
  const pre: Record<string, string> = { chief: 'CHIEF', district: 'D', route: 'RT', firecrew: 'FC', shelter: 'SH', supply: 'SUP', airlift: 'AIR', verifier: 'V', research: 'RESEARCH', reflector: 'REFLECTOR' };
  const p = pre[a.role] ?? a.role.toUpperCase().slice(0, 3);
  return d && !['chief', 'research', 'reflector'].includes(a.role) ? `${p}-${d}` : p;
}

export type Tab = 'incident' | 'agents' | 'response' | 'delegation';
export type SubTab = 'layers' | 'analysis' | 'evidence' | 'notes';
export type LayerId = 'terrain' | 'buildings' | 'imagery' | 'shaking' | 'fire' | 'burn' | 'spread' | 'landslide' | 'flood' | 'dams' | 'infra' | 'routes' | 'agents' | 'lines' | 'labels';
export interface LayerState { on: boolean; opacity: number }
export const LAYER_DEFS: { id: LayerId; label: string; swatch: string; thumb: string }[] = [
  { id: 'terrain', label: 'Terrain 3D', swatch: '#8a817a', thumb: 'linear-gradient(135deg,#d9cfc1,#8a7a6a 55%,#5b4636)' },
  { id: 'buildings', label: 'Buildings', swatch: '#9a938a', thumb: 'linear-gradient(90deg,#d9d2c6 0 18%,#8f8880 18% 22%,#c9c2b8 22% 48%,#8f8880 48% 52%,#b9c3cc 52% 80%,#8f8880 80% 84%,#d9d2c6 84%)' },
  { id: 'imagery', label: 'Aerial imagery', swatch: '#6b7a5a', thumb: 'linear-gradient(160deg,#7d8a62,#4e5a3c 50%,#9a8f78)' },
  { id: 'shaking', label: 'Shaking (isoseismal)', swatch: '#8b5cf6', thumb: 'radial-gradient(circle,#8b5cf6cc 0 18%,transparent 20%),radial-gradient(circle,transparent 0 34%,#8b5cf6aa 35% 37%,transparent 38%),radial-gradient(circle,transparent 0 48%,#8b5cf677 49% 51%,transparent 52%),#d8d2df' },
  { id: 'fire', label: 'Fire spread', swatch: '#f26a1b', thumb: 'radial-gradient(circle at 50% 50%,#fff3b0 0 12%,#f26a1b 35%,#7a1d0f 60%,transparent 78%),#cfc5b5' },
  { id: 'burn', label: 'Burn scar', swatch: '#3b2a24', thumb: 'radial-gradient(circle at 40% 45%,#3b2a24 0 40%,#7a1d0f88 55%,transparent 75%),#b8ad9c' },
  { id: 'spread', label: 'Spread / surge path', swatch: '#f5c542', thumb: 'linear-gradient(20deg,transparent 46%,#f5c542 47% 53%,transparent 54%),#b9ad9b' },
  { id: 'landslide', label: 'Landslides', swatch: '#a16207', thumb: 'radial-gradient(circle at 30% 40%,#a16207 0 16%,transparent 24%),radial-gradient(circle at 65% 65%,#5b3a1a 0 14%,transparent 22%),#c9bca8' },
  { id: 'flood', label: 'Inundation (flood)', swatch: '#1d4ed8', thumb: 'radial-gradient(ellipse at 50% 55%,#1d4ed8 0 20%,#3b82f6 40%,#bfdbfe 65%,transparent 80%),#cfd6c7' },
  { id: 'dams', label: 'Dams & surges', swatch: '#ffffff', thumb: 'radial-gradient(circle,#fff 0 18%,#2b2622 20% 26%,transparent 28%),linear-gradient(180deg,#9fb6c9,#4b6f8f)' },
  { id: 'infra', label: 'Infrastructure', swatch: '#2b2622', thumb: 'radial-gradient(circle at 50% 50%,#fff 0 22%,#16a34a 24% 34%,transparent 36%),#b8b0a3' },
  { id: 'routes', label: 'Response routes', swatch: '#84cc16', thumb: 'linear-gradient(-30deg,transparent 46%,#84cc16 47% 53%,transparent 54%),#b2a996' },
  { id: 'agents', label: 'Agent network', swatch: '#2563eb', thumb: 'radial-gradient(circle at 30% 30%,#f59e0b 0 14%,transparent 16%),radial-gradient(circle at 70% 70%,#2563eb 0 12%,transparent 14%),#2b2622' },
  { id: 'lines', label: 'Faults & rivers', swatch: '#7f1d1d', thumb: 'repeating-linear-gradient(60deg,transparent 0 6px,#7f1d1d 6px 10px),#cfc5b5' },
  { id: 'labels', label: 'Labels', swatch: '#2b2622', thumb: 'linear-gradient(0deg,#e9e2d6,#f4f1ea)' },
];
const defaultLayers = (): Record<LayerId, LayerState> => ({
  terrain: { on: true, opacity: 1 }, buildings: { on: true, opacity: 1 }, imagery: { on: true, opacity: 1 }, burn: { on: true, opacity: 0.9 }, fire: { on: true, opacity: 1 }, spread: { on: true, opacity: 1 },
  shaking: { on: true, opacity: 0.7 }, flood: { on: true, opacity: 0.85 }, dams: { on: true, opacity: 1 }, landslide: { on: true, opacity: 0.9 }, infra: { on: true, opacity: 1 }, routes: { on: true, opacity: 1 },
  agents: { on: true, opacity: 1 }, lines: { on: true, opacity: 0.7 }, labels: { on: true, opacity: 0.9 },
});

export interface Incident {
  runId: string; name: string; scenario: Scenario; startedAt: number; done: boolean; summary?: string;
  snapshots: SimSnapshot[]; agents: Map<string, LiveAgent>; plans: Map<string, DistrictPlan>; verdicts: VerdictRow[]; events: TimelineEntry[]; score?: Score;
  calls?: Map<string, CallRow>;
  risks?: Map<string, RiskRow>; riskHistory?: Map<string, number[]>; alerts?: AlertRow[]; narration?: NarrationLine[]; results?: RunResults;
}
export const TICK_MIN = 30; // 1 tick = 30 simulated minutes
export const tickClock = (t: number) => { const m = t * TICK_MIN; return `+${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export function incidentName(sc: Scenario | undefined, region: RegionConfig | undefined): string {
  if (!sc) return 'No incident';
  const d = region?.districts.reduce<{ d: District; dist: number } | null>((best, d) => { const dist = Math.hypot(d.centroid.lng - sc.trigger.at.lng, d.centroid.lat - sc.trigger.at.lat); return !best || dist < best.dist ? { d, dist } : best; }, null)?.d;
  const p = sc.trigger.params;
  if (sc.trigger.kind === 'quake') {
    const f = region?.faults?.reduce<{ f: Fault; dist: number } | null>((best, f) => { const dist = Math.min(...f.line.map((q) => Math.hypot(q.lng - sc.trigger.at.lng, q.lat - sc.trigger.at.lat))); return !best || dist < best.dist ? { f, dist } : best; }, null)?.f;
    return `${f?.name ?? 'Quake'} M${(p.magnitude ?? 0).toFixed(1)} — ${d?.name ?? region?.name ?? ''}`;
  }
  if (sc.trigger.kind === 'fire') return `${d?.name ?? 'Hills'} fire — wind ${p.windKph ?? p.wind ?? ''} km/h`;
  const rv = region?.rivers?.reduce<{ name: string; dist: number } | null>((best, f) => { const dist = Math.min(...f.line.map((q) => Math.hypot(q.lng - sc.trigger.at.lng, q.lat - sc.trigger.at.lat))); return !best || dist < best.dist ? { name: f.name, dist } : best; }, null);
  return `${rv?.name ?? 'Cloudburst'} cloudburst ${p.rainMm ?? p.mm ?? ''} mm — ${d?.name ?? ''}`;
}
export const shortId = (id?: string) => (id ? id.replace(/^(mock|run)-?/, '').slice(0, 6) : '—');

let seq = 1;

export interface CascadeState {
  mode: Mode | 'connecting';
  connection: 'open' | 'error' | 'idle';
  serverRun?: { runId: string; regionId: string; tick: number } | null;
  regions: RegionConfig[];
  regionId: RegionId;
  triggerKind: TriggerSpec['kind'];
  params: Record<string, number>;
  clickAt?: LngLat;

  runId?: string;
  scenario?: Scenario;
  running: boolean;
  snapshot?: SimSnapshot;
  score?: Score;
  summary?: string;
  agents: Map<string, LiveAgent>;
  plans: Map<string, DistrictPlan>;
  verdicts: VerdictRow[];
  events: TimelineEntry[];
  playbook?: Playbook;
  memory: { key: string; value: string; ts: number }[];
  evolving: boolean;
  narration: NarrationLine[];
  llmCalls: number;
  replans: number;
  celebration?: Celebration;
  results?: RunResults;
  risks: Map<string, RiskRow>;          // latest district.risk per districtId
  riskHistory: Map<string, number[]>;   // severity history per districtId (sparkline)
  alerts: AlertRow[];                   // newest first, cap 200
  calls: Map<string, CallRow>;          // phone calls keyed districtId|role|to, latest status wins

  snapshots: SimSnapshot[];
  viewTick: number | 'live';
  playing: boolean;
  speed: number;
  layers: Record<LayerId, LayerState>;
  exaggeration: number;

  tab: Tab;
  subTab: SubTab;
  agentView: 'fleet' | 'tree';
  showNewIncident: boolean;
  incidents: Incident[];
  selectedAgentId?: string;
  flyTo?: { at: LngLat; zoom?: number; n: number };
  pulse: number;

  // actions
  setMode(m: Mode | 'connecting'): void;
  setConnection(c: 'open' | 'error' | 'idle'): void;
  setServerRun(r: { runId: string; regionId: string; tick: number } | null | undefined): void;
  setRegions(r: RegionConfig[]): void;
  setRegion(id: RegionId): void;
  setTrigger(kind: TriggerSpec['kind']): void;
  setParam(name: string, v: number): void;
  setClickAt(at?: LngLat): void;
  setTab(t: Tab): void;
  setSubTab(t: SubTab): void;
  setAgentView(v: 'fleet' | 'tree'): void;
  setShowNewIncident(b: boolean): void;
  archiveCurrent(): void;
  viewIncident(runId: string): void;
  selectAgent(id?: string): void;
  fly(at: LngLat, zoom?: number): void;
  setPlaybook(p?: Playbook): void;
  setEvolving(b: boolean): void;
  dismissCelebration(): void;
  dismissResults(): void;
  resetRun(): void;
  tickPulse(): void;
  apply(e: CascadeEvent): void;
  region(): RegionConfig | undefined;
  viewSnapshot(): SimSnapshot | undefined;
  setViewTick(t: number | 'live'): void;
  setPlaying(b: boolean): void;
  setSpeed(n: number): void;
  stepTick(d: number): void;
  setLayer(id: LayerId, patch: Partial<LayerState>): void;
  setExaggeration(n: number): void;
}

function defaultParams(region: RegionConfig | undefined, kind: TriggerSpec['kind']) {
  const spec = region?.triggers.find((t) => t.kind === kind);
  const p: Record<string, number> = {};
  spec?.params.forEach((q) => (p[q.name] = q.default));
  return p;
}

export const useStore = create<CascadeState>((set, get) => ({
  mode: 'connecting',
  connection: 'idle',
  regions: [],
  regionId: 'bayarea',
  triggerKind: 'quake',
  params: {},
  running: false,
  agents: new Map(),
  plans: new Map(),
  verdicts: [],
  events: [],
  memory: [],
  evolving: false,
  narration: [],
  llmCalls: 0,
  replans: 0,
  risks: new Map(),
  riskHistory: new Map(),
  alerts: [],
  calls: new Map(),
  dismissCelebration: () => set({ celebration: undefined }),
  dismissResults: () => set({ results: undefined }),
  snapshots: [],
  viewTick: 'live',
  playing: false,
  speed: 1,
  layers: defaultLayers(),
  exaggeration: 1.6,
  tab: 'incident',
  subTab: 'layers',
  agentView: 'fleet',
  showNewIncident: false,
  incidents: [],
  pulse: 0,

  setSubTab: (subTab) => set({ subTab }),
  setAgentView: (agentView) => set({ agentView }),
  setShowNewIncident: (showNewIncident) => set({ showNewIncident }),
  archiveCurrent: () => {
    const s = get();
    if (!s.runId || !s.scenario) return;
    const inc: Incident = { runId: s.runId, name: incidentName(s.scenario, s.region()), scenario: s.scenario, startedAt: s.incidents.find((i) => i.runId === s.runId)?.startedAt ?? Date.now(), done: !s.running, summary: s.summary, snapshots: s.snapshots, agents: s.agents, plans: s.plans, verdicts: s.verdicts, events: s.events, score: s.score, risks: s.risks, riskHistory: s.riskHistory, alerts: s.alerts, calls: s.calls, narration: s.narration, results: s.results };
    set({ incidents: [inc, ...s.incidents.filter((i) => i.runId !== s.runId)].slice(0, 5) });
  },
  viewIncident: (runId) => {
    const s = get();
    if (runId === s.runId) return;
    s.archiveCurrent();
    const inc = get().incidents.find((i) => i.runId === runId);
    if (!inc) return;
    const last = inc.snapshots[inc.snapshots.length - 1];
    set({ runId: inc.runId, scenario: inc.scenario, running: false, snapshot: last, snapshots: inc.snapshots, score: inc.score ?? last?.score, summary: inc.summary, agents: inc.agents, plans: inc.plans, verdicts: inc.verdicts, events: inc.events, viewTick: 'live', playing: false, selectedAgentId: undefined, risks: inc.risks ?? new Map(), riskHistory: inc.riskHistory ?? new Map(), alerts: inc.alerts ?? [], calls: inc.calls ?? new Map(), narration: inc.narration ?? [], results: undefined });
  },

  viewSnapshot: () => {
    const { snapshots, viewTick, snapshot } = get();
    if (viewTick === 'live') return snapshot;
    return snapshots.find((x) => x.tick === viewTick) ?? snapshot;
  },
  setViewTick: (viewTick) => set({ viewTick }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  stepTick: (d) => {
    const { snapshots, viewTick, snapshot } = get();
    if (!snapshots.length) return;
    const cur = viewTick === 'live' ? (snapshot?.tick ?? 0) : viewTick;
    const idx = Math.max(0, Math.min(snapshots.length - 1, snapshots.findIndex((x) => x.tick === cur) + d));
    const t = snapshots[idx].tick;
    set({ viewTick: idx === snapshots.length - 1 && !get().running ? t : t });
  },
  setLayer: (id, patch) => set((s) => ({ layers: { ...s.layers, [id]: { ...s.layers[id], ...patch } } })),
  setExaggeration: (exaggeration) => set({ exaggeration }),

  region: () => get().regions.find((r) => r.id === get().regionId),
  setMode: (mode) => set({ mode }),
  setConnection: (connection) => set({ connection }),
  setServerRun: (serverRun) => set({ serverRun }),
  setRegions: (regions) => {
    const region = regions.find((r) => r.id === get().regionId) ?? regions[0];
    const kind = region?.triggers[0]?.kind ?? 'quake';
    set({ regions, regionId: region?.id ?? 'bayarea', triggerKind: kind, params: defaultParams(region, kind), clickAt: region?.defaultTriggerAt ?? region?.center });
  },
  setRegion: (regionId) => {
    const region = get().regions.find((r) => r.id === regionId);
    const kind = region?.triggers[0]?.kind ?? 'quake';
    set({ regionId, triggerKind: kind, params: defaultParams(region, kind), clickAt: region?.defaultTriggerAt ?? region?.center, snapshot: undefined, snapshots: [], viewTick: 'live', agents: new Map(), plans: new Map(), verdicts: [], score: undefined, risks: new Map(), riskHistory: new Map(), alerts: [], calls: new Map() });
    if (region) get().fly(region.center, region.zoom);
  },
  setTrigger: (triggerKind) => set({ triggerKind, params: defaultParams(get().region(), triggerKind) }),
  setParam: (name, v) => set({ params: { ...get().params, [name]: v } }),
  setClickAt: (clickAt) => set({ clickAt }),
  setTab: (tab) => set({ tab }),
  selectAgent: (selectedAgentId) => set({ selectedAgentId }),
  fly: (at, zoom) => set({ flyTo: { at, zoom, n: seq++ } }),
  setPlaybook: (playbook) => set({ playbook }),
  setEvolving: (evolving) => set({ evolving }),
  resetRun: () => set({ snapshot: undefined, snapshots: [], viewTick: 'live', agents: new Map(), plans: new Map(), verdicts: [], score: undefined, summary: undefined, running: false, risks: new Map(), riskHistory: new Map(), alerts: [], calls: new Map() }),
  tickPulse: () => set((s) => ({ pulse: (s.pulse + 1) % 1_000_000 })),

  apply: (e) => {
    let s = get();
    const now = Date.now();
    const push = (entry: Omit<TimelineEntry, 'id' | 'ts'>) => {
      const events = [{ id: seq++, ts: now, ...entry }, ...s.events];
      if (events.length > 300) events.length = 300;
      return events;
    };
    const say = (role: string, who: string, text: string, tone: NarrationLine['tone'] = 'info', color?: string): NarrationLine[] =>
      [{ id: seq++, ts: now, role, color: color ?? ROLE_COLOR[role] ?? '#6b7280', who, text, tone }, ...get().narration].slice(0, 8);
    const codeModel = (a: { role: string; districtId?: string; model: string }) => `${agentCodeOf(a)} · ${shortModel(a.model)}`;
    const dName = (id?: string) => s.region()?.districts.find((d) => d.id === id)?.name ?? id ?? '';
    const ev = e as unknown as { type: string; runId?: string };
    if (ev.type === 'relay.message' || ev.type === 'terse.claim' || ev.type === 'terse.actor') { useSponsor.getState().ingest(ev); return; }
    if (ev.type === 'district.risk') {
      const r = e as unknown as DistrictRiskEvent;
      if (s.runId && r.runId && r.runId !== s.runId) return;
      const risks = new Map(s.risks);
      const prev = risks.get(r.districtId);
      const rose = prev ? r.severity > prev.severity : r.severity >= 2;
      risks.set(r.districtId, { ...r, ts: now, roseAt: rose ? now : prev?.roseAt });
      const riskHistory = new Map(s.riskHistory);
      riskHistory.set(r.districtId, [...(riskHistory.get(r.districtId) ?? []), r.severity].slice(-24));
      const tone: NarrationLine['tone'] = r.severity >= 3 ? 'bad' : r.trend === 'settled' || r.trend === 'falling' ? 'good' : 'info';
      set({
        risks, riskHistory,
        narration: say('district', dName(r.districtId).toUpperCase(), `→ severity ${r.label} (${r.trend}) — ${r.forecast?.text ?? r.action ?? ''}`, tone, SEVERITY_COLOR[r.severity] ?? undefined),
        events: rose ? push({ kind: 'risk', text: `${dName(r.districtId)} severity → ${r.label}${r.forecast?.text ? ' · ' + r.forecast.text : ''}`, severity: r.severity >= 3 ? 'critical' : 'warn', tick: r.tick }) : s.events,
      });
      return;
    }
    if (ev.type === 'alert') {
      const a = e as unknown as AlertEvent;
      if (s.runId && a.runId && a.runId !== s.runId) return;
      const alerts = [{ ...a, id: seq++, ts: now }, ...s.alerts].slice(0, 200);
      set({
        alerts,
        narration: say('district', dName(a.districtId).toUpperCase(), `→ alerted ${a.service} (${a.scope}): ${a.message}`, a.scope === 'regional' ? 'bad' : 'info', a.scope === 'regional' ? '#dc2626' : '#d99a0b'),
        events: push({ kind: 'alert', text: `${dName(a.districtId)} alerted ${a.service} (${a.scope}): ${a.message}`, severity: a.scope === 'regional' ? 'critical' : 'warn', tick: a.tick }),
      });
      return;
    }
    if (ev.type === 'call') {
      const c = e as unknown as CallEvent;
      if (s.runId && c.runId && c.runId !== s.runId) return;
      const key = `${c.districtId}|${c.role}|${c.to}`;
      const calls = new Map(s.calls);
      const prev = calls.get(key);
      calls.set(key, { ...c, script: c.script || prev?.script || '', key, ts: now, firstTs: prev?.firstTs ?? now });
      const who = dName(c.districtId).toUpperCase();
      const roleTxt = c.role === 'citizen' ? 'citizen' : 'district emergency contact';
      const script = (c.script || prev?.script || '').replace(/\s+/g, ' ');
      let narration = get().narration;
      if (!prev) {
        narration = say('district', who, `→ calling ${roleTxt} (${maskNumber(c.to)})${c.status === 'simulated' ? ' [simulated]' : ''}: '${script.slice(0, 80)}${script.length > 80 ? '…' : ''}'`, 'info', '#0ea5e9');
      } else if (prev.status !== c.status) {
        if (c.status === 'connected') narration = say('district', who, `→ connected · message delivered (${roleTxt})`, 'good', '#16a34a');
        else if (c.status === 'completed' && prev.status !== 'connected') narration = say('district', who, `→ call completed · ${roleTxt}`, 'good', '#16a34a');
        else if (c.status === 'failed') narration = say('district', who, `→ call to ${roleTxt} failed`, 'bad', '#dc2626');
      }
      set({ calls, narration, events: !prev ? push({ kind: 'call', text: `${dName(c.districtId)} calling ${roleTxt} ${maskNumber(c.to)}`, severity: 'warn', tick: c.tick }) : s.events });
      return;
    }
    switch (e.type) {
      case 'run.start':
        if (s.runId && s.runId !== e.runId) s.archiveCurrent();
        if (e.scenario.regionId && e.scenario.regionId !== s.regionId) { s.setRegion(e.scenario.regionId as any); s = get(); } // a run started elsewhere (API/another tab) switches the view to its region
        set({ narration: say('chief', 'INCIDENT', `declared: ${incidentName(e.scenario, s.region())} · playbook gen ${e.playbookGen}`, 'gold'), llmCalls: 0, replans: 0, results: undefined, risks: new Map(), riskHistory: new Map(), alerts: [], calls: new Map() });
        set({
          runId: e.runId, scenario: e.scenario, running: true, snapshot: undefined, score: undefined, summary: undefined,
          agents: new Map(), plans: new Map(), verdicts: [], selectedAgentId: undefined, snapshots: [], viewTick: 'live', playing: false,
          events: push({ kind: 'run', text: `Run started · ${e.scenario.trigger.kind} in ${e.scenario.regionId} · playbook gen ${e.playbookGen}`, severity: 'info', tick: 0 }),
        });
        break;
      case 'sim.snapshot': {
        if (s.runId && e.runId !== s.runId) break;
        const snapshots = s.snapshots.filter((x) => x.tick !== e.snapshot.tick).concat(e.snapshot).sort((a, b) => a.tick - b.tick);
        set({ snapshot: e.snapshot, score: e.snapshot.score, snapshots });
        break;
      }
      case 'sim.event':
        set({ events: push({ kind: e.kind, text: e.text, severity: e.severity, tick: e.tick, at: e.at }) });
        break;
      case 'agent.spawn': {
        const agents = new Map(s.agents);
        const prev = agents.get(e.agent.id);
        agents.set(e.agent.id, { tokens: prev?.tokens ?? 0, spawnedAt: prev?.spawnedAt ?? now, ...e.agent, updatedAt: now });
        const a = e.agent; const parent = a.parentId ? s.agents.get(a.parentId) : undefined;
        const dname = s.region()?.districts.find((d) => d.id === a.districtId)?.name ?? a.districtId ?? '';
        const hit = s.snapshot?.districts.filter((d) => d.shaking > 0.2 || d.fires > 0 || d.flooded > 0 || d.landslides > 0 || d.cutOff).length ?? 0;
        const line = a.role === 'chief' ? say('chief', `CHIEF · ${shortModel(a.model)}`, `→ assessing ${hit ? hit + ' ' : ''}hit districts`, 'gold')
          : a.role === 'district' ? say('district', `${dname.toUpperCase()} planner · ${shortModel(a.model)}`, '→ forecasting next hour')
          : a.role === 'verifier' ? say('verifier', codeModel(a), `→ auditing ${parent ? agentCodeOf(parent) : dname} plan`)
          : a.role === 'research' ? say('research', codeModel(a), '→ searching live facts for shared memory')
          : a.role === 'reflector' ? say('reflector', codeModel(a), '→ observing the run to evolve the playbook')
          : say(a.role, parent ? agentCodeOf(parent) : 'CHIEF', `→ spawned helper ${agentCodeOf(a)} · ${a.role} (${shortModel(a.model)})`);
        set({ agents, narration: prev ? get().narration : line, events: push({ kind: 'agent', text: `${e.agent.role} spawned · ${e.agent.label}`, severity: 'info', tick: s.snapshot?.tick, at: e.agent.at }) });
        break;
      }
      case 'agent.status': {
        const agents = new Map(s.agents);
        const a = agents.get(e.agentId);
        if (a) {
          agents.set(e.agentId, { ...a, status: e.status as AgentStatus, note: e.note ?? a.note, tokens: e.tokens ?? a.tokens, updatedAt: now });
          const calls = get().llmCalls + (e.status === 'done' || e.status === 'rejected' || e.status === 'error' ? 1 : 0);
          const replans = get().replans + (e.status === 'rejected' && a.role !== 'verifier' ? 1 : 0);
          const nar = e.note && e.status !== a.status ? say(a.role, codeModel(a), `${e.status === 'done' ? '✓' : e.status === 'rejected' || e.status === 'error' ? '✗' : '→'} ${e.note}`, e.status === 'done' ? 'good' : e.status === 'rejected' || e.status === 'error' ? 'bad' : 'info') : get().narration;
          set({ agents, llmCalls: calls, replans, narration: nar });
        }
        if (e.status === 'rejected' || e.status === 'error') {
          set({ events: push({ kind: 'agent', text: `${a?.label ?? e.agentId} ${e.status}${e.note ? ' · ' + e.note : ''}`, severity: e.status === 'error' ? 'error' : 'warn', tick: s.snapshot?.tick, at: a?.at }) });
        }
        break;
      }
      case 'agent.plan': {
        const plans = new Map(s.plans);
        plans.set(e.agentId, e.plan);
        const a = s.agents.get(e.agentId);
        const helpers = e.plan.helpersRequested?.length ? ` · asks for ${e.plan.helpersRequested.join(', ')}` : '';
        set({ plans, narration: say(a?.role ?? 'district', dName(e.plan.districtId ?? a?.districtId).toUpperCase() || (a ? codeModel(a) : e.agentId), `→ evacuation plan: ${e.plan.routes.length} routes · ${e.plan.fireCrews} crews · airlift ${e.plan.airlift ? 'yes' : 'no'}${helpers}`), events: push({ kind: 'plan', text: `${a?.label ?? e.agentId} planned: ${e.plan.summary}`, severity: 'info', tick: s.snapshot?.tick, at: a?.at }) });
        break;
      }
      case 'verifier.verdict': {
        const verdicts = [{ id: seq++, agentId: e.agentId, verdict: e.verdict, ts: now }, ...s.verdicts].slice(0, 60);
        const a = s.agents.get(e.agentId);
        const tDid = e.verdict.districtId ?? a?.districtId;
        const target = tDid ? dName(tDid).toUpperCase() : a ? agentCodeOf(a) : e.agentId;
        set({
          llmCalls: get().llmCalls + 1,
          narration: say('verifier', 'VERIFIER', `${e.verdict.accepted ? '✓ ACCEPTED' : '✗ REJECTED'} ${target}${e.verdict.reasons[0] ? ' — ' + e.verdict.reasons[0] : ''}`, e.verdict.accepted ? 'good' : 'bad', e.verdict.accepted ? '#16a34a' : '#dc2626'),
          verdicts,
          events: push({ kind: 'verifier', text: `${e.verdict.accepted ? 'ACCEPTED' : 'REJECTED'} ${a?.label ?? e.agentId}${e.verdict.reasons[0] ? ' — ' + e.verdict.reasons[0] : ''}`, severity: e.verdict.accepted ? 'info' : 'warn', tick: s.snapshot?.tick, at: a?.at }),
        });
        break;
      }
      case 'score.update':
        set({ score: e.score });
        break;
      case 'run.done':
        if (e.runId !== s.runId) break;
        {
          let tokens = 0, levels = 0; s.agents.forEach((a) => { tokens += a.tokens; levels = Math.max(levels, a.depth + 1); });
          const accepted = s.verdicts.filter((v) => v.verdict.accepted).length;
          const delegated = new Set([...s.agents.values()].filter((a) => a.role === 'district' && a.districtId).map((a) => a.districtId)).size;
          let escalated = 0; s.riskHistory.forEach((h) => { if (h.some((v) => v >= 3)) escalated++; });
          set({ results: { id: seq++, name: incidentName(s.scenario, s.region()), score: e.score, summary: e.summary, agents: s.agents.size, levels, accepted, rejected: s.verdicts.length - accepted, replans: s.replans, llmCalls: s.llmCalls, tokens, alerts: s.alerts.length, escalated, delegated, calls: s.calls.size }, narration: say('chief', 'RUN COMPLETE', `score ${e.score.total} · ${e.summary}`, 'gold') });
        }
        set({ running: false, score: e.score, summary: e.summary, events: push({ kind: 'run', text: `Run complete · score ${e.score.total} · ${e.summary}`, severity: 'info', tick: s.snapshot?.tick }) });
        break;
      case 'playbook.update':
        if (e.change) set({
          celebration: { id: seq++, kept: e.change.kept, fromGen: e.change.kept ? e.change.generation - 1 : e.playbook.generation, toGen: e.change.generation, before: e.change.before, after: e.change.after, diff: e.change.diff, summary: e.change.summary, heldOut: e.change.heldOutScenarios.length },
          narration: say('reflector', 'REFLECTOR', `→ Gen ${e.change.generation} ${e.change.kept ? 'KEPT' : 'DISCARDED'} · ${e.change.before} → ${e.change.after} on ${e.change.heldOutScenarios.length} held-out scenarios · ${e.change.summary}`, e.change.kept ? 'gold' : 'info', e.change.kept ? '#f59e0b' : '#8a817a'),
        });
        set({
          playbook: e.playbook, evolving: false,
          events: push({ kind: 'playbook', text: e.change ? `Playbook gen ${e.change.generation}: ${e.change.summary} → ${e.change.kept ? 'KEPT' : 'DISCARDED'}` : `Playbook now at generation ${e.playbook.generation}`, severity: 'info' }),
        });
        break;
      case 'memory.update':
        set({ narration: say('research', 'RESEARCH', `→ shared memory ← ${e.key}: ${e.value.slice(0, 90)}${e.value.length > 90 ? '…' : ''}`, 'info') });
        set({ memory: [{ key: e.key, value: e.value, ts: now }, ...s.memory.filter((m) => m.key !== e.key)].slice(0, 40) });
        break;
      case 'log':
        set({ events: push({ kind: 'log', text: e.text, severity: e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : 'info', tick: s.snapshot?.tick }) });
        break;
    }
  },
}));

// ---- helpers shared by panels and map ----
export const ROLE_COLOR: Record<string, string> = {
  chief: '#f59e0b', district: '#2563eb', route: '#0d9488', firecrew: '#16a34a', shelter: '#059669', supply: '#0891b2', airlift: '#0ea5e9',
  verifier: '#ef4444', research: '#7c3aed', reflector: '#374151',
};
export function shortModel(m: string): string {
  // "nvidia/Nemotron-3-Super-120B-A12B" -> "Nemotron Super 120B"; "nvidia/nemotron-3.5-lightning-30b-a3b" -> "Nemotron 3.5 Lightning 30B"
  const tail = (m ?? '').split('/').pop() ?? '';
  const toks = tail.split(/[-_]/).filter(Boolean)
    .filter((t, i) => !(i === 0 && /^nvidia$/i.test(t)))  // drop vendor prefix ("NVIDIA-Nemotron-...")
    .filter((t) => !/^\d+$/.test(t))            // drop integer-only major version ("3")
    .filter((t) => !/^a\d+b$/i.test(t))         // drop active-param suffix ("A12B")
    .map((t) => (/^\d+(\.\d+)?b$/i.test(t) ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1)));
  return toks.join(' ') || m;
}
export function agentColor(a: { role: string; status: string }, verdictAccepted?: boolean) {
  if (a.role === 'verifier') return a.status === 'rejected' ? '#ef4444' : a.status === 'done' ? '#16a34a' : '#f97316';
  if (a.status === 'rejected') return '#ef4444';
  return ROLE_COLOR[a.role] ?? '#6b7280';
}
