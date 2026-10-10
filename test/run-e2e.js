'use strict';
// Usage: node test/run-e2e.js   (on Linux without a display: xvfb-run -a node test/run-e2e.js)
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'), electron = process.env.MB_ELECTRON_BIN || require('electron');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-e2e-'));
const env = (mode) => ({ ...process.env, MB_E2E: mode, MB_USERDATA: path.join(tmp, 'user'), MB_BACKUPDIR: path.join(tmp, 'backups') });
const run = (mode, ms = 120000) => new Promise((res) => {
  const t0 = Date.now(), p = spawn(electron, [process.env.MB_APP_DIR || root, '--no-sandbox', '--disable-gpu'], { env: env(mode) });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', () => {});
  const k = setTimeout(() => p.kill('SIGKILL'), ms);
  p.on('exit', (code) => { clearTimeout(k); res({ code, out, ms: Date.now() - t0 }); });
  p.__proc = p; run.last = p;
});
let pass = 0, fail = 0;
const show = (title, r) => {
  const m = /E2E_RESULT (.*)/.exec(r.out); const list = m ? JSON.parse(m[1]) : [[false, 'no result printed (exit ' + r.code + ')']];
  console.log('--- ' + title + ' (' + r.ms + ' ms, exit ' + r.code + ')');
  for (const [c, msg] of list) { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + msg); }
};
(async () => {
  show('first run: create data, native backups, printing API', await run('seed'));
  show('second run (same data folder): persistence, restore, corrupted backup', await run('verify'));
  // single instance: A holds the lock, B must exit quickly while A stays alive
  const A = spawn(electron, [process.env.MB_APP_DIR || root, '--no-sandbox', '--disable-gpu'], { env: env('hold') });
  await new Promise((r) => setTimeout(r, 3500));
  const t0 = Date.now();
  const B = spawn(electron, [process.env.MB_APP_DIR || root, '--no-sandbox', '--disable-gpu'], { env: env('hold') });
  const bExit = await new Promise((r) => { const k = setTimeout(() => { B.kill('SIGKILL'); r('timeout'); }, 8000); B.on('exit', (c) => { clearTimeout(k); r(c); }); });
  const aAlive = A.exitCode === null;
  console.log('--- single instance');
  const chk = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
  chk(bExit === 0 && Date.now() - t0 < 6000, 'second copy exits immediately (' + bExit + ', ' + (Date.now() - t0) + ' ms)');
  chk(aAlive, 'first copy keeps running');
  await new Promise((r) => A.on('exit', r)).then(() => {}); 
  console.log('\nE2E total: ' + pass + ' ok, ' + fail + ' failed');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
