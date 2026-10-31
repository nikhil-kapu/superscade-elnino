import { useMemo, useState } from 'react';
import { LAYER_DEFS, ROLE_COLOR, agentColor, incidentName, shortId, shortModel, useStore, type LiveAgent } from '../store';
import { agentCode } from '../map/MapView';
import { postEvolve, postReset } from '../api';
import DelegationTab from './DelegationTab';
import SponsorPanel from './SponsorPanel';

export default function RightPanel() {
  const tab = useStore((s) => s.tab);
  return (
    <aside className={'panel right' + (tab === 'delegation' ? ' wide' : '')}>
      {tab === 'incident' && <IncidentTab />}
      {tab === 'delegation' && <DelegationTab />}
      {tab === 'agents' && <AgentsTab />}
      {tab === 'response' && <ResponseTab />}
      {(tab === 'agents' || tab === 'response' || tab === 'delegation') && <SponsorPanel />}
    </aside>
  );
}

/* ---------------- Incident ---------------- */
function IncidentTab() {
  const sub = useStore((s) => s.subTab);
  const setSub = useStore((s) => s.setSubTab);
  return (
    <>
      <section className="card tabs-card">
        <div className="subtabs">
          {(['layers', 'analysis', 'evidence', 'notes'] as const).map((t) => <button key={t} className={'subtab' + (sub === t ? ' active' : '')} onClick={() => setSub(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
        {sub === 'layers' && <LayersList />}
        {sub === 'analysis' && <Analysis />}
        {sub === 'evidence' && <Evidence />}
        {sub === 'notes' && <Notes />}
      </section>
      <IncidentOverview />
      <HazardResponse />
    </>
  );
}
function LayersList() {
  const layers = useStore((s) => s.layers);
  const setLayer = useStore((s) => s.setLayer);
  const exaggeration = useStore((s) => s.exaggeration);
  const setExaggeration = useStore((s) => s.setExaggeration);
  return (
    <>
      <ul className="layer-list">
        {LAYER_DEFS.map((d) => (
          <li key={d.id} className={'layer-row' + (layers[d.id].on ? '' : ' off')}>
            <input type="checkbox" checked={layers[d.id].on} onChange={(e) => setLayer(d.id, { on: e.target.checked })} />
            <span className="thumb" style={{ background: d.thumb }} />
            <span className="layer-name">{d.label}</span>
            {d.id === 'terrain' ? (
              <select className="mini" value={exaggeration} onChange={(e) => setExaggeration(Number(e.target.value))}><option value={1}>1×</option><option value={1.6}>1.6×</option><option value={2.5}>2.5×</option></select>
            ) : (
              <><input className="opacity" type="range" min={0.1} max={1} step={0.05} value={layers[d.id].opacity} onChange={(e) => setLayer(d.id, { opacity: Number(e.target.value) })} /><span className="mono pct">{Math.round(layers[d.id].opacity * 100)}%</span></>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
function Analysis() {
  const playbook = useStore((s) => s.playbook);
  const evolving = useStore((s) => s.evolving);
  const setEvolving = useStore((s) => s.setEvolving);
  const running = useStore((s) => s.running);
  const [err, setErr] = useState<string | null>(null);
  const evolve = async () => { setErr(null); setEvolving(true); try { await postEvolve(); } catch (e: any) { setErr(e?.message ?? 'evolve failed'); setEvolving(false); } };
  const reset = async () => { setErr(null); try { await postReset(); } catch (e: any) { setErr(e?.message ?? 'reset failed'); } };
  const gen = playbook?.generation ?? 0;
  return (
    <div className="sub-body">
      <div className="section-row"><h4 className="h4">Response playbook</h4><span className="genpill mono">Gen {gen}</span></div>
      <ol className="rules">{(playbook?.rules ?? []).map((r, i) => <li key={i}>{r}</li>)}</ol>
      {playbook && <table className="params mono"><tbody>{Object.entries(playbook.params).map(([k, v]) => <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>)}</tbody></table>}
      <div className="btn-row">
        <button className="btn primary" disabled={evolving || running} onClick={evolve}>{evolving ? <><span className="spinner" /> Reflecting…</> : `Evolve playbook (v${gen + 1})`}</button>
        <button className="btn ghost" disabled={evolving || running} onClick={reset}>Reset to Gen 0</button>
      </div>
      {err && <div className="error">{err}</div>}
      <h4 className="h4">Evolution history</h4>
      {!playbook?.history.length ? <p className="muted empty">No evolutions yet. After an incident, the reflector proposes a change; it is kept only if held-out scores improve.</p> : (
        <ul className="history">{[...playbook.history].reverse().map((h, i) => (
          <li key={i} className={'hist ' + (h.kept ? 'kept' : 'discarded')}>
            <div className="hist-head"><span className="mono">Gen {h.generation}</span><span className="kbadge">{h.kept ? 'KEPT' : 'DISCARDED'}</span></div>
            <div className="hist-summary">{h.summary}</div>
            <div className="mono small muted">{h.diff}</div>
            <div className="hist-score mono">{h.before} <span className="arrow">→</span> <b>{h.after}</b> <span className="muted small">({h.heldOutScenarios.length} held-out)</span></div>
          </li>))}</ul>
      )}
    </div>
  );
}
function Evidence() {
  const memory = useStore((s) => s.memory);
  const verdicts = useStore((s) => s.verdicts);
  const agents = useStore((s) => s.agents);
  const region = useStore((s) => s.region());
  return (
    <div className="sub-body">
      <h4 className="h4">Shared memory</h4>
      {memory.length === 0 ? <p className="muted empty">Facts the agents share with each other appear here.</p> : <ul className="memory">{memory.map((m) => <li key={m.key}><span className="mono key">{m.key}</span><span>{m.value}</span></li>)}</ul>}
      <h4 className="h4">Research facts</h4>
      <ul className="facts">{(region?.facts ?? []).map((f, i) => <li key={i}><span className={'fbadge ' + (f.verified ? 'v' : 's')}>{f.verified ? 'verified' : 'simulated'}</span><span>{f.text}{f.source && <span className="muted"> — {f.source}</span>}</span></li>)}</ul>
      <h4 className="h4">Verifier verdicts</h4>
      {verdicts.length === 0 ? <p className="muted empty">Verdicts appear as the verifier audits district plans.</p> : (
        <ul className="verdicts">{verdicts.map((v) => { const a = agents.get(v.agentId); return (
          <li key={v.id} className={'verdict ' + (v.verdict.accepted ? 'accept' : 'reject')}>
            <div className="verdict-head"><span className="vbadge">{v.verdict.accepted ? 'ACCEPT' : 'REJECT'}</span><span>{a?.label ?? v.agentId}</span></div>
            <ul className="reasons">{v.verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            <div className="checks mono">{v.verdict.checks.map((c) => <span key={c.name} className={c.pass ? 'ok' : 'fail'} title={c.detail}>{c.pass ? '✓' : '✕'} {c.name}</span>)}</div>
          </li>); })}</ul>
      )}
    </div>
  );
}
function Notes() {
  const region = useStore((s) => s.region());
  return (
    <div className="sub-body">
      <h4 className="h4">Region notes</h4>
      <ul className="facts">{(region?.facts ?? []).map((f, i) => <li key={i}><span className={'fbadge ' + (f.verified ? 'v' : 's')}>{f.verified ? 'verified' : 'simulated'}</span><span>{f.text}</span></li>)}</ul>
      <h4 className="h4">Districts</h4>
      <ul className="facts">{(region?.districts ?? []).map((d) => <li key={d.id}><span className="fbadge s">{d.terrain}</span><span>{d.name} · <span className="mono">{(d.population / 1000).toFixed(0)}k</span></span></li>)}</ul>
      <p className="disclaimer">{region?.disclaimer}</p>
    </div>
  );
}
function IncidentOverview() {
  const region = useStore((s) => s.region());
  const scenario = useStore((s) => s.scenario);
  const runId = useStore((s) => s.runId);
  const running = useStore((s) => s.running);
  const snap = useStore((s) => s.viewSnapshot());
  const live = useStore((s) => s.snapshot);
  const verdicts = useStore((s) => s.verdicts);
  const playbook = useStore((s) => s.playbook);
  const affected = live?.districts.filter((d) => d.shaking > 0.2 || d.fires > 0 || d.flooded > 0 || d.landslides > 0 || d.cutOff).length ?? 0;
  const acc = verdicts.filter((v) => v.verdict.accepted).length;
  return (
    <section className="card">
      <div className="section-row"><h3 className="section-title">Incident overview</h3><span className="muted small">{snap ? `viewing T+${snap.tick}` : ''}</span></div>
      <dl className="kv">
        <dt>Incident name</dt><dd>{scenario ? incidentName(scenario, region) : '—'}</dd>
        <dt>Incident ID</dt><dd className="mono">{runId ?? '—'}</dd>
        <dt>Location</dt><dd>{region?.name ?? '—'}</dd>
        <dt>Start</dt><dd className="mono">{scenario ? 'T+0' : '—'}</dd>
        <dt>End</dt><dd className="mono">{scenario ? (running ? 'In progress' : `T+${live?.tick ?? scenario.ticks}`) : '—'}</dd>
        <dt>Districts hit</dt><dd className="mono">{affected} / {region?.districts.length ?? 0}</dd>
        <dt>Verifier</dt><dd className="mono"><span className="ok">{acc} accept</span> · <span className="fail">{verdicts.length - acc} reject</span></dd>
        <dt>Playbook</dt><dd className="mono">Gen {playbook?.generation ?? 0}</dd>
        <dt>Analysis status</dt><dd><i className={'sdot ' + (running ? 'run' : scenario ? 'done' : 'idle')} />{running ? 'In progress' : scenario ? 'Complete' : 'Awaiting incident'}</dd>
      </dl>
    </section>
  );
}
function HazardResponse() {
  const score = useStore((s) => s.score);
  const plans = useStore((s) => s.plans);
  let crews = 0; plans.forEach((p) => (crews += p.fireCrews));
  const f = (n?: number) => (n === undefined ? '—' : n.toLocaleString());
  const tiles = [
    { icon: '⚠', label: 'Stranded', v: f(score?.stranded), sub: 'people without a plan' },
    { icon: '⇪', label: 'Evacuated', v: f(score?.evacuated), sub: 'people moved' },
    { icon: '🔥', label: 'Fires uncovered', v: f(score?.firesUncovered), sub: 'cells w/o crews' },
    { icon: '⛔', label: 'Cut off', v: f(score?.cutOffDistricts), sub: 'districts isolated' },
    { icon: '∑', label: 'Score', v: f(score?.total), sub: 'higher is better' },
    { icon: '⛑', label: 'Crews deployed', v: String(crews), sub: 'from accepted plans' },
  ];
  return (
    <section className="card">
      <h3 className="section-title">Hazard &amp; response</h3>
      <div className="hr-tiles">{tiles.map((t) => <div key={t.label} className="hr-tile"><span className="hr-icon">{t.icon}</span><div><span className="eyebrow">{t.label}</span><span className="mono hr-v">{t.v}</span><span className="muted small">{t.sub}</span></div></div>)}</div>
    </section>
  );
}

/* ---------------- Agents (fleet) ---------------- */
const GROUPS: [string, string[]][] = [['Chief', ['chief']], ['District planners', ['district']], ['Helpers', ['route', 'firecrew', 'shelter', 'supply', 'airlift']], ['Verifiers', ['verifier']], ['Research', ['research']], ['Reflector', ['reflector']]];
function AgentsTab() {
  const agents = useStore((s) => s.agents);
  const view = useStore((s) => s.agentView);
  const setView = useStore((s) => s.setAgentView);
  const selected = useStore((s) => s.selectedAgentId);
  const select = useStore((s) => s.selectAgent);
  const fly = useStore((s) => s.fly);
  const list = useMemo(() => [...agents.values()].sort((a, b) => a.spawnedAt - b.spawnedAt), [agents]);
  const thinking = list.filter((a) => a.status === 'thinking' || a.status === 'spawning').length;
  const sel = selected ? agents.get(selected) : undefined;
  const tree = useMemo(() => { const kids = new Map<string | undefined, LiveAgent[]>(); list.forEach((a) => { const k = a.parentId && agents.has(a.parentId) ? a.parentId : undefined; kids.set(k, [...(kids.get(k) ?? []), a]); }); return kids; }, [list, agents]);
  return (
    <>
      <section className="card">
        <div className="section-row">
          <h3 className="section-title">Agents <span className="muted">· {list.length} agents · {thinking} thinking</span></h3>
          <span className="livetag"><i />LIVE</span>
        </div>
        <div className="seg tiny"><button className={'seg-btn' + (view === 'fleet' ? ' active' : '')} onClick={() => setView('fleet')}>Fleet</button><button className={'seg-btn' + (view === 'tree' ? ' active' : '')} onClick={() => setView('tree')}>Tree</button></div>
        {list.length === 0 && <p className="muted empty">No agents yet. Start an incident — the chief spawns district planners, which recruit helpers; the verifier audits every plan.</p>}
        {view === 'fleet' ? GROUPS.map(([g, roles]) => { const rows = list.filter((a) => roles.includes(a.role)); if (!rows.length) return null; return (
          <div key={g} className="fleet-group">
            <div className="eyebrow">{g}</div>
            {rows.map((a) => <AgentRow key={a.id} a={a} selected={selected === a.id} onClick={() => { select(a.id); fly(a.at, 12); }} />)}
          </div>); }) : <ul className="tree">{(tree.get(undefined) ?? []).map((a) => <TreeNode key={a.id} a={a} tree={tree} selected={selected} />)}</ul>}
      </section>
      {sel && <AgentDetail a={sel} />}
    </>
  );
}
function AgentRow({ a, selected, onClick }: { a: LiveAgent; selected: boolean; onClick: () => void }) {
  return (
    <button className={'fleet-row' + (selected ? ' selected' : '')} data-status={a.status} style={{ ['--c' as any]: agentColor(a) }} onClick={onClick}>
      <span className="status-dot" />
      <span className="fr-main"><span className="fr-code mono">{agentCode(a)}</span><span className="fr-label">{a.label}</span><span className="fr-meta">{shortModel(a.model)}</span></span>
      <span className="fr-right"><span className={'status-tag ' + a.status}>{a.status}</span><span className="mono muted small">{a.tokens.toLocaleString()} tok</span></span>
    </button>
  );
}
function AgentDetail({ a }: { a: LiveAgent }) {
  const plan = useStore((s) => s.plans.get(a.id));
  const verdicts = useStore((s) => s.verdicts.filter((v) => v.agentId === a.id || (a.role === 'verifier' && a.districtId && s.agents.get(v.agentId)?.districtId === a.districtId)));
  return (
    <section className="card detail" style={{ ['--c' as any]: agentColor(a) }}>
      <div className="section-row"><h3 className="section-title"><span className="status-dot inline" /> {agentCode(a)} · {a.label}</h3><span className={'status-tag ' + a.status}>{a.status}</span></div>
      <dl className="kv">
        <dt>Role</dt><dd>{a.role}</dd>
        <dt>Model</dt><dd className="mono">{shortModel(a.model)}</dd>
        <dt>Tokens</dt><dd className="mono">{a.tokens.toLocaleString()}</dd>
        <dt>Position</dt><dd className="mono">{a.at.lat.toFixed(3)}, {a.at.lng.toFixed(3)}</dd>
        {a.note && <><dt>Note</dt><dd>{a.note}</dd></>}
      </dl>
      {plan && <div className="plan-box"><div className="eyebrow">Plan</div><p>{plan.summary}</p><div className="mono small">{plan.routes.length} routes · {plan.fireCrews} crews{plan.airlift ? ' · airlift' : ''} · shelters: {plan.shelters.join(', ') || '—'}</div></div>}
      {verdicts.length > 0 && <ul className="verdicts">{verdicts.slice(0, 3).map((v) => <li key={v.id} className={'verdict ' + (v.verdict.accepted ? 'accept' : 'reject')}><div className="verdict-head"><span className="vbadge">{v.verdict.accepted ? 'ACCEPT' : 'REJECT'}</span></div><ul className="reasons">{v.verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></li>)}</ul>}
    </section>
  );
}
function TreeNode({ a, tree, selected }: { a: LiveAgent; tree: Map<string | undefined, LiveAgent[]>; selected?: string }) {
  const kids = tree.get(a.id) ?? [];
  const fly = useStore((s) => s.fly);
  const select = useStore((s) => s.selectAgent);
  return (
    <li className="tree-node">
      <button className={'node' + (selected === a.id ? ' selected' : '')} data-status={a.status} style={{ ['--c' as any]: agentColor(a) }} onClick={() => { select(a.id); fly(a.at, 12); }}>
        <span className="status-dot" />
        <span className="node-main"><span className="node-label">{agentCode(a)} · {a.label}</span><span className="node-meta mono">{shortModel(a.model)} · {a.tokens.toLocaleString()} tok</span>{a.note && <span className="node-note">{a.note}</span>}</span>
        <span className={'status-tag ' + a.status}>{a.status}</span>
      </button>
      {kids.length > 0 && <ul className="tree">{kids.map((k) => <TreeNode key={k.id} a={k} tree={tree} selected={selected} />)}</ul>}
    </li>
  );
}

/* ---------------- Response ---------------- */
function ResponseTab() {
  const plans = useStore((s) => s.plans);
  const agents = useStore((s) => s.agents);
  const region = useStore((s) => s.region());
  const verdicts = useStore((s) => s.verdicts);
  const fly = useStore((s) => s.fly);
  const running = useStore((s) => s.running);
  const scenario = useStore((s) => s.scenario);
  // latest verdict per district (verdicts are newest-first); the server may key verdicts by the verifier's agentId, so resolve district via verdict.districtId or the agent's districtId
  const latest = new Map<string, boolean>();
  verdicts.forEach((v) => { const did = v.verdict.districtId ?? agents.get(v.agentId)?.districtId ?? plans.get(v.agentId)?.districtId; if (did && !latest.has(did)) latest.set(did, v.verdict.accepted); });
  const statusOf = (districtId: string) => (latest.has(districtId) ? (latest.get(districtId) ? 'verified' : 'rejected · re-planning') : 'pending verification');
  const rows = [...plans.entries()].map(([agentId, p]) => ({ agentId, p, a: agents.get(agentId), ok: latest.get(p.districtId) === true, status: statusOf(p.districtId), d: region?.districts.find((x) => x.id === p.districtId) }));
  const units: { code: string; name: string; sub: string; at?: { lng: number; lat: number }; kind: string }[] = [];
  rows.forEach(({ p, d, status }) => {
    const dc = (d?.id ?? p.districtId).toUpperCase().slice(0, 4);
    if (p.fireCrews) units.push({ code: `FC-${dc}`, name: `${p.fireCrews} fire crews`, sub: `${d?.name ?? p.districtId} · ${status}`, at: d?.centroid, kind: 'crew' });
    p.routes.forEach((r) => units.push({ code: r.mode === 'air' ? `H-${dc}` : r.mode === 'boat' ? `B-${dc}` : `E-${dc}`, name: r.label, sub: `${r.mode} · cap ${r.capacity}`, at: r.to, kind: r.mode }));
    p.shelters.forEach((sid) => { const inf = region?.infra.find((x) => x.id === sid); units.push({ code: `S-${dc}`, name: inf?.name ?? sid, sub: `shelter${inf?.capacity ? ` · capacity ${inf.capacity.toLocaleString()}` : ''}`, at: inf?.at, kind: 'shelter' }); });
  });
  const n = (k: string[]) => units.filter((u) => k.includes(u.kind)).length;
  return (
    <section className="card">
      <div className="section-row"><h3 className="section-title">Response units <span className="muted">· {units.length} units</span></h3>{running ? <span className="livetag"><i />LIVE</span> : scenario ? <span className="livetag done">complete</span> : null}</div>
      <div className="res-stats"><div><b className="mono">{n(['crew'])}</b><span>crew groups</span></div><div><b className="mono">{n(['air'])}</b><span>air routes</span></div><div><b className="mono">{n(['boat'])}</b><span>boat routes</span></div><div><b className="mono">{n(['shelter'])}</b><span>shelters</span></div></div>
      {units.length === 0 && <p className="muted empty">Response units appear as district plans are accepted.</p>}
      {(['crew', 'air', 'road', 'boat', 'shelter'] as const).map((k) => { const us = units.filter((u) => u.kind === k); if (!us.length) return null; return (
        <div key={k} className="fleet-group"><div className="eyebrow">{k === 'crew' ? 'Crews' : k === 'air' ? 'Aircraft' : k === 'road' ? 'Road corridors' : k === 'boat' ? 'Boats & ferries' : 'Shelters'}</div>
          {us.map((u, i) => <button key={u.code + i} className="fleet-row unit" onClick={() => u.at && fly(u.at, 12.5)}><span className={'udot ' + u.kind} /><span className="fr-main"><span className="fr-code mono">{u.code}</span><span className="fr-label">{u.name}</span><span className="fr-meta">{u.sub}</span></span></button>)}
        </div>); })}
    </section>
  );
}
