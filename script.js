import { submitScore, fetchTopScores } from "./leaderboard.js";

const GAME_SECONDS = 120;
const COLS = 17;
const ROWS = 10;
const TARGET_SUM = 10;

const gridEl = document.getElementById("apple-grid");
const boardEl = gridEl.parentElement;
const selectionBox = document.getElementById("selection-box");
const sumBadge = document.getElementById("sum-badge");
const scoreEl = document.getElementById("score");
const sideScoreEl = document.getElementById("side-score");
const timeEl = document.getElementById("time");
const timerFillEl = document.getElementById("timer-fill");
const startOverlay = document.getElementById("start-overlay");
const endOverlay = document.getElementById("end-overlay");
const startBtn = document.getElementById("start-btn");
const retryBtn = document.getElementById("retry-btn");
const resetBtn = document.getElementById("reset-btn");
const finalScoreEl = document.getElementById("final-score");
const endTitleEl = document.getElementById("end-title");
const playerNameInput = document.getElementById("player-name");
const submitScoreBtn = document.getElementById("submit-score-btn");
const submitStatusEl = document.getElementById("submit-status");
const paleToggle = document.getElementById("pale-toggle");
const bgmToggle = document.getElementById("bgm-toggle");
const rankingBtn = document.getElementById("ranking-btn");
const rankingModal = document.getElementById("ranking-modal");
const rankingClose = document.getElementById("ranking-close");
const rankingList = document.getElementById("ranking-list");
const rankingSourceNote = document.getElementById("ranking-source-note");

