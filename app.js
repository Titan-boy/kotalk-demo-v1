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
    completed: {},       // 完了したレッスン { レッスン番号: { date, score } }
    mada: {},            // 単語カードで「まだ」にした単語 { レッスン番号: [ko, ...] }
    quizDate: null,      // 単語テストを最後に受けた日（ポイントは1日1回）
    lastQuizScore: null,
    goal: 15,            // 1日の目標（分）
    practice: {},        // 練習時間 { "YYYY-MM-DD": 秒 }
    sessions: [],        // 最近の練習 [{ theme, date, sec, ok, turns }]
    level: "中級",        // ホームで選んでいるレベル
    talkDone: {}         // 会話を終えたテーマ { themeId: { date, ok, turns } }
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
    const files = { correct: "audio/sfx/correct.mp3", wrong: "audio/sfx/wrong.mp3", tick: "audio/sfx/tick.mp3" };
    const players = {};
    Object.entries(files).forEach(([k, src]) => {
      const a = new Audio(src);
      a.preload = "auto";
      players[k] = a;
    });
    let unlocked = false;
    // iOS ではタップ操作の中で一度再生しておかないと、後からの再生（録音カウントなど）が許可されない
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
      wrong: () => play("wrong"),     // 띵-!
      tick: () => play("tick")        // 録音の残り 3・2・1
    };
  })();
  // 最初のタップで効果音を使えるようにしておく
  document.addEventListener("pointerdown", () => sfx.unlock(), { once: true, capture: true });

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
    btnModel: $("btnModel"), btnExpl: $("btnExpl"), explBox: $("explBox"), explSummary: $("explSummary"), explGrammar: $("explGrammar"), btnToQuiz: $("btnToQuiz"),
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

  // ===== 録音 =====
  // MediaRecorder が使えれば利用し、無い端末（古い iOS など）では Web Audio で WAV を作る
  let rec = null, recBlob = null, recStart = 0, recDuration = null, recTimer = null, stream = null;

  function noRecordReason() {
    if (!window.isSecureContext) return "録音には https で開く必要があります";
    if (IN_APP) return "アプリ内ブラウザでは録音できません。Safari / Chrome で開いてください";
    // iPhone で https なのにマイクの機能自体が無い → ロックダウンモードでブロックされている可能性が高い
    if (IS_IOS && !HAS_GUM) return "iPhoneの「ロックダウンモード」でマイクが使えない状態です。このサイトをロックダウンモードから除外してください";
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
      if (micPerm !== "granted") { micPerm = "granted"; renderDiagnostics(); }
    } catch (e) {
      el.btnNoMic.hidden = false;
      const name = e && e.name;
      const noDevice = name === "NotFoundError" || name === "OverconstrainedError";
      if (!noDevice) micPerm = "denied";
      // マイクがない場合以外は、ほぼ権限の問題なので許可の手順を出す
      el.recStatus.textContent = noDevice
        ? "マイクが見つかりませんでした（イヤホンのマイク等を接続してください）"
        : `マイクの使用が許可されていません。${micHowTo()}`;
      renderDiagnostics();
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

  function playLine(src) {
    partnerAudio.pause();
    partnerAudio.src = src;
    const p = partnerAudio.play();
    if (p && p.catch) p.catch(() => {});
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

  function startTalk(id) {
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
    const src = lineAudio(th, n + 1);
    addBubble("partner", div => {
      div.innerHTML = "<p class=\"b-ko\" lang=\"ko\"></p><p class=\"b-ja\"></p><button class=\"b-listen\" type=\"button\">🔊 聞く</button>";
      div.querySelector(".b-ko").textContent = line.ko;
      div.querySelector(".b-ja").textContent = line.ja;
      div.querySelector(".b-listen").addEventListener("click", () => playLine(src));
    });
    if (el.autoRead.checked) playLine(src);
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
  //   audioUrl: 録音した返事（文字入力のときは null）
  function handleReply(text, audioUrl) {
    const turn = talk.theme.turns[talk.i];
    const judged = !!text;
    // キーワードが入っていれば「ぴったり」、入っていなくても自然な韓国語の返事なら「通じた」
    const exact = judged && hasHangul(text) && understood(text, turn.kw);
    const ok = exact || (judged && hasHangul(text) && !turn.require && naturalReply(text, turn));
    addBubble("me", div => {
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
      const mark = document.createElement("span");
      mark.className = "b-mark";
      mark.textContent = !judged ? "🎙️ 録音で返事しました" : ok ? "✓ 通じました" : "💡 もう少し";
      div.appendChild(mark);
      div.classList.toggle("ok", ok);
      div.classList.toggle("voice", !!audioUrl);
    });
    talk.replies.push({ ko: text, ok: judged ? ok : null, hint: turn.hint.ko, turn: talk.i, audio: audioUrl });

    // 文字起こしができない端末では内容を判定できないので、参考の答えを見せて先に進む
    if (!judged) {
      addBubble("system", div => {
        div.innerHTML = "<p class=\"b-note\">この端末では音声の文字起こしができないため、内容は判定していません。</p><p class=\"b-ja\"></p><p class=\"b-ko\" lang=\"ko\"></p>";
        div.querySelector(".b-ja").textContent = "参考の答えと聞き比べてみましょう。";
        div.querySelector(".b-ko").textContent = `例）${turn.hint.ko}`;
      });
      nextTurn();
      return;
    }
    if (ok) {
      sfx.correct();
      talk.ok++;
      if (!exact) {
        addBubble("system tip", div => {
          div.innerHTML = "<p class=\"b-ja\">💬 こんな言い方もできます</p><p class=\"b-ko\" lang=\"ko\"></p>";
          div.querySelector(".b-ko").textContent = turn.hint.ko;
        });
      }
      nextTurn();
      return;
    }
    talk.tries++;
    if (!hasHangul(text)) {
      showHint(turn, "韓国語（ハングル）で書いてみましょう。");
    } else if (talk.tries >= 2) {
      showHint(turn, "この言い方も覚えておきましょう。会話は先に進みます。");
      nextTurn();
    } else {
      showHint(turn, turn.require && naturalReply(text, turn)
        ? "韓国語としては通じますが、この場面では今日の表現を使ってみましょう。"
        : "相手にうまく伝わらなかったようです。ヒントを見てもう一度どうぞ。");
    }
  }

  function nextTurn() {
    talk.i++;
    talk.tries = 0;
    setTimeout(() => {
      if (!talk || talk.done) return;
      partnerSay(talk.i);
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
  // TODO(API): 本番では録音データを音声認識API（サーバー経由）に送り、どの端末でも判定できるようにする
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TALK_MAX_SEC = 15;
  let talkRec = null; // { rec, stream, start, timer, sr, transcript }

  function resetTalkMic() {
    el.btnTalkMic.classList.remove("on");
    el.btnTalkMic.textContent = "🎤";
    el.btnTalkMic.setAttribute("aria-label", "声で返事を録音");
  }

  el.btnTalkMic.addEventListener("click", async () => {
    if (!talk || talk.finished) return;
    if (talkRec) { stopTalkRec(); return; }
    if (!canRecord) {
      // 録音できない端末でも、キーボードの音声入力（🎤）なら文字で返事できる
      el.micStatus.textContent = `${noRecordReason()}。今はキーボードの🎤（音声入力）で返事できます`;
      el.talkInput.focus();
      return;
    }
    sfx.unlock();
    partnerAudio.pause();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (micPerm !== "granted") { micPerm = "granted"; renderDiagnostics(); }
    } catch (e) {
      const noDevice = e && (e.name === "NotFoundError" || e.name === "OverconstrainedError");
      if (!noDevice) micPerm = "denied";
      renderDiagnostics();
      el.micStatus.textContent = noDevice ? "マイクが見つかりませんでした" : `マイクが許可されていません。${micHowTo()}`;
      return;
    }
    let r = null;
    try {
      r = HAS_MR ? startMediaRecorder(stream) : startWavRecorder(stream);
    } catch (e) {
      try { r = HAS_WEBAUDIO ? startWavRecorder(stream) : null; } catch (e2) { r = null; }
    }
    if (!r) {
      stream.getTracks().forEach(t => t.stop());
      el.micStatus.textContent = "録音を開始できませんでした";
      return;
    }
    const tr = { rec: r, stream, start: Date.now(), transcript: "", sr: null };
    talkRec = tr;
    // 文字起こし（対応端末のみ。失敗しても録音はそのまま続ける）
    if (SR) {
      try {
        const s = new SR();
        s.lang = "ko-KR";
        s.interimResults = true;
        s.continuous = true;
        s.onresult = e => { tr.transcript = Array.from(e.results).map(x => x[0].transcript).join(""); };
        s.onerror = () => {};
        s.start();
        tr.sr = s;
      } catch (e) { tr.sr = null; }
    }
    el.btnTalkMic.classList.add("on");
    el.btnTalkMic.textContent = "■";
    el.btnTalkMic.setAttribute("aria-label", "録音を止めて送る");
    tr.timer = setInterval(() => {
      const sec = (Date.now() - tr.start) / 1000;
      el.micStatus.textContent = `🔴 録音中 ${sec.toFixed(1)}秒　もう一度タップで送信`;
      if (sec >= TALK_MAX_SEC) stopTalkRec();
    }, 100);
  });

  async function stopTalkRec(cancel) {
    const tr = talkRec;
    if (!tr) return;
    talkRec = null;
    clearInterval(tr.timer);
    resetTalkMic();
    const dur = (Date.now() - tr.start) / 1000;
    const blob = await tr.rec.stop();
    tr.stream.getTracks().forEach(t => t.stop());
    if (tr.sr) {
      try { tr.sr.stop(); } catch (e) {}
      await new Promise(res => setTimeout(res, 500)); // 最後の文字起こしを待つ
    }
    el.micStatus.textContent = "";
    if (cancel || !talk || talk.finished) return;
    if (dur < 0.6) { el.micStatus.textContent = "短すぎました。もう一度どうぞ"; return; }
    handleReply(tr.transcript.trim(), URL.createObjectURL(blob));
  }

  function finishTalk() {
    if (!talk || talk.done) return;
    talk.done = true;
    partnerAudio.pause();
    if (talkRec) stopTalkRec(true);
    const th = talk.theme;
    if (talk.sec > 0 || talk.replies.length) {
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
          add("🎙️ 発音チェック", () => openPractice(th.lesson, "sentence", "review"));
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

  // ===== テーマごとの練習（単語カード・単語クイズ・発音チェック） =====
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
    resetRecording();
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
