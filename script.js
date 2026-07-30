import { submitScore, fetchTopScores, getNextReset } from "./leaderboard.js?v=24";
import { findTargeted } from "./profanity.js?v=24";
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
  deleteMessages,
  blockClient,
  reserveNickname,
  clearNickname,
} from "./chat.js?v=24";

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

function startGame() {
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

  buildGrid();
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
    submitStatusEl.textContent = `등록 실패: ${err.message}`;
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
    const resetNote = `매일 오후 5:30 초기화 · 다음 초기화 ${next.toLocaleString("ko-KR", {
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

// 비밀번호 자체는 코드에 없고 SHA-256 해시만 둔다.
const ADMIN_HASH =
  "8d02a502793c9e16ae89bb936b24bc6f91987ca412e77a233e6ca7ebc32b491f";
const ADMIN_KEY = "apple-game-admin";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isAdmin() {
  try {
    return sessionStorage.getItem(ADMIN_KEY) === "1";
  } catch {
    return false;
  }
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
        (b, i) => `<li>
          <span class="rank">${i + 1}</span>
          <span class="name">${escapeHtml(b.name || "(닉네임 없음)")}
            <span class="blocked-item__reason">${escapeHtml(b.reason || "")}</span>
          </span>
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
  const { scores } = await fetchTopScores();
  if (!scores || scores.length === 0) {
    adminScoreListEl.innerHTML = '<li class="ranking-empty">기록이 없습니다.</li>';
    return;
  }
  adminScoreListEl.innerHTML = scores
    .map(
      (s, i) => `<li>
        <span class="rank">${i + 1}</span>
        <span class="name">${escapeHtml(s.name || "?")}
          <span class="online-list__code">${s.score}점 · 매칭 ${s.clears ?? "?"}회 · ${Math.round((s.durationMs || 0) / 1000)}초</span>
        </span>
      </li>`
    )
    .join("");
}

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
  const hash = await sha256(value);
  if (hash !== ADMIN_HASH) {
    onlinePwMsg.textContent = "비밀번호가 올바르지 않습니다.";
    return;
  }
  try {
    sessionStorage.setItem(ADMIN_KEY, "1");
  } catch {
    /* 저장이 막혀 있어도 이번 창에서는 열린다 */
  }
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
  const id = btn.dataset.id;
  const name = btn.dataset.name;
  btn.disabled = true;
  btn.textContent = "차단 중";
  try {
    await blockClient(id, name, btn.dataset.fp, btn.dataset.hw);
    btn.textContent = "차단됨";
    renderBlockedList();
  } catch (err) {
    console.error(err);
    btn.textContent = "실패";
    btn.disabled = false;
  }
});

onlinePwBtn.addEventListener("click", checkAdminPassword);
onlinePwInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkAdminPassword();
});
onlineClose.addEventListener("click", () => {
  onlineModal.hidden = true;
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
