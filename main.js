'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const E2E = process.env.MB_E2E || '';
app.setName('MB Store');
// !!! NEVER change this folder name or the origin 'app://mb' below:
// the shop's data lives in the browser storage of this exact folder + origin.
const USER = process.env.MB_USERDATA || path.join(app.getPath('appData'), 'MB Store');
app.setPath('userData', USER);
if (E2E) app.commandLine.appendSwitch('no-sandbox');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/* ---------- logging ---------- */
const LOGDIR = path.join(USER, 'logs');
function log(...a) {
  try {
    fs.mkdirSync(LOGDIR, { recursive: true });
    const f = path.join(LOGDIR, 'app.log');
    try { if (fs.statSync(f).size > 2e6) fs.renameSync(f, f + '.old'); } catch (_) {}
    fs.appendFileSync(f, new Date().toISOString() + ' ' + a.map(String).join(' ') + '\n');
  } catch (_) {}
}
process.on('uncaughtException', (e) => log('uncaught', e && e.stack || e));
process.on('unhandledRejection', (e) => log('unhandled', e && e.stack || e));

/* ---------- config ---------- */
let cfg = { printer: '', paper: '80', backupDir: '' };
const cfgPath = () => path.join(USER, 'config.json');
function loadCfg() { try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch (_) {} }
function saveCfg() { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); }
function backupDir() {
  const d = process.env.MB_BACKUPDIR || cfg.backupDir || path.join(app.getPath('documents'), 'MB Store Backups');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/* ---------- backups ---------- */
const BK_RE = /^MB-backup-\d{4}-\d{2}-\d{2}\.json$/;
const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function validate(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return { ok: false, reason: 'الملف تالف (مش JSON صالح)' }; }
  if (!o || !Array.isArray(o.p) || !Array.isArray(o.b) || !Array.isArray(o.s) || !Array.isArray(o.u) || !o.u.length)
    return { ok: false, reason: 'الملف مش نسخة احتياطية من السيستم' };
  return { ok: true, summary: { sales: o.s.length, products: o.p.length, users: o.u.length } };
}
function prune(dir) {
  try {
    const names = fs.readdirSync(dir).filter((n) => BK_RE.test(n)).sort();
    for (const n of names.slice(0, -30)) { fs.unlinkSync(path.join(dir, n)); try { fs.unlinkSync(path.join(dir, n.replace(/\.json$/, '.prev.json'))); } catch (_) {} }
  } catch (_) {}
}
function writeAtomic(dst, text) {
  const tmp = dst + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, dst);
}

ipcMain.handle('saveBackup', (_e, text) => {
  try {
    if (typeof text !== 'string' || text.length < 20 || text.length > 400e6) return { ok: false, reason: 'بيانات غير صالحة' };
    const v = validate(text); if (!v.ok) return v;           // never overwrite a good backup with a broken one
    const dir = backupDir(), name = 'MB-backup-' + dayKey() + '.json', dst = path.join(dir, name);
    try { if (fs.existsSync(dst)) fs.copyFileSync(dst, dst.replace(/\.json$/, '.prev.json')); } catch (_) {}
    writeAtomic(dst, text);
    prune(dir);
    return { ok: true, name, summary: v.summary };
  } catch (e) { log('saveBackup', e && e.stack || e); return { ok: false, reason: String(e && e.message || e) }; }
});
ipcMain.handle('listBackups', () => {
  try {
    const dir = backupDir();
    return fs.readdirSync(dir).filter((n) => BK_RE.test(n)).sort().reverse()
      .map((n) => { const s = fs.statSync(path.join(dir, n)); return { name: n, size: s.size, mtime: s.mtimeMs }; });
  } catch (_) { return []; }
});
ipcMain.handle('readBackup', (_e, name) => {
  try {
    if (typeof name !== 'string' || !BK_RE.test(name)) return { ok: false, reason: 'اسم ملف غير صالح' };
    const text = fs.readFileSync(path.join(backupDir(), name), 'utf8');
    const v = validate(text); return v.ok ? { ok: true, text, summary: v.summary } : v;
  } catch (e) { return { ok: false, reason: 'تعذر قراءة الملف' }; }
});
ipcMain.handle('pickBackup', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'MB backup', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    const text = fs.readFileSync(r.filePaths[0], 'utf8');
    const v = validate(text); return v.ok ? { ok: true, text, summary: v.summary } : v;
  } catch (e) { return { ok: false, reason: 'تعذر قراءة الملف' }; }
});
ipcMain.handle('chooseBackupDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  cfg.backupDir = r.filePaths[0]; saveCfg(); return { ok: true, dir: cfg.backupDir };
});
ipcMain.handle('openBackupDir', () => shell.openPath(backupDir()));

