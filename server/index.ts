import { stopRun } from './run.ts';
// SUPERSCADE server: Express + SSE. Routes per shared/types.ts (bottom) plus /api/health and /api/usage.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';

// ---- manual .env (no dotenv dep): never overwrite existing env ----
(function loadEnv() {
  for (const f of ['.env', '.env.local']) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
})();

const { emit, sseHandler } = await import('./bus.ts');
const { regions, getRegion } = await import('./regions/index.ts');
const { simModule } = await import('./sim/engine.ts');
const { isMock, MODELS, usage, listModels } = await import('./agents/crusoe.ts');
const { getPlaybook, resetPlaybook, evolve } = await import('./agents/playbook.ts');
const { startRun, getLastRunSummary, getLastRunRegion, currentRun, buildTrigger } = await import('./run.ts');
const { isYouMock } = await import('./agents/youcom.ts');
// sponsor integrations (never block startup): Agent Relay workspace + Terse actor probe
const { initRelay, prewarmRelay, slug: relaySlug } = await import('./infra/relay.ts');
const { isTerseUp } = await import('./infra/terse.ts');
void initRelay().then(() => prewarmRelay(['chief', 'verifier', ...[...new Set(Object.values(regions).flatMap((r: any) => r.districts.map((d: any) => `district-${relaySlug(d.id)}`)))]])).catch(() => false);
void isTerseUp().then(up => console.log(`[terse] durable actors ${up ? 'reachable' : 'NOT reachable (cd actors && bunx terse-cli@latest actor dev)'}`)).catch(() => {});

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  let models: string[] | string = Object.values(MODELS);
  if (_req.query.live === '1') { try { models = await listModels(); } catch (e: any) { models = `models fetch failed: ${e.message}`; } }
  res.json({ ok: true, mock: isMock(), youMock: isYouMock(), models: MODELS, available: models, usage, run: currentRun(), playbookGen: getPlaybook().generation });
});
app.get('/api/usage', (_req, res) => res.json(usage));

const LOCK_REGION = process.env.LOCK_REGION; // demo safety: only this region can be viewed/run
app.get('/api/regions', (_req, res) => res.json(Object.values(regions).filter(r => !LOCK_REGION || r.id === LOCK_REGION)));

const cellCache = new Map<string, unknown>();
app.get('/api/regions/:id/cells', (req, res) => {
  try {
    const region = getRegion(req.params.id);
    if (!cellCache.has(region.id)) {
      const scenario = simModule.makeScenario(region, buildTrigger(region.id), 1);
      cellCache.set(region.id, simModule.createSim(region, scenario).cells);
    }
    res.json(cellCache.get(region.id));
  } catch (e: any) { res.status(404).json({ error: e.message }); }
});

app.post('/api/run', (req, res) => {
  try {
    const body = req.body ?? {};
    if (!body.regionId) return res.status(400).json({ error: 'regionId required' });
    getRegion(body.regionId);
    if (LOCK_REGION && body.regionId !== LOCK_REGION) return res.status(400).json({ error: `region locked to ${LOCK_REGION} for this demo` });
    console.log(`[run] start requested: region=${body.regionId} seed=${body.seed ?? 'random'} realCalls=${body.realCalls === undefined ? true : !!body.realCalls} from=${req.ip} ua=${(req.get('user-agent') ?? '').slice(0, 70)} ref=${req.get('referer') ?? '-'}`);
    const out = startRun({ regionId: body.regionId, trigger: body.trigger, seed: body.seed, realCalls: body.realCalls === true }); // real calls are OFF unless explicitly requested (and ALLOW_REAL_CALLS=1)
    res.json(out);
  } catch (e: any) { res.status(e.status ?? 400).json({ error: e.message, run: currentRun() }); }
});

app.get('/api/events', sseHandler);
app.get('/api/playbook', (_req, res) => res.json(getPlaybook()));
app.get('/api/last-run', (_req, res) => res.json({ regionId: getLastRunRegion(), summary: getLastRunSummary() }));

let evolving = false;
app.post('/api/evolve', async (req, res) => {
  if (evolving) return res.status(409).json({ error: 'evolve already in progress' });
  evolving = true;
  try {
    const regionId = req.body?.regionId ?? getLastRunRegion();
    const change = await evolve(regionId, req.body?.summary ?? getLastRunSummary());
    res.json({ change, playbook: getPlaybook() });
  } catch (e: any) {
    emit({ type: 'log', level: 'error', text: `evolve failed: ${e.message}` });
    res.status(500).json({ error: e.message });
  } finally { evolving = false; }
});
app.post('/api/reset', (_req, res) => res.json(resetPlaybook()));
app.post('/api/stop', (req, res) => { console.log(`[run] stop requested from=${req.ip}`); res.json({ stopped: stopRun() }); });

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(process.cwd(), 'dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[superscade] listening on http://localhost:${port}  mode=${isMock() ? 'MOCK_LLM (no OPENAI_API_KEY or MOCK_LLM=1)' : 'LIVE LLM'}  you.com=${isYouMock() ? 'mock' : 'live'}  playbook gen ${getPlaybook().generation}  regions=${Object.keys(regions).join(',')}`);
  emit({ type: 'playbook.update', playbook: getPlaybook() });
});
