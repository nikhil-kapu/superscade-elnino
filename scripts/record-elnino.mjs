// Demo recorder for the El Niño build. Drives the running app (server :8787, client UI) in a real (headed, GPU) Chromium
// window, adds on-screen captions, records ~2 min of 1440x900 video and converts it to MP4 with ffmpeg.
// Usage: PLAYWRIGHT_DIR=/path/with/node_modules/playwright node scripts/record-elnino.mjs [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'node_modules/') : import.meta.url);
const { chromium } = require('playwright');
const OUT = path.resolve(process.argv[2] || './demo-video');
const UI = process.env.UI || 'http://localhost:5174';
const API = process.env.API || 'http://localhost:8787';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const idle = async (maxMs) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { const h = await fetch(API + '/api/health').then((r) => r.json()).catch(() => null); if (h && !h.run) return true; await sleep(700); } return false; };
const T0 = Date.now(); const stamp = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6);

await post('/api/stop'); await idle(8000);
const browser = await chromium.launch({ headless: false, args: ['--window-size=1440,980', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const caption = async (text) => {
  console.log(stamp(), 'caption:', text);
  await page.evaluate((t) => {
    let el = document.getElementById('demo-caption');
    if (!el) { el = document.createElement('div'); el.id = 'demo-caption'; Object.assign(el.style, { position: 'fixed', left: '50%', top: '112px', transform: 'translateX(-50%)', zIndex: 99999, background: 'rgba(17,17,17,0.86)', color: '#fff', font: '600 19px/1.35 Inter, system-ui, sans-serif', padding: '10px 18px', borderRadius: '12px', maxWidth: '900px', textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,0.25)', pointerEvents: 'none', transition: 'opacity .3s' }); document.body.appendChild(el); }
    el.textContent = t; el.style.opacity = t ? '1' : '0';
  }, text).catch(() => {});
};
const click = async (sel) => { try { await page.locator(sel).first().click({ timeout: 2500 }); return true; } catch { console.log(stamp(), 'click failed', sel); return false; } };
const scrollTo = async (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return true; } return false; }, sel).catch(() => false);

// 1 · intro (Bay Area scene)
await page.goto(UI + '/?region=bayarea', { waitUntil: 'domcontentloaded' });
await sleep(6500);
await caption('SUPERSCADE · El Niño preparedness, rehearsed by a live AI agent team');
await sleep(5000);
// 2 · trigger the storm
await caption('An atmospheric river + 7 ft king tide hits the SF Bay Area');
await post('/api/run', { regionId: 'bayarea', seed: 7 });
await sleep(12000);
await caption('Creeks overflow, Santa Cruz Mtns slide, Hwy 17 / 84 / 92 close, substations trip, levees overtop');
await sleep(8000);
// 3 · real map
await click('button:has-text("Map")');
await caption('Real terrain: highways, hospitals, county EOCs, fire stations, pump stations, PG&E substations, levees');
await sleep(11000);
// 4 · agents + Terse
await click('button.pill:has-text("Agents")');
await caption('Chief → one agent per district → helpers → verifier. Every agent that spins up is its own Terse Durable Actor');
await sleep(11000);
await scrollTo('[class*="ledger"]');
await caption('Terse ResourceLedger actor: one call at a time, so two cities can never book the same helicopter');
await sleep(11000);
// 5 · Agent Relay
await scrollTo('[class*="relay"]');
await caption('Agents coordinate over Agent Relay: assignments by DM, plans in #elnino-storm, verifier verdicts in threads');
await sleep(13000);
// 6 · verifier / delegation
await click('button.pill:has-text("Delegation")');
await caption('A verifier checks every plan against the simulation; rejected plans go back to re-plan');
await sleep(9000);
// 7 · San Francisco 3D city
await post('/api/stop'); await idle(9000);
await caption('Zoom in: San Francisco in 3D (TerraPrinter city model), king tide + storm');
await page.goto(UI + '/?region=sanfrancisco', { waitUntil: 'domcontentloaded' });
await sleep(1500);
await caption('Zoom in: San Francisco in 3D (TerraPrinter city model), king tide + storm');
await sleep(5500);
await post('/api/run', { regionId: 'sanfrancisco', seed: 11 });
await sleep(9000);
await caption('Embarcadero, Mission Bay & Marina flood at king tide; Ocean Beach erodes; agents respond live');
await sleep(10000);
await caption('Rehearse the El Niño winter before it arrives · Terse + Agent Relay + OpenAI');
await sleep(5000);
console.log(stamp(), 'done');

await ctx.close();
await browser.close();
await post('/api/stop');
const webm = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm')).map((f) => path.join(OUT, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (webm) {
  const mp4 = path.join(OUT, 'superscade-elnino-demo.mp4');
  execSync(`ffmpeg -y -loglevel error -i "${webm}" -t 120 -c:v libx264 -pix_fmt yuv420p -crf 22 -preset veryfast -movflags +faststart "${mp4}"`);
  console.log('wrote', mp4);
}
