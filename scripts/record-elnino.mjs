// Demo recorder for the El Niño build (needs playwright: `pnpm add -D playwright` or `npx -y playwright@latest install chromium`).
// Drives the running app (pnpm dev on :5173/:8787) and records a ~110 s 1440x900 video, then converts it to MP4 with ffmpeg.
// Usage: node scripts/record-elnino.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const OUT = process.argv[2] || './demo-video';
const UI = process.env.UI || 'http://localhost:5173';
const API = process.env.API || 'http://localhost:8787';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const waitRunDone = async (maxMs) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { const h = await fetch(API + '/api/health').then((r) => r.json()).catch(() => null); if (h && !h.run) return true; await sleep(1500); } return false; };
const click = async (page, sel) => { try { await page.locator(sel).first().click({ timeout: 2500 }); return true; } catch { return false; } };
const pickRegion = (page, re) => page.evaluate((src) => { const rx = new RegExp(src, 'i'); const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => rx.test(o.textContent))); if (!sel) return false; const opt = [...sel.options].find((o) => rx.test(o.textContent)); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value); sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }, re.source);

await post('/api/stop');
await waitRunDone(15000);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
await page.goto(UI, { waitUntil: 'domcontentloaded' });
await sleep(9000); // terrain build + SSE connect

// Scene 1: El Niño atmospheric river over the Bay Area
await post('/api/run', { regionId: 'bayarea', seed: 7 });
await sleep(16000);
await click(page, 'button.pill:has-text("Agents")');
await sleep(12000);
await click(page, 'text=/Relay/');
await sleep(14000);
await click(page, 'button.pill:has-text("Delegation")');
await sleep(10000);
await click(page, 'text=/Relay/');
await waitRunDone(40000);
await sleep(4000);

// Scene 2: San Francisco 3D city, king tide + storm
await click(page, 'button.pill:has-text("Incident")');
await pickRegion(page, /San Francisco/);
await sleep(8000);
await post('/api/run', { regionId: 'sanfrancisco', seed: 11 });
await sleep(22000);

await ctx.close();
await browser.close();
const webm = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm')).map((f) => path.join(OUT, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (webm) {
  const mp4 = path.join(OUT, 'superscade-elnino-demo.mp4');
  execSync(`ffmpeg -y -loglevel error -i "${webm}" -c:v libx264 -pix_fmt yuv420p -crf 23 -preset veryfast "${mp4}"`);
  console.log('wrote', mp4);
}