let score = 0;
let timeLeft = GAME_SECONDS;
let playing = false;
let timerId = null;
let apples = [];
let isSelecting = false;
let startX = 0;
let startY = 0;
let clearedCount = 0;
let scoreSubmitted = false;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateValues(total) {
  const values = [];
  for (let i = 0; i < total; i++) {
    values.push(Math.floor(Math.random() * 9) + 1);
  }
  return shuffle(values);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildGrid() {
  gridEl.innerHTML = "";
  apples = [];
  clearedCount = 0;

  const values = generateValues(COLS * ROWS);

  values.forEach((value) => {
    const el = document.createElement("div");
    el.className = "apple";
    const num = document.createElement("span");
    num.textContent = value;
    el.appendChild(num);
    gridEl.appendChild(el);
    apples.push({ value, el, cleared: false, rect: null });
  });
}

function measureRects() {
  const boardRect = boardEl.getBoundingClientRect();
  apples.forEach((apple) => {
    const r = apple.el.getBoundingClientRect();
    apple.rect = {
      left: r.left - boardRect.left,
      top: r.top - boardRect.top,
      right: r.right - boardRect.left,
      bottom: r.bottom - boardRect.top,
    };
  });
}

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function getSelectionRect(curX, curY) {
  return {
    left: Math.min(startX, curX),
    top: Math.min(startY, curY),
    right: Math.max(startX, curX),
    bottom: Math.max(startY, curY),
  };
}

function updateSelectionVisual(sel) {
  selectionBox.hidden = false;
  selectionBox.style.left = `${sel.left}px`;
  selectionBox.style.top = `${sel.top}px`;
  selectionBox.style.width = `${sel.right - sel.left}px`;
  selectionBox.style.height = `${sel.bottom - sel.top}px`;

  let sum = 0;
  apples.forEach((apple) => {
    if (apple.cleared) return;
    const hit = rectsIntersect(apple.rect, sel);
    apple.el.classList.toggle("is-selecting", hit);
    if (hit) sum += apple.value;
  });

  const isMatch = sum === TARGET_SUM;
  selectionBox.classList.toggle("is-match", isMatch);
  apples.forEach((apple) => {
    if (apple.el.classList.contains("is-selecting")) {
      apple.el.classList.toggle("is-match", isMatch);
    }
  });

  sumBadge.hidden = false;
  sumBadge.textContent = sum;
  sumBadge.style.left = `${sel.right}px`;
  sumBadge.style.top = `${sel.top}px`;
  sumBadge.classList.toggle("is-good", isMatch);
  sumBadge.classList.toggle("is-over", sum > TARGET_SUM);
}

function clearSelectionVisual() {
  selectionBox.hidden = true;
  selectionBox.classList.remove("is-match");
  sumBadge.hidden = true;
  apples.forEach((apple) => {
    apple.el.classList.remove("is-selecting");
    apple.el.classList.remove("is-match");
  });
}

function finalizeSelection() {
  const selected = apples.filter((a) => !a.cleared && a.el.classList.contains("is-selecting"));
  const sum = selected.reduce((acc, a) => acc + a.value, 0);

  if (sum === TARGET_SUM && selected.length > 0) {
    selected.forEach((a) => {
      a.cleared = true;
      a.el.classList.remove("is-selecting", "is-match");
      a.el.classList.add("is-cleared");
    });
    clearedCount += selected.length;
    score += selected.length;
    scoreEl.textContent = score;
    sideScoreEl.textContent = score;

    if (clearedCount >= apples.length) {
      endGame(true);
    }
  }

  clearSelectionVisual();
}

function relativePoint(e) {
  const rect = boardEl.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  return {
    x: Math.min(Math.max(point.clientX - rect.left, 0), rect.width),
    y: Math.min(Math.max(point.clientY - rect.top, 0), rect.height),
  };
}

function handlePointerDown(e) {
  if (!playing) return;
  const p = relativePoint(e);
  isSelecting = true;
  startX = p.x;
  startY = p.y;
  measureRects();
  boardEl.setPointerCapture?.(e.pointerId);
  updateSelectionVisual(getSelectionRect(startX, startY));
}

function handlePointerMove(e) {
  if (!isSelecting) return;
  const p = relativePoint(e);
  updateSelectionVisual(getSelectionRect(p.x, p.y));
}

function handlePointerUp(e) {
  if (!isSelecting) return;
  isSelecting = false;
  if (e && typeof e.clientX === "number") {
    const p = relativePoint(e);
    updateSelectionVisual(getSelectionRect(p.x, p.y));
  }
  finalizeSelection();
}

function updateTimerVisual() {
  const pct = Math.max(0, (timeLeft / GAME_SECONDS) * 100);
  timerFillEl.style.height = `${pct}%`;
  timerFillEl.style.setProperty("--time-pct", `${pct}%`);
  timerFillEl.classList.toggle("is-low", timeLeft <= 20);
}

function tick() {
  timeLeft -= 1;
  timeEl.textContent = formatTime(timeLeft);
  updateTimerVisual();
  if (timeLeft <= 0) {
    endGame(false);
  }
}

function startGame() {
  score = 0;
  timeLeft = GAME_SECONDS;
  scoreSubmitted = false;
  scoreEl.textContent = score;
  sideScoreEl.textContent = score;
  timeEl.textContent = formatTime(timeLeft);
  updateTimerVisual();
  playing = true;

  startOverlay.hidden = true;
  endOverlay.hidden = true;
  playerNameInput.value = "";
  submitStatusEl.textContent = "";
  submitScoreBtn.disabled = false;

  buildGrid();
  clearSelectionVisual();

  window.clearInterval(timerId);
  timerId = window.setInterval(tick, 1000);
}

function endGame(cleared) {
  playing = false;
  isSelecting = false;
  window.clearInterval(timerId);
  clearSelectionVisual();

  if (cleared) {
    const elapsed = GAME_SECONDS - timeLeft;
    endTitleEl.textContent = `올 클리어! 🎉 (${formatTime(elapsed)} 소요)`;
  } else {
    endTitleEl.textContent = "시간 종료!";
  }
  finalScoreEl.textContent = score;
  endOverlay.hidden = false;
}

async function handleSubmitScore() {
  if (scoreSubmitted) return;
  const name = playerNameInput.value.trim();
  if (!name) {
    submitStatusEl.textContent = "이름을 입력해주세요.";
    return;
  }
  submitScoreBtn.disabled = true;
  submitStatusEl.textContent = "등록 중...";
  try {
    const result = await submitScore(name, score);
    scoreSubmitted = true;
    submitStatusEl.textContent = result.online
      ? "온라인 랭킹에 등록되었습니다!"
      : "로컬 랭킹에 저장되었습니다 (온라인 랭킹 미설정)";
  } catch (err) {
    console.error(err);
    submitStatusEl.textContent = "등록에 실패했습니다. 다시 시도해주세요.";
    submitScoreBtn.disabled = false;
  }
}

async function openRanking() {
  rankingModal.hidden = false;
  rankingList.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  try {
    const { online, scores } = await fetchTopScores();
    rankingSourceNote.textContent = online
      ? "온라인 공유 랭킹"
      : "로컬 랭킹 (이 브라우저에만 저장됨 · firebase-config.js 설정 시 온라인 공유 가능)";

    if (!scores || scores.length === 0) {
      rankingList.innerHTML = '<li class="ranking-empty">아직 등록된 기록이 없습니다.</li>';
      return;
    }

    rankingList.innerHTML = scores
      .map(
        (s, idx) => `
        <li>
          <span class="rank">${idx + 1}</span>
          <span class="name">${escapeHtml(s.name ?? "익명")}</span>
          <span class="score">${s.score}점</span>
        </li>`
      )
      .join("");
  } catch (err) {
    console.error(err);
    rankingList.innerHTML = '<li class="ranking-empty">랭킹을 불러오지 못했습니다.</li>';
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

let audioCtx = null;
let bgmNodes = null;

function startBgm() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const master = audioCtx.createGain();
  master.gain.value = 0.05;
  master.connect(audioCtx.destination);

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.connect(master);

  const notes = [261.63, 329.63, 392.0, 440.0];
  const oscillators = notes.map((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(filter);
    osc.start();

    const now = audioCtx.currentTime;
    for (let t = 0; t < 60; t += 4) {
      const start = now + t + i * 1;
      gain.gain.setTargetAtTime(0.15, start, 0.5);
      gain.gain.setTargetAtTime(0, start + 2, 0.5);
    }
    return { osc, gain };
  });

  bgmNodes = { master, filter, oscillators };
}

function stopBgm() {
  if (!audioCtx) return;
  bgmNodes?.oscillators.forEach(({ osc }) => osc.stop());
  audioCtx.close();
  audioCtx = null;
  bgmNodes = null;
}

boardEl.addEventListener("pointerdown", handlePointerDown);
window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);

startBtn.addEventListener("click", startGame);
retryBtn.addEventListener("click", startGame);
resetBtn.addEventListener("click", startGame);
submitScoreBtn.addEventListener("click", handleSubmitScore);

rankingBtn.addEventListener("click", openRanking);
rankingClose.addEventListener("click", () => {
  rankingModal.hidden = true;
});
rankingModal.addEventListener("click", (e) => {
  if (e.target === rankingModal) rankingModal.hidden = true;
});

paleToggle.addEventListener("change", () => {
  gridEl.classList.toggle("is-pale", paleToggle.checked);
});

bgmToggle.addEventListener("change", () => {
  if (bgmToggle.checked) startBgm();
  else stopBgm();
});

buildGrid();
updateTimerVisual();
