import { useStore } from '../store';
import { reconnectEvents } from '../api';

/** Tells the operator when the server is running an incident this tab is not showing, or when the stream is down. */
export default function ServerRunBanner() {
  const serverRun = useStore((s) => s.serverRun);
  const runId = useStore((s) => s.runId);
  const connection = useStore((s) => s.connection);
  const running = useStore((s) => s.running);
  const detached = !!serverRun?.runId && serverRun.runId !== runId;
  const stale = !!runId && running && serverRun === null; // server says nothing is running but we think it is
  if (connection === 'error') return <div className="srv-banner warn">Connection to the server lost · reconnecting… <button onClick={() => reconnectEvents()}>Retry now</button></div>;
  if (detached) return (
    <div className="srv-banner">
      <span>An incident is running on the server right now ({serverRun!.regionId} · T+{serverRun!.tick}) and this tab is not attached to it.</span>
      <button onClick={() => reconnectEvents()}>Attach</button>
      <button className="ghost" onClick={async () => { await fetch('/api/stop', { method: 'POST' }); }}>Stop it</button>
    </div>
  );
  if (stale) return <div className="srv-banner warn">The server finished or dropped this incident · <button onClick={() => reconnectEvents()}>Resync</button></div>;
  return null;
}
