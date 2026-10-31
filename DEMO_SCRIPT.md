# Voiceover script (about 2:00, timed to `demo-video/superscade-elnino-demo.mp4`)

**[0:00–0:12] Hook**
El Niño winters don't hit the Bay Area one disaster at a time. They hit in cascades. In 1982 one storm set off thousands of landslides. In 2017 Coyote Creek forced 14,000 people out of San Jose. This is SUPERSCADE: a live AI agent team that rehearses an El Niño winter before it arrives.

**[0:12–0:31] The storm**
We trigger an atmospheric river plus a seven-foot king tide. The simulation never waits for the AI. Creeks overflow, the Santa Cruz Mountains slide, Highways 17, 84 and 92 close, substations trip and levees overtop, tick by tick.

**[0:31–0:42] The map**
This is the real Bay Area: terrain, highways, hospitals, county emergency operations centers, fire stations, pump stations and PG&E substations. These are the facilities that matter in a flood.

**[0:42–0:53] Agents on Terse**
A chief agent triages the districts at risk and spins up one agent per city, each with its own helpers. Every agent that spins up gets its own Terse Durable Actor: its own SQLite memory of what it was told, what it planned and what it was refused.

**[0:53–1:04] The Terse ledger**
Scarce resources live in a Terse ledger actor: swift-water teams, helicopters, pump crews and shelter beds. A Terse actor handles one call at a time, so when ten cities ask at once, nobody double-books a helicopter. Denied claims force a re-plan.

**[1:04–1:17] Agent Relay**
The agents talk over Agent Relay:
- the chief DMs each district its assignment,
- districts post plans and claims to the storm channel,
- the verifier answers in the thread.

Each agent reads its Relay inbox before it plans, so the coordination itself runs through Relay.

**[1:17–1:27] Verification**
Plans are only done when the verifier accepts them. Unsafe plans, like routes through flooded roads, get rejected and re-planned live.

**[1:27–1:55] San Francisco in 3D**
Zooming into San Francisco, a real 3D city model. At king tide the Embarcadero, Mission Bay and the Marina flood and Ocean Beach erodes, while the same agent team responds.

**[1:55–2:00] Close**
Emergency managers can rehearse resource fights before the storm. Built today on Terse, Agent Relay and OpenAI.
