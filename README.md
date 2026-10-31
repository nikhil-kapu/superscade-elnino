# SUPERSCADE: El Niño preparedness agents

**Haunted Hacks: Real-Time AI Edition** (Y Combinator, Oct 31 2026). Tracks: **Terse** and **Agent Relay**. See [SUBMISSION.md](SUBMISSION.md) for the pitch.

A live team of AI agents rehearses an El Niño winter for the SF Bay Area. An atmospheric river plus king tides set off a cascade: creek floods, Santa Cruz Mountains debris flows, Pacifica bluff collapse, closures on Hwy 17, 84, 92 and Devil's Slide, tripped substations, overwhelmed pump stations and overtopped levees.

The agents respond in real time while the simulation keeps ticking:
1. A **chief** triages the districts at risk.
2. It spawns one **district agent** per city.
3. Districts spawn **helper** agents.
4. A **verifier** accepts or rejects every plan; rejected plans go back for a re-plan.

## How the sponsor tech is used

| | What it does here | Code |
|---|---|---|
| **Terse: Durable Actors** | Every agent that spawns gets its own `ResponderAgent` durable actor: role and status as `@Persisted @Emittable` fields, plus a SQLite memory of its assignment, inbox, plans and verdicts. A per-incident `ResourceLedger` actor owns the scarce resources (swift-water teams, helicopters, pump crews, sandbag trucks, shelter beds). The actor runs one call at a time, so concurrent district agents can never double-book a helicopter. Denials feed back into the plan. | `actors/src/actor.ts`, `server/infra/terse.ts` |
| **Agent Relay** | Each agent is a Relay participant. The chief posts TRIAGE to `#elnino-storm` and DMs each district its ASSIGNMENT. Districts post PLAN plus their ledger claims. Helpers DM findings to their district. The verifier replies ACCEPT or REJECT in the plan's thread. Each district's Relay inbox goes into its LLM prompt, so coordination flows through Relay. | `server/infra/relay.ts`, `server/agents/orchestrator.ts` |

In the UI, the right panel (Agents, Response and Delegation tabs) shows the live Terse ledger and the Agent Relay feed.

## Run it locally

Requirements: Node 22+, pnpm, and Bun ≥ 1.4 (for Terse).

```bash
pnpm install
cp .env.example .env          # set OPENAI_API_KEY (MOCK_LLM=1 runs without a key)

# 1) Terse durable actors (local runtime)
cd actors && bun install && bunx terse-cli@latest actor dev    # :7100
#    Terse Cloud instead: bunx terse-cli@latest install && bunx terse-cli@latest deploy, then set TERSE_ACTOR_URL + TERSE_API_KEY

# 2) Agent Relay: hosted Relaycast by default. To self-host the same open-source engine:
npx -y @relaycast/engine@12.3.0 --port 8789 --db ./relaycast.db   # then RELAY_BASE_URL=http://localhost:8789 in .env

# 3) App
pnpm dev                        # server :8787 + client :5173
```

**Optional 3D city:** export San Francisco from [TerraPrinter](https://terraprinter.com) as GLB (Realistic, Flat model off) and save it as `client/public/models/sf.glb`. The San Francisco region then uses it as its 3D base. The file is not committed (about 200 MB).

**Phone calls are simulated.** Real dialing needs `ALLOW_REAL_CALLS=1` and a locally authenticated Twilio CLI.

## Regions
- **SF Bay Area: El Niño winter storms** (default): 18 districts, 8 creeks, 12 highways, and 69 facilities (hospitals, county EOCs, fire stations, pump stations, PG&E substations, levees, shelters, bridges, airports).
- **San Francisco: El Niño storms + king tide (3D city):**
  - Ocean Beach erosion.
  - King-tide flooding in the Embarcadero, Mission Bay, Marina, Bayview and Treasure Island.
  - Slides on Twin Peaks.
- **Nepal: Trishuli basin:** from the original SUPERSCADE (rain → landslides → dam burst → flood).

## Credits and honesty notes
- This is a planning simulator with simplified, synthetic hazard rules. It is not a forecast and not official emergency guidance.
- The engine and the Nepal scenario come from our earlier SUPERSCADE project (Recursive Agents Hackathon, Oct 17 2026). These parts were added today:
  - the El Niño scenarios,
  - the Bay Area and SF maps and facilities,
  - the Terse actors and ledger,
  - the Agent Relay messaging,
  - the OpenAI provider.
- 3D city model data credits:
  - Made with TerraPrinter (terraprinter.com).
  - Map data © OpenStreetMap contributors (ODbL).
  - Elevation: Copernicus DEM GLO-30 (© DLR e.V. & Airbus) and Mapzen.
  - Buildings: Overture Maps Foundation.
