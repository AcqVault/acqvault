/* Minimal dependency-free CDP driver: launch headless Chrome, open a URL at a
   given viewport, run an async expression in the PAGE world, return JSON.
   Exists because the in-app browser pane runs script in an isolated world and
   delivers no real scroll input, so scroll-driven UI could not be verified.

   usage: node cdp.js <url> <width> <height> <exprFile>
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [, , url, wArg, hArg, exprFile] = process.argv;
const W = parseInt(wArg || '375', 10), H = parseInt(hArg || '812', 10);
const expr = fs.readFileSync(exprFile, 'utf8');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--user-data-dir=' + profile,
  `--window-size=${W},${H}`, 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

let buf = '';
chrome.stderr.on('data', d => {
  buf += d.toString();
  const m = buf.match(/ws:\/\/[^\s]+/);
  if (m) { buf = ''; go(m[0]); }
});

function fail(e) { try { chrome.kill(); } catch (_) {} console.error('ERR: ' + e); process.exit(1); }
setTimeout(() => fail('timeout waiting for chrome'), 30000);

async function go(wsUrl) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  ws.onerror = e => fail('ws error ' + e.message);
  await new Promise(r => { ws.onopen = r; });

  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S('Page.enable');
    await S('Runtime.enable');
    await S('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: 2, mobile: true
    });
    await S('Page.navigate', { url });
    // wait for load + fonts + deferred scripts
    await new Promise(r => setTimeout(r, 3500));
    const out = await S('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (out.exceptionDetails) {
      console.log(JSON.stringify({ __exception: out.exceptionDetails.exception?.description || out.exceptionDetails.text }, null, 1));
    } else {
      const v = out.result.value;
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
    }
  } catch (e) {
    fail(e.message);
  } finally {
    try { chrome.kill(); } catch (_) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
  }
}
