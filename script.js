import { submitScore, fetchTopScores, getNextReset, fetchScoresForAdmin, fetchMyScores } from "./leaderboard.js?v=67";
import { findTargeted } from "./profanity.js?v=67";
import {
  ROULETTE_MIN_SCORE,
  DAILY_SPINS,
  segments,
  drawPrize,
  recordPrize,
  watchPrizes,
  remainingSpins,
  nextResetAt,
  fetchMyPrizes,
  PRIZES,
  fetchTodayPrizes,
} from "./roulette.js?v=67";
import { nicknameKey } from "./profanity.js?v=67";
import {
  TICKET_KINDS,
  issueTicket,
  myTickets,
  verifyTicket,
  useTicket,
  transferTicket,
  prettySerial,
} from "./shop.js?v=67";
import {
  makeRoomCode,
  setGuestStakes,
  myStakes,
  createRoom,
  joinRoom,
  submitResult,
  watchRoom,
  openRooms,
  recentDuels,
  duelWinner,
  forfeit,
  isForfeitWin,
} from "./duel.js?v=67";
import {
  activeEvent,
  upcomingEvent,
  claimEvent,
  fetchMyEventPrizes,
  watchEventWinners,
  EVENT_PRIZE,
} from "./event.js?v=67";
import {
  getNickname,
  setNickname,
  checkNickname,
  hasNickname,
  sendMessage,
  watchMessages,
  startPresence,
  reportCheat,
  isBlockedOnServer,
  getTargetedViolation,
  fetchBlockedList,
  fetchRecentMessages,
  fetchChatLocked,
  deleteMessages,
  blockTargets,
  reserveNickname,
  clearNickname,
} from "./chat.js?v=67";

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
const submitScoreBtnFixed = document.getElementById("submit-score-btn-fixed");
const scoreNickSetup = document.getElementById("score-nick-setup");
const scoreNickFixed = document.getElementById("score-nick-fixed");
const scoreNicknameEl = document.getElementById("score-nickname");
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
let clearEvents = 0;
let startedAt = 0;
let finishedAt = 0;

// 리플레이 검증을 위해 보드를 시드로 만든다.
// 같은 시드면 언제든 똑같은 배치를 다시 만들 수 있어,
// 기록된 수순을 그대로 재생해 진짜 플레이인지 확인할 수 있다.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function boardFromSeed(seed, total) {
  const rand = mulberry32(seed);
  const values = [];
  for (let i = 0; i < total; i++) values.push(Math.floor(rand() * 9) + 1);
  return values;
}

