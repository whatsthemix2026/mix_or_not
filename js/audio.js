// 聲音：背景音樂（封面／遊戲中兩首，循環）＋音效。檔案由 tools/make_audio.py 產生。
// 瀏覽器規定要使用者先點一下才能出聲，所以第一次點畫面時才真正開始播放。
// 背景音樂用 <audio>（檔案大、邊下載邊播）；音效用 Web Audio（短、要即時，手機上才不會延遲）。
window.Sound = (function () {
  const DIR = "assets/audio/";
  const SFX = ["click", "hover", "line", "griddle", "wobble", "hatch"];
  const tracks = {
    title: Object.assign(new Audio(DIR + "bgm-title.mp3"), { loop: true, preload: "auto" }),
    game: Object.assign(new Audio(DIR + "bgm-game.mp3"), { loop: true, preload: "none" })
  };
  let enabled = true;
  try { enabled = localStorage.getItem("mix_sound") !== "0"; } catch (e) {}
  let unlocked = false;
  let want = null;          // 目前畫面該放哪一首
  let ctx = null;
  const buffers = {};
  const playing = new Set();  // 正在播的音效（換頁時可以停掉長的，例如煎台）

  function loadSfx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    SFX.forEach(name => {
      fetch(DIR + "sfx-" + name + ".mp3")
        .then(r => r.arrayBuffer())
        .then(b => new Promise((ok, ng) => ctx.decodeAudioData(b, ok, ng)))
        .then(buf => { buffers[name] = buf; })
        .catch(() => {});
    });
  }

  function syncMusic() {
    Object.entries(tracks).forEach(([k, a]) => {
      if (enabled && unlocked && k === want) {
        if (a.paused) a.play().catch(() => {});
      } else if (!a.paused) {
        a.pause();
        if (k !== want) a.currentTime = 0;   // 換到另一首：下次從頭播
      }
    });
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (!ctx) loadSfx();
    if (ctx && ctx.state === "suspended") ctx.resume();
    tracks.game.preload = "auto";
    syncMusic();
  }
  // 第一次點畫面／按鍵（capture，在按鈕自己的處理之前）
  ["pointerdown", "keydown", "touchend"].forEach(ev =>
    window.addEventListener(ev, unlock, { capture: true, passive: true }));

  return {
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = on;
      try { localStorage.setItem("mix_sound", on ? "1" : "0"); } catch (e) {}
      if (!on) this.stopSfx();
      unlock();
      syncMusic();
    },
    music(name) { want = name; syncMusic(); },
    sfx(name) {
      if (!enabled || !ctx || !buffers[name]) return;
      if (ctx.state === "suspended") ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buffers[name];
      src.connect(ctx.destination);
      src.onended = () => playing.delete(src);
      playing.add(src);
      src.start();
    },
    stopSfx() { playing.forEach(s => { try { s.stop(); } catch (e) {} }); playing.clear(); },
    // 檢查用（瀏覽器主控台輸入 Sound.status()）
    status() {
      return { enabled, unlocked, want, ctx: ctx && ctx.state, sfxLoaded: Object.keys(buffers),
               title: { playing: !tracks.title.paused, t: +tracks.title.currentTime.toFixed(1) },
               game: { playing: !tracks.game.paused, t: +tracks.game.currentTime.toFixed(1) } };
    }
  };
})();
