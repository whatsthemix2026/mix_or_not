// 即時統計：把作答送到 Google Apps Script，並取回大家的統計
// 部署好 Apps Script 後，把網址貼到 STATS_ENDPOINT（見 README.md）
// 留空時使用示範數據，畫面上會標示「示範數據」
window.STATS_ENDPOINT = "https://script.google.com/macros/s/AKfycbzTJxrYwG__5aOVpoX67xbP4Cs0dysjZfoT1ZY7ecjome0Upukjlpecol63quYbcd6reA/exec";

window.Stats = (function () {
  const SUBMITTED_KEY = "mix_submitted_v1";

  function alreadySubmitted() {
    try { return localStorage.getItem(SUBMITTED_KEY) === "1"; } catch (e) { return false; }
  }
  function markSubmitted() {
    try { localStorage.setItem(SUBMITTED_KEY, "1"); } catch (e) {}
  }

  // 同一支手機只計入第一次作答；「再玩一次」不重複送出
  async function submit(answers, result) {
    if (!window.STATS_ENDPOINT || alreadySubmitted()) return false;
    // 確認後台回 {ok:true} 才算送出成功；Google 偶爾回錯誤頁，最多試 3 次
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // text/plain 不會觸發 CORS 預檢，Apps Script 才收得到
        const res = await fetch(window.STATS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ answers, result, v: 1 })
        });
        const data = await res.json();
        if (data && data.ok) { markSubmitted(); return true; }
        // 資料格式錯、或後台暫停收件：重送也沒用，直接結束（不標記已送出，畫面照常）
        if (data && (data.error === "invalid" || data.error === "paused")) return false;
      } catch (e) {
        console.warn(`統計送出失敗（第 ${attempt} 次）`, e);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
    return false;
  }

  async function load(myAnswers, myResult) {
    // 沒設定後台才用示範數據；有後台但讀不到時重試，仍失敗就回報錯誤，不顯示假數據
    if (!window.STATS_ENDPOINT) return demoData(myAnswers, myResult);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(window.STATS_ENDPOINT, { method: "GET" });
        const data = await res.json();   // Google 偶爾回傳錯誤頁（HTML），這裡會丟出例外
        if (data && data.total >= 0) return Object.assign({ demo: false }, data);
      } catch (e) {
        console.warn(`統計讀取失敗（第 ${attempt} 次）`, e);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
    return { error: true };
  }

  // 示範數據：固定亂數種子，人格比例參考田調分布
  function demoData(myAnswers, myResult) {
    let seed = 20261020;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const typeW = { G: 34.6, F: 8.0, R: 11.1, E: 30.9, H: 15.4 };
    const total = 1203;
    const types = {};
    let left = total;
    window.TYPE_ORDER.forEach((t, i, arr) => {
      types[t] = i === arr.length - 1 ? left : Math.round(total * typeW[t] / 100);
      left -= types[t];
    });
    const questions = {};
    window.QUESTION_IDS.forEach(id => {
      const n = window.QUESTIONS[id].options.length;
      const w = Array.from({ length: n }, () => 0.4 + rnd());
      const sum = w.reduce((a, b) => a + b, 0);
      questions[id] = w.map(x => Math.round(total * x / sum));
    });
    if (myAnswers) myAnswers.forEach((a, i) => { questions[window.QUESTION_IDS[i]][a] += 1; });
    if (myResult) types[myResult] += 1;
    return { demo: true, total: total + (myResult ? 1 : 0), types, questions };
  }

  return { submit, load };
})();
