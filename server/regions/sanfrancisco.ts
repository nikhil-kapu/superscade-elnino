// San Francisco — city & county at neighbourhood scale. Headline hazard: a 1906-style San Andreas rupture
// (shaking → liquefaction-amplified damage in bay-fill districts → bridge/freeway damage → gas-line fires → hills
// landslides), with a Diablo-wind urban conflagration as the secondary trigger. Geometry is approximate (simple rings
// around real geography) — planning simulator, not GIS. Cells outside `landmask` are water (Pacific, Golden Gate, Bay).
import type { RegionConfig } from '../../shared/types.ts';

const P = (lng: number, lat: number) => ({ lng, lat });

export const sanfrancisco: RegionConfig = {
  id: 'sanfrancisco',
  name: 'San Francisco — El Niño storms + king tide (3D city)',
  center: P(-122.445, 37.775),
  zoom: 11.3,
  bbox: [-122.56, 37.69, -122.34, 37.86],
  grid: { cols: 44, rows: 38 },
  // El Niño atmospheric river makes landfall over the Sunset / Twin Peaks (a quake started here snaps to the San Andreas trace)
  defaultTriggerAt: P(-122.465, 37.755),
  // Land polygons: everything else in the bbox is water. Traced along the real shoreline at ~0.5 km resolution.
  landmask: [
    [ // the peninsula: Ocean Beach → Lands End → Golden Gate shore → Embarcadero → Hunters Point → Candlestick → Daly City
      P(-122.505, 37.690), P(-122.507, 37.720), P(-122.510, 37.760), P(-122.513, 37.778), P(-122.514, 37.787),
      P(-122.505, 37.791), P(-122.492, 37.789), P(-122.484, 37.796), P(-122.478, 37.808), P(-122.468, 37.808),
      P(-122.452, 37.807), P(-122.440, 37.808), P(-122.429, 37.809), P(-122.420, 37.810), P(-122.410, 37.811),
      P(-122.403, 37.809), P(-122.396, 37.804), P(-122.391, 37.797), P(-122.387, 37.790), P(-122.386, 37.783),
      P(-122.388, 37.777), P(-122.385, 37.771), P(-122.383, 37.763), P(-122.381, 37.754), P(-122.384, 37.747),
      P(-122.374, 37.740), P(-122.360, 37.733), P(-122.355, 37.722), P(-122.367, 37.713), P(-122.378, 37.709),
      P(-122.388, 37.704), P(-122.391, 37.696), P(-122.398, 37.690),
    ],
    [ // Marin Headlands / Sausalito (north anchorage of the Golden Gate; no district, just terrain)
      P(-122.560, 37.812), P(-122.535, 37.813), P(-122.518, 37.819), P(-122.495, 37.824), P(-122.479, 37.826),
      P(-122.470, 37.833), P(-122.474, 37.846), P(-122.481, 37.858), P(-122.487, 37.860), P(-122.560, 37.860),
    ],
    [ // Treasure Island (1936-37 fill) + Yerba Buena Island
      P(-122.381, 37.817), P(-122.381, 37.833), P(-122.363, 37.834), P(-122.362, 37.822), P(-122.358, 37.813),
      P(-122.361, 37.806), P(-122.371, 37.805), P(-122.376, 37.812),
    ],
  ],
  // NOTE: order matters for cell assignment (first polygon containing a cell wins) — small districts first.
  districts: [
    { id: 'treasureisland', name: 'Treasure Island / Yerba Buena Island (bay fill)', terrain: 'softsoil', population: 3000, centroid: P(-122.371, 37.822),
      polygon: [P(-122.385, 37.800), P(-122.355, 37.800), P(-122.355, 37.840), P(-122.385, 37.840)] },
    { id: 'marina', name: 'Marina / Cow Hollow (bay fill)', terrain: 'softsoil', population: 50000, centroid: P(-122.436, 37.801),
      polygon: [P(-122.455, 37.792), P(-122.418, 37.792), P(-122.418, 37.815), P(-122.455, 37.815)] },
    { id: 'soma', name: 'SoMa / Mission Bay / South Beach (bay fill)', terrain: 'softsoil', population: 60000, centroid: P(-122.400, 37.776),
      polygon: [P(-122.415, 37.762), P(-122.375, 37.762), P(-122.375, 37.785), P(-122.415, 37.785)] },
    { id: 'bayview', name: 'Bayview / Hunters Point / Visitacion Valley (bay fill)', terrain: 'softsoil', population: 65000, centroid: P(-122.390, 37.728),
      polygon: [P(-122.415, 37.690), P(-122.340, 37.690), P(-122.340, 37.762), P(-122.375, 37.762), P(-122.375, 37.735), P(-122.415, 37.735)] },
    { id: 'presidio', name: 'Presidio / Sea Cliff / Lands End', terrain: 'hills', elevRange: [30, 120], population: 8000, centroid: P(-122.470, 37.797),
      polygon: [P(-122.520, 37.782), P(-122.455, 37.782), P(-122.455, 37.815), P(-122.520, 37.815)] },
    { id: 'twinpeaks', name: 'Twin Peaks / Mt Davidson / Glen Park / Excelsior', terrain: 'urban', elevRange: [90, 280], population: 115000, centroid: P(-122.445, 37.735), // built-up hills: urban fire/landslide behaviour, ridge elevation
      polygon: [P(-122.465, 37.690), P(-122.415, 37.690), P(-122.415, 37.730), P(-122.440, 37.740), P(-122.440, 37.762), P(-122.465, 37.762)] },
    { id: 'downtown', name: 'Downtown / Financial District / North Beach / Chinatown', terrain: 'urban', population: 100000, centroid: P(-122.408, 37.795),
      polygon: [P(-122.418, 37.785), P(-122.380, 37.785), P(-122.380, 37.815), P(-122.418, 37.815)] },
    { id: 'central', name: 'Western Addition / Haight / Castro / Noe Valley', terrain: 'urban', population: 120000, centroid: P(-122.435, 37.770),
      polygon: [P(-122.445, 37.728), P(-122.415, 37.728), P(-122.415, 37.792), P(-122.455, 37.792), P(-122.455, 37.782), P(-122.445, 37.782)] },
    { id: 'mission', name: 'Mission / Potrero Hill / Bernal Heights', terrain: 'urban', population: 95000, centroid: P(-122.410, 37.752),
      polygon: [P(-122.420, 37.728), P(-122.375, 37.728), P(-122.375, 37.762), P(-122.420, 37.762)] },
    { id: 'richmond', name: 'Richmond District / Golden Gate Park', terrain: 'urban', population: 110000, centroid: P(-122.480, 37.775),
      polygon: [P(-122.520, 37.762), P(-122.445, 37.762), P(-122.445, 37.782), P(-122.520, 37.782)] },
    { id: 'sunset', name: 'Sunset / Parkside / Lake Merced', terrain: 'coast', population: 120000, centroid: P(-122.490, 37.740),
      polygon: [P(-122.520, 37.690), P(-122.465, 37.690), P(-122.465, 37.762), P(-122.520, 37.762)] },
  ],
  infra: [
    // bridges (spanKm = road corridor radius over water; the real spans are 2.7 km and 3.1 km)
    { id: 'goldengate', name: 'Golden Gate Bridge (US-101)', kind: 'bridge', at: P(-122.4785, 37.8199), districtIds: ['presidio', 'marina'], spanKm: 1.8 },
    { id: 'baybridge', name: 'Bay Bridge west span (I-80)', kind: 'bridge', at: P(-122.378, 37.799), districtIds: ['soma', 'downtown', 'treasureisland'], spanKm: 2.0 },
    // hospitals
    { id: 'zsfg', name: 'Zuckerberg SF General (Level I trauma)', kind: 'hospital', at: P(-122.4047, 37.7553), districtIds: ['mission', 'bayview'], capacity: 400 },
    { id: 'ucsf_parnassus', name: 'UCSF Medical Center (Parnassus)', kind: 'hospital', at: P(-122.4578, 37.7631), districtIds: ['central', 'sunset', 'richmond'], capacity: 600 },
    { id: 'ucsf_missionbay', name: 'UCSF Medical Center at Mission Bay', kind: 'hospital', at: P(-122.3913, 37.7667), districtIds: ['soma', 'mission'], capacity: 290 },
    { id: 'cpmc_vanness', name: 'CPMC Van Ness Campus', kind: 'hospital', at: P(-122.4227, 37.7872), districtIds: ['downtown', 'central', 'marina'], capacity: 270 },
    { id: 'stfrancis', name: 'Saint Francis Memorial Hospital', kind: 'hospital', at: P(-122.4165, 37.7895), districtIds: ['downtown'], capacity: 250 },
    { id: 'kaiser_geary', name: 'Kaiser Permanente SF (Geary)', kind: 'hospital', at: P(-122.4420, 37.7826), districtIds: ['richmond', 'central'], capacity: 250 },
    { id: 'cpmc_missionbernal', name: 'CPMC Mission Bernal (St. Luke’s)', kind: 'hospital', at: P(-122.4195, 37.7470), districtIds: ['mission', 'central', 'twinpeaks'], capacity: 120 },
    { id: 'va_fortmiley', name: 'SF VA Medical Center (Fort Miley)', kind: 'hospital', at: P(-122.5047, 37.7824), districtIds: ['presidio', 'richmond'], capacity: 120 },
    { id: 'chinese', name: 'Chinese Hospital (Chinatown)', kind: 'hospital', at: P(-122.4079, 37.7954), districtIds: ['downtown'], capacity: 60 },
    // shelters / mass-care sites (large public venues; not the official DEM shelter list)
    { id: 'moscone', name: 'Moscone Center', kind: 'shelter', at: P(-122.4014, 37.7841), districtIds: ['soma', 'downtown'], capacity: 8000 },
    { id: 'billgraham', name: 'Bill Graham Civic Auditorium', kind: 'shelter', at: P(-122.4180, 37.7784), districtIds: ['central', 'downtown'], capacity: 7000 },
    { id: 'polofields', name: 'Golden Gate Park Polo Fields', kind: 'shelter', at: P(-122.4934, 37.7686), districtIds: ['richmond', 'sunset'], capacity: 10000 },
    { id: 'kezar', name: 'Kezar Pavilion', kind: 'shelter', at: P(-122.4568, 37.7676), districtIds: ['central', 'richmond'], capacity: 2500 },
    { id: 'chasecenter', name: 'Chase Center', kind: 'shelter', at: P(-122.3875, 37.7680), districtIds: ['soma', 'mission'], capacity: 12000 },
    { id: 'oraclepark', name: 'Oracle Park', kind: 'shelter', at: P(-122.3910, 37.7786), districtIds: ['soma'], capacity: 20000 },
    { id: 'presidio_mainpost', name: 'Presidio Main Post / Crissy Field', kind: 'shelter', at: P(-122.4560, 37.8000), districtIds: ['presidio', 'marina'], capacity: 5000 },
    { id: 'doloreshigh', name: 'Mission High / Dolores Park', kind: 'shelter', at: P(-122.4265, 37.7605), districtIds: ['mission', 'central'], capacity: 3000 },
    { id: 'balboa', name: 'Balboa Park / City College', kind: 'shelter', at: P(-122.4480, 37.7246), districtIds: ['twinpeaks', 'sunset'], capacity: 4000 },
    { id: 'cowpalace', name: 'Cow Palace', kind: 'shelter', at: P(-122.4178, 37.7073), districtIds: ['bayview', 'twinpeaks'], capacity: 6000 },
    { id: 'bayview_opera', name: 'Bayview Opera House / Hilltop Park', kind: 'shelter', at: P(-122.3907, 37.7318), districtIds: ['bayview'], capacity: 2000 },
    // highways / lifelines (point = representative chokepoint)
    { id: 'us101', name: 'US-101 / Central Freeway & Van Ness corridor', kind: 'highway', at: P(-122.4200, 37.7700), districtIds: ['central', 'soma', 'mission'] },
    { id: 'i280', name: 'I-280 (King St ramps / Potrero)', kind: 'highway', at: P(-122.3960, 37.7480), districtIds: ['mission', 'bayview', 'soma'] },
    { id: 'hwy1', name: 'Hwy 1 / 19th Avenue', kind: 'highway', at: P(-122.4755, 37.7400), districtIds: ['sunset', 'richmond'] },
    { id: 'doyle', name: 'Presidio Parkway (Doyle Drive, Golden Gate approach)', kind: 'highway', at: P(-122.4650, 37.8050), districtIds: ['presidio', 'marina'] },
    { id: 'embarcadero', name: 'The Embarcadero', kind: 'highway', at: P(-122.3930, 37.7970), districtIds: ['downtown', 'soma'] },
    { id: 'barttube', name: 'BART Transbay Tube (Embarcadero–Oakland)', kind: 'highway', at: P(-122.3830, 37.7930), districtIds: ['downtown', 'soma', 'treasureisland'] },
    // El Niño municipal services
    { id: 'eoc_sf', name: 'SF Emergency Operations Center (1011 Turk St)', kind: 'eoc', at: P(-122.428, 37.781), districtIds: ['central', 'downtown', 'soma', 'mission', 'marina', 'richmond', 'sunset', 'bayview', 'twinpeaks', 'presidio', 'treasureisland'] },
    { id: 'fs_hq', name: 'SF Fire Dept HQ (698 2nd St)', kind: 'fire_station', at: P(-122.392, 37.779), districtIds: ['soma'] },
    { id: 'fs_marina', name: 'SFFD fire station (Marina)', kind: 'fire_station', at: P(-122.437, 37.8), districtIds: ['marina'] },
    { id: 'fs_bayview', name: 'SFFD fire station (Bayview)', kind: 'fire_station', at: P(-122.392, 37.735), districtIds: ['bayview'] },
    { id: 'fs_sunset', name: 'SFFD fire station (Outer Sunset)', kind: 'fire_station', at: P(-122.495, 37.752), districtIds: ['sunset'] },
    { id: 'fs_ti', name: 'SFFD fire station (Treasure Island)', kind: 'fire_station', at: P(-122.372, 37.825), districtIds: ['treasureisland'] },
    { id: 'ps_channel', name: 'Channel Pump Station (Mission Creek)', kind: 'pump_station', at: P(-122.394, 37.771), districtIds: ['soma', 'mission'] },
    { id: 'ps_islais', name: 'Islais Creek pump station', kind: 'pump_station', at: P(-122.392, 37.744), districtIds: ['bayview'] },
    { id: 'ps_southeast', name: 'Southeast Treatment Plant', kind: 'pump_station', at: P(-122.385, 37.742), districtIds: ['bayview'] },
    { id: 'ps_oceanside', name: 'Oceanside Treatment Plant', kind: 'pump_station', at: P(-122.502, 37.718), districtIds: ['sunset'] },
    { id: 'ps_northpoint', name: 'North Point wet-weather facility', kind: 'pump_station', at: P(-122.405, 37.807), districtIds: ['downtown', 'marina'] },
    { id: 'sub_larkin', name: 'PG&E Larkin Substation', kind: 'substation', at: P(-122.418, 37.787), districtIds: ['downtown', 'central'] },
    { id: 'sub_potrero', name: 'PG&E Potrero Substation', kind: 'substation', at: P(-122.386, 37.757), districtIds: ['mission', 'bayview', 'soma'] },
    { id: 'sub_mission', name: 'PG&E Mission Substation', kind: 'substation', at: P(-122.408, 37.772), districtIds: ['soma', 'mission'] },
    { id: 'sub_martin', name: 'PG&E Martin Substation', kind: 'substation', at: P(-122.415, 37.7), districtIds: ['bayview', 'twinpeaks'] },
    { id: 'lv_embarcadero', name: 'Embarcadero Seawall', kind: 'levee', at: P(-122.392, 37.797), districtIds: ['downtown', 'soma'] },
    { id: 'lv_oceanbeach', name: 'Ocean Beach seawall (Great Hwy south of Sloat)', kind: 'levee', at: P(-122.508, 37.732), districtIds: ['sunset'] },
    // helicopter staging (SFO lies outside the city grid)
    { id: 'crissy_helibase', name: 'Crissy Field helicopter staging', kind: 'airport', at: P(-122.4620, 37.8045), districtIds: ['presidio', 'marina'] },
    { id: 'hunterspoint_helipad', name: 'Hunters Point / India Basin helipad', kind: 'airport', at: P(-122.3700, 37.7300), districtIds: ['bayview'] },
  ],
  // Roads are drawn in the 3D scene only (the sim routes on its grid). Approximate centrelines of the real alignments.
  roads: [
    { id: 'us101', name: 'US-101 (Golden Gate Bridge · Doyle Dr · Van Ness · Central Fwy · Bayshore)', kind: 'highway', line: [
      P(-122.4785, 37.826), P(-122.4775, 37.810), P(-122.465, 37.805), P(-122.448, 37.802), P(-122.4245, 37.802), P(-122.4225, 37.790), P(-122.421, 37.776),
      P(-122.416, 37.771), P(-122.408, 37.768), P(-122.4045, 37.760), P(-122.402, 37.750), P(-122.405, 37.740), P(-122.405, 37.730), P(-122.404, 37.720), P(-122.400, 37.708), P(-122.397, 37.690) ] },
    { id: 'i80', name: 'I-80 (Skyway · Bay Bridge)', kind: 'highway', line: [
      P(-122.408, 37.770), P(-122.398, 37.781), P(-122.392, 37.786), P(-122.385, 37.790), P(-122.375, 37.800), P(-122.366, 37.808), P(-122.356, 37.815), P(-122.340, 37.822) ] },
    { id: 'i280', name: 'I-280 (King St · Potrero · Alemany · Daly City)', kind: 'highway', line: [
      P(-122.393, 37.776), P(-122.392, 37.765), P(-122.395, 37.752), P(-122.405, 37.740), P(-122.420, 37.733), P(-122.440, 37.725), P(-122.460, 37.715), P(-122.470, 37.705), P(-122.475, 37.690) ] },
    { id: 'hwy1', name: 'Hwy 1 (Park Presidio · 19th Ave · Junipero Serra)', kind: 'highway', line: [
      P(-122.4775, 37.810), P(-122.4725, 37.800), P(-122.472, 37.785), P(-122.4725, 37.775), P(-122.4755, 37.768), P(-122.4755, 37.750), P(-122.4755, 37.730), P(-122.4755, 37.720), P(-122.470, 37.705), P(-122.468, 37.690) ] },
    { id: 'greathwy', name: 'Great Highway / Skyline Blvd', kind: 'arterial', line: [P(-122.509, 37.775), P(-122.509, 37.735), P(-122.505, 37.720), P(-122.500, 37.705), P(-122.495, 37.690)] },
    { id: 'market', name: 'Market Street', kind: 'arterial', line: [P(-122.393, 37.7945), P(-122.400, 37.789), P(-122.410, 37.782), P(-122.420, 37.775), P(-122.430, 37.768), P(-122.435, 37.762), P(-122.445, 37.752)] },
    { id: 'geary', name: 'Geary Boulevard', kind: 'arterial', line: [P(-122.405, 37.787), P(-122.420, 37.786), P(-122.440, 37.783), P(-122.460, 37.781), P(-122.480, 37.780), P(-122.500, 37.780), P(-122.510, 37.780)] },
    { id: 'embarcadero', name: 'The Embarcadero', kind: 'arterial', line: [P(-122.412, 37.808), P(-122.403, 37.806), P(-122.396, 37.800), P(-122.393, 37.795), P(-122.389, 37.788), P(-122.388, 37.780), P(-122.392, 37.777)] },
    { id: 'missionst', name: 'Mission Street', kind: 'arterial', line: [P(-122.400, 37.788), P(-122.410, 37.780), P(-122.420, 37.768), P(-122.419, 37.755), P(-122.420, 37.740), P(-122.430, 37.725), P(-122.440, 37.715), P(-122.450, 37.705), P(-122.460, 37.695)] },
    { id: 'thirdst', name: 'Third Street', kind: 'arterial', line: [P(-122.389, 37.780), P(-122.389, 37.770), P(-122.389, 37.760), P(-122.388, 37.750), P(-122.390, 37.740), P(-122.390, 37.730), P(-122.395, 37.720), P(-122.400, 37.710)] },
    { id: 'sunsetblvd', name: 'Sunset Boulevard', kind: 'arterial', line: [P(-122.496, 37.763), P(-122.496, 37.745), P(-122.496, 37.720)] },
  ],
  // Low-detail surroundings (outside the sim bbox) so the city sits in its geography: Marin, the East Bay, the Peninsula.
  context: {
    bbox: [-122.82, 37.50, -122.10, 38.06],
    land: [
      [ // Marin (Headlands to Point Reyes; Sausalito / Tiburon / San Rafael on the bay side)
        P(-122.82, 37.86), P(-122.58, 37.86), P(-122.48, 37.86), P(-122.445, 37.873), P(-122.455, 37.900), P(-122.470, 37.950), P(-122.450, 38.000), P(-122.500, 38.060), P(-122.82, 38.060) ],
      [ P(-122.44, 37.862), P(-122.415, 37.862), P(-122.420, 37.876), P(-122.44, 37.876) ], // Angel Island
      [ // East Bay (Richmond / Berkeley / Oakland / Alameda / San Leandro / Hayward)
        P(-122.10, 37.50), P(-122.10, 38.06), P(-122.36, 38.06), P(-122.34, 37.95), P(-122.32, 37.90), P(-122.32, 37.84), P(-122.30, 37.80), P(-122.32, 37.77), P(-122.27, 37.73), P(-122.22, 37.70), P(-122.17, 37.63), P(-122.13, 37.55) ],
      [ // Peninsula south of the city (Daly City / Pacifica / SFO / San Mateo)
        P(-122.51, 37.69), P(-122.50, 37.66), P(-122.50, 37.60), P(-122.52, 37.55), P(-122.50, 37.50), P(-122.22, 37.50), P(-122.28, 37.56), P(-122.35, 37.60), P(-122.38, 37.64), P(-122.39, 37.69) ],
    ],
    labels: [
      { name: 'Pacific Ocean', at: P(-122.70, 37.70) }, { name: 'Marin County', at: P(-122.62, 37.96) }, { name: 'San Francisco Bay', at: P(-122.33, 37.90) },
      { name: 'Oakland', at: P(-122.24, 37.80) }, { name: 'Berkeley', at: P(-122.26, 37.875) }, { name: 'Alameda', at: P(-122.24, 37.755) },
      { name: 'Daly City', at: P(-122.47, 37.672) }, { name: 'SFO', at: P(-122.37, 37.615) }, { name: 'San Mateo', at: P(-122.31, 37.56) }, { name: 'Sausalito', at: P(-122.50, 37.875) },
    ],
    roads: [
      { id: 'ctx-101n', name: 'US-101 north', kind: 'highway', line: [P(-122.4785, 37.826), P(-122.482, 37.840), P(-122.492, 37.862), P(-122.505, 37.900), P(-122.520, 37.960), P(-122.530, 38.02)] },
      { id: 'ctx-101s', name: 'US-101 south', kind: 'highway', line: [P(-122.397, 37.690), P(-122.400, 37.650), P(-122.395, 37.620), P(-122.350, 37.580), P(-122.300, 37.530), P(-122.270, 37.500)] },
      { id: 'ctx-280s', name: 'I-280 south', kind: 'highway', line: [P(-122.475, 37.690), P(-122.480, 37.650), P(-122.470, 37.610), P(-122.420, 37.560), P(-122.350, 37.510)] },
      { id: 'ctx-80e', name: 'I-80 east', kind: 'highway', line: [P(-122.340, 37.822), P(-122.310, 37.826), P(-122.295, 37.835), P(-122.290, 37.870), P(-122.300, 37.930)] },
      { id: 'ctx-880', name: 'I-880', kind: 'highway', line: [P(-122.295, 37.835), P(-122.280, 37.800), P(-122.240, 37.740), P(-122.190, 37.690), P(-122.130, 37.620)] },
      { id: 'ctx-1s', name: 'Hwy 1 south', kind: 'highway', line: [P(-122.495, 37.690), P(-122.495, 37.650), P(-122.500, 37.600), P(-122.515, 37.550), P(-122.500, 37.505)] },
      { id: 'ctx-rsr', name: 'Richmond–San Rafael Bridge (I-580)', kind: 'highway', line: [P(-122.470, 37.950), P(-122.420, 37.935), P(-122.360, 37.930)] },
      { id: 'ctx-sanmateo', name: 'San Mateo Bridge (Hwy 92)', kind: 'highway', line: [P(-122.300, 37.560), P(-122.250, 37.590), P(-122.150, 37.630)] },
    ],
  },
  faults: [
    // Peninsula segment: comes ashore at Mussel Rock (Daly City) and runs offshore NNW towards Bolinas — the 1906 trace.
    { id: 'sanandreas', name: 'San Andreas Fault', line: [P(-122.44, 37.60), P(-122.47, 37.64), P(-122.497, 37.667), P(-122.52, 37.70), P(-122.563, 37.75), P(-122.603, 37.80), P(-122.642, 37.85), P(-122.69, 37.91)] },
  ],
  triggers: [
    { kind: 'rain', label: 'El Niño atmospheric river + king tide', params: [
      { name: 'rain_mm', label: 'Storm rainfall (mm)', min: 50, max: 400, step: 10, default: 170 },
      { name: 'duration', label: 'Storm duration (ticks)', min: 4, max: 16, step: 1, default: 10 },
      { name: 'radius_km', label: 'Storm footprint radius (km)', min: 3, max: 20, step: 1, default: 12 },
      { name: 'tide_ft', label: 'King tide (ft above MLLW)', min: 0, max: 8, step: 0.1, default: 7.2 },
    ] },
    { kind: 'quake', label: 'Earthquake (1906 San Andreas scenario)', params: [{ name: 'magnitude', label: 'Magnitude (Mw)', min: 5.5, max: 8.0, step: 0.1, default: 7.8 }] },
    { kind: 'fire', label: 'Urban conflagration (Diablo wind)', params: [
      { name: 'wind_speed', label: 'Wind speed (mph)', min: 0, max: 40, step: 1, default: 25 },
      { name: 'wind_dir_deg', label: 'Wind from (deg)', min: 0, max: 360, step: 5, default: 45 },
      { name: 'dryness', label: 'Fuel dryness', min: 0, max: 1, step: 0.05, default: 0.75 },
    ] },
  ],
  facts: [
    { text: 'On 31 Dec 2022 an atmospheric river dropped about 5.5 inches of rain on downtown San Francisco, its second-wettest day since records began in 1849.', verified: true },
    { text: 'Winter storm erosion at Ocean Beach south of Sloat Boulevard has repeatedly undermined the Great Highway extension and its parking lots.', verified: true },
    { text: 'The Embarcadero Seawall, built between 1878 and 1916, holds up about 3 miles of the bay-fill waterfront and is being strengthened against quakes and sea-level rise.', verified: true },
    { text: 'King tides push Bay water onto the Embarcadero promenade and low streets in Mission Bay; a king tide during a storm leaves the combined sewer system nowhere to drain.', verified: false },
    { text: 'On 18 April 1906 a ~M7.9 earthquake ruptured about 480 km of the San Andreas Fault, with the epicentre offshore of the city. The fires that followed burned for three days, destroyed roughly 80% of San Francisco (about 28,000 buildings) and the death toll is estimated at 3,000 or more.',
      verified: true, source: 'https://earthquake.usgs.gov/earthquakes/events/1906calif/18april/' },
    { text: 'In 1906 broken water mains left firefighters without water. The city responded with the Auxiliary Water Supply System (completed 1913): a separate high-pressure firefighting network fed from the Twin Peaks reservoir, two bay-water pump stations and ~170 underground cisterns.',
      verified: true, source: 'https://en.wikipedia.org/wiki/Auxiliary_Water_Supply_System' },
    { text: 'Loma Prieta, 17 Oct 1989 (M6.9, epicentre ~100 km south): the Marina District, built on fill from the 1915 fair site, suffered liquefaction, collapsed apartment buildings and a gas-fed fire; the Embarcadero Freeway was damaged and later demolished, and a section of the Bay Bridge upper deck collapsed.',
      verified: true, source: 'https://en.wikipedia.org/wiki/1989_Loma_Prieta_earthquake' },
    { text: 'Treasure Island (artificial fill, 1936–37), the Marina, Mission Bay / SoMa, the old Mission Creek channel and Hunters Point are mapped by the California Geological Survey as zones of very high liquefaction susceptibility.',
      verified: true, source: 'https://www.conservation.ca.gov/cgs/sh/program' },
    { text: 'USGS UCERF3 (2014): a 72% chance of at least one M6.7+ earthquake in the Bay Area by 2043; the Hayward–Rodgers Creek system carries the highest single-fault probability (~33%) and the northern San Andreas ~22%.',
      verified: true, source: 'https://pubs.usgs.gov/fs/2016/3020/' },
    { text: 'The Bay Bridge east span was replaced in 2013 after the 1989 collapse; the Golden Gate Bridge has been under a phased seismic retrofit since 1997. Both bridges plus the BART Transbay Tube are the only fixed links out of the city to the north and east; ferries were the backup after 1989.',
      verified: true, source: 'https://en.wikipedia.org/wiki/San_Francisco%E2%80%93Oakland_Bay_Bridge' },
    { text: 'Zuckerberg San Francisco General is the city’s only Level I trauma centre. Hetch Hetchy water reaches the city through pipelines that cross the Hayward and Calaveras faults in the East Bay; SFPUC’s Water System Improvement Program was built to restore basic service within 24 hours of a major earthquake.',
      verified: true, source: 'https://sfpuc.org/' },
    { text: 'Diablo winds — hot, dry offshore winds from the north-east (Oakland Hills 1991, North Bay 2017) — are the Bay Area’s urban-conflagration wind setup; the secondary trigger here ignites a wind-driven fire under those conditions.',
      verified: true, source: 'https://en.wikipedia.org/wiki/Diablo_wind' },
    { text: 'Simulated: the engine treats bay-fill districts (softsoil) as 1.5× shaking amplification with liquefaction-type displacement above 0.6, seeds gas-line fires in hard-shaken urban cells, and uses large public venues as shelters. It does not model soil columns, building stock, the AWSS or the official DEM shelter list.',
      verified: false },
  ],
  disclaimer: 'SUPERSCADE is a planning simulator with simplified, synthetic hazard rules. It is not a forecast, not real-time data and not official emergency guidance. Follow local authorities in a real emergency.',
};
