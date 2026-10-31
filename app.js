(() => {
  "use strict";

  // ===== 設定値 =====
  const POINTS_PER_DAY = 10;
  const STREAK_BONUS_EVERY = 7;
  const STREAK_BONUS = 30;
  const EXCHANGE_COST = 300;
  const MAX_REC_SEC = 10;
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
    idx: 0
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
    btnModel: $("btnModel"), btnNext: $("btnNext"),
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
    toast: $("toast")
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

  el.btnNext.addEventListener("click", () => {
    state.idx = (state.idx + 1) % window.SENTENCES.length;
    save();
    resetRecording();
    renderSentence();
  });

  // お手本音声：現在はブラウザ内蔵の音声合成
  // TODO(API): 本番ではネイティブ録音または ElevenLabs 等で生成した音声ファイルに差し替え
  el.btnModel.addEventListener("click", () => {
    if (!("speechSynthesis" in window)) { toast("この端末では音声再生に対応していません"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(current().ko);
    u.lang = "ko-KR";
    u.rate = 0.9;
    const ko = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith("ko"));
    if (ko) u.voice = ko;
    speechSynthesis.speak(u);
  });

  // ===== 録音 =====
  let recorder = null, chunks = [], recBlob = null, recStart = 0, recDuration = null, recTimer = null, stream = null;
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  if (!canRecord) {
    el.btnNoMic.hidden = false;
    el.recStatus.textContent = "このブラウザでは録音できません";
  }

  function resetRecording() {
    recBlob = null; recDuration = null;
    el.playback.hidden = true;
    el.playback.removeAttribute("src");
    el.btnEvaluate.hidden = true;
    el.resultCard.hidden = true;
    el.recordCard.hidden = false;
    el.btnRec.classList.remove("recording");
    el.recStatus.textContent = canRecord ? "マイクをタップして録音" : "このブラウザでは録音できません";
  }

  el.btnRec.addEventListener("click", async () => {
    if (!canRecord) { toast("下のボタンから録音なしでお試しください"); return; }
    if (recorder && recorder.state === "recording") { recorder.stop(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      el.btnNoMic.hidden = false;
      el.recStatus.textContent = "マイクの使用が許可されませんでした";
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(recTimer);
      stream.getTracks().forEach(t => t.stop());
      recDuration = (Date.now() - recStart) / 1000;
      recBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      el.playback.src = URL.createObjectURL(recBlob);
      el.playback.hidden = false;
      el.btnEvaluate.hidden = false;
      el.btnRec.classList.remove("recording");
      el.btnRec.setAttribute("aria-label", "録音し直す");
      el.recStatus.textContent = `録音完了（${recDuration.toFixed(1)}秒）。もう一度タップで録り直し`;
    };
    recorder.start();
    recStart = Date.now();
    el.btnRec.classList.add("recording");
    el.btnRec.setAttribute("aria-label", "録音停止");
    el.playback.hidden = true;
    el.btnEvaluate.hidden = true;
    recTimer = setInterval(() => {
      const sec = (Date.now() - recStart) / 1000;
      el.recStatus.textContent = `録音中… ${sec.toFixed(1)}秒（タップで停止）`;
      if (sec >= MAX_REC_SEC) recorder.stop();
    }, 100);
  });

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
    renderStreak();
    syncRatio();
  });

  // ===== 設定 =====
  function syncRatio() {
    document.querySelectorAll('input[name="ratio"]').forEach(r => { r.checked = r.value === state.ratio; });
  }
  document.querySelectorAll('input[name="ratio"]').forEach(r => {
    r.addEventListener("change", () => {
      state.ratio = r.value;
      save();
      toast(r.value === "ja6" ? "日本語6：韓国語4 に設定しました" : "日本語4：韓国語6 に設定しました");
    });
  });

  // ===== 初期表示 =====
  syncRatio();
  renderSentence();
  renderStreak();
})();