let boardSeed = 0;
let moves = [];

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildGrid(fixedSeed) {
  gridEl.innerHTML = "";
  apples = [];
  clearedCount = 0;

  boardSeed = Number.isInteger(fixedSeed)
    ? fixedSeed
    : Math.floor(Math.random() * 2147483647);
  moves = [];
  const values = boardFromSeed(boardSeed, COLS * ROWS);

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
    // 리플레이용 수순: [경과 밀리초, 지운 칸 번호들]
    moves.push([
      Date.now() - startedAt,
      selected.map((a) => apples.indexOf(a)),
    ]);
    selected.forEach((a) => {
      a.cleared = true;
      a.el.classList.remove("is-selecting", "is-match");
      a.el.classList.add("is-cleared");
    });
    clearedCount += selected.length;
    clearEvents += 1;
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
  // 막지 않으면 사과의 숫자를 텍스트로 잡아 끄는 동작이 끼어든다
  e.preventDefault();
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

function startGame(fixedSeed) {
  if (isBlocked()) {
    lockOut(isBlocked());
    return;
  }
  if (!getNickname()) {
    updateEntryGate();
    return;
  }
  score = 0;
  timeLeft = GAME_SECONDS;
  scoreSubmitted = false;
  clearEvents = 0;
  startedAt = Date.now();
  finishedAt = 0;
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
  submitScoreBtnFixed.disabled = false;
  renderScoreNameArea();

  buildGrid(fixedSeed);
  clearSelectionVisual();

  window.clearInterval(timerId);
  timerId = window.setInterval(tick, 1000);
}

function endGame(cleared) {
  playing = false;
  isSelecting = false;
  finishedAt = Date.now();
  window.clearInterval(timerId);
  clearSelectionVisual();

  if (cleared) {
    const elapsed = GAME_SECONDS - timeLeft;
    endTitleEl.textContent = `올 클리어! 🎉 (${formatTime(elapsed)} 소요)`;
  } else {
    endTitleEl.textContent = "시간 종료!";
  }
  finalScoreEl.textContent = score;
  renderScoreNameArea();
  endOverlay.hidden = false;

  // 대결 판이면 결과를 방에 올린다
  if (duelMode && duelRoom) {
    duelMode = false;
    submitResult({ code: duelRoom.code, isHost: duelIsHost, score, moves })
      .then(() => { duelModal.hidden = false; })
      .catch((err) => console.error("대결 결과 전송 실패", err));
  }

  // 돌발 이벤트가 진행 중이고 목표를 넘겼으면 바로 상품을 준다
  const ev = activeEvent();
  if (ev && score >= ev.target && getNickname()) {
    claimEvent(getNickname(), nicknameKey(getNickname()), ev.id, score)
      .then((res) => {
        if (res.ok) {
          submitStatusEl.textContent = `🔥 돌발 이벤트 달성! ${EVENT_PRIZE} 당첨!`;
        } else if (res.reason) {
          submitStatusEl.textContent = res.reason;
        }
      })
      .catch((err) => console.error("이벤트 기록 실패", err));
  }

  // 100점을 넘기면 룰렛 기회를 준다
  if (score >= ROULETTE_MIN_SCORE && getNickname()) {
    window.setTimeout(() => openRoulette(score), 600);
  }
}

// 채팅 닉네임과 랭킹 이름을 하나로 쓴다. 이미 정해둔 닉네임이 있으면 그대로 사용한다.
function renderScoreNameArea() {
  const nick = getNickname();
  const fixed = nick.length > 0;
  scoreNickSetup.hidden = fixed;
  scoreNickFixed.hidden = !fixed;
  if (fixed) scoreNicknameEl.textContent = nick;
}

async function handleSubmitScore() {
  if (scoreSubmitted) return;

  let name = getNickname();
  if (!name) {
    const typed = playerNameInput.value.trim();
    const targetedTry = findTargeted(typed);
    if (targetedTry) {
      lockOut(`금지된 닉네임 시도 (${targetedTry})`);
      return;
    }
    const nickProblem = checkNickname(typed);
    if (nickProblem) {
      submitStatusEl.textContent = nickProblem;
      return;
    }
    const taken = await reserveNickname(typed);
    if (!taken.ok) {
      submitStatusEl.textContent = taken.reason;
      return;
    }
    name = setNickname(typed);
    renderNickname();
    renderScoreNameArea();
  }

  submitScoreBtn.disabled = true;
  submitScoreBtnFixed.disabled = true;
  submitStatusEl.textContent = "등록 중...";
  try {
    // 화면에 표시된 점수 변수 대신 실제로 사라진 사과 수를 다시 세어 보낸다.
    const actualScore = apples.filter((a) => a.cleared).length;
    const result = await submitScore(name, actualScore, {
      clears: clearEvents,
      durationMs: Math.max(0, (finishedAt || Date.now()) - startedAt),
      seed: boardSeed,
      moves,
    });
    scoreSubmitted = true;
    submitStatusEl.textContent = result.online
      ? "온라인 랭킹에 등록되었습니다!"
      : "로컬 랭킹에 저장되었습니다 (온라인 랭킹 미설정)";
  } catch (err) {
    console.error(err);
    // 조작 판정은 값 자체가 불가능할 때만 한다.
    // 서버 거부(permission-denied)는 규칙 변경이나 일시적 문제로도 발생하므로
    // 이것만으로 차단하면 정상 참가자가 잘못 밴된다.
    const impossible = /점수 범위|매칭 기록|플레이 시간이 점수에 비해/.test(
      err.message ?? ""
    );
    if (impossible) {
      lockOut(err.message);
      return;
    }
    submitStatusEl.textContent = err.message.startsWith("리플레이 검증 실패")
      ? `${err.message} · 게임은 계속 즐길 수 있습니다`
      : `등록 실패: ${err.message}`;
    submitScoreBtn.disabled = false;
    submitScoreBtnFixed.disabled = false;
  }
}

async function openRanking() {
  rankingModal.hidden = false;
  rankingList.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  try {
    const { online, scores } = await fetchTopScores();
    const next = getNextReset();
    const resetNote = `평일 오전 9시 초기화 · 다음 초기화 ${next.toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    rankingSourceNote.textContent = online
      ? `온라인 공유 랭킹 · ${resetNote}`
      : `로컬 랭킹 (이 브라우저에만 저장됨) · ${resetNote}`;

    if (!scores || scores.length === 0) {
      rankingList.innerHTML =
        '<li class="ranking-empty">이번 회차에 등록된 기록이 아직 없습니다.</li>';
      return;
    }

    // 상위 기록이 진짜인지 누구나 확인할 수 있게 리플레이 버튼을 단다
    rankingList.innerHTML = scores
      .map((s, idx) => {
        const replay = s.moves && s.id
          ? `<button type="button" class="replay-btn" data-replay="${escapeHtml(s.id)}">🎬</button>`
          : "";
        return `
        <li>
          <span class="rank">${idx + 1}</span>
          <span class="name">${escapeHtml(s.name ?? "익명")}</span>
          <span class="score">${s.score}점</span>${replay}
        </li>`;
      })
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
// 모바일: 게임판 위에서 손가락을 끌 때 화면이 스크롤되거나
// 두 손가락 확대가 걸리면 드래그 선택이 끊긴다.
boardEl.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
boardEl.addEventListener("gesturestart", (e) => e.preventDefault());
// 드래그 도중 숫자가 텍스트로 선택되는 것을 막는다
boardEl.addEventListener("selectstart", (e) => e.preventDefault());
boardEl.addEventListener("dragstart", (e) => e.preventDefault());
window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);

startBtn.addEventListener("click", startGame);
retryBtn.addEventListener("click", startGame);
resetBtn.addEventListener("click", startGame);
submitScoreBtn.addEventListener("click", handleSubmitScore);
submitScoreBtnFixed.addEventListener("click", handleSubmitScore);
playerNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSubmitScore();
});

rankingBtn.addEventListener("click", openRanking);
rankingClose.addEventListener("click", () => {
  rankingModal.hidden = true;
});
rankingModal.addEventListener("click", (e) => {
  if (e.target === rankingModal) rankingModal.hidden = true;
});

const APPLE_COLOR_KEY = "apple-game-apple-color";
const appleColorBtn = document.getElementById("apple-color-btn");
const appleColorIcon = document.getElementById("apple-color-icon");
const appleColorLabel = document.getElementById("apple-color-label");

function renderAppleColor() {
  const green = gridEl.classList.contains("is-green");
  appleColorIcon.textContent = green ? "🍎" : "🍏";
  appleColorLabel.textContent = green ? "레드애플" : "그린애플";
}

try {
  if (localStorage.getItem(APPLE_COLOR_KEY) === "green") {
    gridEl.classList.add("is-green");
  }
} catch {
  /* 저장소를 못 읽어도 기본(빨강)으로 진행한다 */
}
renderAppleColor();

appleColorBtn.addEventListener("click", () => {
  const green = gridEl.classList.toggle("is-green");
  try {
    localStorage.setItem(APPLE_COLOR_KEY, green ? "green" : "red");
  } catch {
    /* 저장 실패해도 이번 화면에는 적용된다 */
  }
  renderAppleColor();
});

paleToggle.addEventListener("change", () => {
  gridEl.classList.toggle("is-pale", paleToggle.checked);
});

bgmToggle.addEventListener("change", () => {
  if (bgmToggle.checked) startBgm();
  else stopBgm();
});

const CHEAT_KEY = "apple-game-blocked";
const lockoutEl = document.getElementById("lockout");
const lockoutReasonEl = document.getElementById("lockout-reason");

// 조작이 감지되면 이 기기에서 게임을 더 진행할 수 없게 막는다.
function lockOut(reason, { report = true } = {}) {
  try {
    localStorage.setItem(CHEAT_KEY, reason);
  } catch {
    /* 저장이 막혀 있어도 이번 화면은 잠긴다 */
  }
  // 저장소를 지워도 다시 막히도록 서버에도 남긴다
  if (report) reportCheat(reason, getNickname());
  playing = false;
  isSelecting = false;
  window.clearInterval(timerId);
  lockoutReasonEl.textContent = `사유: ${reason}`;
  lockoutEl.hidden = false;
}

function isBlocked() {
  try {
    return localStorage.getItem(CHEAT_KEY);
  } catch {
    return null;
  }
}

const THEME_KEY = "apple-game-theme";
const themeBtn = document.getElementById("theme-btn");
const themeIconEl = document.getElementById("theme-icon");
const themeLabelEl = document.getElementById("theme-label");

function currentTheme() {
  const saved = document.documentElement.getAttribute("data-theme");
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function renderThemeButton() {
  const dark = currentTheme() === "dark";
  themeIconEl.textContent = dark ? "☀️" : "🌙";
  themeLabelEl.textContent = dark ? "라이트모드" : "다크모드";
}

themeBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* 저장이 막혀 있어도 이번 화면에는 적용된다 */
  }
  renderThemeButton();
});

// 직접 고른 적이 없으면 시스템 설정 변경을 그대로 따라간다
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!document.documentElement.getAttribute("data-theme")) renderThemeButton();
});

renderThemeButton();

const entryGateEl = document.getElementById("entry-gate");
const entryNickInput = document.getElementById("entry-nick");
const entryNickBtn = document.getElementById("entry-nick-btn");
const entryNickMsg = document.getElementById("entry-nick-msg");

// 닉네임이 없으면 아무것도 하기 전에 먼저 정하게 한다
function updateEntryGate() {
  const needsNick = !getNickname();
  entryGateEl.hidden = !needsNick;
  if (needsNick) entryNickInput.focus();
}

async function saveEntryNickname() {
  const value = entryNickInput.value.trim();

  const targetedTry = findTargeted(value);
  if (targetedTry) {
    lockOut(`금지된 닉네임 시도 (${targetedTry})`);
    return;
  }
  const problem = checkNickname(value);
  if (problem) {
    entryNickMsg.textContent = problem;
    return;
  }

  entryNickBtn.disabled = true;
  entryNickMsg.textContent = "확인 중...";
  const taken = await reserveNickname(value);
  entryNickBtn.disabled = false;
  if (!taken.ok) {
    entryNickMsg.textContent = taken.reason;
    return;
  }

  setNickname(value);
  entryNickInput.value = "";
  entryNickMsg.textContent = "";
  renderNickname();
  renderScoreNameArea();
  updateEntryGate();
}

entryNickBtn.addEventListener("click", saveEntryNickname);
entryNickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveEntryNickname();
});

// ── 룰렛 ───────────────────────────────────
const rouletteEl = document.getElementById("roulette");
const wheelEl = document.getElementById("wheel");
const rouletteResultEl = document.getElementById("roulette-result");
const rouletteSpinBtn = document.getElementById("roulette-spin");
const rouletteCloseBtn = document.getElementById("roulette-close");
const rouletteCongratsEl = document.getElementById("roulette-congrats");
const rouletteSubEl = document.getElementById("roulette-sub");
const tickerEl = document.getElementById("prize-ticker");
const tickerTrackEl = document.getElementById("prize-ticker-track");

const SEGMENTS = segments();
let rouletteScore = 0;
let spinning = false;
let wheelAngle = 0;

// 원판을 확률 구간대로 색칠한다
wheelEl.style.background = `conic-gradient(${SEGMENTS.map(
  (s) => `${s.color} ${s.start}deg ${s.end}deg`
).join(", ")})`;

async function openRoulette(score) {
  rouletteScore = score;
  spinning = false;
  wheelAngle = 0;
  wheelEl.style.transition = "none";
  wheelEl.style.transform = "rotate(0deg)";
  rouletteResultEl.textContent = "";
  rouletteResultEl.className = "roulette__result";
  rouletteCongratsEl.textContent = `🎊 ${score}점 달성! 축하합니다`;
  rouletteCloseBtn.hidden = false;
  rouletteEl.hidden = false;

  const left = await remainingSpins(nicknameKey(getNickname()));
  const reset = nextResetAt().toLocaleString("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  if (left <= 0) {
    rouletteSubEl.textContent = `오늘 기회를 모두 썼습니다 · ${reset}에 초기화`;
    rouletteSpinBtn.hidden = true;
    return;
  }
  rouletteSubEl.textContent = `남은 기회 ${left}/${DAILY_SPINS}회 · ${reset}에 초기화`;
  rouletteSpinBtn.hidden = false;
  rouletteSpinBtn.disabled = false;
}

rouletteSpinBtn.addEventListener("click", async () => {
  if (spinning) return;
  spinning = true;
  rouletteSpinBtn.disabled = true;

  const prize = drawPrize();
  const seg = SEGMENTS.find((s) => s.id === prize.id);
  // 바늘(위쪽)이 당첨 구간 한가운데에 오도록 회전각을 맞춘다.
  // 현재 각도에서의 "차이"만큼 더해야 한다. 목표각을 그냥 더하면
  // 두 번째 회전부터 이전 목표각이 누적돼 다른 칸에 멈춘다.
  const target = seg.start + seg.angle / 2;
  const current = ((wheelAngle % 360) + 360) % 360;
  const desired = ((360 - target) % 360 + 360) % 360;
  let delta = desired - current;
  if (delta < 0) delta += 360;
  wheelAngle += 360 * 6 + delta;

  wheelEl.style.transition = "transform 4s cubic-bezier(0.15, 0.9, 0.2, 1)";
  wheelEl.style.transform = `rotate(${wheelAngle}deg)`;

  window.setTimeout(async () => {
    const won = prize.id !== "none";
    rouletteResultEl.textContent = won
      ? `${prize.emoji} ${prize.label} 당첨!`
      : `${prize.emoji} 꽝! 다음 기회에`;
    rouletteResultEl.className = `roulette__result ${won ? "is-win" : "is-lose"}`;
    rouletteCloseBtn.hidden = false;
    spinning = false;

    try {
      const res = await recordPrize(
        getNickname(),
        nicknameKey(getNickname()),
        prize.label,
        rouletteScore
      );
      if (!res.ok) {
        rouletteResultEl.textContent = res.reason;
        rouletteResultEl.className = "roulette__result is-lose";
        rouletteSpinBtn.hidden = true;
      } else if (res.left > 0) {
        rouletteSubEl.textContent = `남은 기회 ${res.left}/${DAILY_SPINS}회`;
        rouletteSpinBtn.disabled = false;
      } else {
        rouletteSubEl.textContent = "오늘 기회를 모두 사용했습니다";
        rouletteSpinBtn.hidden = true;
      }
    } catch (err) {
      console.error("당첨 기록 실패", err);
      rouletteResultEl.textContent = "기록에 실패했습니다.";
    }
  }, 4100);
});

rouletteCloseBtn.addEventListener("click", () => {
  rouletteEl.hidden = true;
});

let lastPrizeList = [];

function renderTicker(list) {
  lastPrizeList = list ?? lastPrizeList;
  // 꽝은 당첨이 아니므로 로그에 올리지 않는다
  const rows = [
    ...eventWinners.map((r) => ({ ...r, isEvent: true })),
    ...(lastPrizeList || []),
  ].filter((r) => r.prize && r.prize !== "꽝");
  if (rows.length === 0) {
    tickerEl.hidden = true;
    return;
  }
  tickerEl.hidden = false;
  tickerTrackEl.innerHTML = rows
    .map((r) => {
      const tag = r.isEvent ? "🔥 돌발 이벤트 " : "";
      return `<span class="win">
        ${tag}<b>${escapeHtml(r.name || "?")}</b>님 ${r.score}점 · ${escapeHtml(r.prize)} 당첨!
      </span>`;
    })
    .join("");
}

watchPrizes(renderTicker, 20);

// ── 내 기록실 ──────────────────────────────
const myStatsBtn = document.getElementById("mystats-btn");
const myStatsModal = document.getElementById("mystats-modal");
const myStatsClose = document.getElementById("mystats-close");
const myStatsNote = document.getElementById("mystats-note");
const statGridEl = document.getElementById("stat-grid");
const myStatsListEl = document.getElementById("mystats-list");

async function renderMyStats() {
  const nick = getNickname();
  if (!nick) {
    myStatsNote.textContent = "닉네임을 먼저 정하세요.";
    statGridEl.innerHTML = "";
    myStatsListEl.innerHTML = "";
    return;
  }
  myStatsNote.textContent = "불러오는 중...";
  myStatsListEl.innerHTML = "";
  const rows = await fetchMyScores(nick);

  if (rows.length === 0) {
    myStatsNote.textContent = `${nick} · 오늘 기록이 없습니다`;
    statGridEl.innerHTML = "";
    return;
  }

  const scores = rows.map((r) => r.score);
  const best = Math.max(...scores);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const total = scores.reduce((a, b) => a + b, 0);

  myStatsNote.textContent = `${nick} · 오늘 ${rows.length}판`;
  statGridEl.innerHTML = `
    <div class="stat-card stat-card--best">
      <span class="stat-card__label">최고 점수</span>
      <span class="stat-card__value">${best}</span>
    </div>
    <div class="stat-card">
      <span class="stat-card__label">평균</span>
      <span class="stat-card__value">${avg}</span>
    </div>
    <div class="stat-card">
      <span class="stat-card__label">플레이 판수</span>
      <span class="stat-card__value">${rows.length}</span>
    </div>
    <div class="stat-card">
      <span class="stat-card__label">터뜨린 사과</span>
      <span class="stat-card__value">${total}</span>
    </div>`;

  myStatsListEl.innerHTML = rows
    .slice(0, 20)
    .map((r, i) => {
      const at = r.createdAt
        ? new Date(r.createdAt.seconds * 1000).toLocaleTimeString("ko-KR", {
            hour: "2-digit", minute: "2-digit",
          })
        : "";
      const replay = r.moves
        ? `<button type="button" class="block-btn" data-replay="${escapeHtml(r.id)}">리플레이</button>`
        : "";
      return `<li>
        <span class="rank">${i + 1}</span>
        <span class="name">${r.score}점
          <span class="online-list__code">매칭 ${r.clears ?? "?"}회 · ${at}</span>
        </span>${replay}
      </li>`;
    })
    .join("");
}

myStatsBtn.addEventListener("click", () => {
  myStatsModal.hidden = false;
  renderMyStats();
});
myStatsClose.addEventListener("click", () => { myStatsModal.hidden = true; });
myStatsModal.addEventListener("click", (e) => {
  if (e.target === myStatsModal) myStatsModal.hidden = true;
});

// ── 리플레이 검증 ──────────────────────────
const replayModal = document.getElementById("replay-modal");
const replayClose = document.getElementById("replay-close");
const replayBoardEl = document.getElementById("replay-board");
const replayNoteEl = document.getElementById("replay-note");
const replayPlayBtn = document.getElementById("replay-play");
const replayTimeEl = document.getElementById("replay-time");
const replayVerdictEl = document.getElementById("replay-verdict");

let replayData = null;
let replayTimers = [];

function stopReplay() {
  replayTimers.forEach((t) => window.clearTimeout(t));
  replayTimers = [];
}

function openReplay(rec) {
  stopReplay();
  let moves = [];
  try {
    moves = JSON.parse(rec.moves || "[]");
  } catch {
    moves = [];
  }
  replayData = { ...rec, moves };

  const values = boardFromSeed(Number(rec.seed) || 0, COLS * ROWS);
  replayBoardEl.innerHTML = values
    .map((v, i) => `<span class="replay-cell" data-i="${i}">${v}</span>`)
    .join("");

  // 수순만으로도 진위를 어느 정도 가릴 수 있다.
  // 사람은 매칭 사이에 최소 0.2초 이상 걸리고, 합이 10이어야 한다.
  const cells = [...replayBoardEl.children];
  let prevT = 0;
  let tooFast = 0;
  let badSum = 0;
  moves.forEach(([t, idx]) => {
    if (t - prevT < 200) tooFast += 1;
    prevT = t;
    const sum = idx.reduce((a, i) => a + (values[i] ?? 0), 0);
    if (sum !== 10) badSum += 1;
  });

  const problems = [];
  if (moves.length === 0) problems.push("수순 기록이 없습니다(예전 버전 기록)");
  if (badSum > 0) problems.push(`합이 10이 아닌 매칭 ${badSum}건`);
  if (tooFast > 0) problems.push(`0.2초 미만 연속 매칭 ${tooFast}건`);

  replayNoteEl.textContent = `${rec.name} · ${rec.score}점 · 매칭 ${moves.length}회 · ${Math.round((rec.durationMs || 0) / 1000)}초`;
  replayVerdictEl.textContent = problems.length
    ? `⚠️ ${problems.join(" / ")}`
    : "✅ 수순이 규칙에 맞고 속도도 사람 범위입니다";
  replayVerdictEl.className = problems.length
    ? "admin-hint replay-verdict--bad"
    : "admin-hint";

  replayTimeEl.textContent = "0.0초";
  replayModal.hidden = false;
}

replayPlayBtn.addEventListener("click", () => {
  if (!replayData) return;
  stopReplay();
  const cells = [...replayBoardEl.children];
  cells.forEach((c) => c.classList.remove("is-gone"));
  // 30초 이내로 압축해서 보여준다
  const dur = replayData.durationMs || 1;
  const speed = Math.max(1, dur / 30000);
  replayData.moves.forEach(([t, idx]) => {
    replayTimers.push(
      window.setTimeout(() => {
        idx.forEach((i) => cells[i]?.classList.add("is-gone"));
        replayTimeEl.textContent = `${(t / 1000).toFixed(1)}초`;
      }, t / speed)
    );
  });
});

replayClose.addEventListener("click", () => {
  stopReplay();
  replayModal.hidden = true;
});

// 기록실과 관리자 창 양쪽에서 리플레이를 열 수 있다
async function handleReplayClick(e) {
  const btn = e.target.closest("[data-replay]");
  if (!btn) return;
  const id = btn.dataset.replay;
  const [all, mine, top] = await Promise.all([
    fetchScoresForAdmin(200),
    getNickname() ? fetchMyScores(getNickname(), 200) : Promise.resolve([]),
    fetchTopScores().then((r) => r.scores || []),
  ]);
  const rec = [...all, ...mine, ...top].find((r) => r.id === id);
  if (rec) openReplay(rec);
}
myStatsListEl.addEventListener("click", handleReplayClick);
rankingList.addEventListener("click", handleReplayClick);

// ── 개인 증정권 발급 ───────────────────────
const shopBtn = document.getElementById("shop-btn");
const shopModal = document.getElementById("shop-modal");
const shopCloseBtn = document.getElementById("shop-close");
const shopGridEl = document.getElementById("shop-grid");
const shopStatusEl = document.getElementById("shop-status");
const ticketListEl = document.getElementById("ticket-list");
const verifyInput = document.getElementById("verify-input");
const verifyBtn = document.getElementById("verify-btn");
const verifyResultEl = document.getElementById("verify-result");

function renderShopCards() {
  shopGridEl.innerHTML = Object.entries(TICKET_KINDS)
    .map(
      ([kind, info]) => `<div class="shop-card">
        <span class="shop-card__emoji">${info.emoji}</span>
        <span class="shop-card__name">${info.label}</span>
        <span class="shop-card__note">${info.note}</span>
        <button type="button" data-issue="${kind}">발급</button>
      </div>`
    )
    .join("");
}

async function renderMyTickets() {
  const nick = getNickname();
  if (!nick) {
    ticketListEl.innerHTML = '<li class="ranking-empty">닉네임을 먼저 정하세요.</li>';
    return;
  }
  ticketListEl.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  const list = await myTickets(nicknameKey(nick));
  if (list.length === 0) {
    ticketListEl.innerHTML = '<li class="ranking-empty">아직 발급받은 증정권이 없습니다.</li>';
    return;
  }
  ticketListEl.innerHTML = list
    .map((t) => {
      const p = prettySerial(t.serial);
      const used = t.state === "used";
      return `<li class="${used ? "ticket-used" : ""}">
        <span class="rank">${TICKET_KINDS[t.kind]?.emoji ?? "🎟️"}</span>
        <span class="name">${escapeHtml(p.title)}
          <span class="ticket-serial">${p.code}</span>
        </span>
        ${used ? '<span class="block-state">사용됨</span>'
               : `<button type="button" class="block-btn" data-use="${escapeHtml(t.serial)}">사용</button>`}
      </li>`;
    })
    .join("");
}

shopBtn.addEventListener("click", () => {
  shopModal.hidden = false;
  createStakes = [];
  shopStatusEl.textContent = "";
  verifyResultEl.hidden = true;
  renderShopCards();
  renderMyTickets();
});
shopCloseBtn.addEventListener("click", () => { shopModal.hidden = true; });
shopModal.addEventListener("click", (e) => {
  if (e.target === shopModal) shopModal.hidden = true;
});

shopGridEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-issue]");
  if (!btn) return;
  const nick = getNickname();
  if (!nick) { shopStatusEl.textContent = "닉네임을 먼저 정하세요."; return; }
  btn.disabled = true;
  shopStatusEl.textContent = "발급 중...";
  try {
    const serial = await issueTicket({ kind: btn.dataset.issue, name: nick, nickKey: nicknameKey(nick) });
    const p = prettySerial(serial);
    shopStatusEl.textContent = `${p.title} 발급 완료 · 일련번호 ${p.code}`;
    renderMyTickets();
  } catch (err) {
    shopStatusEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

ticketListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-use]");
  if (!btn) return;
  if (!window.confirm("이 증정권을 사용 처리할까요? 되돌릴 수 없습니다.")) return;
  btn.disabled = true;
  try {
    await useTicket(btn.dataset.use);
    shopStatusEl.textContent = "사용 처리했습니다.";
    renderMyTickets();
  } catch (err) {
    shopStatusEl.textContent = err.message;
    btn.disabled = false;
  }
});

async function doVerify() {
  const v = verifyInput.value.trim();
  if (!v) return;
  verifyResultEl.hidden = false;
  verifyResultEl.className = "verify-result";
  verifyResultEl.textContent = "확인 중...";
  const r = await verifyTicket(v);
  if (!r.found) {
    verifyResultEl.className = "verify-result is-bad";
    verifyResultEl.innerHTML = `<div class="verify-result__title">❌ 확인 불가</div>${escapeHtml(r.reason)}`;
    return;
  }
  const issued = r.createdAt?.seconds
    ? new Date(r.createdAt.seconds * 1000).toLocaleString("ko-KR")
    : "-";
  verifyResultEl.className = `verify-result ${r.valid ? "is-ok" : "is-bad"}`;
  verifyResultEl.innerHTML = `
    <div class="verify-result__title">${r.valid ? "✅ 유효한 증정권" : "⚠️ 이미 사용됨"}</div>
    <b>${escapeHtml(r.title)}</b><br />
    일련번호: ${r.code}<br />
    현재 소유자: ${escapeHtml(r.owner || "-")}<br />
    최초 발급: ${escapeHtml(r.issuedTo || "-")} · ${issued}
    ${r.wonFrom ? `<br />대결로 획득 (이전 소유: ${escapeHtml(r.wonFrom)})` : ""}`;
}

verifyBtn.addEventListener("click", doVerify);
verifyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doVerify(); });

// ── 대결 ───────────────────────────────────
const duelBtn = document.getElementById("duel-btn");
const duelModal = document.getElementById("duel-modal");
const duelCloseBtn = document.getElementById("duel-close");
const duelLobbyEl = document.getElementById("duel-lobby");
const duelRoomEl = document.getElementById("duel-room");
const duelStakeSel = document.getElementById("duel-stake");
const duelPwInput = document.getElementById("duel-pw");
const duelCreateBtn = document.getElementById("duel-create");
const duelCodeInput = document.getElementById("duel-code");
const duelJoinBtn = document.getElementById("duel-join");
const duelRoomsEl = document.getElementById("duel-rooms");
const duelStatusEl = document.getElementById("duel-status");
const duelRoomCodeEl = document.getElementById("duel-room-code");
const duelHostNameEl = document.getElementById("duel-host-name");
const duelHostScoreEl = document.getElementById("duel-host-score");
const duelGuestNameEl = document.getElementById("duel-guest-name");
const duelGuestScoreEl = document.getElementById("duel-guest-score");
const duelRoomStakeEl = document.getElementById("duel-room-stake");
const duelRoomMsgEl = document.getElementById("duel-room-msg");
const duelStartBtn = document.getElementById("duel-start");
const duelLeaveBtn = document.getElementById("duel-leave");

let duelRoom = null;      // 지금 들어가 있는 방
let duelIsHost = false;
let duelUnwatch = null;
let duelMode = false;     // 대결용 판인지

function showDuelLobby() {
  duelLobbyEl.hidden = false;
  duelRoomEl.hidden = true;
}

// 증정권을 눌러서 올리고 내리는 목록을 그린다
function stakeChips(list, chosen) {
  if (list.length === 0) {
    return '<li class="empty">걸 수 있는 증정권이 없습니다</li>';
  }
  return list
    .map((t) => {
      const p = prettySerial(t.serial);
      const on = chosen.includes(t.serial);
      return `<li>
        <button type="button" class="stake-chip ${on ? "is-on" : ""}" data-stake="${escapeHtml(t.serial)}">
          <span class="stake-chip__mark">✓</span>
          <span class="stake-chip__body">${escapeHtml(p.title)}
            <span class="stake-chip__code">${p.code}</span>
          </span>
        </button>
      </li>`;
    })
    .join("");
}

let createStakes = [];
let myTicketCache = [];

async function fillStakeOptions() {
  const nick = getNickname();
  createStakes = [];
  if (!nick) {
    duelStakeSel.innerHTML = '<li class="empty">닉네임을 먼저 정하세요</li>';
    return;
  }
  myTicketCache = (await myTickets(nicknameKey(nick))).filter((t) => t.state === "active");
  duelStakeSel.innerHTML = stakeChips(myTicketCache, createStakes);
}

duelStakeSel.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-stake]");
  if (!btn) return;
  const serial = btn.dataset.stake;
  createStakes = createStakes.includes(serial)
    ? createStakes.filter((s) => s !== serial)
    : [...createStakes, serial];
  duelStakeSel.innerHTML = stakeChips(myTicketCache, createStakes);
});

function selectedStakes() {
  return createStakes;
}

async function renderOpenRooms() {
  duelRoomsEl.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  const rooms = await openRooms(15);
  if (rooms.length === 0) {
    duelRoomsEl.innerHTML = '<li class="ranking-empty">열려 있는 방이 없습니다.</li>';
    return;
  }
  duelRoomsEl.innerHTML = rooms
    .map(
      (r) => `<li>
        <span class="rank">${r.pw ? "🔒" : "🔓"}</span>
        <span class="name">${escapeHtml(r.host)}
          <span class="online-list__code">${escapeHtml(r.code)} · 건 것: ${escapeHtml(r.stake || "없음")}</span>
        </span>
        <button type="button" class="block-btn" data-room="${escapeHtml(r.code)}">참가</button>
      </li>`
    )
    .join("");
}

// ── 대전 기록 ────────────────────────────
// 끝난 대결을 누가 무엇을 걸고 어떻게 됐는지까지 남긴다.
// 리플레이 버튼으로 양쪽 수순을 그대로 다시 볼 수 있다.
const duelLogEl = document.getElementById("duel-log");
let duelLogCache = [];

function logStakeText(list) {
  if (!list || list.length === 0) return "건 것 없음";
  return list.map((serial) => prettySerial(serial).title).join(", ");
}

function logWhen(ts) {
  const ms = ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : 0;
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function renderDuelLog() {
  duelLogEl.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  const rooms = await recentDuels(20);
  duelLogCache = rooms;
  if (rooms.length === 0) {
    duelLogEl.innerHTML = '<li class="ranking-empty">아직 끝난 대결이 없습니다.</li>';
    return;
  }

  duelLogEl.innerHTML = rooms
    .map((r) => {
      const winner = duelWinner(r);
      const hostWon = winner === "host";
      const guestWon = winner === "guest";
      // 진 쪽이 건 것이 이긴 쪽으로 넘어갔다.
      // 아무것도 안 걸었으면 넘어간 것도 없으니 이 줄은 빼둔다.
      const loot = hostWon ? r.guestStakes : r.hostStakes;
      const moved = winner === "draw" || !loot?.length
        ? ""
        : `<span class="duel-log__loot">🎁 ${escapeHtml(
            logStakeText(loot)
          )} → ${escapeHtml(hostWon ? r.host : r.guest)}</span>`;

      const side = (who, name, score, stakes, won, hasMoves) => `
        <div class="duel-log__side${won ? " is-winner" : ""}">
          <span class="duel-log__name">${won ? "👑 " : ""}${escapeHtml(name || "-")}</span>
          <span class="duel-log__score">${typeof score === "number" ? `${score}점` : "-"}</span>
          <span class="duel-log__stake">${escapeHtml(logStakeText(stakes))}</span>
          ${hasMoves
            ? `<button type="button" class="replay-btn" data-duel="${escapeHtml(r.code)}" data-side="${who}">🎬</button>`
            : ""}
        </div>`;

      return `<li>
        <div class="duel-log__head">
          <span class="duel-log__code">${escapeHtml(r.code)}</span>
          <span class="duel-log__when">${escapeHtml(logWhen(r.createdAt))}</span>
          ${r.forfeit ? '<span class="duel-log__tag">🏳️ 기권</span>' : ""}
          ${winner === "draw" ? '<span class="duel-log__tag">🤝 무승부</span>' : ""}
        </div>
        <div class="duel-log__body">
          ${side("host", r.host, r.hostScore, r.hostStakes, hostWon, Boolean(r.hostMoves))}
          <span class="duel-log__vs">VS</span>
          ${side("guest", r.guest, r.guestScore, r.guestStakes, guestWon, Boolean(r.guestMoves))}
        </div>
        ${moved}
      </li>`;
    })
    .join("");
}

duelLogEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-duel]");
  if (!btn) return;
  const room = duelLogCache.find((r) => r.code === btn.dataset.duel);
  if (!room) return;

  const isHost = btn.dataset.side === "host";
  const moves = isHost ? room.hostMoves : room.guestMoves;
  if (!moves) return;

  // 대결에는 따로 소요 시간을 남기지 않아 마지막 수순 시각으로 대신한다
  let durationMs = 0;
  try {
    const parsed = JSON.parse(moves);
    durationMs = parsed.length ? parsed[parsed.length - 1][0] : 0;
  } catch {
    durationMs = 0;
  }

  openReplay({
    name: isHost ? room.host : room.guest,
    score: isHost ? room.hostScore : room.guestScore,
    moves,
    seed: room.seed,
    durationMs,
  });
});

const tradeHostList = document.getElementById("trade-host-list");
const tradeGuestList = document.getElementById("trade-guest-list");
const tradeHostLabel = document.getElementById("trade-host-label");
const tradeGuestLabel = document.getElementById("trade-guest-label");
const tradeAddRow = document.getElementById("trade-add-row");
const tradeAddSel = document.getElementById("trade-add-sel");

function stakeItems(list) {
  if (!list || list.length === 0) {
    return '<li class="empty">올린 것 없음</li>';
  }
  return list
    .map((serial) => {
      const p = prettySerial(serial);
      return `<li>${escapeHtml(p.title)}<br /><span class="ticket-serial">${p.code}</span></li>`;
    })
    .join("");
}

// 양쪽이 무엇을 걸었는지 서로 보이게 한다
function renderTrade(room) {
  tradeHostLabel.textContent = `${room.host || "방장"}이 건 것`;
  tradeGuestLabel.textContent = `${room.guest || "도전자"}가 건 것`;
  tradeHostList.innerHTML = stakeItems(room.hostStakes);
  tradeGuestList.innerHTML = stakeItems(room.guestStakes);

  // 도전자는 대결 전까지 자기 판돈을 올릴 수 있다
  const canAdd = !duelIsHost && room.guest && !duelWinner(room)
    && typeof room.guestScore !== "number";
  tradeAddRow.hidden = !canAdd;
  if (canAdd) fillTradeAddOptions(room.guestStakes || []);
}

async function fillTradeAddOptions(already) {
  const nick = getNickname();
  if (!nick) return;
  const list = (await myTickets(nicknameKey(nick))).filter((t) => t.state === "active");
  tradeAddSel.innerHTML = stakeChips(list, already || []);
}

// 방 안에서도 눌러서 올리고 내린다
tradeAddSel.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-stake]");
  if (!btn || !duelRoom) return;
  const serial = btn.dataset.stake;
  const now = duelRoom.guestStakes || [];
  const next = now.includes(serial)
    ? now.filter((s) => s !== serial)
    : [...now, serial];
  btn.classList.toggle("is-on");
  try {
    await setGuestStakes(duelRoom.code, next);
  } catch (err) {
    duelRoomMsgEl.textContent = "판돈을 바꾸지 못했습니다.";
    btn.classList.toggle("is-on");
  }
});

const duelResultEl = document.getElementById("duel-result");
const duelResultCard = duelResultEl.querySelector(".duel-result__card");
const duelResultIcon = document.getElementById("duel-result-icon");
const duelResultTitle = document.getElementById("duel-result-title");
const duelResultScore = document.getElementById("duel-result-score");
const duelResultLoot = document.getElementById("duel-result-loot");
const duelResultLootList = document.getElementById("duel-result-loot-list");

document.getElementById("duel-result-close").addEventListener("click", () => {
  duelResultEl.hidden = true;
});

let shownResult = null;

function showDuelResult(room, winner) {
  if (shownResult === room.code) return;
  shownResult = room.code;

  const iWon = (winner === "host") === duelIsHost;
  const myScore = duelIsHost ? room.hostScore : room.guestScore;
  const foeScore = duelIsHost ? room.guestScore : room.hostScore;

  duelResultCard.className = "modal__card duel-result__card";
  if (winner === "draw") {
    duelResultCard.classList.add("is-draw");
    duelResultIcon.textContent = "🤝";
    duelResultTitle.textContent = "무승부";
  } else if (iWon) {
    duelResultCard.classList.add("is-win");
    duelResultIcon.textContent = isForfeitWin(room) ? "🏳️" : "🏆";
    duelResultTitle.textContent = isForfeitWin(room) ? "상대 기권 · 승리!" : "승리!";
  } else {
    duelResultCard.classList.add("is-lose");
    duelResultIcon.textContent = "😢";
    duelResultTitle.textContent = isForfeitWin(room) ? "기권 · 패배" : "패배";
  }

  duelResultScore.textContent =
    typeof myScore === "number" && typeof foeScore === "number"
      ? `내 점수 ${myScore}점 · 상대 ${foeScore}점`
      : "";

  // 이겼고 상대가 건 것이 있으면 획득 목록을 보여준다
  const loot = winner === "host" ? room.guestStakes : room.hostStakes;
  if (iWon && winner !== "draw" && loot?.length) {
    duelResultLootList.innerHTML = loot
      .map((serial) => {
        const p = prettySerial(serial);
        return `<li>${escapeHtml(p.title)}<br /><span class="ticket-serial">${p.code}</span></li>`;
      })
      .join("");
    duelResultLoot.hidden = false;
  } else {
    duelResultLoot.hidden = true;
  }

  duelResultEl.hidden = false;
}

// 대결이 끝나면 진 쪽의 증정권을 이긴 쪽으로 넘긴다
let settledRoom = null;
async function settleDuel(room) {
  const winner = duelWinner(room);
  if (!winner || winner === "draw") return;
  if (settledRoom === room.code) return;

  // 이긴 쪽이 처리한다 (양쪽이 동시에 하지 않도록)
  const iWon = (winner === "host") === duelIsHost;
  if (!iWon) return;
  settledRoom = room.code;

  const loot = winner === "host" ? room.guestStakes : room.hostStakes;
  if (!loot || loot.length === 0) return;
  const nick = getNickname();
  const fromNk = winner === "host" ? room.guestNk : room.hostNk;
  for (const serial of loot) {
    try {
      await transferTicket(serial, nick, nicknameKey(nick), getClientIdSafe(), fromNk);
    } catch (err) {
      console.error("증정권 이전 실패", serial, err);
    }
  }
  duelRoomMsgEl.textContent += ` · 증정권 ${loot.length}장을 획득했습니다!`;
}

function getClientIdSafe() {
  try {
    return localStorage.getItem("apple-game-client-id") || "";
  } catch {
    return "";
  }
}

function renderDuelRoom(room) {
  if (!room) {
    duelStatusEl.textContent = "방이 사라졌습니다.";
    showDuelLobby();
    return;
  }
  duelRoom = room;
  duelLobbyEl.hidden = true;
  duelRoomEl.hidden = false;

  duelRoomCodeEl.textContent = room.code;
  duelHostNameEl.textContent = room.host || "-";
  duelGuestNameEl.textContent = room.guest || "기다리는 중…";
  duelHostScoreEl.textContent = room.hostScore ?? "-";
  duelGuestScoreEl.textContent = room.guestScore ?? "-";
  renderTrade(room);

  const winner = duelWinner(room);
  document.getElementById("duel-side-host").classList.toggle("is-winner", winner === "host");
  document.getElementById("duel-side-guest").classList.toggle("is-winner", winner === "guest");

  const myScore = duelIsHost ? room.hostScore : room.guestScore;
  if (winner) {
    const label =
      winner === "draw"
        ? "무승부!"
        : (winner === "host" ? room.host : room.guest) + " 님 승리!";
    duelRoomMsgEl.textContent = isForfeitWin(room)
      ? `🏳️ 상대가 나갔습니다 · ${label}`
      : `🏁 ${label}`;
    duelStartBtn.hidden = true;
    showDuelResult(room, winner);
    settleDuel(room);
  } else if (!room.guest) {
    duelRoomMsgEl.textContent = "상대를 기다리고 있습니다";
    duelStartBtn.hidden = true;
  } else if (typeof myScore === "number") {
    duelRoomMsgEl.textContent = "상대가 끝내기를 기다리는 중…";
    duelStartBtn.hidden = true;
  } else {
    duelRoomMsgEl.textContent = "준비되면 시작하세요. 같은 배치로 겨룹니다.";
    duelStartBtn.hidden = false;
  }
}

async function enterRoom(room, isHost) {
  duelIsHost = isHost;
  shownResult = null;
  settledRoom = null;
  duelUnwatch?.();
  duelUnwatch = await watchRoom(room.code, renderDuelRoom);
  renderDuelRoom(room);
}

duelBtn.addEventListener("click", async () => {
  duelModal.hidden = false;
  if (!duelRoom) {
    showDuelLobby();
    duelStatusEl.textContent = "";
    createStakes = [];
    await fillStakeOptions();
    renderOpenRooms();
    renderDuelLog();
  }
});

duelCloseBtn.addEventListener("click", () => { duelModal.hidden = true; });

// 대결 중에 페이지를 떠나면 기권으로 처리한다
window.addEventListener("pagehide", () => {
  if (duelRoom?.guest && !duelWinner(duelRoom)) {
    const nick = getNickname();
    if (nick) forfeit(duelRoom.code, nicknameKey(nick));
  }
});
duelModal.addEventListener("click", (e) => {
  if (e.target === duelModal) duelModal.hidden = true;
});

duelCreateBtn.addEventListener("click", async () => {
  const nick = getNickname();
  if (!nick) { duelStatusEl.textContent = "닉네임을 먼저 정하세요."; return; }
  duelCreateBtn.disabled = true;
  duelStatusEl.textContent = "방을 만드는 중...";
  try {
    const code = makeRoomCode();
    const seed = Math.floor(Math.random() * 2147483647);
    const stakes = selectedStakes();
    await createRoom({
      code, name: nick, nickKey: nicknameKey(nick), seed, stakes,
      password: duelPwInput.value.trim(),
    });
    duelPwInput.value = "";
    await enterRoom({ code, host: nick, seed, hostStakes: stakes, state: "waiting" }, true);
  } catch (err) {
    duelStatusEl.textContent = err.message;
  } finally {
    duelCreateBtn.disabled = false;
  }
});

async function doJoin(code) {
  const nick = getNickname();
  if (!nick) { duelStatusEl.textContent = "닉네임을 먼저 정하세요."; return; }
  let password = "";
  try {
    const peek = await openRooms(50);
    const target = peek.find((r) => r.code === code);
    if (target?.pw) password = window.prompt("방 비밀번호를 입력하세요") || "";
  } catch {
    /* 목록 조회 실패 시에는 비밀번호 없이 시도한다 */
  }
  duelStatusEl.textContent = "참가하는 중...";
  try {
    const room = await joinRoom({ code, name: nick, nickKey: nicknameKey(nick), password });
    await enterRoom({ ...room, code, guest: nick, state: "playing" }, false);
  } catch (err) {
    duelStatusEl.textContent = err.message;
  }
}

duelJoinBtn.addEventListener("click", () => {
  const code = duelCodeInput.value.trim().toUpperCase();
  if (code.length !== 5) { duelStatusEl.textContent = "방 번호 5자리를 입력하세요."; return; }
  doJoin(code);
});

duelRoomsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-room]");
  if (btn) doJoin(btn.dataset.room);
});

duelLeaveBtn.addEventListener("click", async () => {
  // 상대가 있고 아직 승부가 안 났다면 기권으로 처리한다
  if (duelRoom?.guest && !duelWinner(duelRoom)) {
    if (!window.confirm("지금 나가면 기권 처리되어 상대가 이깁니다. 나갈까요?")) return;
    const nick = getNickname();
    await forfeit(duelRoom.code, nicknameKey(nick));
  }
  duelUnwatch?.();
  duelUnwatch = null;
  duelRoom = null;
  duelMode = false;
  showDuelLobby();
  renderOpenRooms();
  renderDuelLog();
});

// 대결 시작 전 5초를 세어 양쪽이 같은 호흡으로 출발하게 한다
const countdownEl = document.getElementById("countdown");
const countdownNumEl = document.getElementById("countdown-num");

function runCountdown(seconds, onDone) {
  let left = seconds;
  countdownNumEl.classList.remove("is-go");
  countdownNumEl.textContent = left;
  countdownEl.hidden = false;

  const tick = window.setInterval(() => {
    left -= 1;
    if (left > 0) {
      countdownNumEl.textContent = left;
      // 애니메이션을 다시 태운다
      countdownNumEl.style.animation = "none";
      countdownNumEl.offsetHeight;
      countdownNumEl.style.animation = "";
      return;
    }
    window.clearInterval(tick);
    countdownNumEl.textContent = "시작!";
    countdownNumEl.classList.add("is-go");
    window.setTimeout(() => {
      countdownEl.hidden = true;
      onDone();
    }, 700);
  }, 1000);
}

// 대결 시작: 방의 시드로 판을 깔고 평소처럼 2분간 플레이한다
duelStartBtn.addEventListener("click", () => {
  if (!duelRoom) return;
  const seed = duelRoom.seed;
  duelModal.hidden = true;
  runCountdown(5, () => {
    duelMode = true;
    startGame(seed);
  });
});

// ── 돌발 이벤트 ────────────────────────────
const eventBannerEl = document.getElementById("event-banner");
const eventTitleEl = document.getElementById("event-title");
const eventDescEl = document.getElementById("event-desc");
const eventTimerEl = document.getElementById("event-timer");

let liveEvent = null;


function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function renderEventBanner() {
  const now = new Date();
  liveEvent = activeEvent(now);

  if (liveEvent) {
    eventBannerEl.hidden = false;
    eventBannerEl.className = "event-banner";
    eventTitleEl.textContent = `🔥 돌발 이벤트 진행 중! ${liveEvent.target}점 이상 달성하면 ${EVENT_PRIZE}!`;
    eventDescEl.textContent = `제한 시간 안에 ${liveEvent.target}점을 넘기면 즉시 당첨됩니다`;
    eventTimerEl.textContent = fmtClock(liveEvent.endAt - now);
    return;
  }

  // 돌발 이벤트라서 30분 전이 되어야 배너가 뜬다.
  // 시작 시각은 알려주지 않고 "곧 시작"이라고만 한다.
  const soon = upcomingEvent(now);
  if (soon) {
    eventBannerEl.hidden = false;
    eventBannerEl.className = "event-banner event-banner--notice";
    eventTitleEl.textContent = `⏰ 곧 돌발 이벤트가 시작됩니다! 목표 ${soon.target}점 · 상품 ${EVENT_PRIZE}`;
    eventDescEl.textContent = "30분 안에 시작됩니다 · 시작되면 30분 동안 진행돼요";
    eventTimerEl.textContent = "";
    return;
  }

  eventBannerEl.hidden = true;
}

renderEventBanner();
window.setInterval(renderEventBanner, 1000);

// 이벤트 달성자도 상단 로그에 함께 보여준다
let eventWinners = [];
watchEventWinners((list) => {
  eventWinners = list;
  renderTicker(lastPrizeList);
}, 20);

// ── 내 당첨권 ──────────────────────────────
const myPrizeBtn = document.getElementById("myprize-btn");
const myPrizeModal = document.getElementById("myprize-modal");
const myPrizeClose = document.getElementById("myprize-close");
const myPrizeListEl = document.getElementById("myprize-list");
const myPrizeNoteEl = document.getElementById("myprize-note");

const EMOJI = Object.fromEntries(PRIZES.map((p) => [p.label, p.emoji]));

// 받은 날짜. 며칠 전 것도 그대로 남아 있다는 것을 보여준다.
function prizeWhen(ts) {
  const ms = ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : 0;
  if (!ms) return "";
  const d = new Date(ms);
  return ` · ${d.getMonth() + 1}/${d.getDate()}`;
}

async function renderMyPrizes() {
  const nick = getNickname();
  if (!nick) {
    myPrizeNoteEl.textContent = "닉네임을 먼저 정하세요.";
    myPrizeListEl.innerHTML = "";
    return;
  }
  myPrizeListEl.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  // 당첨권 목록은 회차와 무관하게 전부 보여주고,
  // "오늘 몇 회 썼는지"만 오늘 회차로 따로 센다.
  const [list, evList, todayList] = await Promise.all([
    fetchMyPrizes(nicknameKey(nick)),
    fetchMyEventPrizes(nicknameKey(nick)),
    fetchTodayPrizes(nicknameKey(nick)),
  ]);
  const reset = nextResetAt().toLocaleString("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const won = [
    ...evList.map((r) => ({ ...r, n: "돌발", isEvent: true })),
    ...list.filter((r) => r.prize && r.prize !== "꽝"),
  ];
  // "초기화"되는 것은 룰렛을 돌릴 수 있는 횟수뿐이다.
  // 받은 당첨권은 계속 남는다는 것을 문구에서 분명히 한다.
  myPrizeNoteEl.textContent =
    `${nick} · 오늘 룰렛 ${todayList.length}/${DAILY_SPINS}회 사용 ` +
    `(${reset}에 횟수만 초기화) · 받은 당첨권은 계속 보관됩니다`;

  if (won.length === 0) {
    myPrizeListEl.innerHTML =
      '<li class="ranking-empty">아직 당첨된 경품이 없습니다.</li>';
    return;
  }
  myPrizeListEl.innerHTML = won
    .map(
      (r, i) => `<li>
        <span class="rank">${i + 1}</span>
        <span class="name">${EMOJI[r.prize] || "🎁"} ${escapeHtml(r.prize)}
          <span class="online-list__code">${r.score}점 달성 · ${
            r.isEvent ? "🔥 돌발 이벤트" : `${r.n}번째 룰렛`
          }${prizeWhen(r.createdAt)}</span>
        </span>
      </li>`
    )
    .join("");
}

myPrizeBtn.addEventListener("click", () => {
  myPrizeModal.hidden = false;
  renderMyPrizes();
});
myPrizeClose.addEventListener("click", () => {
  myPrizeModal.hidden = true;
});
myPrizeModal.addEventListener("click", (e) => {
  if (e.target === myPrizeModal) myPrizeModal.hidden = true;
});

const onlineCountEl = document.getElementById("online-count");
const onlineBtn = document.getElementById("online-btn");
const onlineModal = document.getElementById("online-modal");
const onlineClose = document.getElementById("online-close");
const onlineListEl = document.getElementById("online-list");
const onlineNoteEl = document.getElementById("online-note");

const onlineGateEl = document.getElementById("online-gate");
const onlinePwInput = document.getElementById("online-pw");
const onlinePwBtn = document.getElementById("online-pw-btn");
const onlinePwMsg = document.getElementById("online-pw-msg");

// 비밀번호는 코드에 없다. PBKDF2(20만 회) 해시만 두어
// 해시를 보더라도 비밀번호를 되찾기 어렵게 한다.
const ADMIN_SALT = "d4dadcbe50374387f6261732ad65cea1";
const ADMIN_HASH =
  "837bfa304ec1e67b1e5d7ac3a21b4ea4f2cb5ccb7a857bb30458f2ea1ccab2a4";

// 인증 상태를 저장소에 남기지 않는다. 저장해두면 값만 바꿔 넣어
// 비밀번호 없이 관리자 화면을 열 수 있기 때문이다.
let adminUnlocked = false;

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function derive(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const salt = Uint8Array.from(ADMIN_SALT.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
    key,
    256
  );
  return hex(bits);
}

function isAdmin() {
  return adminUnlocked;
}

const blockedSectionEl = document.getElementById("blocked-section");
const blockedListEl = document.getElementById("blocked-list");

async function renderBlockedList() {
  blockedListEl.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  try {
    const list = await fetchBlockedList();
    if (list.length === 0) {
      blockedListEl.innerHTML = '<li class="ranking-empty">차단된 기기가 없습니다.</li>';
      return;
    }
    blockedListEl.innerHTML = list
      .map(
        (b, i) => `<li class="${b.active ? "" : "is-expired"}">
          <span class="rank">${i + 1}</span>
          <span class="name">${escapeHtml(b.name || "(닉네임 없음)")}
            <span class="blocked-item__reason">${escapeHtml(b.reason || "")}</span>
            <span class="online-list__code">${escapeHtml(b.id)}</span>
          </span>
          <span class="block-state">${b.active ? "차단 중" : "해제됨"}</span>
        </li>`
      )
      .join("");
  } catch (err) {
    console.error(err);
    blockedListEl.innerHTML = '<li class="ranking-empty">불러오지 못했습니다.</li>';
  }
}

const adminChatListEl = document.getElementById("admin-chat-list");
const adminScoreListEl = document.getElementById("admin-score-list");
const adminStatusEl = document.getElementById("admin-status");
const adminUnblockCmdEl = document.getElementById("admin-unblock-cmd");
const adminPurgeNameBtn = document.getElementById("admin-purge-name");
const adminPurgeAllBtn = document.getElementById("admin-purge-all");

async function renderAdminChat() {
  adminChatListEl.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  const list = await fetchRecentMessages(40);
  if (list.length === 0) {
    adminChatListEl.innerHTML = '<li class="ranking-empty">채팅이 없습니다.</li>';
    return;
  }
  adminChatListEl.innerHTML = list
    .map(
      (m) => `<li>
        <span class="name">
          <span class="chat-name">${escapeHtml(m.name || "?")}</span>
          ${escapeHtml((m.text || "").slice(0, 40))}
          <span class="online-list__code">${escapeHtml(m.cid || "구버전")}</span>
        </span>
        <button type="button" class="block-btn" data-msg="${escapeHtml(m.id)}">삭제</button>
      </li>`
    )
    .join("");
}

async function renderAdminScores() {
  adminScoreListEl.innerHTML = '<li class="ranking-empty">불러오는 중...</li>';
  const scores = await fetchScoresForAdmin(50);
  if (scores.length === 0) {
    adminScoreListEl.innerHTML = '<li class="ranking-empty">기록이 없습니다.</li>';
    return;
  }
  // 실측 정상 범위는 매칭당 2.1~2.5개, 초당 0.86~0.99개다.
  // 이를 벗어나면 규칙은 통과했더라도 눈에 띄게 표시한다.
  adminScoreListEl.innerHTML = scores
    .map((s, i) => {
      const sec = (s.durationMs || 0) / 1000;
      const perMatch = s.clears ? s.score / s.clears : 0;
      const perSec = sec ? s.score / sec : 0;
      const odd = perMatch > 2.6 || perSec > 1.1;
      const flag = odd
        ? `<span class="score-flag">의심 · 매칭당 ${perMatch.toFixed(2)} · 초당 ${perSec.toFixed(2)}</span>`
        : "";
      return `<li class="${odd ? "is-odd" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="name">${escapeHtml(s.name || "?")}
          <span class="online-list__code">${s.score}점 · 매칭 ${s.clears ?? "?"}회 · ${Math.round(sec)}초</span>
          ${flag}
        </span>
        ${s.moves ? `<button type="button" class="block-btn" data-replay="${escapeHtml(s.id)}">리플레이</button>` : ""}
        <button type="button" class="block-btn" data-score="${escapeHtml(s.id)}">삭제</button>
      </li>`;
    })
    .join("");
}

// 점수 삭제는 웹에서 직접 하지 않는다. 권한을 열면 누구나 랭킹을 지울 수 있기 때문이다.
// 대신 운영자가 터미널에 붙여넣을 명령을 만들어 클립보드에 복사한다.
adminScoreListEl.addEventListener("click", handleReplayClick);
adminScoreListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-score]");
  if (!btn || !isAdmin()) return;
  const cmd = `npx firebase-tools firestore:delete scores/${btn.dataset.score} --force --project jo8454-ea749`;
  try {
    await navigator.clipboard.writeText(cmd);
    adminStatusEl.textContent = "삭제 명령을 복사했습니다. 터미널에 붙여넣어 실행하세요.";
  } catch {
    adminStatusEl.textContent = cmd;
  }
  adminUnblockCmdEl.textContent = cmd;
});

adminChatListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-msg]");
  if (!btn || !isAdmin()) return;
  btn.disabled = true;
  const { ok, fail } = await deleteMessages([btn.dataset.msg]);
  adminStatusEl.textContent = ok
    ? "삭제했습니다."
    : "삭제 실패 (올라온 지 2분이 지나야 지울 수 있습니다).";
  if (ok) btn.closest("li").remove();
  else btn.disabled = false;
});

adminPurgeNameBtn.addEventListener("click", async () => {
  if (!isAdmin()) return;
  const name = window.prompt("삭제할 닉네임을 입력하세요 (부분 일치)");
  if (!name) return;
  adminStatusEl.textContent = "삭제 중...";
  const list = await fetchRecentMessages(200);
  const targets = list.filter((m) => (m.name || "").includes(name)).map((m) => m.id);
  const { ok, fail } = await deleteMessages(targets);
  adminStatusEl.textContent = `${ok}건 삭제${fail ? ` · ${fail}건은 2분 미만이라 남음` : ""}`;
  renderAdminChat();
});

adminPurgeAllBtn.addEventListener("click", async () => {
  if (!isAdmin()) return;
  if (!window.confirm("채팅을 전부 삭제할까요? 되돌릴 수 없습니다.")) return;
  adminStatusEl.textContent = "삭제 중...";
  const list = await fetchRecentMessages(200);
  const { ok, fail } = await deleteMessages(list.map((m) => m.id));
  adminStatusEl.textContent = `${ok}건 삭제${fail ? ` · ${fail}건은 2분 미만이라 남음` : ""}`;
  renderAdminChat();
});

function applyAdminView() {
  const ok = isAdmin();
  onlineGateEl.hidden = ok;
  onlineNoteEl.hidden = !ok;
  onlineListEl.hidden = !ok;
  blockedSectionEl.hidden = !ok;
  if (ok) {
    renderOnlineList();
    renderBlockedList();
    renderAdminChat();
    renderAdminScores();
    fetchChatLocked().then((locked) => {
      const el = document.getElementById("admin-chat-lock-state");
      if (el) el.textContent = locked ? "🔒 잠김" : "🔓 열림";
    });
    adminUnblockCmdEl.textContent =
      "npx firebase-tools firestore:delete blocked/<기기코드> --force --project jo8454-ea749";
  }
}

async function checkAdminPassword() {
  const value = onlinePwInput.value;
  if (!value) {
    onlinePwMsg.textContent = "비밀번호를 입력하세요.";
    return;
  }
  onlinePwMsg.textContent = "확인 중...";
  const hash = await derive(value);
  if (hash !== ADMIN_HASH) {
    onlinePwMsg.textContent = "비밀번호가 올바르지 않습니다.";
    return;
  }
  adminUnlocked = true;
  onlinePwInput.value = "";
  onlinePwMsg.textContent = "";
  applyAdminView();
}

let onlineUsers = [];

function renderOnlineList() {
  onlineNoteEl.textContent = `현재 ${onlineUsers.length}명 접속 중 · 15초마다 갱신`;
  if (onlineUsers.length === 0) {
    onlineListEl.innerHTML = '<li class="ranking-empty">접속자를 불러오는 중입니다.</li>';
    return;
  }
  onlineListEl.innerHTML = onlineUsers
    .map((u, i) => {
      const name = u.name
        ? escapeHtml(u.name)
        : '<span class="online-list__anon">닉네임 미설정</span>';
      const me = u.isMe ? '<span class="online-list__me">나</span>' : "";
      const code = `<span class="online-list__code">${escapeHtml(u.id)}</span>`;
      const btn = u.isMe
        ? ""
        : `<button type="button" class="block-btn" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.name)}" data-fp="${escapeHtml(u.fp || "")}" data-hw="${escapeHtml(u.hw || "")}">차단</button>`;
      return `<li><span class="rank">${i + 1}</span><span class="name">${name}${code}</span>${me}${btn}</li>`;
    })
    .join("");
}

