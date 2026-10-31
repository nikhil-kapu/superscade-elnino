import { useEffect, useRef } from 'react';
import maplibregl, { Map as MLMap, Marker } from 'maplibre-gl';
import { useStore, agentColor, shortModel, tickClock, type LiveAgent, type LayerId } from '../store';
import type { RegionConfig, RoutePlan } from '../../../shared/types.ts';
import { agentHaloFC, agentLinksFC, burnFC, districtsFC, empty, frontFC, hazardPointsFC, hazardsFC, isoseismalFC, linesFC, pointFC, routesFC, spreadPathFC, type FeatureCollection } from './geo';
import { incidentName } from '../store';

const DEM = 'dem';
const INFRA_LETTER: Record<string, string> = { bridge: 'B', hospital: 'H', shelter: 'S', highway: 'W', airport: 'A', river_crossing: 'R', eoc: 'E', fire_station: 'F', pump_station: 'P', substation: '⚡', levee: 'L' };

function baseStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      imagery: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' },
      labels: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Esri' },
      [DEM]: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15 },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e9e2d6' } },
      { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-saturation': -0.55, 'raster-contrast': 0.12, 'raster-brightness-min': 0.08, 'raster-brightness-max': 0.98 } },
      { id: 'hillshade', type: 'hillshade', source: DEM, paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#5b4636', 'hillshade-highlight-color': '#fff7ec', 'hillshade-accent-color': '#c9a27a' } },
      { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.9, 'raster-saturation': -1 } },
    ],
  };
}

