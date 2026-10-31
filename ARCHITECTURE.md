# SUPERSCADE — architecture (read this first)

Disaster-cascade response simulator run by a recursive agent team on Crusoe Managed Inference.
Hackathon: Recursive Agents Hackathon (Cerebral Valley x Crusoe), Oct 17 2026. Deadline 5pm PT.

## Layout
- `shared/types.ts`      — THE contract. Do not change shapes without updating all consumers.
- `server/index.ts`      — Express on :8787. Routes listed at bottom of shared/types.ts. SSE at /api/events.
- `server/sim/`          — deterministic cascade engine (grid, hazards, infra, scoring). No LLM calls.
- `server/regions/`      — region configs (bayarea.ts, nepal.ts) implementing RegionConfig.
- `server/agents/`       — LLM layer: crusoe client, chief/district/helper/verifier/reflector, playbook.
- `client/`              — Vite + React + MapLibre. Reads SSE, draws hazards/infra/routes/agents.

## Models (Crusoe, OpenAI-compatible, base https://api.inference.crusoecloud.com/v1)
- chief / verifier / reflector: `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`
- district agents:              `nvidia/Nemotron-3.5-Lightning-30B-A3B`
- helper agents:                `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
Pass `chat_template_kwargs: {enable_thinking: false}` for direct JSON answers; max_tokens >= 1024.
Rate limits are per model per minute; spread roles across models. Retry 429/503 with backoff.
Env: CRUSOE_API_KEY (single quotes in shell!), YDC_API_KEY (You.com), PORT.

## Event bus
`server/bus.ts` exports `emit(event: CascadeEvent)` and the SSE handler. Everything (sim + agents) emits through it.

## Run loop (server/run.ts)
1. POST /api/run -> build Scenario -> create Sim -> emit run.start
2. For tick in 0..N: sim.step(); emit sim.snapshot (every tick) + sim.event for notable changes
3. At tick 0 and whenever new districts get hit: orchestrator.respond(simState, playbook)
   - chief spawns district agents (parallel) -> each may spawn helpers -> plans
   - verifier checks each plan (deterministic checks + LLM) -> reject => district re-plans (max 2)
   - accepted plans are applied to the sim (routes, crews, airlift) and change the score
4. emit run.done with Score

## Version N+1 (server/agents/playbook.ts)
After a run, POST /api/evolve: reflector proposes a Playbook change (rules text + params);
fast evaluator runs the deterministic sim with `autoRespond(params)` on 3 held-out scenario seeds;
keep the change only if mean score improves. Emit playbook.update with before/after.