onlineBtn.addEventListener("click", () => {
  onlineModal.hidden = false;
  applyAdminView();
});

onlineListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".block-btn");
  if (!btn || !isAdmin()) return;
  // 차단 등록은 웹에서 못 한다(누구나 남을 차단할 수 있게 되므로).
  // 대상 ID를 복사해 Firebase 콘솔의 blocked 컬렉션에 넣으면 된다.
  const ids = blockTargets(btn.dataset.id, btn.dataset.fp);
  try {
    await navigator.clipboard.writeText(ids.join("\n"));
    adminStatusEl.textContent = `차단 대상 ID ${ids.length}개를 복사했습니다. Firebase 콘솔 blocked 컬렉션에 문서 ID로 추가하세요.`;
  } catch {
    adminStatusEl.textContent = ids.join(" / ");
  }
  adminUnblockCmdEl.textContent = ids.join("\n");
  btn.textContent = "ID 복사됨";
});

onlinePwBtn.addEventListener("click", checkAdminPassword);
onlinePwInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkAdminPassword();
});
onlineClose.addEventListener("click", () => {
  onlineModal.hidden = true;
  adminUnlocked = false;
  applyAdminView();
});
onlineModal.addEventListener("click", (e) => {
  if (e.target === onlineModal) onlineModal.hidden = true;
});
const nickLabelEl = document.getElementById("nick-label");
const nickSetupEl = document.getElementById("nick-setup");
const nickInput = document.getElementById("nick-input");
const nickSaveBtn = document.getElementById("nick-save-btn");
const chatListEl = document.getElementById("chat-list");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send");
const chatStatusEl = document.getElementById("chat-status");

