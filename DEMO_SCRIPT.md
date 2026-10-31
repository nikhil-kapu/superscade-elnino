# Voiceover script (2:00, timed to `demo-video/superscade-elnino-demo.mp4`)

**[0:00–0:15] Hook (Bay Area 3D, storm starts)**
This winter, El Niño could flood the Bay Area. When it does, every city will fight over the same few helicopters and rescue teams. So we built SUPERSCADE: an AI emergency team that practices the disaster first. Let's hit the Bay with a massive storm.

**[0:15–0:23] The cascade**
The simulation never waits for the AI. Creeks overflow, the Santa Cruz Mountains slide, Highways 17, 84 and 92 close, substations trip and levees overtop, tick by tick.

**[0:23–0:34] Real map**
This is the real Bay Area: terrain, highways, hospitals, county emergency operations centers, fire stations, pump stations and substations.

**[0:34–0:46] Agents on Terse**
A chief agent triages the districts at risk and spins up one agent per city, plus helpers and a verifier. Every agent that spins up gets its own Terse Durable Actor, with its own SQLite memory of what it was told, planned and refused.

**[0:46–0:58] Terse ledger**
Scarce resources live in a Terse ledger actor: swift-water teams, helicopters, pump crews and shelter beds. A Terse actor handles one call at a time, so when ten cities ask at once, nobody double-books a helicopter. Denied claims force a re-plan.

**[0:58–1:11] Agent Relay**
The agents talk over Agent Relay:
- the chief DMs each district its assignment,
- districts post plans and claims to the storm channel,
- the verifier replies in the thread.

Each agent reads its Relay inbox before it plans, so the coordination itself runs through Relay.

**[1:11–1:20] Verification (right panel: Terse ledger + Relay feed)**
Plans only count when the verifier accepts them. Here you can see the live ledger, with grants and denials, and the Relay traffic side by side.

**[1:20–1:45] San Francisco in 3D**
Now zoom into San Francisco, a real 3D city model. We start the same storm with a king tide, and the same agent architecture spins up for the city's neighborhoods.

**[1:45–1:55] Impact**
The Embarcadero, Mission Bay and the Marina flood at king tide, Ocean Beach erodes, and the agents respond live.

**[1:55–2:00] Close**
Rehearse the fight for resources before the storm. Built today on Terse, Agent Relay and OpenAI.
