// SUPERSCADE durable actors (Terse).
// - ResponderAgent: one durable actor per spawned LLM agent (actor id = agent id). Holds its role/status and a
//   SQLite memory log, so every agent's state survives restarts and a browser can subscribe to it.
// - ResourceLedger: one per run (actor id = runId). Holds the region's scarce El Nino storm resources. Terse runs
//   one call at a time per actor, so concurrent district agents can never double-book the same helicopter.
import { Actor, Emittable, Persisted, type ActorContext } from "terse-sdk/actor"

type MemoryRow = { tick: number; kind: string; text: string; from: string; at: number }

export class ResponderAgent extends Actor {
    @Persisted @Emittable role = ""
    @Persisted @Emittable label = ""
    @Persisted @Emittable status = "spawning"
    @Persisted @Emittable lastNote = ""
    @Persisted @Emittable runId = ""
    @Persisted @Emittable districtId = ""
    @Persisted @Emittable model = ""
    @Persisted @Emittable parentId = ""
    @Persisted @Emittable bootedAt = 0
    @Persisted @Emittable statusChanges = 0

    constructor(context: ActorContext) {
        super(context)
        this.db.exec("CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER, kind TEXT, text TEXT, src TEXT, at INTEGER)")
    }

    async boot(info: { runId: string; role: string; label: string; districtId?: string; model?: string; parentId?: string }): Promise<{ id: string; bootedAt: number; resumed: boolean }> {
        const resumed = this.bootedAt > 0
        this.runId = info.runId
        this.role = info.role
        this.label = info.label
        this.districtId = info.districtId ?? ""
        this.model = info.model ?? ""
        this.parentId = info.parentId ?? ""
        if (!resumed) this.bootedAt = Date.now()
        this.status = "spawning"
        this.db.exec("INSERT INTO memory (tick, kind, text, src, at) VALUES (?, ?, ?, ?, ?)", 0, "boot", `${info.role} ${info.label}`, "orchestrator", Date.now())
        return { id: this.id, bootedAt: this.bootedAt, resumed }
    }

    async setStatus(status: string, note?: string): Promise<number> {
        this.status = status
        if (note) this.lastNote = note.slice(0, 400)
        this.statusChanges = this.statusChanges + 1
        return this.statusChanges
    }

    async remember(kind: string, text: string, tick?: number, from?: string): Promise<number> {
        this.db.exec("INSERT INTO memory (tick, kind, text, src, at) VALUES (?, ?, ?, ?, ?)", tick ?? 0, kind, text.slice(0, 2000), from ?? "self", Date.now())
        const rows = this.db.exec("SELECT COUNT(*) AS n FROM memory") as { n: number }[]
        return Number(rows[0]?.n ?? 0)
    }

    async recall(limit?: number): Promise<MemoryRow[]> {
        const rows = this.db.exec("SELECT tick, kind, text, src, at FROM memory ORDER BY id DESC LIMIT ?", Math.max(1, Math.min(200, limit ?? 20))) as any[]
        return rows.map(r => ({ tick: Number(r.tick), kind: String(r.kind), text: String(r.text), from: String(r.src), at: Number(r.at) }))
    }

    async getState(): Promise<{ id: string; role: string; label: string; status: string; lastNote: string; runId: string; districtId: string; statusChanges: number; memories: number }> {
        const rows = this.db.exec("SELECT COUNT(*) AS n FROM memory") as { n: number }[]
        return { id: this.id, role: this.role, label: this.label, status: this.status, lastNote: this.lastNote, runId: this.runId, districtId: this.districtId, statusChanges: this.statusChanges, memories: Number(rows[0]?.n ?? 0) }
    }
}

type Pool = Record<string, number>
export type ClaimResult = { granted: number; requested: number; resource: string; remaining: number; status: "granted" | "partial" | "denied"; claimNo: number }

const DEFAULT_POOL: Pool = {
    swiftwater_teams: 6,
    helicopters: 2,
    sandbag_trucks: 8,
    pump_crews: 5,
    shelter_beds: 20000,
}

export class ResourceLedger extends Actor {
    @Persisted @Emittable total: Pool = { ...DEFAULT_POOL }
    @Persisted @Emittable remaining: Pool = { ...DEFAULT_POOL }
    @Persisted @Emittable claims = 0
    @Persisted @Emittable denials = 0
    @Persisted @Emittable regionId = ""

    constructor(context: ActorContext) {
        super(context)
        this.db.exec("CREATE TABLE IF NOT EXISTS claims (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT, district TEXT, resource TEXT, requested INTEGER, granted INTEGER, status TEXT, at INTEGER)")
    }

    async init(regionId: string, pool?: Pool): Promise<Pool> {
        if (this.regionId) return this.remaining // idempotent: a run's ledger is only stocked once
        this.regionId = regionId
        const p = { ...DEFAULT_POOL, ...(pool ?? {}) }
        this.total = p
        this.remaining = { ...p }
        return this.remaining
    }

    /** Atomic claim: grants fully, partially, or denies. One call at a time per actor => no double-booking. */
    async claim(agentId: string, districtId: string, resource: string, qty: number): Promise<ClaimResult> {
        const want = Math.max(0, Math.floor(qty))
        const have = this.remaining[resource] ?? 0
        const granted = Math.min(want, have)
        const status: ClaimResult["status"] = granted === want ? "granted" : granted > 0 ? "partial" : "denied"
        this.remaining = { ...this.remaining, [resource]: have - granted }
        this.claims = this.claims + 1
        if (status !== "granted") this.denials = this.denials + 1
        this.db.exec("INSERT INTO claims (agent, district, resource, requested, granted, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)", agentId, districtId, resource, want, granted, status, Date.now())
        return { granted, requested: want, resource, remaining: have - granted, status, claimNo: this.claims }
    }

    /** Return resources to the pool (e.g. a rejected plan's claims). */
    async release(agentId: string, districtId: string, resource: string, qty: number): Promise<number> {
        const q = Math.max(0, Math.floor(qty))
        const cap = this.total[resource] ?? q
        const next = Math.min(cap, (this.remaining[resource] ?? 0) + q)
        this.remaining = { ...this.remaining, [resource]: next }
        this.db.exec("INSERT INTO claims (agent, district, resource, requested, granted, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)", agentId, districtId, resource, -q, -q, "released", Date.now())
        return next
    }

    async getLedger(limit?: number): Promise<{ total: Pool; remaining: Pool; claims: number; denials: number; recent: { agent: string; district: string; resource: string; requested: number; granted: number; status: string; at: number }[] }> {
        const rows = this.db.exec("SELECT agent, district, resource, requested, granted, status, at FROM claims ORDER BY id DESC LIMIT ?", Math.max(1, Math.min(200, limit ?? 30))) as any[]
        return { total: this.total, remaining: this.remaining, claims: this.claims, denials: this.denials, recent: rows.map(r => ({ agent: String(r.agent), district: String(r.district), resource: String(r.resource), requested: Number(r.requested), granted: Number(r.granted), status: String(r.status), at: Number(r.at) })) }
    }
}
