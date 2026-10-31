// Agent Relay: every spawned agent becomes a relay participant; they talk over a per-run channel, DMs and threads.
// The district planner's LLM prompt includes its relay inbox (assignment DM + other districts' posts/claims),
// so coordination genuinely flows through Relay. All calls are queued, retried on 503, time-limited and never
// awaited on the sim tick path; if Relay is down the sim keeps running.
import '../env.ts';
import fs from 'node:fs';
import path from 'node:path';
import { emit } from '../bus.ts';

const KEY_FILE = path.resolve(process.cwd(), '.relay-workspace.json');
const DISABLED = process.env.RELAY_DISABLED === '1';
// Agent Relay engine: hosted Relaycast by default; RELAY_BASE_URL points at a self-hosted @relaycast/engine (same engine, open source)
const BASE_URL = process.env.RELAY_BASE_URL || '';
const OP_TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS) || 25_000;
const MAX_AGENTS_PER_RUN = Number(process.env.RELAY_MAX_AGENTS) || 80;
const CONCURRENCY = Number(process.env.RELAY_CONCURRENCY) || 8;
const MAX_QUEUE = 120;
const HELPER_IDS = process.env.RELAY_HELPER_IDENTITIES === '1';

export interface RelayMsg { id: string; runId?: string; from: string; to?: string; channel?: string; text: string; threadOf?: string; ts: number }

let relay: any = null;
let ready: Promise<boolean> | null = null;
let warned = false;
const seen = new Set<string>();
const cache: RelayMsg[] = [];
const agents = new Map<string, Promise<any | null>>();   // relay name -> registered agent client
const channels = new Map<string, Promise<boolean>>();     // channel name -> created
const runAgentCount = new Map<string, number>();

// ---- tiny queue with retry/backoff for the (currently busy) hosted relay ----
let active = 0; const waiters: (() => void)[] = [];
async function q<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  if (waiters.length > MAX_QUEUE) return null;
  if (active >= CONCURRENCY) await new Promise<void>(r => waiters.push(r));
  active++;
  try {
    for (let i = 0; i < 4; i++) {
      try {
        return await Promise.race([fn(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error('relay timeout')), OP_TIMEOUT_MS))]);
      } catch (e: any) {
        const retryable = e?.retryable || e?.status === 503 || e?.statusCode === 429 || /overloaded|timeout|rate|busy|fetch failed|ECONNREFUSED|socket/i.test(e?.message ?? '');
        if (!retryable || i === 3) { warn(`${label}: ${e?.message ?? e}`); return null; }
        await new Promise(r => setTimeout(r, Math.min(6000, e?.retryAfterMs ?? 1500 * (i + 1))));
      }
    }
    return null;
  } finally { active--; waiters.shift()?.(); }
}
function warn(msg: string) {
  if (!warned) { warned = true; setTimeout(() => { warned = false; }, 30_000); }
  else return;
  console.warn(`[relay] ${msg}`);
  emit({ type: 'log', level: 'warn', text: `[relay] ${msg.slice(0, 160)}` });
}

export const shortRun = (runId: string) => runId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-5) || 'run';
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
// one standing incident channel per server boot (created during pre-warm) so runs never wait on channel creation
export const runChannel = (_runId: string) => process.env.RELAY_CHANNEL || 'elnino-storm';

export function initRelay(): Promise<boolean> {
  if (DISABLED) return Promise.resolve(false);
  if (ready) return ready;
  ready = (async () => {
    try {
      const { AgentRelay } = await import('@agent-relay/sdk');
      // fresh workspace per boot (agent identities are stable names, so reusing a workspace would 409 on re-register)
      let key = process.env.RELAY_WORKSPACE_KEY || '';
      if (key) relay = new (AgentRelay as any)({ workspaceKey: key, ...(BASE_URL ? { baseUrl: BASE_URL } : {}) });
      else {
        relay = await (AgentRelay as any).createWorkspace({ name: `superscade-${Date.now().toString(36)}`, ...(BASE_URL ? { baseUrl: BASE_URL } : {}) });
        key = relay.workspaceKey;
        try { fs.writeFileSync(KEY_FILE, JSON.stringify({ workspaceKey: key, createdAt: new Date().toISOString() }, null, 2)); } catch { /* read-only fs */ }
      }
      try {
        relay.addListener('message.created', (e: any) => {
          const m = e?.message ?? e?.payload?.message ?? e;
          if (!m?.id && !m?.messageId) return;
          observe({ id: String(m.id ?? m.messageId), from: String(e?.envelope?.from?.handle ?? m.from?.name ?? m.from?.handle ?? m.agentName ?? '?'), channel: e?.envelope?.channel?.name ?? m.channel?.name, to: m.target?.name ?? m.target?.handle, text: String(m.text ?? ''), threadOf: m.parentId ?? m.threadId ?? undefined, ts: Date.now() });
        });
      } catch (e: any) { console.warn('[relay] listener unavailable:', e?.message); }
      console.log(`[relay] workspace ready on ${BASE_URL || 'hosted Relaycast'} (${String(key).slice(0, 12)}…)`);
      return true;
    } catch (e: any) {
      console.warn('[relay] init failed; continuing without Agent Relay (will retry):', e?.message ?? e);
      relay = null;
      setTimeout(() => { ready = null; }, 5_000); // engine may still be booting: allow a retry
      return false;
    }
  })();
  return ready;
}