function formatChatTime(createdAt) {
  if (!createdAt?.seconds) return "";
  const d = new Date(createdAt.seconds * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function renderNickname() {
  const nick = getNickname();
  const hasNick = nick.length > 0;

  nickLabelEl.textContent = hasNick ? nick : "닉네임 미설정";
  nickLabelEl.parentElement.classList.toggle("is-set", hasNick);
  nickSetupEl.hidden = hasNick;
  renderScoreNameArea();
  chatInput.disabled = !hasNick;
  chatSendBtn.disabled = !hasNick;
  chatInput.placeholder = hasNick ? "메시지 입력" : "닉네임을 먼저 정하세요";
}

function renderMessages(list) {
  if (list === null) {
    chatListEl.innerHTML = '<li class="chat-empty">채팅 서버에 연결할 수 없습니다.</li>';
    return;
  }
  if (list.length === 0) {
    chatListEl.innerHTML = '<li class="chat-empty">아직 대화가 없습니다.</li>';
    return;
  }

  const myNick = getNickname();
  chatListEl.innerHTML = list
    .map((m) => {
      const mine = myNick && m.name === myNick ? " is-mine" : "";
      const time = formatChatTime(m.createdAt);
      return `<li class="${mine.trim()}">
        <span class="chat-name">${escapeHtml(m.name ?? "익명")}</span>${escapeHtml(m.text ?? "")}${
        time ? `<span class="chat-time">${time}</span>` : ""
      }
      </li>`;
    })
    .join("");
  chatListEl.scrollTop = chatListEl.scrollHeight;
}

async function saveNicknameFromInput() {
  const value = nickInput.value.trim();
  // 사칭·조롱 닉네임은 시도한 것만으로 이 기기를 차단한다
  const targetedTry = findTargeted(value);
  if (targetedTry) {
    lockOut(`금지된 닉네임 시도 (${targetedTry})`);
    return;
  }
  const problem = checkNickname(value);
  if (problem) {
    chatStatusEl.textContent = problem;
    return;
  }

  nickSaveBtn.disabled = true;
  chatStatusEl.textContent = "확인 중...";
  const taken = await reserveNickname(value);
  nickSaveBtn.disabled = false;
  if (!taken.ok) {
    chatStatusEl.textContent = taken.reason;
    return;
  }

  setNickname(value);
  nickInput.value = "";
  chatStatusEl.textContent = "";
  renderNickname();
  chatInput.focus();
}

nickSaveBtn.addEventListener("click", saveNicknameFromInput);
nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveNicknameFromInput();
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  const nick = getNickname();
  if (!text || !nick) return;

  chatSendBtn.disabled = true;
  chatInput.value = "";
  try {
    await sendMessage(nick, text);
    chatStatusEl.textContent = "";
  } catch (err) {
    console.error(err);
    chatStatusEl.textContent = "전송에 실패했습니다.";
    chatInput.value = text;
  } finally {
    chatSendBtn.disabled = !getNickname();
    chatInput.focus();
  }
});

