// Run: npx tsx server/sim/elnino-check.ts [regionId] — headless El Niño rain cascade check (per-tick district hits)
import { getRegion } from '../regions/index.ts';
import { createSim, makeScenario } from './engine.ts';
import { buildTrigger } from '../run.ts';

const rid = process.argv[2] ?? 'bayarea';
const region = getRegion(rid);
const trig = buildTrigger(rid, process.argv[4] ? { kind: 'rain', params: JSON.parse(process.argv[4]) } as any : undefined);
const sc = makeScenario(region, trig, Number(process.argv[3] ?? 7));
const sim = createSim(region, sc);
const water = sim.cells.filter(c => c.terrain === 'water').length;
console.log(`${region.name}: cells ${sim.cells.length} (water ${water}) trigger ${JSON.stringify(trig)}`);
const perD = new Map<string, number>(); for (const c of sim.cells) if (c.districtId) perD.set(c.districtId, (perD.get(c.districtId) ?? 0) + 1);
console.log('cells/district: ' + [...perD].map(([k, v]) => `${k}=${v}`).join(' '));
const firstHit = new Map<string, number>();
for (let t = 0; t < sc.ticks; t++) {
  const evs = sim.step(); const snap = sim.snapshot();
  const hit = snap.districts.filter(d => d.flooded > 0 || d.landslides > 0);
  for (const d of hit) if (!firstHit.has(d.id)) firstHit.set(d.id, snap.tick);
  const kinds = evs.reduce((m, e) => { m[e.kind] = (m[e.kind] ?? 0) + 1; return m; }, {} as Record<string, number>);
  console.log(`t${snap.tick}: ${JSON.stringify(kinds)} ` + hit.map(d => `${d.id}(f${d.flooded}/s${d.landslides})`).join(' '));
  for (const e of evs.filter(e => e.kind === 'infra' || e.kind === 'dam' || /tide|bluff/i.test(e.text))) console.log('   · ' + e.text);
}
console.log('first hit tick: ' + [...firstHit].map(([k, v]) => `${k}@t${v}`).join(', '));
console.log('score ' + JSON.stringify(sim.score()));