function observe(m: RelayMsg) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  if (!m.runId) { const ch = m.channel ?? ''; const hit = /^storm-([a-z0-9]+)/.exec(ch); if (hit) m.runId = undefined; }
  cache.push(m);
  if (cache.length > 600) cache.shift();
  emit({ type: 'relay.message', runId: m.runId, id: m.id, from: m.from, to: m.to, channel: m.channel, text: m.text.slice(0, 600), threadOf: m.threadOf, ts: m.ts });
}

/** register (once) a relay participant; joins the run channel. Returns null if relay is down / cap reached. */
export function ensureAgent(runId: string, name: string): Promise<any | null> {
  const got = agents.get(name);
  if (got) return got;
  const n = (runAgentCount.get(runId) ?? 0) + 1;
  if (n > MAX_AGENTS_PER_RUN) return Promise.resolve(null);
  runAgentCount.set(runId, n);
  const p = (async () => {
    if (!(await initRelay())) return null;
    const client: any = await q(`register ${name}`, () => relay.workspace.register({ name, type: 'agent' }) as Promise<any>);
    if (!client) return null;
    const ch = runChannel(runId);
    if (!channels.has(ch)) channels.set(ch, q(`channel ${ch}`, () => client.channels.create({ name: ch, topic: `SUPERSCADE storm response run ${runId}` })).then(() => true));
    else { await channels.get(ch); await q(`join ${ch}`, () => client.channels.join(ch)); }
    return client;
  })();
  agents.set(name, p);
  // failed registration (hosted relay busy): forget it so a later call / the background pre-warm can retry
  void p.then((c) => { if (!c && agents.get(name) === p) { agents.delete(name); runAgentCount.set(runId, Math.max(0, (runAgentCount.get(runId) ?? 1) - 1)); } });
  return p;
}

/** post as `from` to '#channel' or '@handle'. Never throws; resolves to the relay message id (or null). */
export function relaySend(runId: string, from: string, to: string, text: string): Promise<string | null> {
  if (DISABLED) return Promise.resolve(null);
  return (async () => {
    // helpers speak through the chief's connection (name-prefixed) unless RELAY_HELPER_IDENTITIES=1: keeps
    // registrations per run low while the hosted relay is under load
    const proxied = !HELPER_IDS && /^(route|firecrew|shelter|airlift|supply|research)-/.test(from);
    let client = proxied ? null : await ensureAgent(runId, from);
    let body = text;
    if (!client) { client = await ensureAgent(runId, 'chief'); body = `[${from}] ${text}`; }
    if (!client) return null;
    if (to.startsWith('@')) await ensureAgent(runId, to.slice(1));
    else if (to.startsWith('#')) await channels.get(to.slice(1));
    const m: any = await q(`send ${from}->${to}`, () => client.sendMessage({ to, text: body.slice(0, 1800) }));
    if (!m) return null;
    const id = String(m.id ?? m.messageId);
    console.log(`[relay] ${from} -> ${to}: ${body.slice(0, 80)}`);
    observe({ id, runId, from, to: to.startsWith('@') ? to.slice(1) : undefined, channel: to.startsWith('#') ? to.slice(1) : undefined, text: body, ts: Date.now() });
    return id;
  })().catch(() => null);
}

/** threaded reply (e.g. verifier ACCEPT/REJECT under a district's plan post) */
export function relayReply(runId: string, from: string, parent: Promise<string | null> | string | null, text: string): Promise<string | null> {
  if (DISABLED) return Promise.resolve(null);
  return (async () => {
    const messageId = await parent;
    if (!messageId) return relaySend(runId, from, `#${runChannel(runId)}`, text);
    const client = await ensureAgent(runId, from);
    if (!client) return null;
    const m: any = await q(`reply ${from}`, () => client.reply({ messageId, text: text.slice(0, 1800) }));
    if (!m) return null;
    const id = String(m.id ?? m.messageId);
    observe({ id, runId, from, channel: runChannel(runId), text, threadOf: messageId, ts: Date.now() });
    return id;
  })().catch(() => null);
}

/** what this agent has received over Relay: DMs to it + recent run-channel posts by others (instant, from cache) */
export function relayInbox(runId: string, name: string, max = 8): string[] {
  const ch = runChannel(runId);
  return cache
    .filter(m => m.from !== name && (!m.runId || m.runId === runId) && (m.to === name || m.channel === ch))
    .slice(-max)
    .map(m => `${m.to === name ? 'DM' : `#${m.channel}${m.threadOf ? ' (thread)' : ''}`} from ${m.from}: ${m.text.slice(0, 220)}`);
}

export function relayStatus() { return { enabled: !!relay, cached: cache.length, agents: agents.size, queued: waiters.length }; }

/** register the standing agent identities up front (server boot) so live runs only pay for sends */
export async function prewarmRelay(names: string[]): Promise<void> {
  if (DISABLED || !(await initRelay())) return;
  const t0 = Date.now();
  const first = names[0];
  if (first) await ensureAgent('boot', first); // creates the standing channel
  const results = await Promise.all(names.slice(1).map(n => ensureAgent('boot', n).catch(() => null)));
  const ok = results.filter(Boolean).length + (first ? 1 : 0);
  const missing = names.slice(1).filter((_, i) => !results[i]);
  if (missing.length) setTimeout(() => { void prewarmRelay([first, ...missing]); }, 20_000); // keep retrying the ones the busy relay refused
  console.log(`[relay] pre-registered ${ok}/${names.length} agent identities + #${runChannel('')} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  emit({ type: 'log', level: 'info', text: `[relay] ${ok} agents online on Agent Relay (#${runChannel('')})` });
}