const blockedReason = isBlocked();
if (blockedReason) {
  lockoutReasonEl.textContent = `사유: ${blockedReason}`;
  lockoutEl.hidden = false;
}

// 특정인을 사칭·조롱하는 닉네임을 쓰던 기기는 접속 자체를 막는다
const targeted = getTargetedViolation();
if (targeted) {
  lockOut(`사용이 금지된 닉네임 사용 (${targeted})`);
}

// 차단은 즉시 반영돼야 한다. 페이지를 열 때 한 번만 보면
// 이미 켜둔 창에서는 계속 플레이할 수 있으므로 주기적으로 다시 확인한다.
async function checkBlockNow() {
  const serverReason = await isBlockedOnServer();
  if (serverReason) {
    lockOut(serverReason, { report: false });
    return;
  }
  // 서버에서 풀렸으면 이 기기의 잠금도 함께 푼다.
  // 이게 없으면 운영자가 해제해도 참가자 화면은 계속 잠겨 있다.
  if (isBlocked()) {
    try {
      localStorage.removeItem(CHEAT_KEY);
    } catch {
      /* 저장소 접근 실패 시 새로고침으로 풀린다 */
    }
    lockoutEl.hidden = true;
  }
}

checkBlockNow();
window.setInterval(checkBlockNow, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkBlockNow();
});

