// Live Agent Relay message feed + Terse ResourceLedger box (sponsor integrations).
import { create } from 'zustand';
import { useMemo } from 'react';

export interface RelayRow { id: string; runId?: string; from: string; to?: string; channel?: string; text: string; threadOf?: string; ts: number }
export interface ClaimRow { key: number; runId: string; agentId: string; districtId: string; resource: string; requested: number; granted: number; status: string; ts: number }
interface SponsorState {
  runId?: string;
  relay: RelayRow[];
  claims: ClaimRow[];
  remaining: Record<string, number>;
  total: Record<string, number>;
  actors: number;
  ingest(ev: any): void;
}
let k = 0;
export const useSponsor = create<SponsorState>((set, get) => ({
  relay: [], claims: [], remaining: {}, total: {}, actors: 0,
  ingest(ev: any) {
    const s = get();
    const fresh = ev.runId && ev.runId !== s.runId && ev.type !== 'relay.message';
    const base = fresh ? { runId: ev.runId, claims: [] as ClaimRow[], remaining: {}, total: {}, actors: 0 } : {};
    if (ev.type === 'relay.message') {
      if (s.relay.some((r) => r.id === ev.id)) return;
      set({ relay: [...s.relay, ev as RelayRow].slice(-150) });
    } else if (ev.type === 'terse.claim') {
      const prev = fresh ? [] : s.claims;
      set({ ...base, claims: [{ key: k++, ...ev, ts: Date.now() }, ...prev].slice(0, 60), remaining: ev.remaining ?? s.remaining, total: ev.total ?? (fresh ? {} : s.total) });
    } else if (ev.type === 'terse.actor') {
      set({ ...base, actors: (fresh ? 0 : s.actors) + 1 });
    }
  },
}));

const RES_LABEL: Record<string, string> = { swiftwater_teams: 'Swift-water teams', helicopters: 'Helicopters', sandbag_trucks: 'Sandbag trucks', pump_crews: 'Pump crews', shelter_beds: 'Shelter beds' };

export default function SponsorPanel() {
  const relay = useSponsor((s) => s.relay);
  const claims = useSponsor((s) => s.claims);
  const remaining = useSponsor((s) => s.remaining);
  const total = useSponsor((s) => s.total);
  const actors = useSponsor((s) => s.actors);
  const ordered = useMemo(() => {
    // thread replies render right under their parent
    const roots = relay.filter((r) => !r.threadOf || !relay.some((p) => p.id === r.threadOf));
    const out: (RelayRow & { depth: number })[] = [];
    for (const r of roots) { out.push({ ...r, depth: 0 }); for (const c of relay.filter((x) => x.threadOf === r.id)) out.push({ ...c, depth: 1 }); }
    return out.slice(-60).reverse();
  }, [relay]);
  return (
    <>
      <section className="card">
        <div className="section-row">
          <h3 className="section-title">Terse ledger <span className="muted">· durable actors: {actors}</span></h3>
          <span className="livetag"><i />ACTOR</span>
        </div>
        {!Object.keys(remaining).length && <p className="muted empty">Waiting for the first resource claim. One ResourceLedger actor per run serializes every claim, so no two districts can double-book a helicopter.</p>}
        {Object.keys(remaining).length > 0 && (
          <div className="ledger-grid mono">
            {Object.entries(remaining).map(([r, n]) => {
              const t = total[r] ?? Math.max(n, 1);
              return (
                <div key={r} className="ledger-row">
                  <span>{RES_LABEL[r] ?? r}</span>
                  <span className={n === 0 ? 'ledger-zero' : ''}>{n.toLocaleString()} / {t.toLocaleString()}</span>
                  <i className="ledger-bar"><b style={{ width: `${Math.max(0, Math.min(100, (n / t) * 100))}%` }} /></i>
                </div>
              );
            })}
          </div>
        )}
        <div className="ledger-claims">
          {claims.slice(0, 10).map((c) => (
            <div key={c.key} className={'ledger-claim ' + c.status}>
              <b>{c.status.toUpperCase()}</b> {c.districtId} · {RES_LABEL[c.resource] ?? c.resource} {c.granted}/{c.requested}
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="section-row">
          <h3 className="section-title">Agent Relay <span className="muted">· {relay.length} messages</span></h3>
          <span className="livetag"><i />RELAY</span>
        </div>
        {!ordered.length && <p className="muted empty">Agents talk over Agent Relay: the chief posts triage and DMs assignments, districts post plans + claims, helpers DM findings, the verifier replies in-thread.</p>}
        <div className="relay-feed">
          {ordered.map((m) => (
            <div key={m.id} className={'relay-msg' + (m.depth ? ' reply' : '')}>
              <div className="relay-head mono"><b>{m.from}</b> → {m.to ? `@${m.to}` : m.threadOf ? 'thread' : `#${m.channel ?? '?'}`}</div>
              <div className="relay-text">{m.text}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
