/**
 * 《怎麼拌！？》即時統計後台（Google Apps Script）
 * 部署步驟見 README.md。
 *
 * POST：收一筆作答 { answers: [13 個選項索引], result: "G|F|R|E|H" }，寫進試算表
 * GET ：回傳統計 { total, types: {G: n...}, questions: {Q1: [n, n, ...]...} }
 * 不收集任何個資，只記錄時間、答案、結果。
 *
 * 暫停收件：
 * - 試算表「設定」分頁 B1 的勾選框：打勾＝收件中，取消＝暫停（暫停時統計照常顯示）
 * - 管理密語：POST { admin: "pause" | "resume" | "status", key: 密語 } 也能切換同一個勾選框
 *   密語存在「專案設定 → 指令碼屬性」的 ADMIN_KEY，不寫在程式或網站裡
 */

const SHEET_NAME = 'responses';
const SETTINGS_SHEET = '設定';
const TYPES = ['G', 'F', 'R', 'E', 'H'];
const OPTION_COUNTS = [3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5]; // Q1～Q13 各題選項數
const CACHE_SECONDS = 30;

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

function handleAdmin_(d) {
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key || d.key !== key) return json_({ ok: false, error: 'forbidden' });
  if (d.admin === 'pause') getSwitch_().setValue(false);
  else if (d.admin === 'resume') getSwitch_().setValue(true);
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

function doGet() {
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
