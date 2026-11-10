/**
 * 《怎麼拌！？》即時統計後台（Google Apps Script）
 * 部署步驟見 README.md。
 *
 * POST：收一筆作答 { answers: [13 個選項索引], result: "G|F|R|E|H" }，寫進試算表
 * GET ：回傳統計 { total, types: {G: n...}, questions: {Q1: [n, n, ...]...} }
 * GET ?page=admin：管理後台（只有專案帳號本人登入時能開，見 assertAdmin_）
 * 不收集任何個資，只記錄時間、答案、結果。
 *
 * 暫停收件：
 * - 試算表「設定」分頁 B1 的勾選框：打勾＝收件中，取消＝暫停（暫停時統計照常顯示）
 * - 管理後台的開關按鈕
 * - 管理密語：POST { admin: "pause" | "resume" | "status", key: 密語 } 也能切換同一個勾選框
 *   密語存在「專案設定 → 指令碼屬性」的 ADMIN_KEY，不寫在程式或網站裡
 *
 * 刪除資料（只在管理後台）：刪除某天以前、或某一天的作答；刪除前先複製到「備份」分頁，
 * 每次操作記在「操作紀錄」分頁。
 */

const SHEET_NAME = 'responses';
const SETTINGS_SHEET = '設定';
const BACKUP_SHEET = '備份';
const LOG_SHEET = '操作紀錄';
const TYPES = ['G', 'F', 'R', 'E', 'H'];
const TYPE_NAMES = { G: '層次守護者', F: '融合創造者', R: '儀式體驗家', E: '嚐鮮探險家', H: '共感協調者' };
const OPTION_COUNTS = [3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5]; // Q1～Q13 各題選項數
const CACHE_SECONDS = 30;
const TZ = 'Asia/Taipei';

// ==================== 試算表 ====================

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    const header = ['時間', '結果'].concat(OPTION_COUNTS.map((_, i) => 'Q' + (i + 1)));
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 「設定」分頁：A1 標籤、B1 勾選框（第一次呼叫時自動建立，預設收件中）
function getSwitch_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.getRange('A1').setValue('收件中');
    sh.getRange('B1').insertCheckboxes().setValue(true);
    sh.getRange('A2').setValue('打勾＝收新的作答；取消打勾＝暫停收件（網站和統計照常顯示）');
  }
  return sh.getRange('B1');
}
function isAccepting_() { return getSwitch_().getValue() === true; }

function countRows_() { return Math.max(getSheet_().getLastRow() - 1, 0); }

function getOrCreate_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function log_(action, detail) {
  getOrCreate_(LOG_SHEET, ['時間', '操作', '內容']).appendRow([new Date(), action, detail || '']);
}

function dayKey_(d) { return Utilities.formatDate(new Date(d), TZ, 'yyyy-MM-dd'); }

// ==================== 公開 API（網站用） ====================

