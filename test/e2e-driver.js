'use strict';
// Runs inside the Electron main process (only when MB_E2E is set). Drives the real app window.
const fs = require('fs'), path = require('path');
module.exports = async (win, ctx) => {
  const out = [];
  const ok = (c, m) => out.push([!!c, m]);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < 150; i++) {
      if (await js("typeof S!=='undefined'&&!!document.getElementById('v')&&document.getElementById('v').innerHTML.length>50").catch(() => false)) break;
      await sleep(100);
    }
    if (ctx.E2E === 'hold') { await sleep(9000); return win.close(); }
    const env = await js("({secure:isSecureContext,subtle:!!(crypto&&crypto.subtle),origin:location.origin,api:Object.keys(window.shopAPI||{}),idb:!!indexedDB})");
    ok(env.secure, 'secure context (needed for password hashing)');
    ok(env.subtle, 'crypto.subtle available');
    ok(env.origin === 'app://mb', 'stable origin app://mb (got ' + env.origin + ')');
    ok(env.api.includes('saveBackup') && env.api.includes('print') && env.api.includes('readBackup'), 'preload API exposed');
    ok(['updateStatus','updateCheck','updateDownload','updateInstall','onUpdate','savePreUpdate'].every((k) => env.api.includes(k)), 'update API exposed');
    ok(!(await js("typeof require")).includes('function'), 'page has no direct Node access');
    const dir = ctx.backupDir();

    if (ctx.E2E === 'seed') {
      await js("document.getElementById('lu').value='owner';document.getElementById('lp').value='pass1234';document.getElementById('ln').value='Owner';login()");
      await sleep(800);
      ok((await js("me&&me.role")) === 'owner', 'first-run owner account created');
      await js(`(()=>{const c=typeOpts()[0][0];[['A',1000,600],['B',500,200]].forEach(([n,pr,cs])=>{const p={id:id(),cid:c,name:n,br:'',fl:'',sz:'',bc:'',price:pr,min:1,h:[],at:{}};S.p.push(p);S.b.push({id:id(),pid:p.id,q:100,c:cs,e:''})});save()})()`);
      await js("(()=>{const a=S.p[0].id,b=S.p[1].id;cart=[{pid:a,q:2}];pmv='كاش';paid='';dpv=0;checkout();cart=[{pid:b,q:3}];pmv='آجل';cn='Ali';cph='01012345678';paid=100;dpv=0;checkout()})()");
      await sleep(400);
      ok((await js("S.s.length")) === 1 && (await js("CR().length")) === 1, 'sale + credit sale recorded');
      // backups
      ok((await js("bkAuto(true)")) === true, 'bkAuto writes a native backup');
      const f = path.join(dir, fs.readdirSync(dir).find((n) => /^MB-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n)) || 'none');
      ok(fs.existsSync(f), 'backup file exists: ' + path.basename(f));
      let j = {}; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) {}
      ok(j.s && j.s.length === 1 && j.cr && j.cr.length === 1 && j.u && j.u.length === 1, 'backup content is complete and valid JSON');
      await js("bkAuto(true)");
      ok(fs.readdirSync(dir).some((n) => /\.prev\.json$/.test(n)), 'previous copy of today\'s backup kept (.prev)');
      const before = fs.readFileSync(f, 'utf8');
      const bad = await js("shopAPI.saveBackup('{\"x\":1,\"padding\":\"" + 'z'.repeat(40) + "\"}')");
      ok(bad && bad.ok === false && fs.readFileSync(f, 'utf8') === before, 'a broken backup never overwrites a good one');
      ok((await js("shopAPI.readBackup('../../etc/passwd')")).ok === false, 'path traversal rejected');
      const lst = await js("shopAPI.listBackups()");
      ok(Array.isArray(lst) && lst.length === 1, 'listBackups ok');
      // update safety: pre-update copy + status API (updater itself is off in tests)
      const us = await js("shopAPI.updateStatus()");
      ok(us && us.state === 'disabled' && typeof us.current === 'string', 'updater reports state (' + (us && us.state) + ', current ' + (us && us.current) + ')');
      ok((await js("shopAPI.updateInstall()")).ok === false, 'install refuses when no update is ready');
      ok((await js("shopAPI.updateDownload()")).ok === false, 'download refuses when no update is offered');
      ok(await js("(()=>{UPD={state:'available',version:'9.9.9',notes:'x',percent:0,current:'1.0.0'};updSnooze=0;updBar();const a=$('#updbar').style.display!=='none'&&/حمّل التحديث/.test($('#updbar').innerHTML)&&/لاحقًا/.test($('#updbar').innerHTML)&&$('#updbadge').style.display!=='none';updLater();updBar();const b=$('#updbar').style.display==='none'&&$('#updbadge').style.display!=='none';UPD={state:'idle'};updBar();return a&&b&&$('#updbadge').style.display==='none'})()"), 'banner: download/later, badge stays after Later, clears when idle');
      ok(await js("S.dv===DATA_VER"), 'data version stamped on the data');
      const pu = await js("shopAPI.savePreUpdate(JSON.stringify(S),'9.9.9')");
      ok(pu && pu.ok && fs.existsSync(path.join(dir, pu.name)), 'pre-update safety copy written: ' + (pu && pu.name));
      ok((await js("shopAPI.savePreUpdate('{\"x\":1,\"padding\":\"zzzzzzzzzzzzzzzzzzzz\"}','1.0.1')")).ok === false, 'a broken pre-update copy is refused');
      for (let i = 0; i < 7; i++) { await js("shopAPI.savePreUpdate(JSON.stringify(S),'1.0." + i + "')"); await sleep(15); }
      ok(fs.readdirSync(dir).filter((n) => /^MB-pre-update-/.test(n)).length === 5, 'only the last 5 pre-update copies are kept');
      ok((await js("shopAPI.listBackups()")).every((f) => !/pre-update/.test(f.name)), 'pre-update copies never mix with the daily backups list');
      // config + print
      const pl = await js("shopAPI.printers()");
      ok(Array.isArray(pl), 'printers() returns a list (' + pl.length + ' here)');
      await js("shopAPI.setConfig({printer:'NoSuchPrinter',paper:'58'})");
      ok(fs.existsSync(path.join(ctx.USER, 'config.json')), 'config.json written');
      const pr = await Promise.race([js("shopAPI.print()"), sleep(25000).then(() => 'hang')]);
      ok(pr && typeof pr === 'object', 'silent print returns instead of hanging: ' + JSON.stringify(pr));
      await js("shopAPI.setConfig({printer:'',paper:'80'})");
      // a change made AFTER the last backup: closing the window must flush it and write a final backup
      await js("(()=>{cart=[{pid:S.p[1].id,q:1}];pmv='كاش';paid='';dpv=0;checkout()})()");
      await sleep(100);
      ok((await js("S.s.length")) === 2, 'extra sale made right before closing');
    } else if (ctx.E2E === 'verify') {
      ok((await js("!!document.getElementById('lu')&&!document.getElementById('ln')")), 'login screen shown (data survived restart: owner exists)');
      await js("document.getElementById('lu').value='owner';document.getElementById('lp').value='pass1234';login()");
      await sleep(800);
      ok((await js("me&&me.role")) === 'owner', 'login after restart works (password hash persisted)');
      ok((await js("S.s.length")) === 2 && (await js("CR().length")) === 1 && (await js("S.p.length")) === 2, 'all data (incl. the sale made just before closing) survived closing and reopening');
      const cfg = ctx.cfg(); ok(cfg.paper === '80', 'config survived restart');
      const lst = await js("shopAPI.listBackups()"); ok(lst.length >= 1, 'backup from the previous session is listed');
      const r = await js(`shopAPI.readBackup(${JSON.stringify(lst[0].name)})`);
      ok(r.ok && r.summary.sales === 2, 'closing the app wrote a final backup that includes the last sale (summary: ' + JSON.stringify(r.summary) + ')');
      // restore the real backup
      await js("confirm=()=>true;alert=()=>{};0");
      await js(`(async()=>{const r=await shopAPI.readBackup(${JSON.stringify(lst[0].name)});restoreText(r.text)})()`);
      await sleep(600);
      ok((await js("me")) === null, 'restore logs out');
      await js("document.getElementById('lu').value='owner';document.getElementById('lp').value='pass1234';login()"); await sleep(800);
      ok((await js("S.s.length")) === 2 && (await js("S.p.length")) === 2, 'data intact after restoring the backup');
      // corrupt backup file on disk must be refused
      fs.writeFileSync(path.join(dir, 'MB-backup-2000-01-01.json'), '{"this is":"not a backup"');
      const rb = await js("shopAPI.readBackup('MB-backup-2000-01-01.json')");
      ok(rb.ok === false, 'a corrupted backup file is refused before restore: ' + rb.reason);
      await js("restoreText('garbage')"); await sleep(200);
      ok((await js("S.s.length")) === 2, 'restoring garbage text leaves the data untouched');
      // restore point (snapshot) created by the restore
      ok((await js("snapMetas().then(l=>l.some(m=>/قبل الاسترجاع/.test(m.label||'')))")) === true, 'a restore point was created before restoring');
      // a locked (newer-version) database must never be overwritten by this version
      const kept = await js("(async()=>{SAVE_LOCK=true;const n=S.p.length;S.p.push({id:id(),cid:S.p[0].cid,name:'LOCKTEST',br:'',fl:'',sz:'',bc:'',price:1,min:1,h:[],at:{}});save();await new Promise(r=>setTimeout(r,250));const got=await load();SAVE_LOCK=false;S.p.pop();return got.p.length===n})()");
      ok(kept === true, 'save lock: data written by a newer version is not overwritten');
    }
  } catch (e) { ok(false, 'exception: ' + (e && e.stack || e)); }
  console.log('E2E_RESULT ' + JSON.stringify(out));
  win.close();
};
