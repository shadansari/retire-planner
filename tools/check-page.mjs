// Dev tool (not part of the page): load a URL in headless Chrome via DevTools protocol,
// report horizontal overflow + console/CSP messages, save a full-page screenshot.
//   node tools/check-page.mjs <url> <width> <out.png> [dark]
// Env: CHROME=<path> (default macOS Chrome), EVAL=<js expr to print>, WAIT=<ms after EVAL>,
//      AFTER=<js expr to print after WAIT>, H=<max height px>.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, width, out, dark] = process.argv.slice(2);
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9333', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'retire-chrome-'))}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); if (targets.length) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Log.entryAdded') logs.push(`log.${m.params.entry.level}: ${m.params.entry.text}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description}`);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +width, height: 900, deviceScaleFactor: 1, mobile: +width < 600 });
if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 2500));
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
console.log('scrollWidth', await ev('document.documentElement.scrollWidth'), 'clientWidth', await ev('document.documentElement.clientWidth'));
if (process.env.EVAL) console.log('eval:', JSON.stringify(await ev(process.env.EVAL)));
if (process.env.WAIT) await new Promise((r) => setTimeout(r, +process.env.WAIT));
if (process.env.AFTER) console.log('after:', JSON.stringify(await ev(process.env.AFTER)));
const h = await ev('document.documentElement.scrollHeight');
await send('Emulation.setDeviceMetricsOverride', { width: +width, height: Math.min(h, +(process.env.H || h)), deviceScaleFactor: 1, mobile: +width < 600 });
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log(logs.length ? logs.join('\n') : 'no console messages');
ws.close(); chrome.kill();