/* ---------- printing ---------- */
ipcMain.handle('info', () => ({ version: app.getVersion(), backupDir: backupDir(), printer: cfg.printer, paper: cfg.paper, userData: USER }));
ipcMain.handle('setConfig', (_e, o) => {
  if (o && typeof o === 'object') {
    if (typeof o.printer === 'string') cfg.printer = o.printer;
    if (o.paper === '58' || o.paper === '80') cfg.paper = o.paper;
    saveCfg();
  }
  return { ok: true };
});
ipcMain.handle('printers', async (e) => { try { return (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, displayName: p.displayName, isDefault: !!p.isDefault })); } catch (_) { return []; } });
ipcMain.handle('print', async (e) => {
  const wc = e.sender, silent = !!cfg.printer;
  const o = { silent, printBackground: true, margins: { marginType: 'none' } };
  if (silent) {
    o.deviceName = cfg.printer;
    let h = 0; try { h = await wc.executeJavaScript("(document.getElementById('rcpt')||{}).scrollHeight||0"); } catch (_) {}
    o.pageSize = { width: (cfg.paper === '58' ? 58 : 80) * 1000, height: Math.max(60000, Math.round((h || 400) * 264.58) + 10000) };
  }
  return new Promise((res) => {
    let done = false; const fin = (r) => { if (!done) { done = true; res(r); } };
    setTimeout(() => fin({ ok: false, reason: 'timeout' }), 20000);
    try { wc.print(o, (ok, reason) => fin({ ok, reason })); } catch (err) { fin({ ok: false, reason: String(err && err.message || err) }); }
  });
});

/* ---------- window ---------- */
let win = null, closing = false;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const APPDIR = path.join(__dirname, 'app');

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1366, height: 820, show: false, backgroundColor: '#050912', title: 'MB Store', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://mb/index.html');

  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://mb/')) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (process.env.MB_DEV && input.key === 'F12') win.webContents.toggleDevTools();
  });
  // Before closing: let the page flush its save and write a last backup (max 5s).
  win.on('close', (e) => {
    if (closing) return; e.preventDefault(); closing = true;
    let done = false; const finish = () => { if (done) return; done = true; clearTimeout(t); try { win.destroy(); } catch (_) {} };
    ipcMain.once('close-ack', finish); const t = setTimeout(finish, 5000);
    try { win.webContents.send('before-close'); } catch (_) { finish(); }
  });
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone', JSON.stringify(d)));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    loadCfg();
    protocol.handle('app', (req) => {
      let p = decodeURIComponent(new URL(req.url).pathname); if (p === '/' || p === '') p = '/index.html';
      const f = path.normalize(path.join(APPDIR, p));
      if (!f.startsWith(APPDIR)) return new Response('forbidden', { status: 403 });
      try { return new Response(fs.readFileSync(f), { headers: { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' } }); }
      catch (_) { return new Response('not found', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
    createWindow();
    log('started v' + app.getVersion());
    if (E2E) { win.webContents.once('did-finish-load', () => require('./test/e2e-driver.js')(win, { E2E, USER, backupDir, cfg: () => cfg })); }
  });
  app.on('window-all-closed', () => app.quit());
}
