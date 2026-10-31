// Run: npx tsx server/sim/selftest.ts
import { bayarea } from '../regions/bayarea.ts';
import { createSim, autoRespond, evaluateHeldOut, makeScenario } from './engine.ts';
import type { PlaybookParams, RegionConfig } from '../../shared/types.ts';

const defaultParams: PlaybookParams = { evacuateShakingThreshold: 0.5, crewPerFireCell: 0.6, airliftWhenCutOff: true, prepositionSheltersSoftSoil: true, reserveCrewFraction: 0.2, floodEvacLeadTicks: 3 };

function section(t: string) { console.log('\n=== ' + t + ' ==='); }

// 1. M6.9 Hayward quake near Oakland
section('Bay Area M6.9 Hayward quake near Oakland');
{
  const sc = makeScenario(bayarea, { kind: 'quake', at: { lng: -122.25, lat: 37.8 }, params: { magnitude: 6.9 } }, 7);
  const t0 = performance.now();
  const sim = createSim(bayarea, sc);
  const water = sim.cells.filter(c => c.terrain === 'water').length;
  console.log(`cells ${sim.cells.length} (water ${water}), pop ${sim.cells.reduce((a, c) => a + c.pop, 0)}`);
  console.log(`newly affected at t0: ${sim.newlyAffectedDistricts().join(', ')}`);
  console.log(sim.describe());
  for (let t = 0; t < sc.ticks; t++) {
    const evs = sim.step();
    const snap = sim.snapshot();
    const kinds = evs.reduce((m, e) => { m[e.kind] = (m[e.kind] ?? 0) + 1; return m; }, {} as Record<string, number>);
    console.log(`t${snap.tick}: hazards=${snap.hazards.length} events=${evs.length} ${JSON.stringify(kinds)} score=${snap.score.total} fires=${snap.districts.reduce((a, d) => a + d.fires, 0)} cutOff=${snap.score.cutOffDistricts}`);
    const na = sim.newlyAffectedDistricts(); if (na.length) console.log(`   newly affected: ${na.join(', ')}`);
  }
  console.log(`final (no response) score: ${JSON.stringify(sim.score())} in ${(performance.now() - t0).toFixed(0)}ms`);
  console.log('--- district describe (oakland) ---');
  console.log(sim.describe('oakland'));
  // route test
  const oak = bayarea.districts.find(d => d.id === 'oakland')!;
  const moscone = bayarea.infra.find(i => i.id === 'moscone')!;
  const path = sim.findRoute(oak.centroid, moscone.at, 'road');
  console.log(`findRoute oakland -> Moscone (road): ${path ? path.length + ' waypoints' : 'null'}`);
  const air = sim.findRoute(oak.centroid, moscone.at, 'air');
  console.log(`findRoute oakland -> Moscone (air): ${air ? air.length + ' waypoints' : 'null'}`);
  const boat = sim.findRoute(bayarea.districts.find(d => d.id === 'alameda')!.centroid, moscone.at, 'boat');
  console.log(`findRoute alameda -> Moscone (boat): ${boat ? boat.length + ' waypoints' : 'null'}`);
  // checkPlan test
  const st = sim.districtState('oakland');
  const verdictBad = sim.checkPlan({ districtId: 'oakland', summary: 'no crews', routes: [], fireCrews: 0, shelters: ['nonexistent'], airlift: false, helpersRequested: [] });
  console.log(`checkPlan (bad): accepted=${verdictBad.accepted} reasons=${verdictBad.reasons.join(' | ')}`);
  const verdictGood = sim.checkPlan({ districtId: 'oakland', summary: 'ok', routes: path ? [{ id: 'r1', districtId: 'oakland', mode: 'road', from: oak.centroid, to: moscone.at, path, capacity: 5000, label: 'to Moscone' }] : [], fireCrews: Math.ceil(st.fires * 0.5), shelters: ['coliseum'], airlift: false, helpersRequested: [] });
  console.log(`checkPlan (good): accepted=${verdictGood.accepted} checks=${verdictGood.checks.map(c => `${c.name}:${c.pass ? 'ok' : 'FAIL'}`).join(' ')}`);
  if (!verdictGood.accepted) console.log('   reasons: ' + verdictGood.reasons.join(' | '));
}

// 2. held-out eval
section('evaluateHeldOut quake seeds [1,2,3]');
{
  const t0 = performance.now();
  const r = await evaluateHeldOut(bayarea, defaultParams, [1, 2, 3], { kind: 'quake', at: { lng: -122.25, lat: 37.8 }, params: { magnitude: 6.9 } });
  console.log(`mean ${r.mean}; per seed: ${r.perSeed.map(p => `${p.seed}=${p.score.total}(str ${p.score.stranded}, fu ${p.score.firesUncovered}, co ${p.score.cutOffDistricts}, ev ${p.score.evacuated})`).join('; ')} in ${(performance.now() - t0).toFixed(0)}ms`);
  const t1 = performance.now();
  const sc = makeScenario(bayarea, { kind: 'quake', at: { lng: -122.25, lat: 37.8 }, params: { magnitude: 6.9 } }, 1);
  const sim = createSim(bayarea, sc);
  for (let t = 0; t < sc.ticks; t++) { autoRespond(sim, defaultParams); sim.step(); }
  console.log(`single 24-tick run with autoRespond: ${(performance.now() - t1).toFixed(0)}ms (budget 300ms)`);
  // determinism
  const a = await evaluateHeldOut(bayarea, defaultParams, [5], { kind: 'quake', at: { lng: -122.25, lat: 37.8 }, params: { magnitude: 7.4 } });
  const b = await evaluateHeldOut(bayarea, defaultParams, [5], { kind: 'quake', at: { lng: -122.25, lat: 37.8 }, params: { magnitude: 7.4 } });
  console.log(`determinism M7.4 seed 5: ${a.mean} vs ${b.mean} ${a.mean === b.mean ? 'OK' : 'MISMATCH'}`);
  const worse = await evaluateHeldOut(bayarea, { ...defaultParams, crewPerFireCell: 0, airliftWhenCutOff: false, evacuateShakingThreshold: 1 }, [1, 2, 3], { kind: 'quake', at: { lng: -122.25, lat: 37.8 }, params: { magnitude: 6.9 } });
  console.log(`no-response policy mean ${worse.mean} (should be below ${r.mean})`);
}