function addDataLayers(map: MLMap) {
  const src = (id: string) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty() }); };
  ['hazards', 'hazpts', 'burn', 'firefront', 'floodfront', 'iso', 'spread', 'spreadpins', 'districts', 'lines', 'routes', 'links', 'halos', 'epicenter'].forEach(src);
  const add = (l: maplibregl.LayerSpecification) => { if (!map.getLayer(l.id)) map.addLayer(l); };

  const foot = (id: string, kind: string, color: string, opacity: number) =>
    add({ id, type: 'fill', source: 'hazards', filter: ['==', ['get', 'kind'], kind], paint: { 'fill-color': color, 'fill-opacity': opacity, 'fill-antialias': false } });
  foot('foot-quake', 'quake', '#a78bfa', 0.18);
  foot('foot-flood', 'flood', '#3b82f6', 0.35);
  foot('foot-fire', 'fire', '#f97316', 0.3);
  const ramp = (stops: (number | string)[]): any => ['interpolate', ['linear'], ['heatmap-density'], ...stops];
  const heat = (id: string, kind: string, color: any, radius: [number, number], weightMul = 1, intensity = 1, weight?: any, opacity = 0.85) =>
    add({ id, type: 'heatmap', source: 'hazpts', filter: ['==', ['get', 'kind'], kind], paint: {
      'heatmap-weight': (weight ?? ['*', weightMul, ['get', 'intensity']]) as any,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, intensity * 0.6, 12, intensity, 15, intensity * 1.6] as any,
      'heatmap-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 8, radius[0], 11, radius[1], 14, radius[1] * 3] as any,
      'heatmap-color': color, 'heatmap-opacity': opacity,
    } });
  // shaking: soft violet glow, large radius
  heat('haz-quake', 'quake', ramp([0, 'rgba(139,92,246,0)', 0.25, 'rgba(139,92,246,0.18)', 0.6, 'rgba(139,92,246,0.42)', 1, 'rgba(109,40,217,0.6)']), [26, 44], 0.9, 0.8);
  // flood: steel blue
  heat('haz-flood', 'flood', ramp([0, 'rgba(59,130,246,0)', 0.15, 'rgba(96,165,250,0.55)', 0.5, '#2563eb', 0.85, '#1e3a8a', 1, '#172554']), [22, 42], 1, 1.1, ['max', 0.45, ['get', 'intensity']], 0.9);
  heat('haz-dam', 'dam', ramp([0, 'rgba(255,255,255,0)', 0.5, 'rgba(255,255,255,0.5)', 1, 'rgba(255,255,255,0.95)']), [12, 22], 1, 1);
  // burn scar: dark fill, no stroke, plus a faint dark-red glow
  heat('haz-burn-glow', 'burn', ramp([0, 'rgba(122,29,15,0)', 0.4, 'rgba(122,29,15,0.25)', 1, 'rgba(122,29,15,0.45)']), [16, 30], 0.8, 0.9);
  add({ id: 'haz-burn', type: 'fill', source: 'burn', paint: { 'fill-color': '#3b2a24', 'fill-opacity': 0.65, 'fill-antialias': false } });
  // fire: transparent → deep red → orange → yellow-white core
  heat('haz-fire', 'fire', ramp([0, 'rgba(122,29,15,0)', 0.18, 'rgba(122,29,15,0.55)', 0.45, 'rgba(242,106,27,0.85)', 0.75, 'rgba(245,197,66,0.95)', 1, 'rgba(255,248,214,1)']), [18, 34], 1.1, 1.2);
  heat('haz-landslide-glow', 'landslide', ramp([0, 'rgba(91,58,26,0)', 0.4, 'rgba(161,98,7,0.35)', 1, 'rgba(91,58,26,0.7)']), [12, 22], 1, 1);
  add({ id: 'iso-rings', type: 'line', source: 'iso', paint: { 'line-color': '#8b5cf6', 'line-width': ['match', ['get', 'level'], 0, 1.6, 1, 1.2, 0.9] as any, 'line-opacity': ['match', ['get', 'level'], 0, 0.75, 1, 0.55, 0.4] as any, 'line-dasharray': [6, 3] } });
  add({ id: 'floodfront', type: 'line', source: 'floodfront', paint: { 'line-color': '#22d3ee', 'line-width': 2, 'line-dasharray': [2.5, 1.5], 'line-opacity': 0.95 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  add({ id: 'haz-dam-pin', type: 'circle', source: 'hazpts', filter: ['==', ['get', 'kind'], 'dam'], paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#2b2622', 'circle-stroke-width': 2 } });
  add({ id: 'haz-dam-label', type: 'symbol', source: 'hazpts', filter: ['==', ['get', 'kind'], 'dam'], layout: { 'text-field': 'DAM', 'text-font': ['Open Sans Semibold'], 'text-size': 9.5, 'text-offset': [0, 1.3], 'text-allow-overlap': true, 'text-letter-spacing': 0.1 }, paint: { 'text-color': '#fff7ec', 'text-halo-color': '#2b2622', 'text-halo-width': 1.6 } });
  add({ id: 'haz-landslide', type: 'circle', source: 'hazpts', filter: ['==', ['get', 'kind'], 'landslide'], paint: {
    'circle-color': ['interpolate', ['linear'], ['get', 'intensity'], 0, '#a16207', 1, '#5b3a1a'] as any, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 12, 5, 15, 9] as any, 'circle-opacity': ['+', 0.45, ['*', 0.5, ['get', 'intensity']]] as any,
    'circle-stroke-color': 'rgba(120,53,15,0.55)', 'circle-stroke-width': 3, 'circle-blur': 0.2 } });
  add({ id: 'firefront', type: 'line', source: 'firefront', paint: { 'line-color': '#e8452b', 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': 0.95 }, layout: { 'line-cap': 'round' } });
  // spread path from ignition through fire centroids
  add({ id: 'spread-halo', type: 'line', source: 'spread', paint: { 'line-color': '#2b2622', 'line-width': 5.5, 'line-opacity': 0.65 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  add({ id: 'spread', type: 'line', source: 'spread', paint: { 'line-color': '#f5c542', 'line-width': 3 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  add({ id: 'spread-arrows', type: 'symbol', source: 'spread', layout: { 'symbol-placement': 'line', 'symbol-spacing': 70, 'text-field': '▶', 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-keep-upright': false, 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-rotation-alignment': 'map' }, paint: { 'text-color': '#f26a1b', 'text-halo-color': '#2b2622', 'text-halo-width': 1 } });
  add({ id: 'spread-pins', type: 'circle', source: 'spreadpins', paint: { 'circle-radius': 5.5, 'circle-color': '#2b2622', 'circle-stroke-color': '#f5c542', 'circle-stroke-width': 2 } });
  add({ id: 'spread-pin-labels', type: 'symbol', source: 'spreadpins', layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold'], 'text-size': 11.5, 'text-anchor': 'left', 'text-offset': [1, 0], 'text-allow-overlap': true, 'text-ignore-placement': true, 'symbol-sort-key': ['*', -1, ['get', 'tick']] as any }, paint: { 'text-color': '#fff7ec', 'text-halo-color': '#2b2622', 'text-halo-width': 2.2 } });

  add({ id: 'lines-halo', type: 'line', source: 'lines', paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.35 } });
  add({ id: 'lines', type: 'line', source: 'lines', paint: { 'line-color': ['match', ['get', 'kind'], 'river', '#0369a1', '#7f1d1d'], 'line-width': 1.6, 'line-dasharray': [3, 2] } });

  add({ id: 'districts-fill', type: 'fill', source: 'districts', paint: { 'fill-color': ['case', ['get', 'cutOff'], '#ef4444', '#ffffff'], 'fill-opacity': ['case', ['get', 'cutOff'], 0.12, 0.03] } });
  add({ id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': ['case', ['get', 'cutOff'], '#ef4444', '#ffffff'], 'line-width': ['case', ['get', 'cutOff'], 2.2, 1.2], 'line-opacity': 0.9, 'line-dasharray': [4, 2] } });

  add({ id: 'routes-halo', type: 'line', source: 'routes', paint: { 'line-color': '#0b1220', 'line-width': 6, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  add({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': ['match', ['get', 'mode'], 'road', '#a3e635', 'air', '#ffffff', 'boat', '#22d3ee', '#a3e635'], 'line-width': 3, 'line-dasharray': ['match', ['get', 'mode'], 'air', ['literal', [1, 2]], ['literal', [3, 2]]] as any }, layout: { 'line-cap': 'round', 'line-join': 'round' } });

  add({ id: 'links-halo', type: 'line', source: 'links', paint: { 'line-color': '#0b1220', 'line-width': 4, 'line-opacity': 0.6 } });
  add({ id: 'links', type: 'line', source: 'links', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.95 } });
  add({ id: 'halos', type: 'circle', source: 'halos', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-blur': 0.9, 'circle-opacity': 0.55 } });
  add({ id: 'epicenter-ring', type: 'circle', source: 'epicenter', paint: { 'circle-radius': 22, 'circle-color': 'transparent', 'circle-stroke-color': '#ef4444', 'circle-stroke-width': 2, 'circle-opacity': 0, 'circle-stroke-opacity': 0.8 } });
}

export function agentCode(a: { role: string; districtId?: string; id: string }): string {
  const d = (a.districtId ?? '').toUpperCase().slice(0, 4);
  const pre: Record<string, string> = { chief: 'CHIEF', district: 'D', route: 'RT', firecrew: 'FC', shelter: 'SH', supply: 'SUP', airlift: 'AIR', verifier: 'V', research: 'RSRCH', reflector: 'REFLECT' };
  const p = pre[a.role] ?? a.role.toUpperCase().slice(0, 3);
  return d && a.role !== 'chief' ? `${p}-${d}` : p;
}
function agentEl(a: LiveAgent): HTMLElement {
  const el = document.createElement('div');
  el.className = 'agent-marker';
  el.innerHTML = `<div class="agent-pill"><i class="agent-dot"></i><span class="agent-code"></span><span class="agent-sub"></span></div>`;
  updateAgentEl(el, a);
  return el;
}
function updateAgentEl(el: HTMLElement, a: LiveAgent) {
  const color = agentColor(a);
  el.dataset.status = a.status;
  el.dataset.depth = String(Math.min(a.depth, 2));
  el.dataset.role = a.role;
  el.style.setProperty('--c', color);
  (el.querySelector('.agent-code') as HTMLElement).textContent = agentCode(a);
  (el.querySelector('.agent-sub') as HTMLElement).textContent = a.role === 'verifier' ? (a.status === 'rejected' ? 'REJECT' : a.status === 'done' ? 'ACCEPT' : 'auditing') : shortModel(a.model).replace(/^Nemotron\s*/, '');
  el.title = `${a.label} · ${shortModel(a.model)} — ${a.status}${a.note ? '\n' + a.note : ''}`;
}

export default function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const markers = useRef<{ agents: Map<string, Marker>; infra: Map<string, Marker>; districts: Map<string, Marker>; epi?: Marker }>({ agents: new Map(), infra: new Map(), districts: new Map() });
  const regionRef = useRef<RegionConfig | undefined>(undefined);

  // ---- init ----
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const st = useStore.getState();
    const region = st.region();
    const map = new maplibregl.Map({
      container: ref.current, style: baseStyle(), center: region ? [region.center.lng, region.center.lat] : [-122.25, 37.8], zoom: (region?.zoom ?? 10) + 0.5,
      pitch: 62, bearing: -25, maxPitch: 75, attributionControl: { compact: true }, hash: false, fadeDuration: 150,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'bottom-right');
    map.on('load', () => {
      try {
        addDataLayers(map);
        ready.current = true;
        applyTerrain(map);
        sync();
      } catch (err) { console.warn('[map] layer init', err); }
    });
    map.on('error', (e) => { /* tile errors are expected offline; keep console clean */ if (e?.error && !/tile|Failed to fetch|404|AJAXError/i.test(String(e.error?.message ?? e.error))) console.warn('[map]', e.error); });
    map.on('click', (e) => {
      const s = useStore.getState();
      if (s.running) return;
      s.setClickAt({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    map.getCanvas().style.cursor = 'crosshair';
    const zoomClass = () => { const z = map.getZoom(); const c = map.getContainer(); c.classList.toggle('z-infra', z >= 10.5); c.classList.toggle('z-dist', z >= 9.5); };
    map.on('zoom', zoomClass); map.on('load', zoomClass);

    // animation: dash offset + pulse
    let raf = 0; let last = 0; let phase = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 110) return; last = t; phase = (phase + 1) % 1000;
      if (!ready.current || !map.isStyleLoaded()) return;
      try {
        const k = phase % 6;
        if (map.getLayer('routes')) map.setPaintProperty('routes', 'line-dasharray', ['match', ['get', 'mode'], 'air', ['literal', [0.001 + (k / 6) * 3, 2, 1, 2 - (k / 6) * 0.001]], ['literal', [k * 0.6 + 0.001, 2, 3 - k * 0.6 + 0.001]]] as any);
        if (map.getLayer('firefront')) map.setPaintProperty('firefront', 'line-dasharray', [2, 1.5, (k / 3) + 0.001, 0.001] as any);
        const pulse = 0.5 + 0.5 * Math.sin(phase / 3);
        const layers = useStore.getState().layers;
        if (map.getLayer('haz-fire') && layers.fire.on) map.setPaintProperty('haz-fire', 'heatmap-opacity', layers.fire.opacity * (0.8 + 0.2 * pulse));
        if (map.getLayer('halos')) map.setPaintProperty('halos', 'circle-radius', ['case', ['==', ['get', 'status'], 'thinking'], ['*', ['get', 'r'], 1 + 0.45 * pulse], ['get', 'r']] as any);
        if (map.getLayer('epicenter-ring')) map.setPaintProperty('epicenter-ring', 'circle-radius', 14 + 14 * pulse), map.setPaintProperty('epicenter-ring', 'circle-stroke-opacity', 0.9 - 0.7 * pulse);
      } catch {}
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); map.remove(); mapRef.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setData = (id: string, data: FeatureCollection) => {
    const map = mapRef.current; if (!map || !ready.current) return;
    const s = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (s && 'setData' in s) s.setData(data as any);
  };

  const applyTerrain = (map: MLMap) => {
    const { layers, exaggeration } = useStore.getState();
    try {
      if (!map.getSource(DEM)) return;
      if (layers.terrain.on) map.setTerrain({ source: DEM, exaggeration });
      else map.setTerrain(null);
    } catch (err) { console.warn('[map] terrain', err); }
  };

  const applyLayerVisibility = (map: MLMap) => {
    const { layers } = useStore.getState();
    const vis = (ids: string[], l: LayerId, opacityProp?: string) => ids.forEach((id) => {
      if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, 'visibility', layers[l].on ? 'visible' : 'none');
      if (opacityProp) map.setPaintProperty(id, opacityProp, opacityProp === 'fill-opacity' ? layers[l].opacity * 0.65 : opacityProp === 'heatmap-opacity' ? layers[l].opacity * 0.85 : layers[l].opacity);
    });
    vis(['imagery'], 'imagery', 'raster-opacity');
    vis(['hillshade'], 'terrain');
    vis(['labels'], 'labels', 'raster-opacity');
    vis(['haz-quake'], 'shaking', 'heatmap-opacity'); vis(['iso-rings'], 'shaking'); vis(['foot-quake'], 'shaking');
    vis(['firefront', 'foot-fire'], 'fire');
    vis(['haz-burn'], 'burn', 'fill-opacity'); vis(['haz-burn-glow'], 'burn', 'heatmap-opacity');
    vis(['haz-landslide'], 'landslide'); vis(['haz-landslide-glow'], 'landslide', 'heatmap-opacity');
    vis(['haz-flood'], 'flood', 'heatmap-opacity'); vis(['floodfront', 'foot-flood'], 'flood'); vis(['haz-dam', 'haz-dam-pin', 'haz-dam-label'], 'dams');
    vis(['spread', 'spread-halo', 'spread-arrows', 'spread-pins', 'spread-pin-labels'], 'spread');
    markers.current.epi?.getElement().classList.toggle('hidden', !layers.spread.on && !!useStore.getState().scenario);
    vis(['lines', 'lines-halo'], 'lines');
    vis(['routes', 'routes-halo'], 'routes');
    vis(['links', 'links-halo', 'halos'], 'agents');
        markers.current.agents.forEach((m) => (m.getElement().style.display = layers.agents.on ? '' : 'none'));
    markers.current.infra.forEach((m) => (m.getElement().style.display = layers.infra.on ? '' : 'none'));
    markers.current.districts.forEach((m) => (m.getElement().style.display = layers.labels.on ? '' : 'none'));
  };

  // ---- full sync of data-driven content ----
  const sync = () => {
    const map = mapRef.current; if (!map || !ready.current) return;
    const s = useStore.getState();
    const region = s.region();
    const snap = s.viewSnapshot();
    try {
      if (region) {
        if (regionRef.current?.id !== region.id) {
          regionRef.current = region;
          setData('lines', linesFC(region));
          // infra markers
          markers.current.infra.forEach((m) => m.remove()); markers.current.infra.clear();
          region.infra.forEach((inf) => {
            const el = document.createElement('div'); el.className = "infra-marker"; el.dataset.status = "open"; el.dataset.kind = inf.kind;
            el.innerHTML = `<div class="infra-pin">${INFRA_LETTER[inf.kind] ?? '•'}</div><div class="infra-label">${inf.name}</div>`;
            el.title = inf.name;
            markers.current.infra.set(inf.id, new Marker({ element: el, anchor: 'center' }).setLngLat([inf.at.lng, inf.at.lat]).addTo(map));
          });
          markers.current.districts.forEach((m) => m.remove()); markers.current.districts.clear();
          region.districts.forEach((d) => {
            const el = document.createElement('div'); el.className = 'district-label';
            el.innerHTML = `<span class="dl-name">${d.name.split(/ \(| \/ /)[0]}</span><span class="dl-stat"></span>`;
            markers.current.districts.set(d.id, new Marker({ element: el, anchor: 'bottom' }).setLngLat([d.centroid.lng, d.centroid.lat + 0.028]).addTo(map));
          });
        }
        setData('hazpts', hazardPointsFC(region, snap?.hazards));
        setData('hazards', hazardsFC(region, snap?.hazards));
        setData('burn', burnFC(region, snap?.hazards));
        setData('firefront', frontFC(region, snap?.hazards, 'fire'));
        setData('floodfront', frontFC(region, snap?.hazards, 'flood'));
        setData('iso', isoseismalFC(s.scenario?.trigger.kind === 'quake' ? s.scenario.trigger.at : undefined, snap?.hazards, region));
        const upto = s.snapshots.filter((x) => !snap || x.tick <= snap.tick);
        const pathKind = s.scenario?.trigger.kind === 'rain' ? 'flood' : 'fire';
        const sp = spreadPathFC(region, s.scenario?.trigger.at, upto, pathKind);
        setData('spread', sp.line); setData('spreadpins', sp.pins);
        setData('districts', districtsFC(region, snap));
        // infra statuses
        region.infra.forEach((inf) => {
          const m = markers.current.infra.get(inf.id); if (!m) return;
          const st = snap?.infra.find((x) => x.id === inf.id)?.status ?? 'open';
          const el = m.getElement(); if (el.dataset.status !== st) el.dataset.status = st;
        });
        region.districts.forEach((d) => {
          const m = markers.current.districts.get(d.id); if (!m) return;
          const st = snap?.districts.find((x) => x.id === d.id);
          const el = m.getElement();
          el.classList.toggle('cutoff', !!st?.cutOff);
          (el.querySelector('.dl-stat') as HTMLElement).textContent = st ? `${st.stranded.toLocaleString()} stranded${st.cutOff ? ' · CUT OFF' : ''}` : `${(d.population / 1000).toFixed(0)}k pop`;
        });
      }
      // routes from accepted/all plans
      const routes: RoutePlan[] = [];
      s.plans.forEach((p) => routes.push(...p.routes));
      setData('routes', routesFC(routes));
      // agents
      setData('links', agentLinksFC(s.agents));
      setData('halos', agentHaloFC(s.agents));
      const seen = new Set<string>();
      s.agents.forEach((a) => {
        seen.add(a.id);
        let m = markers.current.agents.get(a.id);
        if (!m) {
          const el = agentEl(a);
          el.addEventListener('click', (ev) => { ev.stopPropagation(); useStore.getState().selectAgent(a.id); useStore.getState().setTab('agents'); });
          m = new Marker({ element: el, anchor: 'center' }).setLngLat([a.at.lng, a.at.lat]).addTo(map);
          markers.current.agents.set(a.id, m);
          requestAnimationFrame(() => el.classList.add('in'));
        } else {
          updateAgentEl(m.getElement(), a);
          m.setLngLat([a.at.lng, a.at.lat]);
        }
        m.getElement().classList.toggle('selected', s.selectedAgentId === a.id);
      });
      markers.current.agents.forEach((m, id) => { if (!seen.has(id)) { m.remove(); markers.current.agents.delete(id); } });
      // epicenter
      setData('epicenter', pointFC(s.scenario?.trigger.at ?? s.clickAt));
      const ign = s.scenario?.trigger.at ?? s.clickAt;
      if (ign) {
        if (!markers.current.epi) {
          const el = document.createElement('div'); el.className = 'epi-marker'; el.innerHTML = '<div class="epi-ring"></div><div class="epi-core"></div><div class="epi-pill"></div>';
          markers.current.epi = new Marker({ element: el, anchor: 'center' }).setLngLat([ign.lng, ign.lat]).addTo(map);
        } else markers.current.epi.setLngLat([ign.lng, ign.lat]);
        const el = markers.current.epi.getElement();
        el.dataset.kind = s.scenario?.trigger.kind ?? s.triggerKind;
        const p = s.scenario?.trigger.params ?? s.params;
        const tk = s.scenario?.trigger.kind ?? s.triggerKind;
        const what = tk === 'quake' ? `Epicenter · M${(p.magnitude ?? 0).toFixed(1)} · T+0` : tk === 'fire' ? `Ignition · wind ${p.windKph ?? p.wind ?? ''} km/h` : `Rain cell · ${p.rainMm ?? p.mm ?? ''} mm${p.durationTicks ? ` over ${p.durationTicks} ticks` : ''}`;
        (el.querySelector('.epi-pill') as HTMLElement).textContent = s.scenario ? what : `Place: ${what.split(' · ')[0].toLowerCase()} (click map)`;
      }
      applyLayerVisibility(map);
    } catch (err) { console.warn('[map] sync', err); }
  };

  // subscribe to store changes
  useEffect(() => {
    let lastFly = 0; let lastTerrain = ''; let lastEvent = 0;
    const unsub = useStore.subscribe((s) => {
      sync();
      const map = mapRef.current; if (!map) return;
      const newest = s.events[0];
      if (newest && newest.id !== lastEvent) {
        lastEvent = newest.id;
        const burst = newest.kind === 'dam' && /burst|breach|fail/i.test(newest.text);
        const after = newest.kind === 'quake' && /aftershock/i.test(newest.text);
        if ((burst || after) && newest.at && ready.current) {
          try {
            const el = document.createElement('div'); el.className = 'pulse-marker ' + (burst ? 'burst' : 'aftershock');
            el.innerHTML = '<i></i><i></i><i></i>';
            const m = new Marker({ element: el, anchor: 'center' }).setLngLat([newest.at.lng, newest.at.lat]).addTo(map);
            setTimeout(() => m.remove(), 3200);
          } catch {}
        }
      }
      if (s.flyTo && s.flyTo.n !== lastFly) {
        lastFly = s.flyTo.n;
        map.flyTo({ center: [s.flyTo.at.lng, s.flyTo.at.lat], zoom: s.flyTo.zoom ?? Math.max(map.getZoom(), 11.5), pitch: 62, duration: 1400, essential: true });
      }
      const tk = `${s.layers.terrain.on}:${s.exaggeration}`;
      if (tk !== lastTerrain && ready.current) { lastTerrain = tk; applyTerrain(map); }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} className="map-root" />;
}
