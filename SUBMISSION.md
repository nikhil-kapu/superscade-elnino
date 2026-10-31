# SUPERSCADE: El Niño preparedness agents

**Haunted Hacks: Real-Time AI Edition** (Y Combinator, Oct 31 2026). Tracks: **Terse** and **Agent Relay**.

## One-liner
A live team of AI agents that rehearses an El Niño winter for the SF Bay Area. Atmospheric-river storms and king tides set off creek floods, hillside debris flows, coastal erosion and road closures. The agents spin up, coordinate and claim scarce rescue resources in real time while the disaster unfolds on a 3D map.

## The problem
El Niño winters hit the Bay Area in cascades, not one at a time:
- **1982:** a single January storm set off thousands of debris flows across the region.
- **1997–98:** El Niño ate the Pacifica bluffs, and San Francisquito Creek flooded about 1,700 properties.
- **2017:** Coyote Creek forced about 14,000 evacuations in San Jose.

Each county plans for its own hazards. In a real event, though, the same few swift-water teams, helicopters, pump crews and shelter beds get fought over by every city at once. SUPERSCADE lets emergency managers rehearse that contention before the storm arrives.

## What you see in the demo
1. **Trigger:** pick **SF Bay Area: El Niño winter storms** (or Nepal's Trishuli basin, same engine) and start an atmospheric river. Rain saturates the Santa Cruz Mountains and Marin hills, creeks rise, low bayfront districts flood at king tide, and Hwy 1, Hwy 17 and the bridges close.
2. **Agents spawn in real time:**
   - A **chief** agent triages the districts at risk.
   - It spawns one **district agent** per city.
   - Each district agent spawns **helpers** (routing, shelter, airlift, supply).
   - A **verifier** checks every plan against the simulation and sends bad plans back to be re-planned.
3. **Every agent is a Terse Durable Actor.** When an agent spawns, it gets its own durable actor: its own SQLite memory of what it was told, what it planned and what it was refused. It survives restarts and handles one call at a time.
4. **Scarce resources go through a Terse ledger actor.** A per-incident `ResourceLedger` actor owns swift-water teams, helicopters, pump crews, sandbag trucks and shelter beds. District agents claim from it concurrently, and because the actor runs one call at a time, two cities can never book the same helicopter. Denied claims show up live and force a re-plan.
5. **Agents talk over Agent Relay.** Each agent registers as an Agent Relay participant:
   - The chief DMs each district its assignment.
   - Districts post plans and resource claims to the incident channel.
   - Helpers DM findings back to their district.
   - The verifier replies in the plan's thread with ACCEPT or REJECT.
   - District agents read their Relay inbox before planning, so the coordination itself goes through Relay.
   - The Relay tab shows the radio traffic live.
6. **The San Francisco 3D city** is a TerraPrinter model (OSM buildings plus Copernicus DEM), aligned to the simulation grid. King tides flood the Embarcadero, Mission Bay and the Marina, and Ocean Beach erodes.
7. **The 3D Bay Area map** shows terrain relief, highways (101, 280, 880, 80, 1, 17, 92, 84, 24), hospitals, county Emergency Operations Centers, fire stations, flood pump stations, PG&E substations and shelters. Floods, slides and closures play out on it tick by tick.

## Why real-time AI matters here
- The simulation never waits for the agents. It keeps ticking while they plan, so a slow plan means people stranded.
- Risk is re-assessed every tick. When a district's forecast rises, the chief re-dispatches its agent with a stronger mandate.
- Plans are only "done" when the verifier accepts them.

## Measured on a live run (Bay Area, seed 7)
- 67 Terse durable actors booted and 81 ledger claims made, several of them denied.
- 53 Agent Relay messages: triage, assignment DMs, plans, and the verifier's thread replies.
- 18 verifier verdicts.
- About 1–4 s per OpenAI call.

## Stack
- **Terse:** Durable Actors (`terse-sdk/actor`, Terse runtime via `terse actor dev`). One `ResponderAgent` actor per spawned agent, plus a `ResourceLedger` actor per incident.
- **Agent Relay:** `@agent-relay/sdk` v15. We started on the hosted Relaycast, which returned `database_overloaded` (7–25 s per call) during the event, so the demo runs Agent Relay's open-source Relaycast engine (`@relaycast/engine`, the same engine as the hosted gateway) locally. Setup is one workspace per boot, 40 standing agent identities, the `#elnino-storm` channel, and DMs and threads. Switching back to hosted is one environment variable (remove `RELAY_BASE_URL`).
- **LLMs:** OpenAI chat completions (gpt-4.1-mini for the chief, districts and verifier; gpt-4.1-nano for helpers).
- **App:** Node/Express plus SSE, React with a three.js 3D scene and MapLibre.

## Honesty notes
- This is a planning simulator with simplified, synthetic hazard rules. It is not a forecast and not official emergency guidance.
- The engine and Nepal scenario start from our earlier SUPERSCADE codebase (Recursive Agents Hackathon, Oct 17). These parts are new today:
  - the Bay Area El Niño scenario,
  - the 3D Bay Area map with municipal facilities,
  - the Terse actors and resource ledger,
  - the Agent Relay messaging layer,
  - the switch to OpenAI.
