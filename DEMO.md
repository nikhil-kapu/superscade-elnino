# Judging runbook (3 min demo + 2 min Q&A)

## 5 minutes before (do all of these)
1. Terminal: `cd cascade && pnpm dev` (or confirm both are up: `curl localhost:8787/api/health` says `"mock":false`, http://localhost:5173 loads).
2. `curl -s -X POST localhost:8787/api/reset` → playbook back to Gen 0 (or Analysis tab → "Reset to Gen 0").
3. Browser window ≥ 1400 px wide, full screen (the Delegation pill hides on narrow windows). Reload the page: Nepal terrain, slowly orbiting, big orange **Start** button.
4. Phones: your phone (ends 4930) and the resident phone (ends 7750) on the table, ringer on, volume up. Say nothing about them yet.
5. Keep this file and the Twilio console closed; nothing else needed.

## The 3 minutes

**0:00 Hook (10 s) — point at the idle scene.**
"Most agent demos are one agent, one shot. SUPERSCADE is a team of agents you can walk away from during a compound disaster. This is Nepal's Trishuli basin, modelled on the real August flood. One click."

**0:10 CLICK the orange Start button. Stay on the Incident tab (30 s).**
Narrate what appears, top to bottom:
- Narration strip: "The chief, on Nemotron Super, is reading the risk monitor and notifying one district agent per district at risk."
- Terrain: "Rain soaks the slopes, landslides dam the river, the dam bursts and the flood runs downstream closing bridges. One event sets off the next."
- Pills: "Every pill is a live model call on Crusoe Managed Inference. Chief on Super 120B, district planners on Lightning 30B, their helpers on Nano 30B. The tree fans out on the map."
- When your phone rings (about 10 s in): hold it up. "That is Rasuwa's agent. It hit 'evacuate', so it phoned the district emergency contact with its one-hour forecast and plan. Real call, placed by the agent." Decline it or let it play on speaker for 5 s.

**0:40 CLICK the Delegation tab (45 s).**
- Chief card: "Here is the delegation. The chief notified these districts and shared its notes."
- Pick the top card: "Each district agent forecasts its own next hour, grades severity, and acts to match the tier. Monitoring means no public alert. Evacuate means district fire and medical are alerted and shelters open. Escalate means it requests boats or helicopters from the regional pool."
- Point at a red flash or 'attempt 2': "When risk rises, the chief re-dispatches the agent with a stronger mandate, and the plan gets bigger."
- Point at the Calls row: "Those are the two phone calls, with the spoken script."

**1:25 CLICK the Agents tab (20 s).**
"Nothing gets applied until an independent verifier on Nemotron Super checks the plan against the simulation. Routes through hazards, shelters in flooded cells, over-allocated crews get rejected, and the district agent re-plans. Done means done, checked, not declared."

**1:45 CLICK Incident → Analysis sub-tab → EVOLVE PLAYBOOK (30 s).**
"After every run a reflector rewrites the team's playbook and keeps a change only if it scores higher on three held-out storms it has never seen." Wait ~8 s for the KEPT row. "Gen 0 to Gen 1, kept, because the held-out score rose. Discarded proposals stay in the history and are never re-proposed. Version N plus one, with proof."

**2:15 Second phone rings around now (resident call). Hold it up (10 s).**
"And that's the resident of the worst-hit district getting plain-language evacuation instructions."

**2:25 CLICK Response tab (15 s).**
"Crews, boats, airlift and shelters, each marked verified. Same engine runs the San Francisco Bay Area from the New Incident menu: quake, bridge failures, gas-line fires."

**2:40 Close (15 s).**
"A recursive team on Crusoe Nemotron that forecasts, delegates, verifies its own work, phones the people who need to know, and improves itself between runs. Public repo, everything built today. Planning simulator, not a forecast."

## Likely questions, short answers
- **Is the hazard model real?** Simple, believable rules on a grid: hydrology, landslide dams, fire spread, aftershocks, A* routing. Not physics; it says so on screen. The agents are the product.
- **What's recursive?** Chief spawns district agents, district agents spawn helpers, verifier sends plans back, reflector rewrites the team's own playbook. Three levels, visible on the map.
- **How do you know the playbook improved?** Held-out seeds the reflector never saw; the change is kept only if the mean score rises. Live today: Bay Area 902 → 1021 → 1053, Nepal 722 → 737.
- **Rate limits?** Per-model semaphores, exponential backoff, fallback Lightning → Nano and Super → Lightning. The cascade keeps ticking while agents plan.
- **The phone calls?** Twilio, placed by the server when a district reaches evacuate; the resident after the plan is verified. Scripts come from the agent's forecast.
- **Why Nepal?** Real August 2026 Trishuli flood; facts in the Notes tab are labelled verified or simulated.

## If something breaks
- Crusoe errors or slow: restart the server with `MOCK_LLM=1 pnpm dev:server`. Same visuals, deterministic agents.
- No phone ring: carry on; the Delegation card shows the call chips either way.
- Scene stutters: switch "Scene · Map" to Map, or untick Trees/Terrain in Layers.
- Judge asks to change the scenario: New incident → move the rain cell by clicking the map, or switch to the Bay Area and drop an M6.9 on the Hayward Fault.

## Second speaker — handoff after the demo (~75 s)

**Handoff line (teammate):** "…planning simulator, not a forecast. [Name] will tell you what's under the hood."

**You:**
"Thanks. Three things that make this more than a map.

First, the team is genuinely recursive, and we can show it rather than claim it. A chief on Nemotron Super spawns one district agent per district at risk, those spawn their own helpers, and every node you saw was a live call on Crusoe Managed Inference. Three model sizes chosen per role, with per-model rate-limit semaphores and fallbacks, and the cascade keeps ticking while the agents think.

Second, nothing is taken on trust. Every plan goes through a verifier that checks it against the simulation itself, not against vibes: routes that cross hazards, shelters inside flooded cells, crews that don't exist. Rejected plans go back with reasons. In the run you just watched, [N] plans were rejected and re-planned. That's our answer to Done Means Done.

Third, the team improves itself and proves it. The reflector rewrites the playbook, and a change survives only if it scores higher on three held-out storms it has never seen. Today, live: Bay Area 902 to 1021 to 1053, Nepal 722 to 737. Discarded proposals stay on the record and are never re-proposed. That's Version N plus one, with evidence.

Everything runs on one deterministic cascade engine. A region is just config, so the same team that handled Nepal handles a Hayward Fault quake in San Francisco. Research facts come in through You.com into a shared memory every agent reads. And when a district reaches 'evacuate', its agent picks up the phone, which you heard.

Public repo, built since 10:45 this morning. Happy to take questions."

**Q&A split:** teammate answers demo/UX and "what did we see"; you answer architecture, verifier, playbook numbers, rate limits, phone calls, and "what's next" (real DEM and road graphs, agents negotiating mutual aid between districts, human approval gate for calls, NemoClaw sandboxing for unattended district agents).
