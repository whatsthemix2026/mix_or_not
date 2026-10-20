(function () {
  const { TYPES, TYPE_ORDER, CHARS, QUESTIONS, QUESTION_IDS, SCRIPT, Stats } = window;
  const LETTERS = "ABCDE";
  const SCENE_HOLD_MS = 1400;

  const $ = sel => document.querySelector(sel);
  const stage = $("#stage");
  const view = $("#view");
  const bar = $("#progress-bar");
  const progressText = $("#progress-text");
  const backBtn = $("#btn-back");
  const hud = $("#hud");

  const state = {
    step: 0,
    history: [],     // 走過的步驟（返回上一題用）
    answers: {},     // { Q1: 選項索引 }
    noAnim: false,
    music: false
  };
  let sceneTimer = null;

  // ---------- 設定（動畫、音樂） ----------
  try {
    state.noAnim = localStorage.getItem("mix_noanim") === "1";
  } catch (e) {}
  const animBtn = $("#btn-anim");
  const musicBtn = $("#btn-music");
  const bgm = $("#bgm");

  function syncToggles() {
    document.body.classList.toggle("no-anim", state.noAnim);
    animBtn.setAttribute("aria-pressed", String(!state.noAnim));
    animBtn.textContent = state.noAnim ? "動畫 關" : "動畫 開";
    musicBtn.setAttribute("aria-pressed", String(state.music));
    musicBtn.textContent = state.music ? "♪ 開" : "♪ 關";
  }
  animBtn.addEventListener("click", () => {
    state.noAnim = !state.noAnim;
    try { localStorage.setItem("mix_noanim", state.noAnim ? "1" : "0"); } catch (e) {}
    syncToggles();
  });
  musicBtn.addEventListener("click", () => {
    state.music = !state.music;
    if (state.music) {
      bgm.play().catch(() => { musicBtn.title = "音樂檔尚未提供"; });
    } else {
      bgm.pause();
    }
    syncToggles();
  });

  // ---------- 流程控制 ----------
  function go(next, push = true) {
    clearTimeout(sceneTimer);
    if (push) state.history.push(state.step);
    state.step = next;
    render();
  }
  const nextStep = () => go(state.step + 1);

  backBtn.addEventListener("click", () => {
    // 回到上一個題目步驟，並清掉它之後的答案
    while (state.history.length) {
      const prev = state.history.pop();
      if (SCRIPT[prev].t === "q") {
        const idx = QUESTION_IDS.indexOf(SCRIPT[prev].id);
        QUESTION_IDS.slice(idx).forEach(id => delete state.answers[id]);
        go(prev, false);
        return;
      }
    }
  });

  function answeredCount() { return Object.keys(state.answers).length; }

  function updateHud(s) {
    const inQuiz = s.t !== "cover" && s.t !== "result";
    hud.hidden = !inQuiz;
    const n = answeredCount();
    bar.style.width = (n / QUESTION_IDS.length * 100) + "%";
    progressText.textContent = `${n} / ${QUESTION_IDS.length}`;
    const hasPrevQ = state.history.some(i => SCRIPT[i].t === "q");
    backBtn.disabled = !hasPrevQ;
  }

  // ---------- 畫面 ----------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function bubble(who, text, i) {
    const c = CHARS[who] || CHARS.narr;
    const cls = who === "me" ? "bubble me" : who === "narr" ? "bubble narr" : "bubble";
    const tag = c.name ? `<span class="speaker">${c.icon} ${esc(c.name)}</span>` : "";
    return `<div class="${cls}" style="--i:${i}">${tag}<p>${esc(text)}</p></div>`;
  }
  function setBg(bg) {
    stage.className = "stage bg-" + (bg || "sky");
  }

  function render() {
    const s = SCRIPT[state.step];
    updateHud(s);
    setBg(s.bg);
    view.scrollTop = 0;
    ({ cover: renderCover, dialog: renderDialog, scene: renderScene, q: renderQuestion, result: renderResult })[s.t](s);
    const focusEl = view.querySelector("[data-autofocus]");
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  function renderCover() {
    stage.className = "stage bg-cover";
    view.innerHTML = `
      <h1 class="sr-only">What is the mix? 怎麼拌！？</h1>
      <button class="cover-start" type="button" data-autofocus aria-label="開始測驗"></button>
      <p class="cover-hint">點播放鍵開始測驗</p>`;
    view.querySelector(".cover-start").addEventListener("click", () => {
      state.answers = {};
      state.history = [];
      nextStep();
    });
  }

  function renderDialog(s) {
    const choices = s.choices || ["繼續 ▶"];
    view.innerHTML = `
      <div class="talk">${s.lines.map((l, i) => bubble(l.who, l.text, i)).join("")}</div>
      <div class="choices" style="--i:${s.lines.length}">
        ${choices.map((c, i) => `<button type="button" class="choice"><span class="letter">[${LETTERS[i]}]</span>${esc(c)}</button>`).join("")}
      </div>`;
    view.querySelectorAll(".choice").forEach(b => b.addEventListener("click", nextStep));
  }

  function renderScene(s) {
    view.innerHTML = `<div class="scene-card" role="status"><span>${esc(s.name)}</span></div>
      <button type="button" class="scene-skip" data-autofocus>跳過 ▶</button>`;
    view.querySelector(".scene-skip").addEventListener("click", nextStep);
    sceneTimer = setTimeout(nextStep, state.noAnim ? 350 : SCENE_HOLD_MS);
  }

  function renderQuestion(s) {
    const q = QUESTIONS[s.id];
    const num = QUESTION_IDS.indexOf(s.id) + 1;
    const lines = [];
    if (s.pre) lines.push(bubble(s.who, s.pre, 0));
    lines.push(bubble(s.who, q.prompt, lines.length));
    const chosen = state.answers[s.id];
    view.innerHTML = `
      <p class="qnum">第 ${num} 題</p>
      <div class="talk">${lines.join("")}</div>
      <div class="choices" style="--i:${lines.length}" role="group" aria-label="選項">
        ${q.options.map((o, i) => `<button type="button" class="choice${chosen === i ? " is-chosen" : ""}" data-i="${i}">
          <span class="letter">[${LETTERS[i]}]</span>${esc(o[0])}</button>`).join("")}
      </div>`;
    view.querySelectorAll(".choice").forEach(b => b.addEventListener("click", () => {
      state.answers[s.id] = Number(b.dataset.i);
      nextStep();
    }));
  }

  // ---------- 計分與同分規則 ----------
  // 1. 最高分同分時，Q13 選的人格優先
  // 2. 仍同分，從 Q12 往前看每題選項給哪個同分人格較多分
  function computeResult(answers) {
    const scores = Object.fromEntries(TYPE_ORDER.map(t => [t, 0]));
    QUESTION_IDS.forEach(id => {
      const pts = QUESTIONS[id].options[answers[id]][1];
      for (const t in pts) scores[t] += pts[t];
    });
    const top = Math.max(...Object.values(scores));
    let cand = TYPE_ORDER.filter(t => scores[t] === top);
    let tieBreak = null;
    if (cand.length > 1) {
      const lastId = QUESTION_IDS[QUESTION_IDS.length - 1];
      const lastPts = QUESTIONS[lastId].options[answers[lastId]][1];
      const lastType = Object.keys(lastPts)[0];
      if (cand.includes(lastType)) {
        tieBreak = { tied: cand.slice(), by: lastId };
        cand = [lastType];
      } else {
        const tied = cand.slice();
        for (let k = QUESTION_IDS.length - 2; k >= 0 && cand.length > 1; k--) {
          const id = QUESTION_IDS[k];
          const pts = QUESTIONS[id].options[answers[id]][1];
          const best = Math.max(...cand.map(t => pts[t] || 0));
          if (best > 0) {
            cand = cand.filter(t => (pts[t] || 0) === best);
            if (cand.length === 1) tieBreak = { tied, by: id };
          }
        }
        // 理論上不會發生（已窮舉驗證），保險起見依田調排名
        if (cand.length > 1) {
          const rank = ["G", "E", "H", "R", "F"];
          cand.sort((a, b) => rank.indexOf(a) - rank.indexOf(b));
          tieBreak = { tied, by: "rank" };
          cand = [cand[0]];
        }
      }
    }
    return { type: cand[0], scores, tieBreak };
  }

  // ---------- 結果頁 ----------
  function renderResult() {
    const answerList = QUESTION_IDS.map(id => state.answers[id]);
    const res = computeResult(state.answers);
    const T = TYPES[res.type];
    const C = T.character;
    const maxScore = Math.max(...Object.values(res.scores), 1);
    const tieNote = res.tieBreak
      ? `<p class="tie-note">你的 ${res.tieBreak.tied.map(t => TYPES[t].emoji + TYPES[t].name).join("、")} 同分，依${res.tieBreak.by === "rank" ? "田調排名" : " " + res.tieBreak.by + " 的選擇"}決定。</p>`
      : "";

    view.innerHTML = `
      <section class="res-card" aria-labelledby="res-name">
        <p class="res-eyebrow">你的吃法人格是</p>
        <h2 id="res-name">${T.emoji} ${esc(T.name)}</h2>
        ${C ? `
        <div class="res-char"><img src="${esc(C.img)}" alt="${esc(C.name)}（${esc(C.pair)}）"></div>
        <p class="char-name">${esc(C.name)}<small>${esc(C.pair)}</small></p>
        <p class="char-quote">「${esc(C.quote)}」</p>` : `
        <div class="res-char is-empty" aria-hidden="true"><span>${T.emoji}</span><small>角色圖待定</small></div>`}
        <p class="res-kw">${(C ? C.traits : T.keywords).map(k => `<span>${esc(k)}</span>`).join("")}</p>
        <p class="res-desc">${esc(T.desc)}</p>
        ${C ? `
        <details class="char-more">
          <summary>看完整介紹</summary>
          <h4>你是這樣的人</h4><p>${esc(C.about)}</p>
          <h4>但有時候……</h4><p>${esc(C.flip)}</p>
          <h4>你的自然象徵</h4><p>${esc(C.nature)}</p>
        </details>` : ""}
        ${tieNote}
        <div class="bars">${TYPE_ORDER.map(t => `
          <div class="brow${t === res.type ? " is-top" : ""}">
            <span>${TYPES[t].emoji} ${TYPES[t].name}</span>
            <span class="track"><i style="width:${res.scores[t] / maxScore * 100}%"></i></span>
            <span class="num">${res.scores[t]}</span>
          </div>`).join("")}
        </div>
      </section>

      <section class="res-card label-card" aria-label="標籤與數據">
        <h3>別人可能這樣看你</h3>
        <button type="button" class="label-peel" aria-expanded="false">
          <span class="label-front">${esc(T.stereotype)}<small>點一下，撕開標籤</small></span>
          <span class="label-back" hidden><b>${esc(T.fact.num)}</b>${esc(T.fact.text)}<small>資料來源：本專題田野調查</small></span>
        </button>
      </section>

      <section class="res-card" aria-label="大家的選擇">
        <h3>大家的選擇</h3>
        <div id="stats" class="stats"><p class="muted">統計載入中…</p></div>
      </section>

      <div class="res-actions">
        <button type="button" class="btn-main" id="btn-save">存成圖片</button>
        <button type="button" class="btn-sub" id="btn-again">再玩一次</button>
      </div>`;

    const peel = view.querySelector(".label-peel");
    peel.addEventListener("click", () => {
      const open = peel.getAttribute("aria-expanded") === "true";
      peel.setAttribute("aria-expanded", String(!open));
      peel.querySelector(".label-front").hidden = !open;
      peel.querySelector(".label-back").hidden = open;
      peel.classList.toggle("is-peeled", !open);
    });
    $("#btn-again").addEventListener("click", () => { state.answers = {}; state.history = []; go(0, false); });
    $("#btn-save").addEventListener("click", () => saveImage(res));

    Stats.submit(answerList, res.type).finally(() =>
      Stats.load(answerList, res.type).then(st => renderStats(st, answerList, res.type)));
  }

  function renderStats(st, answerList, type) {
    const box = $("#stats");
    if (!box) return;
    if (st.error) {
      box.innerHTML = `<p class="muted">統計暫時讀取不到，請稍後再看看。</p>`;
      return;
    }
    const pct = (n, d) => d ? Math.round(n / d * 100) : 0;
    const typeShare = pct(st.types[type] || 0, st.total);
    const rows = QUESTION_IDS.map((id, i) => {
      const counts = st.questions[id] || [];
      const sum = counts.reduce((a, b) => a + b, 0);
      const mine = answerList[i];
      return `<li><span class="sq">${i + 1}. ${esc(QUESTIONS[id].options[mine][0])}</span>
        <span class="track"><i style="width:${pct(counts[mine] || 0, sum)}%"></i></span>
        <span class="num">${pct(counts[mine] || 0, sum)}%</span></li>`;
    }).join("");
    box.innerHTML = `
      ${st.demo ? `<p class="demo-tag">示範數據（統計後台尚未接上）</p>` : ""}
      <p class="stat-big">目前 <b>${st.total.toLocaleString()}</b> 人測驗<br>
        <b>${typeShare}%</b> 的人跟你一樣是 ${TYPES[type].emoji} ${TYPES[type].name}</p>
      <p class="muted">每一題跟你選一樣的人：</p>
      <ol class="qstats">${rows}</ol>`;
  }

  // ---------- 存成圖片（長按儲存） ----------
  async function saveImage(res) {
    const T = TYPES[res.type];
    const W = 1080, H = 1920;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    try { await document.fonts.ready; } catch (e) {}
    const font = (size, w = 400) => `${w} ${size}px "DotGothic16","Noto Sans TC",sans-serif`;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#1E8FE0"); sky.addColorStop(0.62, "#8FD3FF"); sky.addColorStop(0.62, "#6FB34A"); sky.addColorStop(1, "#2F7A24");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // 卡片
    g.fillStyle = "#10243A"; g.fillRect(96, 196, 900, 1440);
    g.fillStyle = "#FFFFFF"; g.fillRect(84, 184, 900, 1440);
    g.textAlign = "center"; g.fillStyle = "#10243A";
    g.font = font(44); g.fillText("你的吃法人格是", W / 2, 300);
    const C = T.character;
    const img = C ? await new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = C.img; }) : null;
    if (img) {
      const s = Math.min(380 / img.width, 330 / img.height);
      g.drawImage(img, W / 2 - img.width * s / 2, 325, img.width * s, img.height * s);
    } else {
      g.font = font(220); g.fillText(T.emoji, W / 2, 560);
    }
    g.font = font(96); g.fillText(T.name, W / 2, 740);
    g.font = font(44); g.fillStyle = "#51667A";
    g.fillText(C ? C.name + "｜" + C.traits.slice(0, 3).join("・") : T.keywords.join("・"), W / 2, 810);
    g.fillStyle = "#10243A"; g.font = font(42); g.fillText(T.desc, W / 2, 880);
    const maxS = Math.max(...Object.values(res.scores), 1);
    TYPE_ORDER.forEach((t, i) => {
      const y = 990 + i * 110;
      g.textAlign = "left"; g.font = font(40); g.fillStyle = "#10243A";
      g.fillText(TYPES[t].emoji + " " + TYPES[t].name, 150, y + 34);
      g.fillStyle = "#E3EDF5"; g.fillRect(500, y, 360, 40);
      g.fillStyle = t === res.type ? "#C9D400" : "#1E8FE0"; g.fillRect(500, y, 360 * res.scores[t] / maxS, 40);
      g.fillStyle = "#10243A"; g.textAlign = "right"; g.fillText(String(res.scores[t]), 940, y + 34);
    });
    g.textAlign = "center"; g.fillStyle = "#10243A"; g.font = font(40);
    g.fillText(T.fact.num + " " + T.fact.text, W / 2, 1580);
    g.fillStyle = "#FFFFFF"; g.font = font(64, 700); g.fillText("WHAT'S THE MIX ?", W / 2, 1780);
    g.font = font(40); g.fillText("怎麼拌！？", W / 2, 1850);

    const url = cv.toDataURL("image/png");
    const dlg = $("#save-dialog");
    dlg.querySelector("img").src = url;
    dlg.hidden = false;
    dlg.querySelector("button").focus();
  }
  $("#save-dialog button").addEventListener("click", () => { $("#save-dialog").hidden = true; });

  syncToggles();
  render();

  // 給檢查用：window.__mix.computeResult
  window.__mix = { computeResult, state };
})();