function handleAdmin_(d) {
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key || d.key !== key) return json_({ ok: false, error: 'forbidden' });
  if (d.admin === 'pause') { getSwitch_().setValue(false); log_('暫停收件', '管理密語'); }
  else if (d.admin === 'resume') { getSwitch_().setValue(true); log_('恢復收件', '管理密語'); }
  else if (d.admin !== 'status') return json_({ ok: false, error: 'unknown action' });
  return json_({ ok: true, accepting: isAccepting_(), total: countRows_() });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isValid_(d) {
  if (!d || !Array.isArray(d.answers) || d.answers.length !== OPTION_COUNTS.length) return false;
  if (TYPES.indexOf(d.result) === -1) return false;
  return d.answers.every((a, i) => Number.isInteger(a) && a >= 0 && a < OPTION_COUNTS[i]);
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (d && d.admin) return handleAdmin_(d);
  if (!isValid_(d)) return json_({ ok: false, error: 'invalid' });
  if (!isAccepting_()) return json_({ ok: false, error: 'paused' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const letters = d.answers.map(a => 'ABCDE'.charAt(a));
    getSheet_().appendRow([new Date(), d.result].concat(letters));
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove('stats');
  return json_({ ok: true });
}

function doGet(e) {
  if (e && e.parameter && e.parameter.page === 'admin') return adminPage_();

  const cache = CacheService.getScriptCache();
  const hit = cache.get('stats');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

  const sh = getSheet_();
  const rows = sh.getLastRow() > 1
    ? sh.getRange(2, 2, sh.getLastRow() - 1, 1 + OPTION_COUNTS.length).getValues()
    : [];
  const types = {};
  TYPES.forEach(t => { types[t] = 0; });
  const questions = {};
  OPTION_COUNTS.forEach((n, i) => { questions['Q' + (i + 1)] = new Array(n).fill(0); });

  rows.forEach(r => {
    if (types[r[0]] !== undefined) types[r[0]]++;
    OPTION_COUNTS.forEach((n, i) => {
      const k = 'ABCDE'.indexOf(r[i + 1]);
      if (k >= 0 && k < n) questions['Q' + (i + 1)][k]++;
    });
  });

  const out = JSON.stringify({ total: rows.length, types: types, questions: questions });
  cache.put('stats', out, CACHE_SECONDS);
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

// ==================== 管理後台 ====================

// 只有「正在使用的人」就是專案帳號本人時才放行。
// 公開部署（所有人可存取）上，匿名觀眾的 getActiveUser() 是空字串，會被擋下。
function isAdmin_() {
  const me = Session.getEffectiveUser().getEmail();
  const who = Session.getActiveUser().getEmail();
  return !!me && who === me;
}
function assertAdmin_() {
  if (!isAdmin_()) throw new Error('沒有權限，請用專案帳號登入');
}

function adminPage_() {
  if (!isAdmin_()) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">沒有權限。請用專案 Google 帳號登入後，從管理後台網址開啟。</p>')
      .setTitle('怎麼拌 管理後台');
  }
  return HtmlService.createHtmlOutput(adminHtml_())
    .setTitle('怎麼拌 管理後台')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function readRows_() {
  const sh = getSheet_();
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, 2 + OPTION_COUNTS.length).getValues() : [];
}

function adminGetDashboard() {
  assertAdmin_();
  const rows = readRows_();
  const today = dayKey_(new Date());
  const types = {};
  TYPES.forEach(t => { types[t] = 0; });
  const byDay = {};
  let todayCount = 0;
  rows.forEach(r => {
    if (types[r[1]] !== undefined) types[r[1]]++;
    const k = dayKey_(r[0]);
    byDay[k] = (byDay[k] || 0) + 1;
    if (k === today) todayCount++;
  });
  const recent = rows.slice(-5).reverse().map(r => ({
    time: Utilities.formatDate(new Date(r[0]), TZ, 'MM/dd HH:mm'),
    type: TYPE_NAMES[r[1]] || r[1]
  }));
  return {
    account: Session.getEffectiveUser().getEmail(),
    accepting: isAccepting_(),
    total: rows.length,
    today: todayCount,
    last: rows.length ? Utilities.formatDate(new Date(rows[rows.length - 1][0]), TZ, 'MM/dd HH:mm') : null,
    types: TYPES.map(t => ({ name: TYPE_NAMES[t], count: types[t] })),
    recent: recent,
    days: Object.keys(byDay).sort().map(k => ({ day: k, count: byDay[k] }))
  };
}

function adminSetAccepting(on) {
  assertAdmin_();
  getSwitch_().setValue(on === true);
  log_(on === true ? '恢復收件' : '暫停收件', '管理後台');
  return adminGetDashboard();
}

// mode: 'before'＝刪除 day 以前（不含當天）；'on'＝刪除 day 當天
function matchDelete_(mode, day) {
  return r => {
    const k = dayKey_(r[0]);
    return mode === 'before' ? k < day : k === day;
  };
}
function checkDeleteArgs_(mode, day) {
  if (mode !== 'before' && mode !== 'on') throw new Error('刪除方式不正確');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('日期格式不正確');
}

function adminPreviewDelete(mode, day) {
  assertAdmin_();
  checkDeleteArgs_(mode, day);
  return { count: readRows_().filter(matchDelete_(mode, day)).length };
}

function adminDelete(mode, day, expected) {
  assertAdmin_();
  checkDeleteArgs_(mode, day);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_();
    const rows = readRows_();
    const hit = matchDelete_(mode, day);
    const del = rows.filter(hit);
    const keep = rows.filter(r => !hit(r));
    // 預覽之後若有新資料進來導致數量不同，要求重新確認
    if (del.length !== expected) {
      return { ok: false, error: '筆數有變動（預覽 ' + expected + ' 筆，現在 ' + del.length + ' 筆），請重新確認', dashboard: adminGetDashboard() };
    }
    if (!del.length) return { ok: true, deleted: 0, dashboard: adminGetDashboard() };

    // 先備份
    const width = 2 + OPTION_COUNTS.length;
    const backup = getOrCreate_(BACKUP_SHEET, ['刪除時間', '時間', '結果'].concat(OPTION_COUNTS.map((_, i) => 'Q' + (i + 1))));
    const now = new Date();
    backup.getRange(backup.getLastRow() + 1, 1, del.length, width + 1)
      .setValues(del.map(r => [now].concat(r)));

    // 再改寫資料區
    sh.getRange(2, 1, rows.length, width).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);

    const label = mode === 'before' ? day + ' 以前' : day + ' 當天';
    log_('刪除資料', label + '，共 ' + del.length + ' 筆（已備份到「' + BACKUP_SHEET + '」分頁）');
    CacheService.getScriptCache().remove('stats');
    return { ok: true, deleted: del.length, dashboard: adminGetDashboard() };
  } finally {
    lock.releaseLock();
  }
}

