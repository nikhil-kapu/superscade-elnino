// LLM client (OpenAI chat-completions API). JSON-only chat helper with retries + mock mode.
// Provider: OpenAI when OPENAI_API_KEY is set (default for this build); Crusoe Managed Inference when only CRUSOE_API_KEY is set.
import '../env.ts';
import type { AgentRole } from '../../shared/types.ts';

export const PROVIDER: 'openai' | 'crusoe' = process.env.OPENAI_API_KEY ? 'openai' : 'crusoe';
const IS_OPENAI = PROVIDER === 'openai';
export const BASE_URL = IS_OPENAI ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') : (process.env.CRUSOE_BASE_URL || 'https://api.inference.crusoecloud.com/v1');
const API_KEY = () => (IS_OPENAI ? process.env.OPENAI_API_KEY : process.env.CRUSOE_API_KEY);

// three tiers: SUPER = chief/verifier/reflector, LIGHTNING = district planners, NANO = helpers
const SUPER = IS_OPENAI ? (process.env.OPENAI_MODEL_BIG || process.env.OPENAI_MODEL || 'gpt-4.1-mini') : 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B';
const LIGHTNING = IS_OPENAI ? (process.env.OPENAI_MODEL || 'gpt-4.1-mini') : 'nvidia/Nemotron-3.5-Lightning-30B-A3B';
const NANO = IS_OPENAI ? (process.env.OPENAI_MODEL_SMALL || 'gpt-4.1-nano') : 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';

export const MODELS: Record<AgentRole, string> = {
  chief: SUPER,
  verifier: SUPER,
  reflector: SUPER,
  district: LIGHTNING,
  route: NANO,
  firecrew: NANO,
  shelter: NANO,
  supply: NANO,
  airlift: NANO,
  research: NANO,
};

export function isMock(): boolean {
  return process.env.MOCK_LLM === '1' || !API_KEY();
}

export interface UsageEntry { requests: number; tokens: number; errors: number; retries: number; ms: number }
export const usage: Record<string, UsageEntry> = {};
function bump(model: string, patch: Partial<UsageEntry>) {
  const u = (usage[model] ??= { requests: 0, tokens: 0, errors: 0, retries: 0, ms: 0 });
  for (const k of Object.keys(patch) as (keyof UsageEntry)[]) u[k] += patch[k] ?? 0;
}

export interface ChatOpts<T> {
  role: AgentRole;
  system: string;
  user: string;
  schemaHint: string;
  maxTokens?: number;
  temperature?: number;
  /** used in MOCK mode (or as last-resort fallback is NOT done: caller decides). */
  mock?: () => T;
}
export interface ChatResult<T> { data: T; model: string; tokens: number; cached: number; ms: number; mock: boolean }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// concurrency caps: global (all live LLM calls) + per model (Lightning 429s above ~2 in flight)
const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY) || 6;
const PER_MODEL_CAP: Record<string, number> = IS_OPENAI ? {} : { [LIGHTNING]: Number(process.env.LIGHTNING_CONCURRENCY) || 1 };
/** fallback model when the primary keeps returning 429 */
export const FALLBACK: Record<string, string> = SUPER === LIGHTNING ? { [LIGHTNING]: NANO } : { [LIGHTNING]: NANO, [SUPER]: LIGHTNING };
function makeSem(n: number) { let active = 0; const q: (() => void)[] = []; return { async run<T>(fn: () => Promise<T>): Promise<T> { if (active >= n) await new Promise<void>(r => q.push(r)); active++; try { return await fn(); } finally { active--; q.shift()?.(); } }, state: () => ({ active, queued: q.length, cap: n }) }; }
const globalSem = makeSem(LLM_CONCURRENCY);
const modelSems = new Map<string, ReturnType<typeof makeSem>>();
function semFor(model: string) { let s = modelSems.get(model); if (!s) { s = makeSem(PER_MODEL_CAP[model] ?? LLM_CONCURRENCY); modelSems.set(model, s); } return s; }
async function withLLMSlot<T>(model: string, fn: () => Promise<T>): Promise<T> { return semFor(model).run(() => globalSem.run(fn)); }
export function llmInFlight() { return { global: globalSem.state(), perModel: Object.fromEntries([...modelSems].map(([m, s]) => [m, s.state()])) }; }

export function extractJSON(text: string): any {
  if (!text) throw new Error('empty completion');
  let s = text.trim();
  s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('no JSON object in completion');
  const body = s.slice(a, b + 1);
  try { return JSON.parse(body); } catch {
    // literal newlines/tabs inside strings, trailing commas
    const cleaned = body.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  }
}

