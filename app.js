(() => {
  "use strict";

  // ===== 設定値 =====
  const POINTS_PER_DAY = 10;
  const STREAK_BONUS_EVERY = 7;
  const STREAK_BONUS = 30;
  const EXCHANGE_COST = 300;
  const MAX_REC_SEC = 7;
  const COUNTDOWN_FROM = 3; // 残り3秒から 3・2・1 を表示
  const STORAGE_KEY = "kotalk-demo-v1";

  // ===== 状態（デモのため localStorage に保存） =====
  // TODO(API): 本番ではユーザーの出席・ポイントはサーバー側で管理する
  const defaultState = () => ({
    dayOffset: 0,        // デモ用：日付を進めた日数
    last: null,          // 最後に出席した日 "YYYY-MM-DD"
    streak: 0,
    points: 0,
    history: {},         // { "YYYY-MM-DD": "check" | "rest" }
    restWeeks: [],       // 休息券を使った週（その週の月曜日）
    requests: [],        // 講師1:1フィードバック申請
    ratio: "ja6",
    sfx: true,           // 効果音
    idx: 0,
    quizDate: null,      // 単語テストを最後に受けた日（ポイントは1日1回）
    lastQuizScore: null
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) { /* 保存領域が使えない場合は初期状態で動作 */ }
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ===== 日付ユーティリティ =====
  const pad = n => String(n).padStart(2, "0");
  const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
  const diffDays = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
  function today() {
    const d = new Date();
    d.setDate(d.getDate() + state.dayOffset);
    return toKey(d);
  }
  // 週の識別子 = その週の月曜日
  function weekKey(k) {
    const d = fromKey(k);
    const dow = (d.getDay() + 6) % 7; // 月=0
    d.setDate(d.getDate() - dow);
    return toKey(d);
  }
  const restAvailable = k => !state.restWeeks.includes(weekKey(k));

  // ===== 出席ロジック =====
  // 1日だけ空いた場合、その空いた日の週の休息券が残っていれば連続記録を維持
  function streakStatus() {
    if (!state.last) return { streak: 0, alive: false };
    const gap = diffDays(state.last, today());
    if (gap <= 1) return { streak: state.streak, alive: true };
    if (gap === 2 && restAvailable(addDays(state.last, 1))) {
      return { streak: state.streak, alive: true, needsRest: true };
    }
    return { streak: 0, alive: false };
  }

  function checkIn() {
    const t = today();
    if (state.last === t) return { already: true };
    const st = streakStatus();
    let usedRest = false;
    if (st.needsRest) {
      const missed = addDays(state.last, 1);
      state.restWeeks.push(weekKey(missed));
      state.history[missed] = "rest";
      usedRest = true;
    }
    state.streak = st.alive ? st.streak + 1 : 1;
    state.last = t;
    state.history[t] = "check";
    let gained = POINTS_PER_DAY;
    const bonus = state.streak % STREAK_BONUS_EVERY === 0;
    if (bonus) gained += STREAK_BONUS;
    state.points += gained;
    save();
    return { already: false, usedRest, bonus, gained };
  }

  // ===== 効果音（音声ファイルを使わず Web Audio で生成） =====
  const sfx = (() => {
    let ctx = null;
    // iOS ではタップ操作の中で一度作成・再開しておく必要がある
    function unlock() {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    function tone(freq, at, dur, type = "sine", vol = 0.1, endFreq = null) {
      const c = unlock();
      if (!c || !state.sfx) return;
      const t = c.currentTime + at;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    return {
      unlock,
      // 딩동댕：ド・ミ・ソの上昇チャイム
      correct() { tone(1047, 0, 0.22, "sine", 0.09); tone(1319, 0.14, 0.22, "sine", 0.09); tone(1568, 0.28, 0.45, "sine", 0.09); },
      // 띵-!：短く少し下がるブザー音
      wrong() { tone(440, 0, 0.32, "triangle", 0.12, 392); },
      // 録音の残り 3・2・1：ごく小さなクリック音（録音に入りにくいよう短く小さく）
      tick() { tone(1200, 0, 0.05, "sine", 0.025); }
    };
  })();

  // ===== 発音評価（現在はダミー） =====
  async function evaluatePronunciation(audioBlob, sentence, durationSec) {
    // ------------------------------------------------------------
    // TODO(API): 発音評価APIの接続位置
    //   ここで audioBlob と sentence.ko（正解テキスト）を発音評価APIへ送信し、
    //   { total, accuracy, intonation, fluency, weakSyllables[] } などを受け取る。
    //   例:
    //   const fd = new FormData();
    //   fd.append("audio", audioBlob, "rec.webm");
    //   fd.append("reference", sentence.ko);
    //   const res = await fetch("https://<your-api>/v1/pronunciation", { method: "POST", body: fd });
    //   return await res.json();
    //   ※ APIキーはフロントに置かず、サーバー（またはサーバーレス関数）経由で呼ぶこと
    // ------------------------------------------------------------
    await new Promise(r => setTimeout(r, 900)); // 通信待ちの演出

    const rnd = (min, max) => Math.round(min + Math.random() * (max - min));
    // 録音が極端に短い場合は低めに（ダミーでも挙動が分かるように）
    const penalty = durationSec != null && durationSec < 1.5 ? 20 : 0;
    const accuracy = Math.max(30, rnd(68, 96) - penalty);
    const intonation = Math.max(30, rnd(62, 95) - penalty);
    const fluency = Math.max(30, rnd(60, 95) - penalty);
    const total = Math.round(accuracy * 0.5 + intonation * 0.25 + fluency * 0.25);
    return { total, accuracy, intonation, fluency, mock: true };
  }

  // ===== フィードバック文の生成と言語比率 =====
  // 各項目は ja / ko の両方を持ち、比率設定に応じてどちらで表示するかを決める。
  // jaPriority が小さい項目ほど日本語で表示されやすい（説明系 → 日本語、励まし系 → 韓国語）。
  // TODO(API): 本番では講師監修のテンプレートやLLM生成に置き換え可能
  function buildFeedback(result, sentence) {
    const items = [];
    if (result.total >= 85) {
      items.push({ jaPriority: 2, ja: "全体的にとても自然な発音です。この調子で続けましょう。", ko: "전체적으로 아주 자연스러워요. 이대로 계속해 봐요." });
    } else if (result.total >= 70) {
      items.push({ jaPriority: 2, ja: "意味はしっかり伝わります。下の2点を意識するとさらに自然になります。", ko: "뜻은 잘 전달돼요. 아래 두 가지를 신경 쓰면 더 자연스러워져요." });
    } else {
      items.push({ jaPriority: 2, ja: "まずはお手本を聞き、ゆっくり区切って読んでみましょう。", ko: "먼저 원어민 발음을 듣고 천천히 끊어서 읽어 봐요." });
    }
    sentence.points.forEach(p => {
      items.push({ jaPriority: 1, ja: `「${p.mark}」${p.ja}`, ko: `「${p.mark}」${p.ko}` });
    });
    const weakest = [["accuracy", result.accuracy], ["intonation", result.intonation], ["fluency", result.fluency]]
      .sort((a, b) => a[1] - b[1])[0][0];
    const weakTips = {
      accuracy: { ja: "パッチムの音が曖昧になりがちです。語尾まで口の形を保ちましょう。", ko: "받침 소리가 흐려지기 쉬워요. 끝까지 입 모양을 유지해 보세요." },
      intonation: { ja: "日本語より文末の上げ下げをはっきりさせると韓国語らしくなります。", ko: "문장 끝 억양을 조금 더 분명하게 하면 한국어답게 들려요." },
      fluency: { ja: "意味のかたまりごとに区切ると、なめらかに聞こえます。", ko: "의미 단위로 끊어 읽으면 더 매끄럽게 들려요." }
    };
    items.push(Object.assign({ jaPriority: 3 }, weakTips[weakest]));
    items.push({ jaPriority: 4, ja: "明日も1文だけ練習して、連続記録を伸ばしましょう！", ko: "내일도 한 문장만 연습해서 연속 기록을 늘려 봐요!" });

    const jaShare = state.ratio === "ja6" ? 0.6 : 0.4;
    const jaCount = Math.round(items.length * jaShare);
    const order = items.map((it, i) => i).sort((a, b) => items[a].jaPriority - items[b].jaPriority || a - b);
    order.forEach((i, rank) => { items[i].lang = rank < jaCount ? "ja" : "ko"; });
    return { items, jaCount, koCount: items.length - jaCount };
  }

  // ===== DOM =====
  const $ = id => document.getElementById(id);
  const el = {
    pointsTop: $("pointsTop"),
    koSentence: $("koSentence"), jaTranslation: $("jaTranslation"), pronPoints: $("pronPoints"), sentenceIndex: $("sentenceIndex"),
    btnModel: $("btnModel"), btnWordsFromTalk: $("btnWordsFromTalk"), btnToQuiz: $("btnToQuiz"),
    btnRec: $("btnRec"), recStatus: $("recStatus"), playback: $("playback"),
    btnEvaluate: $("btnEvaluate"), btnNoMic: $("btnNoMic"),
    recordCard: $("recordCard"), resultCard: $("resultCard"),
    scoreRing: $("scoreRing"), scoreTotal: $("scoreTotal"), subScores: $("subScores"),
    ratioNote: $("ratioNote"), feedbackList: $("feedbackList"), rewardBox: $("rewardBox"), btnRetry: $("btnRetry"),
    streakNum: $("streakNum"), pointsNum: $("pointsNum"), restNum: $("restNum"),
    calendar: $("calendar"), streakHint: $("streakHint"),
    exchangeCost: $("exchangeCost"), exchangeBar: $("exchangeBar"), exchangeHint: $("exchangeHint"),
    btnExchange: $("btnExchange"), requestList: $("requestList"),
    btnSkipDay: $("btnSkipDay"), btnAddPts: $("btnAddPts"), btnReset: $("btnReset"), demoToday: $("demoToday"),
    toast: $("toast"),
    inAppBanner: $("inAppBanner"), btnCopyUrl: $("btnCopyUrl"), ttsHelp: $("ttsHelp"),
    diag: $("diag"), diagUa: $("diagUa"),
    recTimer: $("recTimer"), recTimerBar: $("recTimerBar"), recCount: $("recCount"), sfxToggle: $("sfxToggle"),
    stepStart: $("stepStart"), stepWords: $("stepWords"),
    stepQuiz: $("stepQuiz"), stepScore: $("stepScore"), stepSentence: $("stepSentence"),
    startDate: $("startDate"), startIndex: $("startIndex"), startKo: $("startKo"), startJa: $("startJa"),
    startStreak: $("startStreak"), startDone: $("startDone"),
    btnStartWords: $("btnStartWords"), btnStartTalk: $("btnStartTalk"), btnStartNext: $("btnStartNext"),
    btnWordsClose: $("btnWordsClose"), wordsBar: $("wordsBar"), wordCard: $("wordCard"), wordTag: $("wordTag"),
    wordNo: $("wordNo"), wordKo: $("wordKo"), wordJa: $("wordJa"), wordHint: $("wordHint"), wordSentence: $("wordSentence"),
    btnWordPrev: $("btnWordPrev"), btnWordNext: $("btnWordNext"),
    quizTag: $("quizTag"), stepIcoWords: $("stepIcoWords"), btnSentenceHome: $("btnSentenceHome"),
    btnQuizClose: $("btnQuizClose"), quizBar: $("quizBar"), quizNo: $("quizNo"), quizWord: $("quizWord"),
    btnSkip: $("btnSkip"), quizOptions: $("quizOptions"),
    quizCorrect: $("quizCorrect"), quizTotal: $("quizTotal"), vocabScore: $("vocabScore"), scoreSub: $("scoreSub"),
    coachMsg: $("coachMsg"), reviewCard: $("reviewCard"), reviewList: $("reviewList"),
    btnScoreHome: $("btnScoreHome"), btnScoreNext: $("btnScoreNext")
  };

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  // ===== 画面切り替え =====
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${tab.dataset.view}`));
      if (tab.dataset.view === "streak") renderStreak();
      window.scrollTo(0, 0);
    });
  });

  // ===== 例文 =====
  const current = () => window.SENTENCES[state.idx % window.SENTENCES.length];
  function renderSentence() {
    const s = current();
    el.koSentence.textContent = s.ko;
    el.jaTranslation.textContent = s.ja;
    el.sentenceIndex.textContent = `${(state.idx % window.SENTENCES.length) + 1} / ${window.SENTENCES.length}`;
    el.pronPoints.innerHTML = "";
    s.points.forEach(p => {
      const li = document.createElement("li");
      li.innerHTML = `<strong lang="ko"></strong> <span></span>`;
      li.firstChild.textContent = p.mark;
      li.lastChild.textContent = p.ja;
      el.pronPoints.appendChild(li);
    });
  }

  // ===== 端末・ブラウザの対応状況 =====
  const UA = navigator.userAgent;
  // アプリ内ブラウザ（LINE / Instagram / Threads / Facebook / X / カカオトーク / NAVER など）
  const IN_APP = /\bLine\/|FBAN|FBAV|Instagram|Barcelona|Twitter|KAKAOTALK|NAVER\(|DaumApps|GSA\//i.test(UA);
  const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const HAS_GUM = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const HAS_MR = typeof window.MediaRecorder === "function";
  const HAS_WEBAUDIO = !!(window.AudioContext || window.webkitAudioContext);
  const HAS_TTS = "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
  const canRecord = HAS_GUM && (HAS_MR || HAS_WEBAUDIO);
  const koVoices = () => (HAS_TTS ? speechSynthesis.getVoices().filter(v => /^ko/i.test(v.lang)) : []);
  // 音声一覧は非同期で読み込まれる端末があるため、事前に一度読み込んでおく
  if (HAS_TTS) {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener("voiceschanged", () => renderDiagnostics());
  }

  if (IN_APP) {
    el.inAppBanner.hidden = false;
  }
  el.btnCopyUrl.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("URLをコピーしました。Safari / Chrome に貼り付けて開いてください");
    } catch (e) {
      prompt("このURLをコピーして Safari / Chrome で開いてください", location.href);
    }
  });

  // お手本音声
  // 1) data.js に audio（音声ファイルのパス）があればそれを再生（最も確実）
  // 2) なければブラウザ内蔵の音声合成（端末に韓国語音声が必要）
  // TODO(API): 本番ではネイティブ録音または ElevenLabs 等で生成した音声ファイルを audio/ に置き、data.js の audio に指定
  const modelAudio = new Audio();
  el.btnModel.addEventListener("click", () => {
    const s = current();
    if (s.audio) {
      modelAudio.src = s.audio;
      modelAudio.play().catch(() => toast("音声を再生できませんでした"));
      return;
    }
    if (!HAS_TTS) { showTtsHelp("このブラウザは音声読み上げに対応していません。"); return; }
    // iOS ではタップ操作の中で同期的に speak() を呼ぶ必要があるため、待たずにすぐ再生する
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(s.ko);
    u.lang = "ko-KR";
    u.rate = 0.9;
    const v = koVoices()[0];
    if (v) u.voice = v;
    let started = false;
    u.onstart = () => { started = true; };
    u.onerror = e => { if (e.error !== "interrupted" && e.error !== "canceled") showTtsHelp("音声の再生に失敗しました。"); };
    speechSynthesis.speak(u);
    setTimeout(() => {
      if (!started && !speechSynthesis.speaking) {
        showTtsHelp(koVoices().length ? "音声が再生されませんでした。" : "この端末に韓国語の読み上げ音声が見つかりません。");
      }
    }, 2500);
  });

  function showTtsHelp(reason) {
    const tips = [];
    if (IN_APP) tips.push("アプリ内ブラウザでは再生できないことがあります。Safari / Chrome で開いてください。");
    if (IS_IOS) tips.push("iPhone はマナーモード（消音スイッチ）だと読み上げ音が出ません。解除して音量を上げてください。");
    if (IS_IOS) tips.push("設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 韓国語 で音声を追加できます。");
    else tips.push("端末の設定で「テキスト読み上げ」に韓国語を追加してください。");
    el.ttsHelp.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = reason;
    const ul = document.createElement("ul");
    tips.forEach(t => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
    el.ttsHelp.append(p, ul);
    el.ttsHelp.hidden = false;
  }

  // ===== 録音 =====
  // MediaRecorder が使えれば利用し、無い端末（古い iOS など）では Web Audio で WAV を作る
  let rec = null, recBlob = null, recStart = 0, recDuration = null, recTimer = null, stream = null;

  function noRecordReason() {
    if (!window.isSecureContext) return "録音には https で開く必要があります";
    if (IN_APP) return "アプリ内ブラウザでは録音できません。Safari / Chrome で開いてください";
    return "このブラウザでは録音できません";
  }
  if (!canRecord) {
    el.btnNoMic.hidden = false;
    el.recStatus.textContent = noRecordReason();
  }

  function startMediaRecorder(s) {
    const chunks = [];
    const mr = new MediaRecorder(s);
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.start();
    return {
      stop: () => new Promise(resolve => {
        mr.onstop = () => resolve(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
        mr.stop();
      })
    };
  }

  function startWavRecorder(s) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(s);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const bufs = [];
    proc.onaudioprocess = e => bufs.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc);
    proc.connect(ctx.destination);
    return {
      stop: () => {
        proc.disconnect();
        src.disconnect();
        const rate = ctx.sampleRate;
        ctx.close();
        return Promise.resolve(encodeWav(bufs, rate));
      }
    };
  }

  function encodeWav(bufs, rate) {
    const len = bufs.reduce((n, b) => n + b.length, 0);
    const view = new DataView(new ArrayBuffer(44 + len * 2));
    const str = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); view.setUint32(4, 36 + len * 2, true); str(8, "WAVE");
    str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, "data"); view.setUint32(40, len * 2, true);
    let o = 44;
    bufs.forEach(b => b.forEach(x => { const v = Math.max(-1, Math.min(1, x)); view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }));
    return new Blob([view], { type: "audio/wav" });
  }

  function resetRecording() {
    recBlob = null; recDuration = null;
    el.playback.hidden = true;
    el.playback.removeAttribute("src");
    el.btnEvaluate.hidden = true;
    el.resultCard.hidden = true;
    el.recordCard.hidden = false;
    el.btnRec.classList.remove("recording");
    el.recStatus.textContent = canRecord ? "マイクをタップして録音" : noRecordReason();
  }

  async function stopRecording() {
    if (!rec) return;
    const r = rec;
    rec = null;
    clearInterval(recTimer);
    el.recTimer.hidden = true;
    recDuration = Math.min(MAX_REC_SEC, (Date.now() - recStart) / 1000);
    recBlob = await r.stop();
    stream.getTracks().forEach(t => t.stop());
    el.playback.src = URL.createObjectURL(recBlob);
    el.playback.hidden = false;
    el.btnEvaluate.hidden = false;
    el.btnRec.classList.remove("recording");
    el.btnRec.setAttribute("aria-label", "録音し直す");
    el.recStatus.textContent = `録音完了（${recDuration.toFixed(1)}秒）。もう一度タップで録り直し`;
  }

  el.btnRec.addEventListener("click", async () => {
    if (!canRecord) { toast(noRecordReason()); return; }
    if (rec) { stopRecording(); return; }
    sfx.unlock();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      el.btnNoMic.hidden = false;
      el.recStatus.textContent = e && e.name === "NotAllowedError"
        ? "マイクの使用が許可されませんでした（ブラウザの設定で許可してください）"
        : "マイクを起動できませんでした";
      return;
    }
    try {
      rec = HAS_MR ? startMediaRecorder(stream) : startWavRecorder(stream);
    } catch (e) {
      // MediaRecorder があっても形式非対応で失敗する端末向けに WAV で再試行
      rec = HAS_WEBAUDIO ? startWavRecorder(stream) : null;
      if (!rec) { el.recStatus.textContent = "録音を開始できませんでした"; el.btnNoMic.hidden = false; return; }
    }
    recStart = Date.now();
    el.btnRec.classList.add("recording");
    el.btnRec.setAttribute("aria-label", "録音停止");
    el.playback.hidden = true;
    el.btnEvaluate.hidden = true;
    // 残り時間のバーが減っていき、最後の3秒だけ小さな数字と小さな音で知らせる
    let lastCount = null;
    el.recTimer.hidden = false;
    el.recTimerBar.style.width = "100%";
    el.recCount.textContent = "";
    el.recStatus.textContent = "録音中…（タップで停止）";
    recTimer = setInterval(() => {
      const left = Math.max(0, MAX_REC_SEC - (Date.now() - recStart) / 1000);
      el.recTimerBar.style.width = `${(left / MAX_REC_SEC) * 100}%`;
      const count = Math.ceil(left);
      if (count <= COUNTDOWN_FROM && count > 0 && count !== lastCount) {
        lastCount = count;
        el.recCount.textContent = count;
        el.recCount.classList.remove("pop");
        void el.recCount.offsetWidth;
        el.recCount.classList.add("pop");
        sfx.tick();
      }
      if (left <= 0) stopRecording();
    }, 50);
  });

  // ===== 対応状況の表示（設定タブ） =====
  function renderDiagnostics() {
    const mark = ok => (ok ? "○" : "×");
    const rows = [
      ["ブラウザ", IN_APP ? "アプリ内ブラウザ" : "通常ブラウザ"],
      ["https 接続", mark(window.isSecureContext)],
      ["マイク取得", mark(HAS_GUM)],
      ["録音方式", HAS_MR ? "MediaRecorder" : HAS_WEBAUDIO ? "WAV（互換モード）" : "×"],
      ["音声読み上げ", mark(HAS_TTS)],
      ["韓国語の読み上げ音声", HAS_TTS ? `${koVoices().length} 件` : "×"]
    ];
    el.diag.innerHTML = "";
    rows.forEach(([k, v]) => {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      el.diag.append(dt, dd);
    });
    el.diagUa.textContent = UA;
  }

  el.btnEvaluate.addEventListener("click", () => runEvaluation(recBlob, recDuration));
  el.btnNoMic.addEventListener("click", () => runEvaluation(null, null));
  el.btnRetry.addEventListener("click", () => { resetRecording(); el.recordCard.scrollIntoView({ behavior: "smooth" }); });

  async function runEvaluation(blob, duration) {
    el.btnEvaluate.disabled = true;
    el.btnNoMic.disabled = true;
    el.recStatus.textContent = "評価中…";
    const result = await evaluatePronunciation(blob, current(), duration);
    el.btnEvaluate.disabled = false;
    el.btnNoMic.disabled = false;
    renderResult(result);
    const ci = checkIn();
    renderReward(ci);
    renderPoints();
  }

  function renderResult(result) {
    el.recordCard.hidden = true;
    el.resultCard.hidden = false;
    el.scoreTotal.textContent = result.total;
    el.scoreRing.style.setProperty("--p", result.total);
    el.subScores.innerHTML = "";
    [["正確さ", result.accuracy], ["抑揚", result.intonation], ["流暢さ", result.fluency]].forEach(([label, v]) => {
      const d = document.createElement("div");
      d.className = "sub";
      d.innerHTML = `<span class="sub-label"></span><div class="bar"><i style="width:${v}%"></i></div><span class="sub-val">${v}</span>`;
      d.firstChild.textContent = label;
      el.subScores.appendChild(d);
    });

    const fb = buildFeedback(result, current());
    el.ratioNote.textContent = `言語バランス：日本語 ${fb.jaCount} ／ 韓国語 ${fb.koCount}（${state.ratio === "ja6" ? "6:4" : "4:6"}）`;
    el.feedbackList.innerHTML = "";
    fb.items.forEach(it => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      const show = lang => {
        li.dataset.lang = lang;
        li.lang = lang;
        li.innerHTML = `<span class="lang-chip">${lang === "ja" ? "日" : "한"}</span><span class="fb-text"></span>`;
        li.lastChild.textContent = it[lang];
      };
      show(it.lang);
      const toggle = () => show(li.dataset.lang === "ja" ? "ko" : "ja");
      li.addEventListener("click", toggle);
      li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      el.feedbackList.appendChild(li);
    });
    el.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderReward(ci) {
    const box = el.rewardBox;
    box.hidden = false;
    if (ci.already) {
      box.innerHTML = "今日の出席は記録済みです。何度でも練習できます。";
      return;
    }
    const lines = [`🔥 出席 ${state.streak}日目！ <strong>+${ci.gained}pt</strong>`];
    if (ci.bonus) lines.push(`🎉 ${STREAK_BONUS_EVERY}日連続ボーナス +${STREAK_BONUS}pt`);
    if (ci.usedRest) lines.push("💤 昨日の分は休息券で連続記録を守りました");
    box.innerHTML = lines.join("<br>");
    toast(`+${ci.gained}pt 獲得`);
  }

  // ===== 出席画面 =====
  function renderPoints() {
    el.pointsTop.textContent = state.points;
  }

  function renderStreak() {
    const t = today();
    const st = streakStatus();
    el.streakNum.textContent = st.streak;
    el.pointsNum.textContent = state.points;
    el.restNum.textContent = restAvailable(t) ? "1" : "0";
    el.demoToday.textContent = t;

    el.calendar.innerHTML = "";
    const dows = ["日", "月", "火", "水", "木", "金", "土"];
    for (let i = 13; i >= 0; i--) {
      const k = addDays(t, -i);
      const mark = state.history[k] === "check" ? "✅" : state.history[k] === "rest" ? "💤" : "・";
      const d = document.createElement("div");
      d.className = "day" + (k === t ? " today" : "");
      d.innerHTML = `<small>${dows[fromKey(k).getDay()]}</small><b>${fromKey(k).getDate()}</b><span>${mark}</span>`;
      el.calendar.appendChild(d);
    }

    if (state.last === t) el.streakHint.textContent = "今日の練習は完了！また明日。";
    else if (st.needsRest) el.streakHint.textContent = "昨日は練習なし。今日練習すれば休息券で連続記録が守られます。";
    else if (st.alive) el.streakHint.textContent = "今日の1文でまだ連続記録をつなげられます。";
    else if (state.last) el.streakHint.textContent = "連続記録が途切れました。今日からまた始めましょう。";
    else el.streakHint.textContent = "最初の1文を録音して出席をスタート！";

    // 講師フィードバック交換
    el.exchangeCost.textContent = EXCHANGE_COST;
    const pct = Math.min(100, Math.round(state.points / EXCHANGE_COST * 100));
    el.exchangeBar.style.width = pct + "%";
    const can = state.points >= EXCHANGE_COST;
    el.btnExchange.disabled = !can;
    el.exchangeHint.textContent = can
      ? "交換できます！"
      : `あと ${EXCHANGE_COST - state.points}pt で交換できます`;

    el.requestList.innerHTML = "";
    state.requests.slice().reverse().forEach(r => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="req-date"></span><span class="req-text" lang="ko"></span><span class="req-status"></span>`;
      li.children[0].textContent = r.date;
      li.children[1].textContent = r.sentence;
      li.children[2].textContent = r.status;
      el.requestList.appendChild(li);
    });
    renderPoints();
  }

  el.btnExchange.addEventListener("click", () => {
    if (state.points < EXCHANGE_COST) return;
    if (!confirm(`${EXCHANGE_COST}pt を使って、講師1:1フィードバックを申請しますか？`)) return;
    // ------------------------------------------------------------
    // TODO(API): 講師フィードバック申請の接続位置
    //   ここで最新の録音・例文・ユーザーIDを予約/申請APIへ送信し、
    //   ポイント減算はサーバー側で確定させる（二重申請・不正防止）。
    // ------------------------------------------------------------
    state.points -= EXCHANGE_COST;
    state.requests.push({ date: today(), sentence: current().ko, status: "受付済み（デモ）" });
    save();
    renderStreak();
    toast("申請しました。講師から48時間以内に返信が届きます（デモ）");
  });

  // ===== デモ用操作 =====
  el.btnSkipDay.addEventListener("click", () => {
    state.dayOffset += 1;
    save();
    resetRecording();
    renderStreak();
    toast(`デモ上の日付を ${today()} にしました`);
  });
  el.btnAddPts.addEventListener("click", () => { state.points += 100; save(); renderStreak(); });
  el.btnReset.addEventListener("click", () => {
    if (!confirm("デモのデータをすべてリセットしますか？")) return;
    state = defaultState();
    save();
    resetRecording();
    renderSentence();
    goStart();
    renderStreak();
    syncRatio();
  });

  // ===== 設定 =====
  el.sfxToggle.addEventListener("change", () => {
    state.sfx = el.sfxToggle.checked;
    save();
    if (state.sfx) { sfx.unlock(); sfx.correct(); }
  });

  function syncRatio() {
    el.sfxToggle.checked = state.sfx !== false;
    document.querySelectorAll('input[name="ratio"]').forEach(r => { r.checked = r.value === state.ratio; });
  }
  document.querySelectorAll('input[name="ratio"]').forEach(r => {
    r.addEventListener("change", () => {
      state.ratio = r.value;
      save();
      toast(r.value === "ja6" ? "日本語6：韓国語4 に設定しました" : "日本語4：韓国語6 に設定しました");
    });
  });

  // ===== レッスンの流れ =====
  // スタート画面 →（じっくり単語練習 →）会話練習（例文・録音・フィードバック）→ 関連単語クイズ → 採点表
  const QUIZ_POINTS_PER_CORRECT = 2;
  let quiz = null;          // { items: [{ko, ja, inSentence, options[]}], i, answers: [bool] }
  let wordIdx = 0;          // じっくり単語練習の現在位置
  let wordsStudied = false; // このレッスンで単語練習をしたか
  let wordsReturn = "sentence"; // 単語練習を終えた後の行き先

  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const tagLabel = w => (w.inSentence ? "例文の単語" : "関連する新しい単語");
  const setTag = (node, w) => { node.textContent = tagLabel(w); node.classList.toggle("new", !w.inSentence); };

  function showStep(step) {
    const practiceTab = document.querySelector('.tab[data-view="practice"]');
    if (!practiceTab.classList.contains("active")) practiceTab.click();
    ["Start", "Words", "Sentence", "Quiz", "Score"].forEach(k => {
      el[`step${k}`].hidden = step !== k.toLowerCase();
    });
    document.body.classList.toggle("focus", step === "quiz" || step === "words");
    window.scrollTo(0, 0);
  }

  // ----- スタート画面 -----
  function goStart() {
    const s = current();
    const n = window.SENTENCES.length;
    const d = fromKey(today());
    el.startDate.textContent = `${d.getMonth() + 1}月${d.getDate()}日`;
    el.startIndex.textContent = `${(state.idx % n) + 1} / ${n}`;
    el.startKo.textContent = s.ko;
    el.startJa.textContent = s.ja;
    const st = streakStatus();
    el.startStreak.textContent = `🔥 連続 ${st.streak}日`;
    el.startDone.textContent = state.last === today() ? "✅ 今日の出席 完了" : "今日はまだ未出席";
    wordsStudied = false;
    resetRecording();
    showStep("start");
  }

  function nextLesson() {
    state.idx = (state.idx + 1) % window.SENTENCES.length;
    save();
    renderSentence();
    goStart();
  }

  el.btnStartWords.addEventListener("click", () => startWords("sentence"));
  el.btnStartTalk.addEventListener("click", goSentence);
  el.btnStartNext.addEventListener("click", nextLesson);

  // ----- じっくり単語練習 -----
  function startWords(returnTo) {
    wordsReturn = returnTo;
    wordIdx = 0;
    showStep("words");
    renderWord();
  }

  function renderWord() {
    const words = current().words;
    const w = words[wordIdx];
    el.wordsBar.style.width = `${((wordIdx + 1) / words.length) * 100}%`;
    el.wordNo.textContent = `${wordIdx + 1} / ${words.length}`;
    el.wordKo.textContent = w.ko;
    el.wordJa.textContent = w.ja;
    el.wordJa.hidden = true;
    el.wordHint.hidden = false;
    setTag(el.wordTag, w);
    el.wordSentence.textContent = w.inSentence ? current().ko : "";
    el.wordSentence.hidden = true;
    el.btnWordPrev.disabled = wordIdx === 0;
    el.btnWordNext.textContent = wordIdx === words.length - 1 ? "会話練習へ →" : "次へ →";
  }

  el.wordCard.addEventListener("click", () => {
    el.wordJa.hidden = false;
    el.wordHint.hidden = true;
    el.wordSentence.hidden = !current().words[wordIdx].inSentence;
  });
  el.btnWordPrev.addEventListener("click", () => { if (wordIdx > 0) { wordIdx--; renderWord(); } });
  el.btnWordNext.addEventListener("click", () => {
    if (wordIdx < current().words.length - 1) { wordIdx++; renderWord(); return; }
    wordsStudied = true;
    goSentence();
  });
  el.btnWordsClose.addEventListener("click", () => {
    if (wordsReturn === "sentence" && el.resultCard.hidden && !wordsStudied) goStart();
    else showStep("sentence");
  });

  // ----- 会話練習 -----
  function goSentence() {
    showStep("sentence");
  }
  el.btnSentenceHome.addEventListener("click", goStart);
  el.btnWordsFromTalk.addEventListener("click", () => startWords("talk"));
  el.btnToQuiz.addEventListener("click", startQuiz);

  // ----- 関連単語クイズ（例文の単語4語 ＋ 関連する新しい単語6語） -----
  function startQuiz() {
    const words = current().words;
    // 例文の単語を先に、関連する新しい単語を後に出す（それぞれの中ではランダム）
    const ordered = [...shuffle(words.filter(w => w.inSentence)), ...shuffle(words.filter(w => !w.inSentence))];
    const items = ordered.map(w => ({
      ko: w.ko,
      ja: w.ja,
      inSentence: !!w.inSentence,
      options: shuffle([w.ja, ...shuffle(words.filter(x => x.ja !== w.ja)).slice(0, 3).map(x => x.ja)])
    }));
    quiz = { items, i: 0, answers: [] };
    showStep("quiz");
    renderQuestion();
  }

  function renderQuestion() {
    const q = quiz.items[quiz.i];
    const n = quiz.items.length;
    el.quizBar.style.width = `${(quiz.i / n) * 100}%`;
    el.quizNo.textContent = `${quiz.i + 1} / ${n}`;
    el.quizWord.textContent = q.ko;
    setTag(el.quizTag, q);
    el.quizOptions.innerHTML = "";
    q.options.forEach((opt, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.innerHTML = `<span class="num">${k + 1}</span><span class="opt-text"></span>`;
      b.lastChild.textContent = opt;
      b.addEventListener("click", () => answer(opt, b));
      el.quizOptions.appendChild(b);
    });
    el.btnSkip.disabled = false;
  }

  function answer(choice, btn) {
    const q = quiz.items[quiz.i];
    const ok = choice === q.ja;
    if (ok) sfx.correct(); else sfx.wrong();
    quiz.answers[quiz.i] = ok;
    el.btnSkip.disabled = true;
    el.quizOptions.querySelectorAll(".opt").forEach(b => {
      b.disabled = true;
      if (b.lastChild.textContent === q.ja) b.classList.add("correct");
    });
    if (btn && !ok) btn.classList.add("wrong");
    setTimeout(nextQuestion, ok ? 600 : 1100);
  }

  function nextQuestion() {
    quiz.i++;
    if (quiz.i < quiz.items.length) renderQuestion();
    else finishQuiz();
  }

  el.btnSkip.addEventListener("click", () => answer(null, null));
  el.btnQuizClose.addEventListener("click", () => {
    if (!confirm("単語クイズを終了して採点しますか？（未回答は不正解になります）")) return;
    finishQuiz();
  });

  function finishQuiz() {
    const n = quiz.items.length;
    const correct = quiz.answers.filter(Boolean).length;
    const score = Math.round((correct / n) * 100);
    const prev = state.lastQuizScore;
    // クイズのポイントは1日1回だけ
    let gained = 0;
    if (state.quizDate !== today()) {
      gained = correct * QUIZ_POINTS_PER_CORRECT;
      state.points += gained;
      state.quizDate = today();
    }
    state.lastQuizScore = score;
    save();
    renderPoints();
    renderScoreSheet({ correct, n, score, prev, gained });
    showStep("score");
  }

  function coachMessage(score, prev) {
    if (prev != null && score > prev) return { ja: `前回より ${score - prev} 点アップ！この調子で続けよう！`, ko: `지난번보다 ${score - prev}점 올랐어요! 이대로 계속해 봐요!` };
    if (score === 100) return { ja: "全問正解！完璧です。明日もこの調子で！", ko: "만점이에요! 완벽해요. 내일도 이렇게 해 봐요!" };
    if (score >= 70) return { ja: "いい感じ！間違えた単語だけ見直しておこう。", ko: "좋아요! 틀린 단어만 다시 봐 둬요." };
    return { ja: "大丈夫、ここからです。次は「じっくり単語練習」から始めてみよう！", ko: "괜찮아요, 지금부터예요. 다음에는 '단어 연습'부터 시작해 봐요!" };
  }

  function renderScoreSheet({ correct, n, score, prev, gained }) {
    el.stepIcoWords.classList.toggle("done", wordsStudied);
    el.quizCorrect.textContent = correct;
    el.quizTotal.textContent = n;
    el.vocabScore.textContent = score;
    const inS = quiz.items.map((q, k) => [q, quiz.answers[k]]);
    const cIn = inS.filter(([q, ok]) => q.inSentence && ok).length;
    const cNew = inS.filter(([q, ok]) => !q.inSentence && ok).length;
    const parts = [`例文の単語 ${cIn}/4・新しい単語 ${cNew}/6`];
    if (prev != null) parts.push(`前回 ${prev}`);
    parts.push(gained ? `+${gained}pt` : "本日のpt獲得済み");
    el.scoreSub.textContent = parts.join("　/　");
    // 吹き出しは言語バランス設定に合わせて主言語を決め、もう一方を小さく添える
    const msg = coachMessage(score, prev);
    const main = state.ratio === "ja6" ? "ja" : "ko";
    const sub = main === "ja" ? "ko" : "ja";
    el.coachMsg.innerHTML = "<span></span><small></small>";
    el.coachMsg.firstChild.textContent = msg[main];
    el.coachMsg.firstChild.lang = main;
    el.coachMsg.lastChild.textContent = msg[sub];
    el.coachMsg.lastChild.lang = sub;

    const wrong = quiz.items.filter((q, k) => !quiz.answers[k]);
    el.reviewCard.hidden = wrong.length === 0;
    el.reviewList.innerHTML = "";
    wrong.forEach(q => {
      const li = document.createElement("li");
      li.innerHTML = "<b lang=\"ko\"></b><span></span>";
      li.firstChild.textContent = q.ko;
      li.lastChild.textContent = q.ja;
      el.reviewList.appendChild(li);
    });
  }

  el.btnScoreHome.addEventListener("click", goStart);
  el.btnScoreNext.addEventListener("click", nextLesson);

  // ===== 初期表示 =====
  syncRatio();
  renderSentence();
  renderStreak();
  renderDiagnostics();
  goStart();
})();
