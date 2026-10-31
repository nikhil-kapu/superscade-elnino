import { useEffect, useState } from 'react';
import MapView from './map/MapView';
import SceneView from './scene/SceneView';
import TopBar from './panels/TopBar';
import RightPanel from './panels/RightPanel';
import BottomBar from './panels/BottomBar';
import NarrationStrip from './panels/NarrationStrip';
import StartOverlay from './panels/StartOverlay';
import RunResultsCard from './panels/RunResultsCard';
import { useStore } from './store';
import { detectMode, fetchPlaybook, fetchRegions, subscribe, pollHealth, getMode, setLive, forcedMock } from './api';
import ServerRunBanner from './panels/ServerRunBanner';

export default function App() {
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let alive = true;
    (async () => {
      const { mode } = await detectMode();
      if (!alive) return;
      const st = useStore.getState();
      st.setMode(mode);
      try {
        const regions = await fetchRegions();
        if (!alive) return;
        st.setRegions(regions);
        try { const want = new URLSearchParams(location.search).get('region'); if (want && regions.some((x) => x.id === want)) st.setRegion(want as any); } catch {} // deep link: ?region=sanfrancisco
        const r = regions.find((x) => x.id === useStore.getState().regionId) ?? regions[0];
        if (r) st.fly(r.center, r.zoom + 0.5);
      } catch (e) { console.warn('regions', e); }
      try { const pb = await fetchPlaybook(); if (pb && alive) st.setPlaybook(pb); } catch {}
      unsub = subscribe((e) => useStore.getState().apply(e), (c) => useStore.getState().setConnection(c));
    })();
    const pulse = setInterval(() => useStore.getState().tickPulse(), 500);
    // server watchdog: notice incidents running on the server that this tab isn't showing, and upgrade mock -> live
    const watchdog = setInterval(async () => {
      if (!alive || forcedMock()) return;
      const h = await pollHealth();
      const st = useStore.getState();
      if (!h) { st.setServerRun(undefined); return; }
      st.setServerRun(h.run ?? null);
      if (getMode() === 'mock') {
        setLive(); st.setMode('live');
        try { st.setRegions(await fetchRegions()); } catch {}
        unsub?.(); unsub = subscribe((e) => useStore.getState().apply(e), (c) => useStore.getState().setConnection(c));
      }
    }, 4000);
    return () => { alive = false; unsub?.(); clearInterval(pulse); clearInterval(watchdog); };
  }, []);

  // playback: advance viewTick while playing
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = useStore.getState();
      const cur = s.viewTick === 'live' ? (s.snapshot?.tick ?? 0) : s.viewTick;
      const next = s.snapshots.find((x) => x.tick > cur);
      if (next) s.setViewTick(next.tick);
      else { s.setPlaying(false); if (!s.running) s.setViewTick('live'); }
    }, 700 / speed);
    return () => clearInterval(id);
  }, [playing, speed]);

  const [view, setView] = useState<'scene' | 'map'>(() => (localStorage.getItem('cascade.view') === 'map' ? 'map' : 'scene'));
  const pick = (v: 'scene' | 'map') => { setView(v); try { localStorage.setItem('cascade.view', v); } catch {} };

  return (
    <div className="app">
      {view === 'scene' ? <SceneView /> : <MapView />}
      <div className="view-switch pills">
        <button className={'pill' + (view === 'scene' ? ' active' : '')} onClick={() => pick('scene')}>Scene</button>
        <button className={'pill' + (view === 'map' ? ' active' : '')} onClick={() => pick('map')}>Map</button>
      </div>
      <NarrationStrip />
      <StartOverlay />
      <ServerRunBanner />
      <TopBar />
      <RightPanel />
      <BottomBar />
      <RunResultsCard />
    </div>
  );
}
