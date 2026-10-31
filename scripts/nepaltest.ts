import { nepal } from '../server/regions/nepal.ts';
import { simModule } from '../server/sim/engine.ts';
const trig = { kind: 'rain' as const, at: { lng: 85.33, lat: 28.1 }, params: { rain_mm: 300, duration_ticks: 6 } };
const sc = simModule.makeScenario(nepal, trig, 11);
const sim = simModule.createSim(nepal, sc);
let t0 = Date.now();
for (let i = 0; i < sc.ticks; i++) { const evs = sim.step(); const s = sim.snapshot(); const kinds = {} as any; for (const h of s.hazards) kinds[h.kind] = (kinds[h.kind]||0)+1; if (i % 4 === 0 || evs.some(e=>e.severity==='critical')) console.log('t'+i, JSON.stringify(kinds), 'score', s.score.total, 'events', evs.slice(0,3).map(e=>e.text)); }
console.log('ms', Date.now()-t0);
console.log(sim.describe().split('\n').slice(0,20).join('\n'));
const ho = await simModule.evaluateHeldOut(nepal, { evacuateShakingThreshold:0.6, crewPerFireCell:0.5, airliftWhenCutOff:false, prepositionSheltersSoftSoil:false, reserveCrewFraction:0, floodEvacLeadTicks:0 }, [101,202,303], trig);
const ho2 = await simModule.evaluateHeldOut(nepal, { evacuateShakingThreshold:0.45, crewPerFireCell:1, airliftWhenCutOff:true, prepositionSheltersSoftSoil:true, reserveCrewFraction:0.2, floodEvacLeadTicks:3 }, [101,202,303], trig);
console.log('heldout default', ho.mean, 'improved', ho2.mean);