/** Deterministic pseudo-latency so demos feel like real inference (300..800ms). */
export async function mockLatency(seedStr = '') {
  let h = 7;
  for (const c of seedStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const ms = 300 + (h % 500);
  await sleep(ms);
  return ms;
}

export async function chatJSON<T = any>(opts: ChatOpts<T>): Promise<ChatResult<T>> {
  let model = MODELS[opts.role] ?? NANO;
  if (isMock()) {
    const t0 = Date.now();
    const ms = await mockLatency(opts.role + opts.user.slice(0, 64));
    bump(model, { requests: 1, tokens: 0, ms: Date.now() - t0 });
    const data = opts.mock ? opts.mock() : (defaultMock(opts.role) as T);
    return { data, model, tokens: Math.round(200 + ms / 2), cached: 0, ms, mock: true };
  }
  const body: any = {
    model,
    messages: [
      { role: 'system', content: `${opts.system}\nRespond with ONLY a single JSON object, no prose, no markdown fences. Schema: ${opts.schemaHint}` },
      { role: 'user', content: opts.user },
    ],
    temperature: opts.temperature ?? 0.6,
    max_tokens: Math.max(1024, opts.maxTokens ?? 1500),
  };
  if (IS_OPENAI) body.response_format = { type: 'json_object' };
  else body.chat_template_kwargs = { enable_thinking: false };
  // queue-depth overflow: when a capped model already has callers waiting (e.g. 11 district planners after a city-wide quake
  // on a 1-concurrent Lightning), send the extra ones to the fallback model instead of serialising them behind it.
  const OVERFLOW_AT = Number(process.env.LLM_OVERFLOW_QUEUE ?? 2);
  if (OVERFLOW_AT > 0 && PER_MODEL_CAP[model] !== undefined && FALLBACK[model] && semFor(model).state().queued >= OVERFLOW_AT) {
    console.log(`[crusoe] ${model} has ${semFor(model).state().queued} callers queued; overflowing ${opts.role} to ${FALLBACK[model]}`);
    model = FALLBACK[model]; body.model = model;
  }
  return withLLMSlot(model, () => chatLive<T>(model, body));
}

async function chatLive<T>(model: string, body: any): Promise<ChatResult<T>> {
  const maxTries = 4;
  let lastErr: any;
  let rateLimited = 0;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const t0 = Date.now();
    if (rateLimited >= 1 && FALLBACK[model] && FALLBACK[model] !== model) {
      console.warn(`[crusoe] ${model} rate-limited ${rateLimited}x; falling back to ${FALLBACK[model]}`);
      model = FALLBACK[model]; body = { ...body, model }; rateLimited = 0;
    }
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const ms = Date.now() - t0;
      if (res.status === 429 || res.status === 503 || res.status >= 500) {
        if (res.status === 429) rateLimited++;
        bump(model, { requests: 1, errors: 1, ms });
        throw Object.assign(new Error(`${PROVIDER} ${res.status}: ${(await res.text()).slice(0, 200)}`), { retryable: true });
      }
      if (!res.ok) {
        bump(model, { requests: 1, errors: 1, ms });
        throw Object.assign(new Error(`${PROVIDER} ${res.status}: ${(await res.text()).slice(0, 300)}`), { retryable: false });
      }
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = JSON.parse(text.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ')); }
      const choice = json.choices?.[0] ?? {};
      const msg = choice.message ?? {};
      const content: string = (msg.content || msg.reasoning_content || msg.reasoning || '') as string;
      const tokens = json.usage?.total_tokens ?? 0;
      const cached = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      bump(model, { requests: 1, tokens, ms });
      let data: T;
      try { data = extractJSON(content); } catch (e: any) {
        if (choice.finish_reason === 'length') body.max_tokens = Math.min(8192, (body.max_tokens ?? 1500) * 2);
        throw Object.assign(new Error(`parse failure (finish=${choice.finish_reason}): ${e.message}; content=${String(content).slice(0, 160)}`), { retryable: true });
      }
      return { data, model, tokens, cached, ms, mock: false };
    } catch (e: any) {
      lastErr = e;
      const retryable = e?.retryable !== false; // network errors count as retryable
      if (!retryable || attempt === maxTries - 1) break;
      bump(model, { retries: 1 });
      const backoff = 1000 * 2 ** attempt + Math.random() * 400;
      console.warn(`[crusoe] retry ${attempt + 1}/${maxTries - 1} ${model} in ${Math.round(backoff)}ms: ${String(e?.message).slice(0, 160)}`);
      await sleep(backoff);
    }
  }
  throw lastErr ?? new Error('crusoe: unknown failure');
}

export async function listModels(): Promise<string[]> {
  if (isMock()) return [...new Set(Object.values(MODELS))];
  const res = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${API_KEY()}` } });
  if (!res.ok) throw new Error(`${PROVIDER} models ${res.status}`);
  const json: any = await res.json();
  return (json.data ?? []).map((m: any) => m.id);
}

/** Generic canned JSON per role, used only when a caller gives no role-specific mock. */
function defaultMock(role: AgentRole): any {
  switch (role) {
    case 'chief': return { assignments: [], memoryNotes: ['mock chief: no districts affected'] };
    case 'district': return { summary: 'mock plan', routes: [], fireCrews: 0, shelters: [], airlift: false, helpersRequested: [] };
    case 'verifier': return { accepted: true, reasons: ['mock verifier accepts'] };
    case 'reflector': return { rules: [], params: {}, summary: 'mock reflector: no change' };
    case 'route': return { orderedInfraIds: [] };
    case 'firecrew': return { fireCrews: 1, why: 'mock' };
    case 'shelter': return { shelterIds: [] };
    case 'airlift': case 'supply': return { yes: false, capacity: 0, why: 'mock' };
    case 'research': return { facts: [] };
  }
}
