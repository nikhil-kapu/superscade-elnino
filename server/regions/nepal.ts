// Nepal region config — Trishuli / Bhote Koshi (Gandaki) basin + Kathmandu Valley.
// Anchored on the 26 Aug 2026 Rasuwagadhi (Lhende Khola → Bhote Koshi → Trishuli) rock-ice-avalanche flash flood
// and the 11 Oct 2026 Budhi Gandaki landslide-dam flood in Gorkha, with Sept 2024 Bagmati floods and the 2015 Gorkha
// earthquake as secondary context. Geometry is approximate (simple rings around real geography) — planning simulator, not GIS.
import type { RegionConfig } from '../../shared/types.ts';

const P = (lng: number, lat: number) => ({ lng, lat });

export const nepal: RegionConfig = {
  id: 'nepal',
  name: 'Nepal — Trishuli/Gandaki basin & Kathmandu Valley',
  center: P(85.05, 27.9),
  zoom: 8.5,
  bbox: [84.3, 27.35, 85.85, 28.45],
  grid: { cols: 48, rows: 40 },
  // NOTE: order matters for cell assignment (first polygon containing a cell wins) — small valley districts first.
  districts: [
    { id: 'kathmandu', name: 'Kathmandu', terrain: 'urban', population: 2050000, centroid: P(85.32, 27.72),
      polygon: [P(85.20, 27.65), P(85.42, 27.65), P(85.42, 27.80), P(85.33, 27.82), P(85.20, 27.80)] },
    { id: 'bhaktapur', name: 'Bhaktapur / Dhulikhel', terrain: 'valley', population: 430000, centroid: P(85.45, 27.67),
      polygon: [P(85.42, 27.58), P(85.58, 27.58), P(85.60, 27.70), P(85.55, 27.78), P(85.42, 27.78)] },
    { id: 'lalitpur', name: 'Lalitpur (Patan)', terrain: 'valley', population: 550000, centroid: P(85.32, 27.62),
      polygon: [P(85.20, 27.45), P(85.42, 27.45), P(85.42, 27.65), P(85.20, 27.65)] },
    { id: 'nuwakot', name: 'Nuwakot (Bidur / Trishuli Bazar / Betrawati)', terrain: 'hills', population: 290000, centroid: P(85.16, 27.92),
      polygon: [P(85.00, 27.80), P(85.35, 27.80), P(85.42, 27.90), P(85.37, 28.02), P(85.00, 28.05)] },
    { id: 'rasuwa', name: 'Rasuwa (Rasuwagadhi / Syaphrubesi / Dhunche)', terrain: 'hills', population: 46000, centroid: P(85.30, 28.17),
      polygon: [P(85.00, 28.05), P(85.37, 28.02), P(85.55, 28.10), P(85.55, 28.42), P(85.10, 28.42)] },
    { id: 'dhading', name: 'Dhading (Galchhi / Benighat / Krishnabhir)', terrain: 'hills', population: 325000, centroid: P(84.88, 27.90),
      polygon: [P(84.70, 27.70), P(84.98, 27.70), P(85.00, 28.05), P(84.78, 28.05), P(84.70, 27.92)] },
    { id: 'gorkha', name: 'Gorkha (Arughat / Budhi Gandaki)', terrain: 'hills', population: 250000, centroid: P(84.70, 28.15),
      polygon: [P(84.45, 27.92), P(84.70, 27.92), P(84.78, 28.05), P(84.95, 28.05), P(84.95, 28.42), P(84.45, 28.42)] },
    { id: 'sindhupalchok', name: 'Sindhupalchok (Araniko corridor)', terrain: 'hills', population: 260000, centroid: P(85.68, 27.95),
      polygon: [P(85.42, 27.80), P(85.85, 27.72), P(85.85, 28.25), P(85.55, 28.25), P(85.55, 28.10), P(85.42, 27.95)] },
    { id: 'makwanpur', name: 'Makwanpur (Hetauda / Kanti corridor)', terrain: 'hills', population: 420000, centroid: P(85.05, 27.50),
      polygon: [P(84.75, 27.35), P(85.20, 27.35), P(85.20, 27.62), P(85.00, 27.70), P(84.75, 27.70)] },
    { id: 'chitwan', name: 'Chitwan (Bharatpur / Narayani floodplain)', terrain: 'softsoil', population: 720000, centroid: P(84.45, 27.62),
      polygon: [P(84.30, 27.40), P(84.70, 27.40), P(84.72, 27.70), P(84.62, 27.90), P(84.40, 27.90), P(84.30, 27.75)] },
  ],
  // Rivers are ordered upstream -> downstream (the dam/surge rule walks the polyline in this order).
  rivers: [
    { id: 'trishuli', name: 'Bhote Koshi → Trishuli → Narayani', line: [
      P(85.40, 28.32), // Lhende Khola junction above Rasuwagadhi (flood origin)
      P(85.38, 28.28), // Rasuwagadhi border post / Timure
      P(85.34, 28.16), // Syaphrubesi
      P(85.28, 28.08), // below Dhunche / Mailung Khola
      P(85.24, 28.03), // Mailung
      P(85.19, 27.97), // Betrawati
      P(85.14, 27.92), // Trishuli Bazar (Bidur)
      P(85.12, 27.87), // Devighat
      P(84.98, 27.82), // Galchhi (Prithvi Highway joins the river)
      P(84.86, 27.84), // Krishnabhir
      P(84.78, 27.80), // Benighat — Budhi Gandaki confluence
      P(84.56, 27.85), // Mugling
      P(84.48, 27.78),
      P(84.42, 27.72), // Devghat → Narayani at Narayangarh
      P(84.40, 27.58),
    ] },
    { id: 'budhigandaki', name: 'Budhi Gandaki', line: [
      P(84.93, 28.42), // Chumnubri / Chumchure area (Oct 2026 landslide dam)
      P(84.90, 28.32),
      P(84.86, 28.22),
      P(84.83, 28.12),
      P(84.82, 28.05), // Arughat
      P(84.80, 27.95),
      P(84.78, 27.86),
      P(84.78, 27.80), // confluence with Trishuli at Benighat
    ] },
    { id: 'tadi', name: 'Tadi Khola', line: [
      P(85.42, 28.05), P(85.38, 28.02), P(85.32, 27.99), P(85.29, 27.97),
      P(85.26, 27.95), P(85.20, 27.91), P(85.16, 27.88), P(85.12, 27.87), // joins Trishuli at Devighat
    ] },
    { id: 'bagmati', name: 'Bagmati', line: [
      P(85.42, 27.78), // Sundarijal
      P(85.36, 27.74),
      P(85.32, 27.70), // Kathmandu core
      P(85.30, 27.67),
      P(85.29, 27.65), // Chobhar gorge (valley outlet)
      P(85.25, 27.58),
      P(85.20, 27.50),
      P(85.15, 27.42),
      P(85.10, 27.36), // toward the Terai
    ] },
  ],
  infra: [
    // Hospitals
    { id: 'h_bir', name: 'Bir Hospital', kind: 'hospital', at: P(85.313, 27.705), districtIds: ['kathmandu'], capacity: 500 },
    { id: 'h_patan', name: 'Patan Hospital', kind: 'hospital', at: P(85.320, 27.670), districtIds: ['lalitpur', 'kathmandu'], capacity: 450 },
    { id: 'h_dhulikhel', name: 'Dhulikhel Hospital', kind: 'hospital', at: P(85.550, 27.620), districtIds: ['bhaktapur', 'sindhupalchok'], capacity: 400 },
    { id: 'h_trishuli', name: 'Trishuli Hospital (Bidur)', kind: 'hospital', at: P(85.150, 27.925), districtIds: ['nuwakot', 'rasuwa'], capacity: 50 },
    { id: 'h_dhunche', name: 'Rasuwa District Hospital (Dhunche)', kind: 'hospital', at: P(85.300, 28.110), districtIds: ['rasuwa'], capacity: 25 },
    { id: 'h_dhading', name: 'Dhading Hospital (Dhading Besi)', kind: 'hospital', at: P(84.900, 27.870), districtIds: ['dhading'], capacity: 50 },
    { id: 'h_gorkha', name: 'Gorkha Hospital', kind: 'hospital', at: P(84.630, 28.000), districtIds: ['gorkha'], capacity: 50 },
    { id: 'h_bharatpur', name: 'Bharatpur Hospital', kind: 'hospital', at: P(84.430, 27.680), districtIds: ['chitwan'], capacity: 300 },
    { id: 'h_hetauda', name: 'Hetauda Hospital', kind: 'hospital', at: P(85.030, 27.430), districtIds: ['makwanpur'], capacity: 100 },
    // Shelters
    { id: 's_tundikhel', name: 'Tundikhel open ground', kind: 'shelter', at: P(85.315, 27.705), districtIds: ['kathmandu'], capacity: 20000 },
    { id: 's_dasharath', name: 'Dasharath Stadium', kind: 'shelter', at: P(85.317, 27.695), districtIds: ['kathmandu', 'lalitpur'], capacity: 15000 },
    { id: 's_lalitpur', name: 'Community school shelter – Lalitpur', kind: 'shelter', at: P(85.320, 27.630), districtIds: ['lalitpur'], capacity: 1000 },
    { id: 's_bhaktapur', name: 'Community school shelter – Bhaktapur', kind: 'shelter', at: P(85.430, 27.670), districtIds: ['bhaktapur'], capacity: 1000 },
    { id: 's_nuwakot', name: 'Community school shelter – Nuwakot (Bidur)', kind: 'shelter', at: P(85.160, 27.930), districtIds: ['nuwakot'], capacity: 800 },
    { id: 's_rasuwa', name: 'Community school shelter – Rasuwa (Dhunche)', kind: 'shelter', at: P(85.300, 28.120), districtIds: ['rasuwa'], capacity: 400 },
    { id: 's_dhading', name: 'Community school shelter – Dhading', kind: 'shelter', at: P(84.900, 27.880), districtIds: ['dhading'], capacity: 800 },
    { id: 's_gorkha', name: 'Community school shelter – Gorkha', kind: 'shelter', at: P(84.640, 28.010), districtIds: ['gorkha'], capacity: 600 },
    { id: 's_sindhupalchok', name: 'Community school shelter – Sindhupalchok (Chautara)', kind: 'shelter', at: P(85.710, 27.780), districtIds: ['sindhupalchok'], capacity: 500 },
    { id: 's_makwanpur', name: 'Community school shelter – Makwanpur (Hetauda)', kind: 'shelter', at: P(85.040, 27.440), districtIds: ['makwanpur'], capacity: 800 },
    { id: 's_chitwan', name: 'Community school shelter – Chitwan (Bharatpur)', kind: 'shelter', at: P(84.450, 27.660), districtIds: ['chitwan'], capacity: 2000 },
    // Highways (point = representative chokepoint)
    { id: 'hw_pasanglhamu', name: 'Pasang Lhamu Highway (Trishuli corridor, Betrawati–Syaphrubesi–Rasuwagadhi)', kind: 'highway', at: P(85.18, 27.97), districtIds: ['nuwakot', 'rasuwa'] },
    { id: 'hw_prithvi', name: 'Prithvi Highway (Naubise–Galchhi–Krishnabhir–Mugling)', kind: 'highway', at: P(84.86, 27.84), districtIds: ['dhading', 'nuwakot', 'gorkha', 'chitwan'] },
    { id: 'hw_mugling_narayangarh', name: 'Mugling–Narayangarh road', kind: 'highway', at: P(84.50, 27.80), districtIds: ['chitwan'] },
    { id: 'hw_tribhuvan', name: 'Tribhuvan Highway (Naubise–Bhimphedi–Hetauda)', kind: 'highway', at: P(85.13, 27.55), districtIds: ['makwanpur', 'lalitpur', 'dhading'] },
    { id: 'hw_kanti', name: 'Kanti Highway (Kathmandu–Hetauda)', kind: 'highway', at: P(85.22, 27.52), districtIds: ['lalitpur', 'makwanpur'] },
    { id: 'hw_araniko', name: 'Araniko Highway (Dhulikhel–Lamosangu–Kodari)', kind: 'highway', at: P(85.78, 27.75), districtIds: ['sindhupalchok', 'bhaktapur'] },
    { id: 'hw_bp', name: 'BP Highway (Dhulikhel–Nepalthok–Sindhuli)', kind: 'highway', at: P(85.60, 27.58), districtIds: ['bhaktapur'] },
    { id: 'hw_mahendra', name: 'East-West (Mahendra) Highway at Bharatpur', kind: 'highway', at: P(84.45, 27.65), districtIds: ['chitwan'] },
    // River crossings (bridges)
    { id: 'rc_rasuwagadhi', name: 'Rasuwagadhi border bridge (Bhote Koshi)', kind: 'river_crossing', at: P(85.38, 28.28), districtIds: ['rasuwa'] },
    { id: 'rc_syaphrubesi', name: 'Syaphrubesi bridge (Bhote Koshi)', kind: 'river_crossing', at: P(85.34, 28.16), districtIds: ['rasuwa'] },
    { id: 'rc_betrawati', name: 'Betrawati bridge (Trishuli)', kind: 'river_crossing', at: P(85.19, 27.97), districtIds: ['nuwakot', 'rasuwa'] },
    { id: 'rc_trishulibazar', name: 'Trishuli Bazar bridge', kind: 'river_crossing', at: P(85.14, 27.92), districtIds: ['nuwakot'] },
    { id: 'rc_devighat', name: 'Devighat bridge (Trishuli / Tadi confluence)', kind: 'river_crossing', at: P(85.12, 27.87), districtIds: ['nuwakot'] },
    { id: 'rc_galchhi', name: 'Galchhi bridge (Prithvi Highway over Trishuli)', kind: 'river_crossing', at: P(84.98, 27.82), districtIds: ['dhading', 'nuwakot'] },
    { id: 'rc_benighat', name: 'Benighat bridge (Budhi Gandaki confluence)', kind: 'river_crossing', at: P(84.78, 27.80), districtIds: ['dhading', 'gorkha'] },
    { id: 'rc_arughat', name: 'Arughat suspension bridge (Budhi Gandaki)', kind: 'river_crossing', at: P(84.82, 28.05), districtIds: ['gorkha'] },
    { id: 'rc_mugling', name: 'Mugling bridge (Trishuli)', kind: 'river_crossing', at: P(84.56, 27.85), districtIds: ['chitwan', 'gorkha'] },
    { id: 'rc_narayani', name: 'Narayani bridge (Narayangarh)', kind: 'river_crossing', at: P(84.42, 27.70), districtIds: ['chitwan'] },
    { id: 'rc_chobhar', name: 'Chobhar bridge (Bagmati)', kind: 'river_crossing', at: P(85.29, 27.66), districtIds: ['kathmandu', 'lalitpur'] },
    // Airports
    { id: 'ap_tia', name: 'Tribhuvan International Airport', kind: 'airport', at: P(85.36, 27.70), districtIds: ['kathmandu', 'bhaktapur', 'lalitpur'] },
    { id: 'ap_bharatpur', name: 'Bharatpur Airport', kind: 'airport', at: P(84.43, 27.68), districtIds: ['chitwan'] },
  ],
  triggers: [
    { kind: 'rain', label: 'Monsoon cloudburst / glacier-collapse surge', params: [
      { name: 'rain_mm', label: 'Rainfall (mm)', min: 50, max: 500, step: 10, default: 300 },
      { name: 'duration_ticks', label: 'Duration (ticks)', min: 2, max: 12, step: 1, default: 6 },
    ] },
    // Secondary trigger: 2015 Gorkha (M7.8) context — co-seismic landslides and dammed rivers.
    { kind: 'quake', label: 'Earthquake (Gorkha 2015 context)', params: [
      { name: 'magnitude', label: 'Magnitude', min: 5.5, max: 8.0, step: 0.1, default: 7.0 },
    ] },
  ],
  facts: [
    { text: 'On the morning of 26 Aug 2026 (08:37 NPT) a large rock-ice avalanche from the Lirung massif (Langtang) dammed the Lhende Khola; the dam failed and a debris-laden flash flood tore down the Bhote Koshi and Trishuli from Rasuwagadhi for roughly 72 km, through Rasuwa, Nuwakot and Dhading toward Chitwan.',
      verified: true, source: 'https://en.wikipedia.org/wiki/2026_Nepal%E2%80%93Tibet_floods' },
    { text: 'NDRRMA figures reported 7 Sep 2026 (via IOM): 1,356 dead and nearly 4,900 missing, ~84,000 people affected. By early October the NDRRMA count stood at about 1,454 dead and 5,285 missing; Tibet (China) reported 43 dead and 519 missing.',
      verified: true, source: 'https://www.iom.int/news/nepal-flood-death-toll-rises-aid-needs-soar' },
    { text: 'Settlements along the Trishuli corridor were inundated or buried: Timure, Syaphrubesi, Mailung, Betrawati, Trishuli Bazar and Devighat. The Rasuwagadhi customs post was destroyed and 300+ queued vehicles were swept away; a bridge at Trishuli Bazar and the Devighat span were lost.',
      verified: true, source: 'https://www.mappr.co/nepal-flash-flood-rasuwagadhi/' },
    { text: 'Hydropower on the Trishuli cascade was heavily damaged — Rasuwagadhi (111 MW), Chilime (22 MW), Upper Trishuli 3A (60 MW), Trishuli and Devighat plants among them; hundreds of workers at the Upper Trishuli-1 site were reported missing.',
      verified: true, source: 'https://en.wikipedia.org/wiki/2026_Nepal%E2%80%93Tibet_floods' },
    { text: 'The Prithvi Highway (Kathmandu–Mugling) was cut: the Baireni–Mugling section was blocked until 28 Aug, a ~70 m stretch at Krishnabhir collapsed into the Trishuli, and the Mugling–Kathmandu road was closed by river erosion. Roads from Kathmandu were passable only as far as Nuwakot in the first week.',
      verified: true, source: 'https://news.un.org/en/story/2026/08/1168233' },
    { text: 'UN News (31 Aug 2026): 903 confirmed dead, 4,200+ missing, 10,000+ rescued; flood emergency declared in 15 municipalities; humanitarian coordination hub set up in Nuwakot; 19 schools damaged and 8 used as shelters; OCHA called access the biggest obstacle to the response.',
      verified: true, source: 'https://news.un.org/en/story/2026/08/1168233' },
    { text: 'On 11 Oct 2026 a landslide dammed the Budhi Gandaki near Chumchure (Gorkha); the barrier burst, the flash flood swept away houses and left at least five people missing, and NDRRMA ordered evacuations along the river (AFP).',
      verified: true, source: 'https://www.euronews.com/video/2026/10/11/nepal-orders-evacuations-after-landslide-triggers-budhi-gandaki-flash-flood' },
    { text: 'Earlier in the 2026 monsoon (Kathmandu Post, 20 Jul 2026) landslides blocked the Araniko Highway at Kodari (Sindhupalchok), reduced the Pasang Lhamu Highway to one lane at Bokejhunda (Rasuwa), closed the Prithvi Highway at Phisling (Chitwan) and Jawang Khola (Dhading), and suspended the BP Highway and Kathmandu–Hetauda Kanti Highway over flood risk.',
      verified: true, source: 'https://kathmandupost.com/national/2026/07/20/landslides-and-floods-block-nine-highways' },
    { text: 'Historical context: the 27–29 Sep 2024 monsoon floods on the Bagmati inundated Kathmandu Valley and killed 200+ (final count ~240) with the BP Highway cut; the 25 Apr 2015 M7.8 Gorkha earthquake (epicentre Barpak, Gorkha) killed ~9,000 and triggered thousands of landslides in Rasuwa, Nuwakot, Dhading and Sindhupalchok.',
      verified: true, source: 'https://en.wikipedia.org/wiki/2024_Nepal_floods' },
    { text: 'Simulated: bridge-loss and downstream figures vary by ledger (Department of Roads: ~41 motorable bridges destroyed between Rasuwa and Chitwan; 68 suspension bridges damaged, 33 beyond repair; bodies recovered as far downstream as Chitwan, Nawalparasi and Uttar Pradesh) — the sim treats every river_crossing on a surging reach as at risk rather than using these counts.',
      verified: false, source: 'https://www.mappr.co/nepal-flash-flood-rasuwagadhi/' },
  ],
  disclaimer: 'Planning and response simulator built on public elevation/river geography and simple cascade rules. Not a forecast, not official guidance. Real events referenced respectfully; unverified details are labeled simulated.',
};