// 이미 닉네임을 쓰고 있던 사람도 접속 시 소유권을 확보한다.
// 다른 사람이 먼저 가져갔다면 비워서 새로 정하게 한다.
(async () => {
  const existing = getNickname();
  if (!existing) return;
  const claim = await reserveNickname(existing);
  if (!claim.ok) {
    clearNickname();
    renderNickname();
    renderScoreNameArea();
    entryNickMsg.textContent = "닉네임이 이미 사용 중이라 다시 정해야 합니다.";
    updateEntryGate();
  }
})();

updateEntryGate();

// 운영자가 채팅을 잠갔는지 주기적으로 확인해 입력창을 막는다
let chatLocked = false;
async function refreshChatLock() {
  chatLocked = await fetchChatLocked();
  const hasNick = !!getNickname();
  chatInput.disabled = chatLocked || !hasNick;
  chatSendBtn.disabled = chatLocked || !hasNick;
  if (chatLocked) {
    chatInput.placeholder = "운영자가 채팅을 잠갔습니다";
    chatStatusEl.textContent = "채팅이 잠겨 있습니다.";
  } else if (hasNick) {
    chatInput.placeholder = "메시지 입력";
    if (chatStatusEl.textContent === "채팅이 잠겨 있습니다.") chatStatusEl.textContent = "";
  }
}
refreshChatLock();
window.setInterval(refreshChatLock, 15000);

renderNickname();
renderScoreNameArea();
watchMessages(renderMessages);
startPresence((count, users) => {
  onlineCountEl.textContent = count === null ? "–" : `${count}명`;
  onlineUsers = users ?? [];
  if (!onlineModal.hidden && isAdmin()) renderOnlineList();
});

buildGrid();
updateTimerVisual();