// 3. Oakland Hills fire
section('Oakland Hills fire, SW wind 20mph, dryness 0.8');
{
  const sc = makeScenario(bayarea, { kind: 'fire', at: { lng: -122.19, lat: 37.84 }, params: { wind_speed: 20, wind_dir_deg: 225, dryness: 0.8 } }, 11);
  const sim = createSim(bayarea, sc);
  for (let t = 0; t < sc.ticks; t++) {
    if (t === 2) autoRespond(sim, defaultParams);
    const evs = sim.step();
    const snap = sim.snapshot();
    const fires = snap.districts.map(d => `${d.id}:${d.fires}`).filter(x => !x.endsWith(':0')).join(' ');
    console.log(`t${snap.tick}: burning ${snap.hazards.filter(h => h.kind === 'fire').length} [${fires}] events=${evs.length} score=${snap.score.total}`);
  }
  console.log(sim.describe('oaklandhills'));
}

// 4. synthetic river region: rain -> flow, landslide dam -> burst
section('Synthetic river region: rain trigger (flood/dam paths)');
{
  const P = (lng: number, lat: number) => ({ lng, lat });
  const fake: RegionConfig = {
    id: 'nepal', name: 'Synthetic Valley', center: P(85.0, 28.0), zoom: 9, bbox: [84.5, 27.6, 85.5, 28.4], grid: { cols: 30, rows: 24 },
    districts: [
      { id: 'upper', name: 'Upper Hills', terrain: 'hills', population: 40000, centroid: P(84.75, 28.25), polygon: [P(84.5, 28.1), P(84.5, 28.4), P(85.0, 28.4), P(85.0, 28.1)] },
      { id: 'lower', name: 'Lower Valley', terrain: 'valley', population: 120000, centroid: P(85.25, 27.85), polygon: [P(85.0, 27.6), P(85.0, 28.1), P(85.5, 28.1), P(85.5, 27.6)] },
      { id: 'west', name: 'West Valley', terrain: 'valley', population: 50000, centroid: P(84.75, 27.85), polygon: [P(84.5, 27.6), P(84.5, 28.1), P(85.0, 28.1), P(85.0, 27.6)] },
    ],
    infra: [
      { id: 'xing', name: 'River crossing', kind: 'river_crossing', at: P(85.05, 28.05), districtIds: ['upper', 'lower'] },
      { id: 'sh', name: 'Valley shelter', kind: 'shelter', at: P(85.4, 27.7), districtIds: ['lower'], capacity: 5000 },
      { id: 'hosp', name: 'Hill hospital', kind: 'hospital', at: P(84.6, 28.35), districtIds: ['upper'], capacity: 100 },
    ],
    rivers: [{ id: 'r1', name: 'Synthetic River', line: [P(84.6, 28.35), P(84.9, 28.15), P(85.1, 28.0), P(85.3, 27.8), P(85.45, 27.65)] }],
    triggers: [{ kind: 'rain', label: 'Monsoon', params: [{ name: 'rain_mm', label: 'mm', min: 50, max: 500, step: 10, default: 300 }, { name: 'duration', label: 'ticks', min: 2, max: 16, step: 1, default: 8 }] }],
    facts: [], disclaimer: 'synthetic',
  };
  let dammed = false, burst = false, slides = 0, maxFlood = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const sc = makeScenario(fake, { kind: 'rain', at: P(84.8, 28.2), params: { rain_mm: 450, duration: 10 } }, seed);
    const sim = createSim(fake, sc);
    for (let t = 0; t < sc.ticks; t++) {
      autoRespond(sim, defaultParams);
      const evs = sim.step();
      for (const e of evs) { if (e.kind === 'dam') { if (/bursts/.test(e.text)) burst = true; else dammed = true; } if (e.kind === 'landslide') slides++; }
      const snap = sim.snapshot();
      maxFlood = Math.max(maxFlood, snap.districts.reduce((a, d) => a + d.flooded, 0));
      if (seed === 1) console.log(`seed1 t${snap.tick}: flood cells ${snap.hazards.filter(h => h.kind === 'flood').length} flooded(>0.4) ${snap.districts.map(d => d.flooded).join('/')} slides ${snap.districts.map(d => d.landslides).join('/')} dams ${snap.hazards.filter(h => h.kind === 'dam').length} events ${evs.map(e => e.kind + (e.kind === 'dam' ? (/bursts/.test(e.text) ? '!burst' : '!form') : '')).join(',')} score ${snap.score.total}`);
    }
    if (seed === 1) { console.log(sim.describe()); console.log(sim.snapshot().infra.map(i => `${i.id}:${i.status}`).join(' ')); }
  }
  console.log(`across 5 seeds: landslides=${slides} damFormed=${dammed} damBurst=${burst} maxFloodedCells=${maxFlood}`);
  if (!dammed || !burst || maxFlood === 0) { console.log('FAIL: flood/dam path not exercised'); process.exitCode = 1; }
  else console.log('flood/dam path OK');
}
console.log('\nselftest done');