function adminHtml_() {
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'
    + '<style>'
    + ':root{--ink:#10243A;--muted:#5B6B7B;--line:#D9E2EA;--bg:#F3F6F9;--card:#fff;--ok:#1E7B45;--ok-bg:#E6F4EA;--warn:#8A5A00;--warn-bg:#FFF4D6;--danger:#B4381F;--danger-bg:#FDECE7;--accent:#1E6FB2}'
    + '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;font-size:15px;line-height:1.6}'
    + '.wrap{max-width:460px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:14px}'
    + 'header{display:flex;justify-content:space-between;align-items:center}h1{font-size:18px;margin:0}.sub{font-size:12px;color:var(--muted)}'
    + '.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}'
    + '.sw{display:flex;flex-direction:column;gap:8px}.sw.on{background:var(--ok-bg);border-color:var(--ok);color:var(--ok)}.sw.off{background:var(--warn-bg);border-color:var(--warn);color:var(--warn)}'
    + '.sw b{font-size:20px}button{font:inherit;cursor:pointer;border-radius:10px;border:1px solid var(--ink);background:#fff;color:var(--ink);padding:8px 12px}'
    + 'button.big{width:100%;height:48px;font-size:16px}button:disabled{opacity:.5;cursor:wait}'
    + '.nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.num{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}.num span{font-size:12px;color:var(--muted)}.num b{display:block;font-size:22px}'
    + 'h2{font-size:14px;color:var(--muted);margin:0 0 8px;font-weight:500}'
    + '.bar{display:grid;grid-template-columns:84px 1fr 64px;gap:8px;align-items:center;font-size:13px;margin:4px 0}.track{height:10px;background:var(--bg);border-radius:5px;overflow:hidden}.track i{display:block;height:100%;background:var(--accent)}.bar em{font-style:normal;text-align:right;color:var(--muted)}'
    + '.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}.row span:first-child{color:var(--muted)}'
    + '.danger{border-color:var(--danger)}.danger h2{color:var(--danger)}select{font:inherit;padding:8px;border-radius:10px;border:1px solid var(--line);width:100%;margin:6px 0;background:#fff}'
    + '.modes{display:flex;gap:16px;margin:4px 0}.modes label{display:flex;gap:6px;align-items:center}'
    + '.confirm{background:var(--danger-bg);border-radius:10px;padding:10px;margin-top:8px;color:var(--danger)}.confirm button{border-color:var(--danger);color:#fff;background:var(--danger);margin-right:8px}'
    + '.msg{font-size:13px;margin-top:6px}.err{color:var(--danger)}.ok{color:var(--ok)}.empty{color:var(--muted);font-size:14px}'
    + '</style></head><body><div class="wrap">'
    + '<header><div><h1>怎麼拌 管理後台</h1><div class="sub" id="acct">載入中…</div></div><button id="reload" aria-label="重新整理">↻</button></header>'
    + '<section class="card sw" id="sw"><b id="swt">讀取中…</b><span id="swd"></span><button class="big" id="swb" disabled>…</button></section>'
    + '<section class="nums"><div class="num"><span>總人數</span><b id="total">–</b></div><div class="num"><span>今天</span><b id="today">–</b></div><div class="num"><span>最後一筆</span><b id="last">–</b></div></section>'
    + '<section class="card"><h2>人格分布</h2><div id="types"></div></section>'
    + '<section class="card"><h2>最近 5 筆作答</h2><div id="recent"></div></section>'
    + '<section class="card danger"><h2>刪除資料</h2>'
    + '<div class="modes"><label><input type="radio" name="mode" value="on" checked> 刪除某一天</label><label><input type="radio" name="mode" value="before"> 刪除某天以前</label></div>'
    + '<select id="day"></select><button id="preview">檢查要刪幾筆</button>'
    + '<div id="confirm"></div><div class="msg" id="delmsg"></div>'
    + '<p class="sub">刪除前會自動備份到試算表的「備份」分頁；所有操作記在「操作紀錄」分頁。</p></section>'
    + '</div><script>'
    + 'var D=null,busy=false;function $(i){return document.getElementById(i)}'
    + 'function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}'
    + 'function fail(e){busy=false;$("swb").disabled=false;$("delmsg").className="msg err";$("delmsg").textContent=(e&&e.message)||"發生錯誤，請重新整理"}'
    + 'function render(d){D=d;busy=false;$("acct").textContent=d.account;'
    + 'var sw=$("sw");sw.className="card sw "+(d.accepting?"on":"off");$("swt").textContent=d.accepting?"● 收件中":"⏸ 已暫停";'
    + '$("swd").textContent=d.accepting?"觀眾的作答會記進統計":"網站照常可以玩，但作答不會記錄";$("swb").textContent=d.accepting?"暫停收件":"恢復收件";$("swb").disabled=false;'
    + '$("total").textContent=d.total.toLocaleString();$("today").textContent=d.today;$("last").textContent=d.last||"–";'
    + 'var max=Math.max.apply(null,d.types.map(function(t){return t.count}).concat([1]));'
    + '$("types").innerHTML=d.types.slice().sort(function(a,b){return b.count-a.count}).map(function(t){var p=d.total?Math.round(t.count/d.total*100):0;return "<div class=\\"bar\\"><span>"+esc(t.name)+"</span><span class=\\"track\\"><i style=\\"width:"+(t.count/max*100)+"%\\"></i></span><em>"+t.count+"・"+p+"%</em></div>"}).join("");'
    + '$("recent").innerHTML=d.recent.length?d.recent.map(function(r){return "<div class=\\"row\\"><span>"+esc(r.time)+"</span><span>"+esc(r.type)+"</span></div>"}).join(""):"<p class=\\"empty\\">還沒有作答</p>";'
    + 'var keep=$("day").value;$("day").innerHTML=d.days.length?d.days.slice().reverse().map(function(x){return "<option value=\\""+x.day+"\\">"+x.day+"（"+x.count+" 筆）</option>"}).join(""):"<option value=\\"\\">沒有資料</option>";if(keep)$("day").value=keep;'
    + '$("preview").disabled=!d.days.length}'
    + 'function load(){google.script.run.withSuccessHandler(render).withFailureHandler(fail).adminGetDashboard()}'
    + '$("reload").onclick=function(){$("confirm").innerHTML="";$("delmsg").textContent="";load()};'
    + '$("swb").onclick=function(){if(busy||!D)return;busy=true;$("swb").disabled=true;$("swb").textContent="處理中…";google.script.run.withSuccessHandler(render).withFailureHandler(fail).adminSetAccepting(!D.accepting)};'
    + 'function mode(){return document.querySelector("input[name=mode]:checked").value}'
    + 'function label(m,day){return m==="before"?day+" 以前（不含當天）":day+" 當天"}'
    + '$("preview").onclick=function(){var m=mode(),day=$("day").value;if(!day)return;$("delmsg").textContent="";$("confirm").innerHTML="檢查中…";'
    + 'google.script.run.withFailureHandler(fail).withSuccessHandler(function(r){if(!r.count){$("confirm").innerHTML="<p class=\\"empty\\">"+esc(label(m,day))+"沒有資料可刪。</p>";return}'
    + '$("confirm").innerHTML="<div class=\\"confirm\\">將刪除 <b>"+esc(label(m,day))+"</b> 的 <b>"+r.count+"</b> 筆作答（會先備份）。<br><button id=\\"go\\">確認刪除 "+r.count+" 筆</button><button id=\\"cancel\\" style=\\"background:#fff;color:#B4381F\\">取消</button></div>";'
    + '$("cancel").onclick=function(){$("confirm").innerHTML=""};'
    + '$("go").onclick=function(){$("go").disabled=true;$("go").textContent="刪除中…";google.script.run.withFailureHandler(fail).withSuccessHandler(function(res){$("confirm").innerHTML="";render(res.dashboard);'
    + 'if(res.ok){$("delmsg").className="msg ok";$("delmsg").textContent="已刪除 "+res.deleted+" 筆，備份在「備份」分頁"}else{$("delmsg").className="msg err";$("delmsg").textContent=res.error}}).adminDelete(m,day,r.count)}}).adminPreviewDelete(m,day)};'
    + 'load();'
    + '</script></body></html>';
}
