// Demo recorder (needs: npm i playwright; npx playwright install chromium). Drives the live app via the API and records 1440x900 video.
// Records a ~70s demo of SUPERSCADE. Usage: node record.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.argv[2] || './video';
const UI = process.env.UI || 'http://localhost:5173';
const API = process.env.API || 'http://localhost:8787';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json()).catch(e => ({ error: String(e) }));
const waitRunDone = async (maxMs = 150000) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { const h = await fetch(API + '/api/health').then(r => r.json()).catch(() => null); if (h && !h.run) return true; await sleep(1500); } return false; };
const click = async (page, sel) => { try { await page.locator(sel).first().click({ timeout: 2500 }); return true; } catch { return false; } };

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
await post('/api/reset');
await page.goto(UI, { waitUntil: 'domcontentloaded' });
try { await page.waitForSelector('text=Live on Crusoe', { timeout: 30000 }); } catch {}
try { await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 }); } catch {}
await sleep(14000); // terrain + imagery tiles + SSE connect
// Scene 1: quake on the Hayward fault
await post('/api/run', { regionId: 'nepal', trigger: { kind: 'rain', at: { lng: 85.33, lat: 28.1 }, params: { rain_mm: 300, duration_ticks: 6 } }, seed: 3 });
await sleep(14000);
await click(page, 'text=Agents');
await sleep(9000);
await waitRunDone();
await sleep(2500);
// Scene 2: evolve the playbook
await click(page, 'text=Playbook');
await sleep(1500);
await click(page, 'button:has-text("Evolve")') || await post('/api/evolve', {});
await sleep(10000);
// Scene 3: Nepal rain cascade
await click(page, 'text=Incident');
await page.evaluate(() => { const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/nepal/i.test(o.textContent))); if(!sel) return; const opt=[...sel.options].find(o=>/nepal/i.test(o.textContent)); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(sel,opt.value); sel.dispatchEvent(new Event('change',{bubbles:true})); });
await sleep(8000);
await post('/api/run', { regionId: 'nepal', trigger: { kind: 'rain', at: { lng: 85.33, lat: 28.1 }, params: { rain_mm: 300, duration_ticks: 6 } }, seed: 3 });
await sleep(16000);
await waitRunDone(90000);
await sleep(3000);
const vid = page.video();
await ctx.close();
const p = await vid.path();
console.log('VIDEO', p);
await browser.close();
