(() => {
  "use strict";

  // ===== 設定値 =====
  const POINTS_PER_DAY = 10;
  const STREAK_BONUS_EVERY = 7;
  const STREAK_BONUS = 30;
  const EXCHANGE_COST = 300;
  const STORAGE_KEY = "kotalk-demo-v1";
  // サーバー（worker/）の設定は config.js。apiBase が空なら、これまでどおり端末の中だけで動く
  const CFG = window.KOTALK_CONFIG || {};
  const API_BASE = (CFG.apiBase || "").trim().replace(/\/+$/, "");
  // AI判定の接続先（空なら、これまでの簡易判定〔文末・キーワード〕だけで動く）
  const AI_ENDPOINT = API_BASE ? (CFG.aiJudge !== false ? `${API_BASE}/judge` : "") : (CFG.aiEndpoint || "").trim();
  // 学習記録（クラスコードで登録し、同意した人の分だけ保存する）
  const RECORDS_ON = !!API_BASE && CFG.records !== false;
  const AI_TIMEOUT_MS = 15000;

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
    completed: {},       // 完了したレッスン { レッスン番号: { date, score } }
    mada: {},            // 単語カードで「まだ」にした単語 { レッスン番号: [ko, ...] }
    quizDate: null,      // 単語テストを最後に受けた日（ポイントは1日1回）
    lastQuizScore: null,
    goal: 15,            // 1日の目標（分）
    practice: {},        // 練習時間 { "YYYY-MM-DD": 秒 }
    sessions: [],        // 最近の練習 [{ theme, date, sec, ok, turns }]
    level: "中級",        // ホームで選んでいるレベル
    talkDone: {},        // 会話を終えたテーマ { themeId: { date, ok, turns } }
    ai: true,            // 会話の返事を AI（Claude）で判定する
    records: null        // 学習記録 { status: "registered" | "declined", token, classCode, type, learnerId, research, profile }
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

  // ===== 効果音（ElevenLabs で生成した mp3：audio/sfx/） =====
  // Web Audio は iPhone の消音スイッチで無音になるため、<audio> 要素で再生する。
  // iOS は volume 指定が効かないので、音量はファイル側で小さめに調整済み。
  const sfx = (() => {
    const files = { correct: "audio/sfx/correct.mp3", wrong: "audio/sfx/wrong.mp3" };
    const players = {};
    Object.entries(files).forEach(([k, src]) => {
      const a = new Audio(src);
      a.preload = "auto";
      players[k] = a;
    });
    let unlocked = false;
    // iOS ではタップ操作の中で一度再生しておかないと、後からの再生（会話の効果音など）が許可されない
    function unlock() {
      if (unlocked) return;
      unlocked = true;
      Object.values(players).forEach(a => {
        a.muted = true;
        const p = a.play();
        // 本番の再生が先に始まっていたら止めない（muted のままなら解除用の再生）
        const reset = () => { if (a.muted) { a.pause(); a.currentTime = 0; a.muted = false; } };
        if (p && p.then) p.then(reset).catch(() => { a.muted = false; unlocked = false; });
        else reset();
      });
    }
    function play(k) {
      if (!state.sfx) return;
      const a = players[k];
      try {
        a.muted = false;
        a.pause();
        a.currentTime = 0;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* 再生できない端末では何もしない */ }
    }
    return {
      unlock,
      correct: () => play("correct"), // 딩동댕
      wrong: () => play("wrong")      // 띵-!
    };
  })();
  // 最初のタップで効果音を使えるようにしておく
  document.addEventListener("pointerdown", () => sfx.unlock(), { once: true, capture: true });

  // ===== DOM =====
  const $ = id => document.getElementById(id);
  const el = {
    pointsTop: $("pointsTop"),
    koSentence: $("koSentence"), jaTranslation: $("jaTranslation"), pronPoints: $("pronPoints"), sentenceIndex: $("sentenceIndex"),
    btnModel: $("btnModel"), btnExpl: $("btnExpl"), explBox: $("explBox"), explSummary: $("explSummary"), explGrammar: $("explGrammar"), btnToQuiz: $("btnToQuiz"),
    streakNum: $("streakNum"), pointsNum: $("pointsNum"), restNum: $("restNum"),
    calendar: $("calendar"), streakHint: $("streakHint"),
    exchangeCost: $("exchangeCost"), exchangeBar: $("exchangeBar"), exchangeHint: $("exchangeHint"),
    btnExchange: $("btnExchange"), requestList: $("requestList"),
    btnSkipDay: $("btnSkipDay"), btnAddPts: $("btnAddPts"), btnReset: $("btnReset"), demoToday: $("demoToday"),
    toast: $("toast"),
    inAppBanner: $("inAppBanner"), btnCopyUrl: $("btnCopyUrl"), ttsHelp: $("ttsHelp"),
    diag: $("diag"), diagUa: $("diagUa"),
    // 学習記録
    btnConsentBack: $("btnConsentBack"), recStatusCard: $("recStatusCard"), recStatusText: $("recStatusText"), btnRecDelete: $("btnRecDelete"),
    consentForm: $("consentForm"), consentBody: $("consentBody"), recClass: $("recClass"), recId: $("recId"),
    recIdLabel: $("recIdLabel"), recIdHint: $("recIdHint"), profileFields: $("profileFields"),
    pfGender: $("pfGender"), pfAge: $("pfAge"), pfExp: $("pfExp"), pfRegion: $("pfRegion"),
    consentText: $("consentText"), recAgree: $("recAgree"), recResearch: $("recResearch"), recResearchLabel: $("recResearchLabel"),
    recError: $("recError"), btnRecSubmit: $("btnRecSubmit"), btnRecSkip: $("btnRecSkip"),
    recSettingsCard: $("recSettingsCard"), recSettingsText: $("recSettingsText"), btnRecOpen: $("btnRecOpen"),
    sfxToggle: $("sfxToggle"), aiToggle: $("aiToggle"), aiStatus: $("aiStatus"), btnAiTest: $("btnAiTest"),
    stepWords: $("stepWords"),
    stepQuiz: $("stepQuiz"), stepScore: $("stepScore"), stepSentence: $("stepSentence"),
    btnWordsClose: $("btnWordsClose"), wordsBar: $("wordsBar"), wordTag: $("wordTag"),
    wordNo: $("wordNo"), wordKo: $("wordKo"), wordJa: $("wordJa"), wordKana: $("wordKana"), wordSentence: $("wordSentence"),
    btnWordSpeak: $("btnWordSpeak"), btnReveal: $("btnReveal"), wordBack: $("wordBack"),
    rateRow: $("rateRow"), btnMada: $("btnMada"), btnOboeta: $("btnOboeta"),
    btnWordPrev: $("btnWordPrev"), btnWordNext: $("btnWordNext"),
    quizFeedback: $("quizFeedback"), qfTitle: $("qfTitle"), qfAnswer: $("qfAnswer"), qfEx: $("qfEx"), btnQuizNext: $("btnQuizNext"),
    quizTag: $("quizTag"), stepIcoWords: $("stepIcoWords"), btnSentenceHome: $("btnSentenceHome"),
    btnQuizClose: $("btnQuizClose"), quizBar: $("quizBar"), quizNo: $("quizNo"), quizWord: $("quizWord"),
    btnSkip: $("btnSkip"), quizOptions: $("quizOptions"),
    quizCorrect: $("quizCorrect"), quizTotal: $("quizTotal"), vocabScore: $("vocabScore"), scoreSub: $("scoreSub"),
    coachMsg: $("coachMsg"), reviewCard: $("reviewCard"), reviewList: $("reviewList"),
    btnScoreHome: $("btnScoreHome"), stepIcoTalk: $("stepIcoTalk"),
    btnSettings: $("btnSettings"), btnSettingsBack: $("btnSettingsBack"),
    // ホーム
    todayMin: $("todayMin"), goalMin: $("goalMin"), todayBar: $("todayBar"), chipStreak: $("chipStreak"), chipWeek: $("chipWeek"),
    btnHeroStart: $("btnHeroStart"), heroNote: $("heroNote"), themeList: $("themeList"), recentList: $("recentList"),
    // 会話
    talkMain: $("talkMain"), talkSummary: $("talkSummary"), talkTitle: $("talkTitle"), talkLevel: $("talkLevel"),
    talkRemain: $("talkRemain"), talkElapsed: $("talkElapsed"), btnTalkEnd: $("btnTalkEnd"), talkPartner: $("talkPartner"),
    autoRead: $("autoRead"), exprBox: $("exprBox"), exprList: $("exprList"), chatLog: $("chatLog"),
    talkInput: $("talkInput"), btnTalkMic: $("btnTalkMic"), btnTalkSend: $("btnTalkSend"), btnHint: $("btnHint"), micStatus: $("micStatus"),
    sumTheme: $("sumTheme"), sumTime: $("sumTime"), sumTurns: $("sumTurns"), sumOk: $("sumOk"), sumReward: $("sumReward"),
    sumReplies: $("sumReplies"), btnSumPron: $("btnSumPron"), btnSumQuiz: $("btnSumQuiz"), btnSumRetry: $("btnSumRetry"), btnSumHome: $("btnSumHome"),
    // 復習・記録
    reviewThemes: $("reviewThemes"),
    recToday: $("recToday"), recWeek: $("recWeek"), rec4w: $("rec4w"), weekBars: $("weekBars")
  };

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  // ===== 画面切り替え =====
  // タブ：ホーム / 復習 / 記録。会話・テーマの練習・設定はタブを持たない画面
  let currentView = "home";
  let prevView = "home";
  function showView(name) {
    if (name !== currentView) prevView = currentView;
    currentView = name;
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
    document.body.classList.toggle("focus", (name === "talk" && !el.talkMain.hidden) || (name === "practice" && practiceFocus));
    if (name === "home") renderHome();
    if (name === "review") renderReview();
    if (name === "record") renderStreak();
    if (name === "settings") { renderRecSettings(); renderDiagnostics(); }
    window.scrollTo(0, 0);
  }
  let practiceFocus = false;
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
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

  // ===== 録音できない理由（会話の🎤で表示） =====
  function noRecordReason() {
    if (!window.isSecureContext) return "録音するには https で開く必要があります。";
    if (IN_APP) return "アプリ内ブラウザでは録音できません。Safari / Chrome で開いてください。";
    // iPhone で https なのにマイクの機能自体が無い → ロックダウンモードでブロックされている可能性が高い
    // 方針：このアプリを使うときは一時的にオフにしてもらう。不安な人にはパソコンを勧める（学習者向けなので日本語）
    if (IS_IOS && !HAS_GUM) {
      return "iPhoneの「ロックダウンモード」がオンになっているため、マイクが使えません。" +
        "声で練習するときは、ロックダウンモードを一時的にオフにしてください（設定 →「プライバシーとセキュリティ」→「ロックダウンモード」）。" +
        "オフにするのが不安な場合は、パソコンで開くのがいちばん簡単です。";
    }
    return "このブラウザでは録音できません。";
  }
  // MediaRecorder が使えれば利用し、無い端末（古い iOS など）では Web Audio で WAV を作る
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

  // ===== 対応状況の表示（設定タブ） =====
  // ブラウザごとのマイク許可の手順（1行）
  function micHowTo() {
    if (IN_APP) return "Safari / Chrome で開き直してください。";
    if (IS_IOS) return "許可するには：アドレスバーの「ぁあ」→「Webサイトの設定」→「マイク」→「許可」";
    if (/Android/i.test(UA)) return "許可するには：アドレスバー左のアイコン →「権限」→「マイク」→「許可」";
    return "許可するには：アドレスバー左のアイコン → マイクを「許可」→ ページを再読み込み";
  }

  // マイクの実際の権限状態（Permissions API）。非対応ブラウザでは "unknown"
  let micPerm = "unknown";
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "microphone" }).then(st => {
      micPerm = st.state;
      renderDiagnostics();
      st.onchange = () => { micPerm = st.state; renderDiagnostics(); };
    }).catch(() => {});
  }
  const micPermLabel = () => ({
    granted: "許可済み",
    denied: "未許可（拒否されています）",
    prompt: "未許可（録音時に確認されます）"
  }[micPerm] || (HAS_GUM ? "不明（録音時に確認されます）" : "×（このブラウザは非対応）"));

  function renderDiagnostics() {
    const mark = ok => (ok ? "○" : "×");
    const rows = [
      ["ブラウザ", IN_APP ? "アプリ内ブラウザ" : "通常ブラウザ"],
      ["https 接続", mark(window.isSecureContext)],
      ["マイク機能", HAS_GUM ? "○" : (IS_IOS && window.isSecureContext ? "×（ロックダウンモードの可能性）" : "×")],
      ["マイクの権限", micPermLabel()],
      ["録音方式", HAS_MR ? "MediaRecorder" : HAS_WEBAUDIO ? "WAV（互換モード）" : "×"],
      ["AI判定", !AI_ENDPOINT ? "未設定（簡易判定）" : state.ai !== false ? "オン" : "オフ"],
      ["学習記録", !RECORDS_ON ? "使わない設定" : recRegistered() ? `登録済み（${state.records.classCode}）` : "未登録"],
      ["音声の文字起こし", !(window.SpeechRecognition || window.webkitSpeechRecognition) ? "×（録音だけ。判定なし）" : IS_IOS ? "○（音声認識のみ。iPhone では録音しない）" : "○（ブラウザの音声認識）"],
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

  // ===== 出席画面 =====
  function renderPoints() {
    el.pointsTop.textContent = state.points;
  }

  function renderStreak() {
    const t = today();
    renderMinutes();
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
    else if (st.alive) el.streakHint.textContent = "今日の会話練習で、まだ連続記録をつなげられます。";
    else if (state.last) el.streakHint.textContent = "連続記録が途切れました。今日からまた始めましょう。";
    else el.streakHint.textContent = "テーマを選んで会話を最後まで終えると出席になります。";

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
    renderStreak();
    toast(`デモ上の日付を ${today()} にしました`);
  });
  el.btnAddPts.addEventListener("click", () => { state.points += 100; save(); renderStreak(); });
  el.btnReset.addEventListener("click", () => {
    if (!confirm("デモのデータをすべてリセットしますか？")) return;
    // 学習記録の登録はサーバー側の記録と結び付いているので、リセットしても残す
    const records = state.records;
    state = defaultState();
    state.records = records;
    save();
    renderSentence();
    renderStreak();
    syncRatio();
    showView("home");
  });

  // ===== 設定 =====
  el.sfxToggle.addEventListener("change", () => {
    state.sfx = el.sfxToggle.checked;
    save();
    if (state.sfx) { sfx.unlock(); sfx.correct(); }
  });

  // AI判定のオン・オフと接続の確認
  function renderAiStatus() {
    el.aiToggle.checked = state.ai !== false;
    el.aiToggle.disabled = !AI_ENDPOINT;
    el.btnAiTest.hidden = !AI_ENDPOINT;
    el.aiStatus.textContent = !AI_ENDPOINT
      ? "AIの接続先がまだ設定されていません。今は簡易判定（文末・キーワード）で確認しています。"
      : state.ai !== false
        ? "オン：返事の文をAI（Claude）に送って判定します。"
        : "オフ：簡易判定（文末・キーワード）で確認します。";
  }
  el.aiToggle.addEventListener("change", () => {
    state.ai = el.aiToggle.checked;
    save();
    renderAiStatus();
    renderDiagnostics();
  });
  el.btnAiTest.addEventListener("click", async () => {
    el.btnAiTest.disabled = true;
    el.aiStatus.textContent = "接続を確認しています…";
    try {
      const r = await callAi({
        theme: "接続テスト", level: "初級", partner: "민지（韓国人の友達）", voice: false, history: [],
        turn: { ko: "이름이 뭐예요?", ja: "お名前は？", hint_ko: "저는 다나카예요.", hint_ja: "名前を言いましょう。", require: false, keywords: [] },
        reply: "저는 다나카예요."
      });
      renderAiStatus();
      toast(`AIに接続できました（判定：${r.verdict}）`);
    } catch (e) {
      renderAiStatus();
      el.aiStatus.textContent += " ※ 接続できませんでした。時間をおいて試すか、管理者に連絡してください。";
    } finally {
      el.btnAiTest.disabled = false;
    }
  });

  function syncRatio() {
    renderAiStatus();
    renderRecSettings();
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

  // ===== 共通 =====
  const THEMES = window.THEMES;
  const themeById = id => THEMES.find(t => t.id === id);
  const themeOfLesson = n => THEMES.find(t => t.lesson === n);
  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const fmtMS = sec => `${Math.floor(sec / 60)}分${pad(sec % 60)}秒`;
  const secOn = k => state.practice[k] || 0;
  const sumSec = n => { let s = 0; for (let i = 0; i < n; i++) s += secOn(addDays(today(), -i)); return s; };
  const daysPracticed = n => {
    let c = 0;
    for (let i = 0; i < n; i++) { const k = addDays(today(), -i); if (secOn(k) >= 60 || state.history[k] === "check") c++; }
    return c;
  };
  const dowJa = k => "日月火水木金土"[fromKey(k).getDay()];

  // ===== 練習時間の計測（会話・テーマの練習を開いている間だけ数える） =====
  let tickLast = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(5, Math.round((now - tickLast) / 1000));
    tickLast = now;
    if (document.hidden || dt <= 0) return;
    const inTalk = currentView === "talk" && talk && !talk.done;
    if (!inTalk && currentView !== "practice") return;
    const t = today();
    state.practice[t] = secOn(t) + dt;
    if (inTalk) { talk.sec += dt; renderTalkTime(); }
    save();
  }, 1000);

  // ===== ホーム =====
  function recommendedTheme() {
    const list = THEMES.filter(t => t.level === state.level);
    return list.find(t => !state.talkDone[t.id]) || list[0];
  }

  function renderHome() {
    const t = today();
    const sec = secOn(t);
    el.todayMin.textContent = Math.floor(sec / 60);
    el.goalMin.textContent = state.goal;
    el.todayBar.style.width = `${Math.min(100, (sec / (state.goal * 60)) * 100)}%`;
    el.chipStreak.textContent = `🔥 ${streakStatus().streak} 日連続`;
    el.chipWeek.textContent = `直近7日で ${daysPracticed(7)} 日練習`;
    const goal4 = state.goal * 28;
    const cur = Math.floor(sumSec(28) / 60);
    el.heroNote.textContent = `4週間の目標 ${goal4} 分まで、あと ${Math.max(0, goal4 - cur)} 分（現在 ${cur} 分・${Math.min(100, Math.round((cur / goal4) * 100))}%）`;
    el.btnHeroStart.textContent = `練習をはじめる（${recommendedTheme().title}）`;

    document.querySelectorAll(".seg-btn").forEach(b => {
      const on = b.dataset.level === state.level;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    el.themeList.innerHTML = "";
    THEMES.filter(th => th.level === state.level).forEach(th => {
      const done = state.talkDone[th.id];
      const card = document.createElement("button");
      card.type = "button";
      card.className = "theme-card";
      card.innerHTML = `<span class="tc-head"><b class="tc-title"></b><span class="tc-ko" lang="ko"></span></span>
        <span class="tc-desc"></span><span class="tc-foot"><span class="tc-cta">このテーマで練習する →</span><span class="tc-done"></span></span>`;
      card.querySelector(".tc-title").textContent = th.title;
      card.querySelector(".tc-ko").textContent = th.ko;
      card.querySelector(".tc-desc").textContent = th.desc;
      card.querySelector(".tc-done").textContent = done ? "✅ 練習済み" : "";
      card.addEventListener("click", () => startTalk(th.id));
      el.themeList.appendChild(card);
    });

    el.recentList.innerHTML = "";
    if (!state.sessions.length) {
      const li = document.createElement("li");
      li.className = "recent-empty";
      li.textContent = "まだ練習の記録はありません。テーマを選んで始めましょう。";
      el.recentList.appendChild(li);
    }
    state.sessions.slice(0, 5).forEach(r => {
      const th = themeById(r.theme);
      if (!th) return;
      const d = fromKey(r.date);
      const li = document.createElement("li");
      li.innerHTML = "<b></b><span class=\"recent-meta\"></span><span class=\"recent-time\"></span>";
      li.children[0].textContent = th.title;
      li.children[1].textContent = `${d.getMonth() + 1}/${d.getDate()}(${dowJa(r.date)})・${th.level}`;
      li.children[2].textContent = r.sec >= 60 ? `${Math.floor(r.sec / 60)}分${r.sec % 60}秒` : `${r.sec}秒`;
      el.recentList.appendChild(li);
    });
    renderPoints();
  }

  document.querySelectorAll(".seg-btn").forEach(b => b.addEventListener("click", () => {
    state.level = b.dataset.level;
    save();
    renderHome();
  }));
  el.btnHeroStart.addEventListener("click", () => startTalk(recommendedTheme().id));

  // ===== 会話練習（決まったシナリオ） =====
  // TODO(API): 自由な会話にする場合は、ここをサーバー経由の LLM 呼び出しに置き換える（APIキーはフロントに置かない）
  let talk = null; // { theme, i, tries, sec, ok, replies: [{ ko, ok, hint }], done, finished }
  const partnerAudio = new Audio();
  const lineAudio = (th, n) => `audio/talk/${th.id}-${n}.mp3`;

  // 相手の音声は順番に流す（分かれ道の受け止め → 次のセリフ、が重ならないように）
  let lineQueue = [];
  function startLine(src) {
    partnerAudio.pause();
    partnerAudio.src = src;
    const p = partnerAudio.play();
    if (p && p.catch) p.catch(() => playNextLine());
  }
  function playNextLine() {
    const next = lineQueue.shift();
    if (next) startLine(next);
  }
  partnerAudio.addEventListener("ended", playNextLine);
  partnerAudio.addEventListener("error", playNextLine);
  // 「🔊 聞く」を押したとき：今すぐ流す
  function playLine(src) {
    lineQueue = [];
    startLine(src);
  }
  // 自動で読み上げるとき：前の音声が終わってから流す
  function queueLine(src) {
    if (!partnerAudio.paused && !partnerAudio.ended) lineQueue.push(src);
    else startLine(src);
  }
  function stopLines() {
    lineQueue = [];
    partnerAudio.pause();
  }

  // ===== 分かれ道シナリオ（branches.js） =====
  // 予想される返事ごとに相手の応答を用意し、外れた話題は学習の範囲へ戻す
  const BR = window.BRANCHES || { audio: false, themes: {} };
  const branchTurn = (th, n) => {
    const t = BR.themes[th.id];
    return t && t.turns ? t.turns[n] : null;
  };
  const branchAudio = (th, n, id) => (BR.audio ? `audio/talk/b/${th.id}-${n}-${id}.mp3` : null);
  const unclearLine = th => (BR.themes[th.id] && BR.themes[th.id].unclear) || null;
  const unclearAudio = th => (BR.audio ? `audio/talk/b/${th.id}-unclear.mp3` : null);

  // 1文字違いまでなら同じとみなす（音声認識の聞き間違い・打ち間違い用）
  function within1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  }
  // 否定の形（「안 피곤해요」「피곤하지 않아요」）は、その語を言ったことにしない
  const negated = (n, i, len) => n[i - 1] === "안" || n.slice(i + len, i + len + 3).includes("지않");
  // 語が見つかった位置（見つからなければ -1）
  function kwFind(n, kw, fuzzy) {
    if (!kw) return -1;
    for (let i = n.indexOf(kw); i !== -1; i = n.indexOf(kw, i + 1)) {
      if (!negated(n, i, kw.length)) return i;
    }
    // 1文字違いは、取り違えが起きにくい4文字以上の語だけ（「일해요」と「안해요」のような誤りを防ぐ）
    if (!fuzzy || kw.length < 4) return -1;
    for (let len = kw.length - 1; len <= kw.length + 1; len++) {
      for (let i = 0; i + len <= n.length; i++) {
        if (within1(n.slice(i, i + len), kw) && !negated(n, i, len)) return i;
      }
    }
    return -1;
  }
  // どの分かれ道に当たるか（当たらなければ null。決まった流れのキーワードが優先される場合も null）
  function matchBranch(th, n, text) {
    const tb = branchTurn(th, n);
    if (!tb) return null;
    const turn = th.turns[n];
    const t = norm(text).toLowerCase();
    const best = fuzzy => {
      for (const weakPass of [false, true]) {
        let hit = null, len = 0, at = -1;
        tb.branches.filter(b => !!b.weak === weakPass).forEach(b => b.kw.forEach(k => {
          const kk = norm(k).toLowerCase();
          if (kk.length <= len) return;
          const i = kwFind(t, kk, fuzzy);
          if (i !== -1) { hit = b; len = kk.length; at = i; }
        }));
        if (hit) return { b: hit, at, len };
      }
      return null;
    };
    // 決まった流れのキーワードが見つかった範囲
    const mainSpans = turn.kw.map(k => {
      const kk = norm(k).toLowerCase();
      const i = kwFind(t, kk, false);
      return i === -1 ? null : [i, i + kk.length];
    }).filter(Boolean);
    const mainExact = mainSpans.length > 0;
    const exact = best(false);
    if (exact) {
      // require のターン：話を戻す分かれ道の語が、決まった流れの語の一部（「명동역」の「역」）なら決まった流れ。
      // 別の場所を聞いている（「명동역 근처 약국」の「약국」）なら、そちらに答える
      if (turn.require && exact.b.kind === "redirect" &&
          mainSpans.some(([s, e]) => exact.at <= e && s <= exact.at + exact.len)) return null; // 重なる・隣り合う
      return exact.b;
    }
    if (mainExact) return null;
    const fz = best(true);
    return fz ? fz.b : null;
  }

  // 空白・記号を無視して、キーワードのどれかが入っていれば「通じた」
  const norm = t => t.replace(/[\s.,!?~。、！？…'"「」]/g, "");
  const hasHangul = t => /[가-힣]/.test(t);
  const understood = (text, kw) => kw.some(k => norm(text).includes(norm(k)));
  // 韓国語として返事になっているか（ハングル2文字以上で、自然な文末で終わる）
  //   例：이번 주말에 집에 가요 / 네 / 아니요 / 몰라요 → OK、질문をそのまま写しただけ → NG
  const hangulCount = t => (t.match(/[\uac00-\ud7a3]/g) || []).length;
  const ENDING = /(요|다|까|죠|네|지|니다|세요|래|게|자|어|아|야|요\?)$/;
  function naturalReply(text, turn) {
    const n = norm(text);
    if (hangulCount(text) < 2 && !/^(네|예|응)$/.test(n)) return false;
    if (n === norm(turn.ko)) return false;
    return ENDING.test(n) || /^(네|예|응|아니요|아뇨)/.test(n);
  }

  // ===== 学習記録（学生用・一般用。登録して同意した人の分だけ、worker/ 経由で保存する） =====
  function recRegistered() { return !!(state.records && state.records.status === "registered"); }
  const newToken = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("-"));
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  const TYPE_LABEL = { student: "東北大学の学生", general: "TOFA の受講生" };

  async function postApi(path, data, keepalive) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: !!keepalive
    });
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { ok: res.ok, status: res.status, body };
  }

  // 同意画面の説明文（学生用・一般用で分ける。【】は config.js で書き換える）
  function consentHtml(type) {
    const c = ((CFG.consent || {})[type]) || {};
    const v = k => esc(c[k] || "【未設定】");
    const voiceNote = "会話練習での返事（入力した文字、または音声認識で文字にしたもの。録音の音声そのものは保存しません）、判定の結果とAIのアドバイス、練習した日時と時間";
    const where = "<li><b>保存先</b>：Cloudflare 社のデータベース（国外のサーバーに保存される場合があります）。AI判定がオンのときは、返事の文が判定のために Anthropic 社（米国）の AI「Claude」に送られます。</li>";
    const quit = "<li><b>登録の解除</b>：いつでも「設定 → 学習記録」から解除できます。解除すると、これまでの記録はすべて削除されます。</li>";
    if (type === "student") {
      return `<h3>東北大学の学生の方へ：学習記録の取り扱い</h3>
        <p>登録した場合に限り、次の情報を保存します。</p>
        <ul>
          <li><b>保存する情報</b>：クラスコード、学籍番号、${voiceNote}</li>
          <li><b>利用目的</b>：授業での学習状況の確認と、指導・フィードバックのため</li>
          <li><b>成績との関係</b>：${v("grading")}</li>
          ${where}
          <li><b>保存期間</b>：${v("retention")}</li>
          <li><b>管理者・問い合わせ先</b>：${v("manager")}（${v("org")}）／${v("contact")}</li>
          ${quit}
        </ul>
        <h3>研究での利用（任意）</h3>
        <p>同意した場合に限り、${v("researcher")}が研究「${v("research")}」のために記録を利用します。研究では学籍番号を仮のIDに置き換え、個人が特定されない形で分析・発表します。<b>同意しなくても、授業や成績には一切影響しません。</b>同意は「設定 → 学習記録」からいつでも取り消せます。</p>`;
    }
    return `<h3>TOFA 受講生の方へ：学習記録の取り扱い</h3>
      <p>登録した場合に限り、次の情報を保存します。</p>
      <ul>
        <li><b>保存する情報</b>：クラスコード、ニックネーム、性別・年代・韓国語の学習歴・お住まいの地域（どれも「回答しない」を選べます）、${voiceNote}</li>
        <li><b>利用目的</b>：受講生の学習状況の把握と指導、講座の改善のため</li>
        ${where}
        <li><b>保存期間</b>：${v("retention")}</li>
        <li><b>管理者・問い合わせ先</b>：${v("manager")}（${v("org")}）／${v("contact")}</li>
        ${quit}
        <li>18歳未満の方は、保護者の同意を得てから登録してください。</li>
      </ul>
      <h3>研究での利用（任意）</h3>
      <p>同意した場合に限り、${v("researcher")}が研究「${v("research")}」のために、記録と上の属性（性別・年代・学習歴・地域）を利用します。研究ではニックネームを仮のIDに置き換え、個人が特定されない形で分析・発表します。<b>同意しなくても、受講には一切影響しません。</b>同意は「設定 → 学習記録」からいつでも取り消せます。</p>`;
  }

  let consentPending = null; // 登録のあとに始める会話テーマ
  const learnerType = () => {
    const r = el.consentForm.querySelector('input[name="learnerType"]:checked');
    return r ? r.value : "";
  };
  function applyLearnerType() {
    const type = learnerType();
    el.consentBody.hidden = !type;
    if (!type) return;
    const student = type === "student";
    el.recIdLabel.textContent = student ? "学籍番号" : "ニックネーム";
    el.recId.placeholder = student ? "例）C1SB1234" : "例）さくら";
    el.recIdHint.textContent = student
      ? "半角英数字で入力してください。"
      : "本名でなくてかまいません。講師があなたを見分けられる名前にしてください。";
    el.profileFields.hidden = student;
    el.consentText.innerHTML = consentHtml(type);
    el.consentText.scrollTop = 0;
    el.recResearchLabel.textContent = student
      ? "研究での利用にも同意します（任意。授業・成績には影響しません）"
      : "研究での利用にも同意します（任意。受講には影響しません）";
    el.recError.textContent = "";
  }

  function renderConsent() {
    const r = state.records;
    const reg = recRegistered();
    el.recStatusCard.hidden = !reg;
    el.btnRecSkip.hidden = reg;
    el.btnRecSubmit.textContent = reg ? "登録内容を変更する" : "登録する";
    if (reg) {
      el.recStatusText.textContent = `${TYPE_LABEL[r.type]}・クラス ${r.classCode}・${r.type === "student" ? "学籍番号" : "ニックネーム"} ${r.learnerId}・研究での利用：${r.research ? "同意" : "同意しない"}`;
    }
    el.consentForm.querySelectorAll('input[name="learnerType"]').forEach(x => { x.checked = !!(reg && x.value === r.type); });
    el.recClass.value = reg ? r.classCode : "";
    el.recId.value = reg ? r.learnerId : "";
    const pf = (reg && r.profile) || {};
    el.pfGender.value = pf.gender || "";
    el.pfAge.value = pf.age_group || "";
    el.pfExp.value = pf.experience || "";
    el.pfRegion.value = pf.region || "";
    el.recAgree.checked = reg;
    el.recResearch.checked = !!(reg && r.research);
    el.recError.textContent = "";
    applyLearnerType();
  }

  function openConsent(pendingTalkId) {
    consentPending = pendingTalkId || null;
    renderConsent();
    showView("consent");
  }
  function afterConsent() {
    const id = consentPending;
    consentPending = null;
    if (id) startTalk(id);
    else { renderRecSettings(); showView("settings"); }
  }

  el.consentForm.querySelectorAll('input[name="learnerType"]').forEach(x => x.addEventListener("change", applyLearnerType));
  el.btnConsentBack.addEventListener("click", () => {
    consentPending = null;
    showView(recRegistered() || (state.records && state.records.status === "declined") ? "settings" : "home");
  });
  el.btnRecSkip.addEventListener("click", () => {
    state.records = { status: "declined" };
    save();
    afterConsent();
  });

  el.consentForm.addEventListener("submit", async e => {
    e.preventDefault();
    const fail = msg => { el.recError.textContent = msg; };
    const type = learnerType();
    const classCode = el.recClass.value.trim().toUpperCase();
    const learnerId = el.recId.value.trim();
    if (!type) return fail("区分を選んでください。");
    if (!classCode) return fail("クラスコードを入力してください。");
    if (type === "student" && !/^[A-Za-z0-9-]{3,20}$/.test(learnerId)) return fail("学籍番号を半角英数字で入力してください。");
    if (type === "general" && !learnerId) return fail("ニックネームを入力してください。");
    const profile = type === "general"
      ? { gender: el.pfGender.value, age_group: el.pfAge.value, experience: el.pfExp.value, region: el.pfRegion.value }
      : null;
    if (profile && Object.values(profile).some(v => !v)) return fail("性別・年代・学習歴・地域を選んでください（答えたくない項目は「回答しない」）。");
    if (!el.recAgree.checked) return fail("登録するには、学習記録の保存への同意が必要です。");

    el.btnRecSubmit.disabled = true;
    fail("");
    try {
      const chk = await postApi("/records/class", { class_code: classCode });
      if (!chk.ok) return fail("このクラスコードは使えません。先生・講師に確認してください。");
      if (chk.body.learner_type !== type) {
        return fail(`このクラスコードは「${TYPE_LABEL[chk.body.learner_type]}」用です。区分を確かめてください。`);
      }
      const token = (state.records && state.records.token) || newToken();
      const res = await postApi("/records/register", {
        device_token: token, class_code: classCode, learner_type: type, learner_id: learnerId,
        research_ok: el.recResearch.checked, profile
      });
      if (!res.ok) return fail("登録できませんでした。入力内容を確かめて、もう一度お試しください。");
      const changed = recRegistered();
      state.records = { status: "registered", token, classCode, type, learnerId, research: el.recResearch.checked, profile };
      save();
      toast(changed ? "登録内容を変更しました" : "登録しました。練習の記録が保存されます");
      afterConsent();
    } catch (err) {
      fail("サーバーに接続できませんでした。通信状態を確かめて、もう一度お試しください。");
    } finally {
      el.btnRecSubmit.disabled = false;
    }
  });

  el.btnRecDelete.addEventListener("click", async () => {
    if (!recRegistered()) return;
    if (!confirm("登録を解除して、これまでの学習記録をすべて削除しますか？（元に戻せません）")) return;
    try {
      const res = await postApi("/records/delete", { device_token: state.records.token });
      if (!res.ok) throw new Error(String(res.status));
      state.records = { status: "declined" };
      save();
      toast("登録を解除し、記録を削除しました");
      renderRecSettings();
      showView("settings");
    } catch (err) {
      toast("削除できませんでした。通信状態を確かめて、もう一度お試しください");
    }
  });

  function renderRecSettings() {
    el.recSettingsCard.hidden = !RECORDS_ON;
    if (!RECORDS_ON) return;
    const r = state.records;
    el.recSettingsText.textContent = recRegistered()
      ? `登録済み：${TYPE_LABEL[r.type]}・クラス ${r.classCode}（研究での利用：${r.research ? "同意" : "同意しない"}）`
      : "登録していません。練習の記録は保存されません（この端末の中の記録だけです）。";
  }
  el.btnRecOpen.addEventListener("click", () => openConsent(null));

  // 記録を送る（失敗しても練習は止めない。登録していなければ何も送らない）
  function sendRecord(path, data) {
    if (!RECORDS_ON || !recRegistered()) return;
    postApi(path, { device_token: state.records.token, ...data }, true).catch(() => {});
  }
  function logReply(turn, turnNo, tryNo, text, voice, verdict, judgedBy, ai, branchId) {
    sendRecord("/records/reply", {
      theme: talk.theme.title, level: talk.theme.level, turn_no: turnNo, try_no: tryNo,
      partner_ko: turn.ko, reply_ko: text || "", voice: !!voice,
      verdict, judged_by: judgedBy,
      feedback_ja: ai ? ai.feedback_ja : "", corrected_ko: ai ? ai.corrected_ko : "", branch_id: branchId || ""
    });
  }

  // ===== AI判定（Claude。APIキーを持つ Worker を経由する：worker/） =====
  // 接続先は設定値の AI_ENDPOINT（config.js）。
  const aiReady = () => !!AI_ENDPOINT && state.ai !== false;

  async function callAi(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    try {
      const res = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`AI ${res.status}`);
      const r = await res.json();
      if (!r || !["ok", "almost", "ng"].includes(r.verdict)) throw new Error("AI bad result");
      return r;
    } finally {
      clearTimeout(timer);
    }
  }

  // いまの場面と、これまでのやりとりを添えて判定を頼む
  function aiJudge(turn, text, voice) {
    const th = talk.theme;
    const history = [];
    for (let k = 0; k < talk.i; k++) {
      history.push({ who: "partner", ko: th.turns[k].ko });
      const mine = talk.replies.filter(r => r.turn === k && r.ko).pop();
      if (mine) history.push({ who: "me", ko: mine.ko });
    }
    return callAi({
      theme: th.title, level: th.level, partner: `${th.partner.name}（${th.partner.role}）`, voice, mission: th.mission || "",
      history,
      turn: { ko: turn.ko, ja: turn.ja, hint_ko: turn.hint.ko, hint_ja: turn.hint.ja, require: !!turn.require, keywords: turn.kw, require_note: turn.requireNote || "" },
      reply: text
    });
  }

  // AI の判定中は、二重に送れないよう入力を止める
  function setTalkBusy(busy) {
    el.talkInput.disabled = busy;
    el.btnTalkMic.disabled = busy;
    el.btnHint.disabled = busy;
    el.btnTalkSend.disabled = busy || !el.talkInput.value.trim();
    if (!busy) el.talkInput.focus();
  }

  // AI のコメント（日本語）と、直した文・別の言い方
  // 分かち書きの直しも見せたいので、空白は残して文末の記号だけ無視して比べる
  const sameSentence = (a, b) => {
    const t = x => x.trim().replace(/[\s.,!?~。、！？…]+$/, "").replace(/\s+/g, " ");
    return t(a) === t(b);
  };
  function showAiFeedback(ai, text, ok) {
    addBubble(ok ? "system tip ai" : "system ai", div => {
      div.innerHTML = "<p class=\"b-note\">🤖 AIのアドバイス</p><p class=\"b-ja\"></p>";
      div.querySelector(".b-ja").textContent = ai.feedback_ja;
      const addLine = (label, ko) => {
        const p = document.createElement("p");
        p.className = "b-ai-line";
        p.innerHTML = "<small></small><span class=\"b-ko\" lang=\"ko\"></span>";
        p.firstChild.textContent = label;
        p.lastChild.textContent = ko;
        div.appendChild(p);
      };
      const fixed = (ai.corrected_ko || "").trim();
      const better = (ai.better_ko || "").trim();
      if (fixed && !sameSentence(fixed, text)) addLine("直すと", fixed);
      if (better && !sameSentence(better, fixed) && !sameSentence(better, text)) addLine("こんな言い方も", better);
      if (!ok) {
        const use = fixed && !sameSentence(fixed, text) ? fixed : better;
        if (use) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "b-use";
          b.textContent = "この文を入力欄に入れる";
          b.addEventListener("click", () => {
            el.talkInput.value = use;
            el.btnTalkSend.disabled = false;
            el.talkInput.focus();
          });
          div.appendChild(b);
        }
      }
    });
  }

  function startTalk(id) {
    // 学習記録を使う設定で、まだ登録するか決めていなければ、先に登録画面を出す
    if (RECORDS_ON && !state.records) { openConsent(id); return; }
    stopLines();
    if (talkRec) stopTalkRec(true);
    const th = themeById(id);
    talk = { theme: th, i: 0, tries: 0, sec: 0, ok: 0, replies: [], done: false, finished: false };
    el.talkTitle.textContent = th.title;
    el.talkLevel.textContent = th.level;
    el.talkPartner.textContent = `相手：${th.partner.name}（${th.partner.role}）`;
    el.exprList.innerHTML = "";
    th.expressions.forEach(x => {
      const li = document.createElement("li");
      li.innerHTML = "<b lang=\"ko\"></b><small></small>";
      li.firstChild.textContent = x.ko;
      li.lastChild.textContent = x.ja;
      el.exprList.appendChild(li);
    });
    // 中級テーマは、例文の文法解説も「使える表現」の中に入れる
    if (th.lesson != null) {
      const e = window.SENTENCES[th.lesson].expl;
      const li = document.createElement("li");
      li.className = "expr-grammar";
      li.innerHTML = "<span class=\"expr-g-label\">今日の例文の文法</span>";
      e.grammar.forEach(g => {
        const p = document.createElement("p");
        p.innerHTML = "<b lang=\"ko\"></b> ";
        p.firstChild.textContent = g.form;
        p.appendChild(document.createTextNode(g.ja));
        li.appendChild(p);
      });
      el.exprList.appendChild(li);
    }
    el.exprBox.open = false;
    el.chatLog.innerHTML = "";
    el.talkInput.value = "";
    el.talkInput.disabled = false;
    el.btnTalkSend.disabled = true;
    el.btnTalkMic.disabled = false;
    el.btnHint.disabled = false;
    el.micStatus.textContent = "";
    el.btnTalkEnd.textContent = "練習をおわる";
    el.talkSummary.hidden = true;
    el.talkMain.hidden = false;
    showView("talk");
    renderTalkTime();
    // 決まったシナリオなので、最初に「この会話でやること」を見せる（相手のセリフはこれを前提に進む）
    if (th.mission) {
      addBubble("system mission", div => {
        div.innerHTML = "<p class=\"b-note\">🎯 この会話でやること</p><p class=\"b-ja\"></p>";
        div.querySelector(".b-ja").textContent = th.mission;
      });
    }
    partnerSay(0);
  }

  function renderTalkTime() {
    if (!talk) return;
    el.talkRemain.textContent = fmtMS(Math.max(0, state.goal * 60 - secOn(today())));
    el.talkElapsed.textContent = fmtMS(talk.sec);
  }

  function addBubble(cls, build) {
    const div = document.createElement("div");
    div.className = `bubble ${cls}`;
    build(div);
    el.chatLog.appendChild(div);
    div.scrollIntoView({ behavior: "smooth", block: "end" });
    return div;
  }

  function partnerSay(n) {
    const th = talk.theme;
    const line = n < th.turns.length ? th.turns[n] : th.close;
    partnerSpeak(line, lineAudio(th, n + 1));
  }

  // 相手のセリフを表示して読み上げる（音声ファイルが無いセリフは文字だけ）
  function partnerSpeak(line, src) {
    addBubble("partner", div => {
      div.innerHTML = "<p class=\"b-ko\" lang=\"ko\"></p><p class=\"b-ja\"></p>" + (src ? "<button class=\"b-listen\" type=\"button\">🔊 聞く</button>" : "");
      div.querySelector(".b-ko").textContent = line.ko;
      div.querySelector(".b-ja").textContent = line.ja;
      if (src) div.querySelector(".b-listen").addEventListener("click", () => playLine(src));
    });
    if (src && el.autoRead.checked) queueLine(src);
  }

  function showHint(turn, note) {
    addBubble("system", div => {
      div.innerHTML = "<p class=\"b-note\"></p><p class=\"b-ja\"></p><p class=\"b-ko\" lang=\"ko\"></p><button class=\"b-use\" type=\"button\">この文を入力欄に入れる</button>";
      div.querySelector(".b-note").textContent = note;
      div.querySelector(".b-ja").textContent = `💡 ${turn.hint.ja}`;
      div.querySelector(".b-ko").textContent = `例）${turn.hint.ko}`;
      div.querySelector(".b-use").addEventListener("click", () => {
        el.talkInput.value = turn.hint.ko;
        el.btnTalkSend.disabled = false;
        el.talkInput.focus();
      });
    });
  }

  function sendReply() {
    if (!talk || talk.finished) return;
    const text = el.talkInput.value.trim();
    if (!text) return;
    el.talkInput.value = "";
    el.btnTalkSend.disabled = true;
    handleReply(text, null);
  }

  // 返事の処理（文字入力・録音の共通）
  //   text: 入力した文、または録音の文字起こし（取れなかったときは空）
  //   audioUrl: 録音した返事（文字入力のとき・iPhone で録音しないときは null）
  //   isVoice: 声で返事したか（iPhone では録音が無くても true）
  //   AI判定が使えるときは AI に判定してもらい、使えないとき・失敗したときは簡易判定にする
  async function handleReply(text, audioUrl, isVoice) {
    const voice = !!(isVoice || audioUrl);
    const turn = talk.theme.turns[talk.i];
    const turnNo = talk.i;
    const judged = !!text;
    let mark;
    const bubble = addBubble("me", div => {
      if (audioUrl) {
        const play = document.createElement("button");
        play.type = "button";
        play.className = "b-voice";
        play.textContent = "▶ 自分の声を聞く";
        const a = new Audio(audioUrl);
        play.addEventListener("click", () => { a.currentTime = 0; a.play().catch(() => {}); });
        div.appendChild(play);
      }
      if (text) {
        const p = document.createElement("p");
        p.className = "b-ko";
        p.lang = "ko";
        p.textContent = text;
        div.appendChild(p);
      }
      mark = document.createElement("span");
      mark.className = "b-mark";
      div.appendChild(mark);
      div.classList.toggle("voice", voice);
    });

    // 文字起こしができない端末では内容を判定できないので、参考の答えを見せて先に進む
    if (!judged) {
      mark.textContent = audioUrl ? "🎙️ 録音で返事しました" : "🎙️ 声で返事しました";
      talk.replies.push({ ko: text, ok: null, hint: turn.hint.ko, turn: turnNo, audio: audioUrl });
      logReply(turn, turnNo, talk.tries + 1, text, voice, "", "none", null);
      addBubble("system", div => {
        div.innerHTML = `<p class="b-note">${SR ? "声を文字にできなかったため" : "この端末では音声の文字起こしができないため"}、内容は判定していません。</p><p class="b-ja"></p><p class="b-ko" lang="ko"></p>`;
        div.querySelector(".b-ja").textContent = "参考の答えと聞き比べてみましょう。";
        div.querySelector(".b-ko").textContent = `例）${turn.hint.ko}`;
      });
      nextTurn();
      return;
    }

    // 分かれ道：予想した返事なら、相手がそれに合わせて答える（AI は使わない）
    if (hasHangul(text)) {
      const b = matchBranch(talk.theme, turnNo, text);
      if (b) { handleBranch(b, turn, turnNo, text, voice, audioUrl, mark, bubble); return; }
    }

    // AI判定（ハングルを含む返事だけ。ひらがなだけ等は簡易判定のヒントで足りる）
    let ai = null;
    if (hasHangul(text) && aiReady()) {
      mark.textContent = "🤖 AIが確認中…";
      setTalkBusy(true);
      try {
        ai = await aiJudge(turn, text, voice);
      } catch (e) {
        ai = null;
        if (!talk.aiFailNoted) {
          talk.aiFailNoted = true;
          addBubble("system", div => {
            div.innerHTML = "<p class=\"b-ja\">AIに接続できなかったため、今回は簡易判定（文末・キーワード）で確認しました。</p>";
          });
        }
      }
      if (!talk || talk.done || talk.i !== turnNo) return;
      setTalkBusy(false);
    }

    // 簡易判定：キーワードが入っていれば「ぴったり」、入っていなくても自然な韓国語の返事なら「通じた」
    const exact = hasHangul(text) && understood(text, turn.kw);
    const ruleOk = exact || (hasHangul(text) && !turn.require && naturalReply(text, turn));
    const ok = ai ? ai.verdict === "ok" : ruleOk;
    mark.textContent = ok ? "✓ 通じました" : "💡 もう少し";
    bubble.classList.toggle("ok", ok);
    talk.replies.push({ ko: text, ok, hint: (ai && ai.better_ko) || turn.hint.ko, turn: turnNo, audio: audioUrl, ai: !!ai });
    logReply(turn, turnNo, talk.tries + 1, text, voice, ai ? ai.verdict : ok ? "ok" : "ng", ai ? "ai" : "rule", ai);
    const tb = branchTurn(talk.theme, turnNo);

    if (ok) {
      sfx.correct();
      talk.ok++;
      if (ai) {
        showAiFeedback(ai, text, true);
      } else if (!exact) {
        addBubble("system tip", div => {
          div.innerHTML = "<p class=\"b-ja\">💬 こんな言い方もできます</p><p class=\"b-ko\" lang=\"ko\"></p>";
          div.querySelector(".b-ko").textContent = turn.hint.ko;
        });
      }
      // 予想外でも通じる返事は、相手がひとこと受け止めてから次へ
      if (!exact && !turn.require && tb && tb.fallback) partnerSpeak(tb.fallback, branchAudio(talk.theme, turnNo, "fallback"));
      nextTurn();
      return;
    }
    talk.tries++;
    if (ai) {
      showAiFeedback(ai, text, false);
      if (talk.tries >= 2) {
        showHint(turn, "この言い方も覚えておきましょう。会話は先に進みます。");
        nextTurn();
      }
      return;
    }
    if (!hasHangul(text)) {
      showHint(turn, "韓国語（ハングル）で書いてみましょう。");
      return;
    }
    if (talk.tries >= 3) {
      showHint(turn, "この言い方も覚えておきましょう。会話は先に進みます。");
      nextTurn();
      return;
    }
    const natural = naturalReply(text, turn);
    if (natural && turn.require) {
      // 決まった流れから外れた返事：相手が話を戻す（2回目は日本語で前提を説明）
      if (talk.tries === 1 && tb && tb.fallback) partnerSpeak(tb.fallback, branchAudio(talk.theme, turnNo, "fallback"));
      else showHint(turn, turn.requireNote || "韓国語としては通じますが、この場面では今日の表現を使ってみましょう。");
      return;
    }
    // 意味が取りにくい返事：相手が聞き返す（2回目はヒント）
    const uc = unclearLine(talk.theme);
    if (talk.tries === 1 && uc) partnerSpeak(uc, unclearAudio(talk.theme));
    else showHint(turn, "相手にうまく伝わらなかったようです。ヒントを見てもう一度どうぞ。");
  }

  // 動作確認用（ブラウザのコンソールや自動テストから、分かれ道の当たり方を確かめる）
  window.KOTALK_DEBUG = { matchBranch: (themeId, n, text) => {
    const b = matchBranch(THEMES.find(t => t.id === themeId), n, text);
    return b ? b.id : null;
  } };

  // 分かれ道に当たったとき
  function handleBranch(b, turn, turnNo, text, voice, audioUrl, mark, bubble) {
    const ok = b.kind === "ok";
    mark.textContent = ok ? "✓ 通じました" : "💬 通じました（話を戻します）";
    bubble.classList.toggle("ok", ok);
    talk.replies.push({ ko: text, ok, hint: turn.hint.ko, turn: turnNo, audio: audioUrl, branch: b.id });
    logReply(turn, turnNo, talk.tries + 1, text, voice, ok ? "ok" : "almost", "branch", null, b.id);
    const src = branchAudio(talk.theme, turnNo, b.id);
    if (ok) {
      sfx.correct();
      talk.ok++;
      if (b.reply) partnerSpeak(b.reply, src);
      if (typeof b.goto === "number") {
        // reply がそのターンの質問になっている（例：体調が悪い → 今日は大丈夫？）
        talk.i = b.goto - 1;
        nextTurn({ silent: true });
      } else {
        nextTurn({ silent: b.next === "replace" && !!b.reply });
      }
      return;
    }
    // 話題がそれた返事：相手が答えたうえで、学習の範囲に話を戻す（同じターンにとどまる）
    talk.tries++;
    if (b.reply) partnerSpeak(b.reply, src);
    if (talk.tries >= 3) {
      showHint(turn, "この場面で練習したい言い方です。会話は先に進みます。");
      nextTurn();
    }
  }

  // silent: 相手の次のセリフ（または最後のあいさつ）は分かれ道の応答がすでに言ったので、表示しない
  function nextTurn(opts) {
    const silent = !!(opts && opts.silent);
    talk.i++;
    talk.tries = 0;
    setTimeout(() => {
      if (!talk || talk.done) return;
      if (!silent) partnerSay(talk.i);
      if (talk.i >= talk.theme.turns.length) {
        // 最後のあいさつまで来たら会話完了
        talk.finished = true;
        el.talkInput.disabled = true;
        el.btnTalkSend.disabled = true;
        el.btnTalkMic.disabled = true;
        el.btnHint.disabled = true;
        el.btnTalkEnd.textContent = "結果を見る";
        addBubble("system done", div => {
          div.innerHTML = "<p class=\"b-note\">会話が終わりました 🎉</p><button class=\"btn cta block\" type=\"button\">結果を見る</button>";
          div.querySelector("button").addEventListener("click", finishTalk);
        });
      }
    }, 700);
  }

  el.talkInput.addEventListener("input", () => { el.btnTalkSend.disabled = !el.talkInput.value.trim(); });
  el.talkInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendReply(); }
  });
  el.btnTalkSend.addEventListener("click", sendReply);
  el.btnHint.addEventListener("click", () => {
    if (talk && !talk.finished) showHint(talk.theme.turns[talk.i], "ヒント");
  });
  el.btnTalkEnd.addEventListener("click", finishTalk);

  // ----- マイク：声で返事を録音して送る -----
  // タップで録音開始、もう一度タップ（または15秒）で送信。
  // 対応端末では同時にブラウザの音声認識で文字起こしし、その文で「通じたか」を判定する。
  // iPhone の Safari では文字起こしが取れたり取れなかったりしたため、次のようにしている。
  //   1) 音声認識はタップの直後（await の前）に始める。待ったあとだと操作の扱いが切れて始まらないことがある
  //   2) 途中で止まったら（間を空けると自動で終わる）録音中は自動で再開し、確定した文をつなげる
  //   3) 送るときは先に音声認識を止めて最後の結果を待ち、そのあとでマイクを止める（逆だと最後の言葉が消える）
  //   4) それでも文字にできなかったときは、会話を先に進めずに「もう一度」か「このまま進む」を選んでもらう
  //   5) iPhone では音声認識だけを使い、録音（getUserMedia）は同時に行わない。
  //      iPhone の Safari はマイクを同時に1つの機能にしか渡さないため、録音と一緒に使うと
  //      1回目だけ文字になり、2回目以降は音声認識に音が届かなくなる（実機で確認された症状）。
  //      そのため iPhone では「自分の声を聞く」は出ない。
  // TODO(API): 本番では録音データを音声認識API（サーバー経由）に送り、どの端末でも判定できるようにする
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TALK_MAX_SEC = 15;
  const SR_FINISH_WAIT_MS = 2000;
  const SR_ONLY = IS_IOS && !!SR; // iPhone：音声認識だけ（録音しない）
  let talkRec = null; // { rec, stream, start, timer, sr, finals, interim, srError, stopping }

  function resetTalkMic() {
    el.btnTalkMic.classList.remove("on");
    el.btnTalkMic.textContent = "🎤";
    el.btnTalkMic.setAttribute("aria-label", "声で返事を録音");
  }

  const transcriptOf = tr => (tr.finals.join(" ") + " " + tr.interim).replace(/\s+/g, " ").trim();

  // 音声認識を1回分始める。終わったら、録音中なら自動で続きを始める
  function startRecognition(tr) {
    const s = new SR();
    s.lang = "ko-KR";
    s.interimResults = true;
    s.continuous = true;
    s.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) tr.finals.push(t.trim());
        else interim += t;
      }
      tr.interim = interim;
    };
    s.onerror = e => { tr.srError = (e && e.error) || "error"; };
    s.onend = () => {
      // 間が空いて自動で終わったときは、確定前の文も残してから再開する
      if (tr.interim.trim()) { tr.finals.push(tr.interim.trim()); tr.interim = ""; }
      if (tr.sr !== s) return;
      if (!tr.stopping && talkRec === tr && tr.restarts < 5 && tr.srError !== "not-allowed" && tr.srError !== "service-not-allowed") {
        tr.restarts++;
        try { startRecognition(tr); return; } catch (err) { /* 再開できなければそのまま */ }
      }
      tr.sr = null;
      if (tr.onSrEnd) tr.onSrEnd();
    };
    tr.sr = s;
    s.start();
  }

  el.btnTalkMic.addEventListener("click", async () => {
    if (!talk || talk.finished) return;
    if (talkRec) { stopTalkRec(); return; }
    if (!canRecord) {
      // 録音できない端末でも、キーボードの音声入力（🎤）なら文字で返事できる
      el.micStatus.textContent = `${noRecordReason()}\n今はキーボードの🎤（音声入力）で、文字で返事することもできます。`;
      el.talkInput.focus();
      return;
    }
    sfx.unlock();
    stopLines();
    const tr = { rec: null, stream: null, start: Date.now(), timer: null, sr: null, finals: [], interim: "", srError: "", restarts: 0, stopping: false, srOnly: false };
    // 文字起こしは、タップの操作の中ですぐ始める（対応端末のみ。失敗しても録音は続ける）
    if (SR) {
      try { startRecognition(tr); } catch (e) { tr.sr = null; tr.srError = "start-failed"; }
    }
    talkRec = tr;
    // iPhone：音声認識が始まったら、録音はしない（マイクの取り合いを避ける）
    if (SR_ONLY && tr.sr) {
      tr.srOnly = true;
      startTalkTimer(tr);
      return;
    }
    try {
      tr.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (micPerm !== "granted") { micPerm = "granted"; renderDiagnostics(); }
    } catch (e) {
      talkRec = null;
      tr.stopping = true;
      if (tr.sr) { try { tr.sr.abort(); } catch (err) {} }
      const noDevice = e && (e.name === "NotFoundError" || e.name === "OverconstrainedError");
      if (!noDevice) micPerm = "denied";
      renderDiagnostics();
      el.micStatus.textContent = noDevice ? "マイクが見つかりませんでした" : `マイクが許可されていません。${micHowTo()}`;
      return;
    }
    try {
      tr.rec = HAS_MR ? startMediaRecorder(tr.stream) : startWavRecorder(tr.stream);
    } catch (e) {
      try { tr.rec = HAS_WEBAUDIO ? startWavRecorder(tr.stream) : null; } catch (e2) { tr.rec = null; }
    }
    if (!tr.rec || talkRec !== tr) {
      talkRec = null;
      tr.stopping = true;
      if (tr.sr) { try { tr.sr.abort(); } catch (err) {} }
      tr.stream.getTracks().forEach(t => t.stop());
      el.micStatus.textContent = "録音を開始できませんでした";
      return;
    }
    startTalkTimer(tr);
  });

  function startTalkTimer(tr) {
    tr.start = Date.now();
    el.btnTalkMic.classList.add("on");
    el.btnTalkMic.textContent = "■";
    el.btnTalkMic.setAttribute("aria-label", "話し終わったらタップして送る");
    tr.timer = setInterval(() => {
      const sec = (Date.now() - tr.start) / 1000;
      el.micStatus.textContent = `🔴 ${tr.srOnly ? "聞き取り中" : "録音中"} ${sec.toFixed(1)}秒　話し終わったらもう一度タップ`;
      if (sec >= TALK_MAX_SEC) stopTalkRec();
    }, 100);
  }

  // 音声認識を止めて、最後の結果が届く（end が来る）まで待つ
  function finishRecognition(tr) {
    tr.stopping = true;
    if (!tr.sr) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(resolve, SR_FINISH_WAIT_MS);
      tr.onSrEnd = () => { clearTimeout(timer); resolve(); };
      try { tr.sr.stop(); } catch (e) { clearTimeout(timer); resolve(); }
    });
  }

  async function stopTalkRec(cancel) {
    const tr = talkRec;
    if (!tr || (!tr.rec && !tr.srOnly)) return;
    talkRec = null;
    clearInterval(tr.timer);
    resetTalkMic();
    const dur = (Date.now() - tr.start) / 1000;
    if (!cancel) el.micStatus.textContent = "文字にしています…";
    await finishRecognition(tr);           // 先に音声認識を終わらせる
    let url = null;
    if (tr.rec) {
      const blob = await tr.rec.stop();    // そのあとで録音とマイクを止める
      tr.stream.getTracks().forEach(t => t.stop());
      url = URL.createObjectURL(blob);
    }
    el.micStatus.textContent = "";
    if (cancel || !talk || talk.finished) return;
    if (dur < 0.6) { el.micStatus.textContent = "短すぎました。もう一度どうぞ"; return; }
    const text = transcriptOf(tr);
    if (!text && SR) { showUnheard(url, tr.srError); return; }
    handleReply(text, url, true);
  }

  // 音声認識に対応しているのに文字にできなかったとき：会話は進めず、理由と次の手を示す
  const SR_ERROR_HINT = {
    "not-allowed": "音声認識が許可されていません。iPhone は「設定 → 一般 → キーボード → 音声入力」をオンにし、Safari のマイクを「許可」にしてください。",
    "service-not-allowed": "音声認識が使えない設定になっています。iPhone は「設定 → 一般 → キーボード → 音声入力」をオンにしてください。",
    "no-speech": "声が聞き取れませんでした。マイクに近づいて、少しはっきり話してみてください。",
    "network": "音声認識の通信に失敗しました。電波の良いところで、もう一度どうぞ。",
    "audio-capture": "マイクを使えませんでした。ほかのアプリがマイクを使っていないか確かめてください。"
  };
  function showUnheard(audioUrl, srError) {
    addBubble("me voice", div => {
      div.innerHTML = (audioUrl ? "<button type=\"button\" class=\"b-voice\">▶ 自分の声を聞く</button>" : "") + "<span class=\"b-mark\">🎙️ 文字にできませんでした</span>";
      if (audioUrl) {
        const a = new Audio(audioUrl);
        div.querySelector(".b-voice").addEventListener("click", () => { a.currentTime = 0; a.play().catch(() => {}); });
      }
    });
    addBubble("system", div => {
      div.innerHTML = `<p class="b-note">声を文字にできませんでした。</p><p class="b-ja"></p><button class="b-use" type="button">${audioUrl ? "この録音のまま次へ進む" : "このまま次へ進む"}</button>`;
      div.querySelector(".b-ja").textContent = `${SR_ERROR_HINT[srError] || "もう一度🎤で話すか、文字で入力してください。"}（もう一度🎤を押すと録り直せます）`;
      const go = div.querySelector(".b-use");
      go.addEventListener("click", () => {
        go.disabled = true;
        if (talk && !talk.finished) handleReply("", audioUrl, true);
      });
    });
  }

  function finishTalk() {
    if (!talk || talk.done) return;
    talk.done = true;
    stopLines();
    if (talkRec) stopTalkRec(true);
    const th = talk.theme;
    if (talk.sec > 0 || talk.replies.length) {
      sendRecord("/records/session", {
        theme: th.title, level: th.level, seconds: talk.sec, turns: talk.replies.length, ok_count: talk.ok, finished: !!talk.finished
      });
      state.sessions.unshift({ theme: th.id, date: today(), sec: talk.sec, ok: talk.ok, turns: talk.replies.length });
      state.sessions = state.sessions.slice(0, 20);
    }
    let ci = null;
    if (talk.finished) {
      state.talkDone[th.id] = { date: today(), ok: talk.ok, turns: th.turns.length };
      ci = checkIn(); // 会話を最後まで終えたら出席
    }
    save();
    renderPoints();

    el.sumTheme.textContent = `${th.title}（${th.level}）・相手：${th.partner.name}`;
    el.sumTime.textContent = talk.sec >= 60 ? `${Math.floor(talk.sec / 60)}分` : `${talk.sec}秒`;
    el.sumTurns.textContent = talk.replies.length;
    el.sumOk.textContent = talk.ok;
    const box = el.sumReward;
    if (ci && !ci.already) {
      const lines = [`🔥 出席 ${state.streak}日目！ <strong>+${ci.gained}pt</strong>`];
      if (ci.bonus) lines.push(`🎉 ${STREAK_BONUS_EVERY}日連続ボーナス +${STREAK_BONUS}pt`);
      if (ci.usedRest) lines.push("💤 昨日の分は休息券で連続記録を守りました");
      box.innerHTML = lines.join("<br>");
      box.hidden = false;
      toast(`+${ci.gained}pt 獲得`);
    } else if (ci && ci.already) {
      box.textContent = "今日の出席は記録済みです。";
      box.hidden = false;
    } else {
      box.textContent = "最後まで会話を終えると出席になります（+10pt）。";
      box.hidden = false;
    }
    el.sumReplies.innerHTML = "";
    if (!talk.replies.length) {
      const li = document.createElement("li");
      li.textContent = "返事はまだありません。";
      el.sumReplies.appendChild(li);
    }
    talk.replies.forEach(r => {
      const li = document.createElement("li");
      li.className = r.ok ? "ok" : r.ok === null ? "voice" : "ng";
      li.innerHTML = "<span class=\"sr-mark\"></span><span class=\"sr-body\"><b lang=\"ko\"></b><small lang=\"ko\"></small></span>";
      li.querySelector(".sr-mark").textContent = r.ok ? "✓" : r.ok === null ? "🎙️" : "💡";
      li.querySelector("b").textContent = r.ko || "（録音の返事）";
      li.querySelector("small").textContent = r.ok ? "" : `例）${r.hint}`;
      if (r.audio) {
        const play = document.createElement("button");
        play.type = "button";
        play.className = "b-voice";
        play.textContent = "▶ 聞く";
        const a = new Audio(r.audio);
        play.addEventListener("click", () => { a.currentTime = 0; a.play().catch(() => {}); });
        li.querySelector(".sr-body").appendChild(play);
      }
      el.sumReplies.appendChild(li);
    });
    const hasLesson = th.lesson != null;
    el.btnSumPron.hidden = !hasLesson;
    el.btnSumQuiz.hidden = !hasLesson;
    el.talkMain.hidden = true;
    el.talkSummary.hidden = false;
    document.body.classList.remove("focus");
    window.scrollTo(0, 0);
  }

  el.btnSumHome.addEventListener("click", () => showView("home"));
  el.btnSumRetry.addEventListener("click", () => startTalk(talk.theme.id));
  el.btnSumPron.addEventListener("click", () => openPractice(talk.theme.lesson, "sentence", "summary"));
  el.btnSumQuiz.addEventListener("click", () => openPractice(talk.theme.lesson, "quiz", "summary"));

  // ===== 復習 =====
  function renderReview() {
    el.reviewThemes.innerHTML = "";
    ["中級", "初級"].forEach(level => {
      const h = document.createElement("h2");
      h.className = "review-level";
      h.textContent = level;
      el.reviewThemes.appendChild(h);
      THEMES.filter(th => th.level === level).forEach(th => {
        const card = document.createElement("div");
        card.className = "card review-card";
        const head = document.createElement("div");
        head.className = "tc-head";
        head.innerHTML = "<b class=\"tc-title\"></b><span class=\"tc-ko\" lang=\"ko\"></span>";
        head.firstChild.textContent = th.title;
        head.lastChild.textContent = th.ko;
        card.appendChild(head);
        const meta = document.createElement("p");
        meta.className = "review-meta";
        const parts = [state.talkDone[th.id] ? "✅ 会話済み" : "会話はまだ"];
        if (th.lesson != null) {
          const done = state.completed[th.lesson];
          parts.push(done ? `クイズ最高 ${done.score}点` : "クイズ未受験");
          const mada = (state.mada[th.lesson] || []).length;
          if (mada) parts.push(`「まだ」${mada}語`);
        }
        meta.textContent = parts.join("　・　");
        card.appendChild(meta);
        const row = document.createElement("div");
        row.className = "review-actions";
        const add = (label, fn, primary) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = primary ? "btn cta" : "btn ghost";
          b.textContent = label;
          b.addEventListener("click", fn);
          row.appendChild(b);
        };
        if (th.lesson != null) {
          add("🐢 単語カード", () => openPractice(th.lesson, "words", "review"), true);
          add("🔤 単語クイズ", () => openPractice(th.lesson, "quiz", "review"));
          add("📖 例文", () => openPractice(th.lesson, "sentence", "review"));
        } else {
          const det = document.createElement("details");
          det.className = "expr-box mini";
          det.innerHTML = "<summary>使える表現を見る</summary><ul class=\"expr-list\"></ul>";
          th.expressions.forEach(x => {
            const li = document.createElement("li");
            li.innerHTML = "<b lang=\"ko\"></b><small></small>";
            li.firstChild.textContent = x.ko;
            li.lastChild.textContent = x.ja;
            det.querySelector("ul").appendChild(li);
          });
          card.appendChild(det);
        }
        add("💬 会話を練習", () => startTalk(th.id));
        card.appendChild(row);
        el.reviewThemes.appendChild(card);
      });
    });
  }

  // ===== テーマごとの練習（単語カード・単語クイズ・今日の例文） =====
  const QUIZ_POINTS_PER_CORRECT = 2;
  let quiz = null;          // { items: [{ko, ja, kana, inSentence, review, options[]}], i, answers: [bool], main }
  let wordIdx = 0;
  let wordsStudied = false; // この練習で単語カードを最後まで見たか
  let revealed = new Set(); // 意味を表示したカード
  let practiceOrigin = "review"; // 練習を終えたら戻る画面（review / summary / home）

  const tagLabel = w => (w.review ? "復習（まだ）" : w.inSentence ? "例文の単語" : "関連する新しい単語");
  const setTag = (node, w) => {
    node.textContent = tagLabel(w);
    node.classList.toggle("new", !w.inSentence && !w.review);
    node.classList.toggle("review", !!w.review);
  };
  const lessonNo = () => state.idx % window.SENTENCES.length;
  const madaList = () => state.mada[lessonNo()] || [];
  // 単語の例文：例文に出てくる単語はレッスンの例文、関連語は専用の例文
  const exampleOf = w => (w.exKo ? { ko: w.exKo, ja: w.exJa } : { ko: current().ko, ja: current().ja });

  // 単語の音声（ElevenLabs で生成した mp3）
  const wordAudio = new Audio();
  function playWord(w) {
    wordAudio.pause();
    wordAudio.src = w.audio;
    const p = wordAudio.play();
    if (p && p.catch) p.catch(() => toast("音声を再生できませんでした"));
  }

  function showStep(step) {
    ["Words", "Sentence", "Quiz", "Score"].forEach(k => {
      el[`step${k}`].hidden = step !== k.toLowerCase();
    });
    practiceFocus = step === "quiz" || step === "words";
    showView("practice");
  }

  function openPractice(lesson, step, origin) {
    state.idx = lesson;
    save();
    practiceOrigin = origin;
    wordsStudied = false;
    revealed = new Set();
    renderSentence();
    setExpl(false);
    if (step === "words") startWords();
    else if (step === "quiz") startQuiz();
    else showStep("sentence");
  }

  function leavePractice() {
    practiceFocus = false;
    quiz = null;
    showView(practiceOrigin === "summary" ? "talk" : practiceOrigin);
  }

  // ----- 単語カード -----
  function startWords() {
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
    setTag(el.wordTag, w);
    el.wordKana.textContent = `（${w.kana}）`;
    el.wordJa.textContent = w.ja;
    const ex = exampleOf(w);
    el.wordSentence.innerHTML = "<span lang=\"ko\"></span><small></small>";
    el.wordSentence.firstChild.textContent = ex.ko;
    el.wordSentence.lastChild.textContent = ex.ja;
    const shown = revealed.has(w.ko);
    el.wordBack.hidden = !shown;
    el.btnReveal.hidden = shown;
    el.rateRow.hidden = !shown;
    const mada = madaList().includes(w.ko);
    el.btnMada.classList.toggle("on", mada);
    el.btnOboeta.classList.toggle("on", shown && !mada);
    el.btnWordPrev.disabled = wordIdx === 0;
    // 意味を一度表示するまで「次へ」は押せない
    el.btnWordNext.disabled = !shown;
    el.btnWordNext.textContent = wordIdx === words.length - 1 ? "完了 →" : "次へ →";
  }

  el.btnReveal.addEventListener("click", () => {
    revealed.add(current().words[wordIdx].ko);
    renderWord();
  });
  el.btnWordSpeak.addEventListener("click", () => playWord(current().words[wordIdx]));

  function rateWord(isMada) {
    const ko = current().words[wordIdx].ko;
    const list = madaList().filter(k => k !== ko);
    if (isMada) list.push(ko);
    state.mada[lessonNo()] = list;
    save();
    goNextWord();
  }
  el.btnMada.addEventListener("click", () => rateWord(true));
  el.btnOboeta.addEventListener("click", () => rateWord(false));

  function goNextWord() {
    if (wordIdx < current().words.length - 1) { wordIdx++; renderWord(); return; }
    wordsStudied = true;
    const n = madaList().length;
    toast(n ? `単語カード完了！「まだ」の ${n} 語はクイズの後に復習します` : "単語カード完了！");
    leavePractice();
  }
  el.btnWordPrev.addEventListener("click", () => { if (wordIdx > 0) { wordIdx--; renderWord(); } });
  el.btnWordNext.addEventListener("click", () => { if (!el.btnWordNext.disabled) goNextWord(); });
  el.btnWordsClose.addEventListener("click", leavePractice);

  // ----- 発音チェック -----
  el.btnSentenceHome.addEventListener("click", leavePractice);
  el.btnToQuiz.addEventListener("click", startQuiz);

  // 「表現を確認」：例文の意味と文法ポイントを日本語で表示（開閉）
  function renderExpl() {
    const e = current().expl;
    el.explSummary.textContent = e.summary;
    el.explGrammar.innerHTML = "";
    e.grammar.forEach(g => {
      const dt = document.createElement("dt");
      dt.lang = "ko";
      dt.textContent = g.form;
      const dd = document.createElement("dd");
      dd.textContent = g.ja;
      el.explGrammar.append(dt, dd);
    });
  }
  function setExpl(open) {
    if (open) renderExpl();
    el.explBox.hidden = !open;
    el.btnExpl.setAttribute("aria-expanded", String(open));
    el.btnExpl.textContent = open ? "📝 解説を閉じる" : "📝 表現を確認";
  }
  el.btnExpl.addEventListener("click", () => setExpl(el.explBox.hidden));

  // ----- 関連単語クイズ（例文の単語4語 ＋ 関連する新しい単語6語 ＋「まだ」の復習） -----
  function makeItem(w, words, review) {
    return {
      ko: w.ko, ja: w.ja, kana: w.kana, inSentence: !!w.inSentence, review, ex: exampleOf(w),
      options: shuffle([w.ja, ...shuffle(words.filter(x => x.ja !== w.ja)).slice(0, 3).map(x => x.ja)])
    };
  }

  function startQuiz() {
    const words = current().words;
    // 例文の単語を先に、関連する新しい単語を後に出す（それぞれの中ではランダム）
    const ordered = [...shuffle(words.filter(w => w.inSentence)), ...shuffle(words.filter(w => !w.inSentence))];
    const items = ordered.map(w => makeItem(w, words, false));
    // 単語カードで「まだ」にした単語は、クイズの後にもう一度出す（採点には含めない）
    madaList().forEach(ko => {
      const w = words.find(x => x.ko === ko);
      if (w) items.push(makeItem(w, words, true));
    });
    quiz = { items, i: 0, answers: [], main: ordered.length };
    showStep("quiz");
    renderQuestion();
  }

  function renderQuestion() {
    const q = quiz.items[quiz.i];
    const n = quiz.items.length;
    el.quizBar.style.width = `${(quiz.i / n) * 100}%`;
    el.quizNo.textContent = q.review ? `復習 ${quiz.i - quiz.main + 1} / ${n - quiz.main}` : `${quiz.i + 1} / ${quiz.main}`;
    el.quizWord.textContent = q.ko;
    setTag(el.quizTag, q);
    el.quizFeedback.hidden = true;
    el.quizOptions.innerHTML = "";
    q.options.forEach((opt, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.innerHTML = `<span class="num">${k + 1}</span><span class="opt-text"></span><span class="opt-mark"></span>`;
      b.querySelector(".opt-text").textContent = opt;
      b.addEventListener("click", () => answer(opt, b));
      el.quizOptions.appendChild(b);
    });
    el.btnSkip.disabled = false;
  }

  // 回答したら文字で正誤を出し、正解と例文を見せる。「次へ」を押すまで進まない
  function answer(choice, btn) {
    const q = quiz.items[quiz.i];
    if (quiz.answers[quiz.i] !== undefined) return;
    const ok = choice === q.ja;
    quiz.answers[quiz.i] = ok;
    if (ok) sfx.correct(); else sfx.wrong();
    el.btnSkip.disabled = true;
    el.quizOptions.querySelectorAll(".opt").forEach(b => {
      b.disabled = true;
      if (b.querySelector(".opt-text").textContent === q.ja) {
        b.classList.add("correct");
        b.querySelector(".opt-mark").textContent = "正解";
      }
    });
    if (btn && !ok) {
      btn.classList.add("wrong");
      btn.querySelector(".opt-mark").textContent = "あなたの回答";
    }
    el.qfTitle.textContent = ok ? "⭕ 正解！" : choice === null ? "スキップ（不正解）" : "❌ 不正解";
    el.qfTitle.className = "qf-title " + (ok ? "ok" : "ng");
    el.qfAnswer.innerHTML = "<b lang=\"ko\"></b><span></span>";
    el.qfAnswer.firstChild.textContent = `${q.ko}（${q.kana}）`;
    el.qfAnswer.lastChild.textContent = ` ＝ ${q.ja}`;
    el.qfEx.innerHTML = "<span lang=\"ko\"></span><small></small>";
    el.qfEx.firstChild.textContent = `例）${q.ex.ko}`;
    el.qfEx.lastChild.textContent = q.ex.ja;
    el.btnQuizNext.textContent = quiz.i === quiz.items.length - 1 ? "結果を見る →" : "次へ →";
    el.quizFeedback.hidden = false;
    el.quizFeedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function nextQuestion() {
    quiz.i++;
    if (quiz.i < quiz.items.length) renderQuestion();
    else finishQuiz();
  }

  el.btnSkip.addEventListener("click", () => answer(null, null));
  el.btnQuizNext.addEventListener("click", nextQuestion);
  // ✕：確認なしで元の画面に戻る（結果は記録しない）
  el.btnQuizClose.addEventListener("click", leavePractice);

  function finishQuiz() {
    const n = quiz.main;
    const correct = quiz.answers.slice(0, n).filter(Boolean).length;
    const score = Math.round((correct / n) * 100);
    const prev = state.lastQuizScore;
    // 復習で正解した「まだ」単語はリストから外す
    const reviewedOk = quiz.items.filter((q, k) => q.review && quiz.answers[k]).map(q => q.ko);
    state.mada[lessonNo()] = madaList().filter(k => !reviewedOk.includes(k));
    // クイズのポイントは1日1回だけ
    let gained = 0;
    if (state.quizDate !== today()) {
      gained = correct * QUIZ_POINTS_PER_CORRECT;
      state.points += gained;
      state.quizDate = today();
    }
    state.lastQuizScore = score;
    const before = state.completed[lessonNo()];
    state.completed[lessonNo()] = { date: today(), score: Math.max(score, before ? before.score : 0) };
    save();
    renderPoints();
    renderScoreSheet({ correct, n, score, prev, gained });
    showStep("score");
  }

  function coachMessage(score, prev) {
    if (prev != null && score > prev) return { ja: `前回より ${score - prev} 点アップ！この調子で続けよう！`, ko: `지난번보다 ${score - prev}점 올랐어요! 이대로 계속해 봐요!` };
    if (score === 100) return { ja: "全問正解！完璧です。明日もこの調子で！", ko: "만점이에요! 완벽해요. 내일도 이렇게 해 봐요!" };
    if (score >= 70) return { ja: "いい感じ！間違えた単語だけ見直しておこう。", ko: "좋아요! 틀린 단어만 다시 봐 둬요." };
    return { ja: "大丈夫、ここからです。次は「単語カード」から始めてみよう！", ko: "괜찮아요, 지금부터예요. 다음에는 '단어 카드'부터 시작해 봐요!" };
  }

  function renderScoreSheet({ correct, n, score, prev, gained }) {
    const th = themeOfLesson(lessonNo());
    el.stepIcoWords.classList.toggle("done", wordsStudied);
    el.stepIcoTalk.classList.toggle("done", !!(th && state.talkDone[th.id]));
    el.quizCorrect.textContent = correct;
    el.quizTotal.textContent = n;
    el.vocabScore.textContent = score;
    const main = quiz.items.slice(0, n).map((q, k) => [q, quiz.answers[k]]);
    const cIn = main.filter(([q, ok]) => q.inSentence && ok).length;
    const cNew = main.filter(([q, ok]) => !q.inSentence && ok).length;
    const parts = [`例文の単語 ${cIn}/4・新しい単語 ${cNew}/6`];
    if (prev != null) parts.push(`前回 ${prev}`);
    parts.push(gained ? `+${gained}pt` : "本日のpt獲得済み");
    el.scoreSub.textContent = parts.join("　/　");
    // 吹き出しは言語バランス設定に合わせて主言語を決め、もう一方を小さく添える
    const msg = coachMessage(score, prev);
    const mainLang = state.ratio === "ja6" ? "ja" : "ko";
    const sub = mainLang === "ja" ? "ko" : "ja";
    el.coachMsg.innerHTML = "<span></span><small></small>";
    el.coachMsg.firstChild.textContent = msg[mainLang];
    el.coachMsg.firstChild.lang = mainLang;
    el.coachMsg.lastChild.textContent = msg[sub];
    el.coachMsg.lastChild.lang = sub;

    const wrong = quiz.items.filter((q, k) => !q.review && !quiz.answers[k]);
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

  el.btnScoreHome.addEventListener("click", leavePractice);

  // ===== 記録：練習時間 =====
  function renderMinutes() {
    el.recToday.textContent = Math.floor(secOn(today()) / 60);
    el.recWeek.textContent = Math.floor(sumSec(7) / 60);
    el.rec4w.textContent = Math.floor(sumSec(28) / 60);
    el.weekBars.innerHTML = "";
    const max = Math.max(state.goal * 60, ...Array.from({ length: 7 }, (_, i) => secOn(addDays(today(), -i))));
    for (let i = 6; i >= 0; i--) {
      const k = addDays(today(), -i);
      const s = secOn(k);
      const d = document.createElement("div");
      d.className = "wb" + (i === 0 ? " today" : "");
      d.innerHTML = `<span class="wb-bar"><i style="height:${Math.round((s / max) * 100)}%"></i></span><small>${dowJa(k)}</small><b>${Math.floor(s / 60)}</b>`;
      el.weekBars.appendChild(d);
    }
  }

  // ===== 設定画面の開閉・目標 =====
  el.btnSettings.addEventListener("click", () => showView("settings"));
  el.btnSettingsBack.addEventListener("click", () => showView(prevView === "settings" ? "home" : prevView));
  document.querySelectorAll('input[name="goal"]').forEach(r => {
    r.addEventListener("change", () => {
      state.goal = Number(r.value);
      save();
      toast(`1日の目標を ${state.goal} 分にしました`);
    });
  });
  const syncGoal = () => document.querySelectorAll('input[name="goal"]').forEach(r => { r.checked = Number(r.value) === state.goal; });

  // ===== 初期表示 =====
  syncRatio();
  syncGoal();
  renderSentence();
  renderDiagnostics();
  showView("home");
})();
