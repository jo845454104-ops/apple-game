import { getFirestoreApi } from "./firebase-app.js?v=78";
import { getFingerprint } from "./fingerprint.js?v=78";
import {
  getNickname,
  reserveNickname,
  setNickname,
  checkNickname,
  sendMessage,
  watchMessages,
  fetchChatLocked,
} from "./chat.js?v=78";

// 무한 사과게임 (베타).
// 기본 규칙은 원래 게임과 같다 — 드래그로 합이 10인 칸을 묶어 터뜨린다.
// 다른 점: 판이 절대 비지 않는다(터진 칸은 잠시 뒤 새 사과로 다시 채워진다),
// 매 판정마다 시간 막대가 줄고 0이 되면 끝난다, 콤보가 쌓일수록 배율이 오른다,
// 가끔 황금 사과가 섞여 나와 추가 점수를 준다.
// 점수 체계가 원래 게임과 달라 랭킹은 infiniteScores 컬렉션에 따로 쌓는다.

const COLS = 9;
const ROWS = 10;
const TARGET_SUM = 10;
// 제한시간은 점수가 오를수록 짧아진다. 6초로 시작해 100점마다 0.1초씩 줄고
// 4초에서 멈춘다 — 20단계, 즉 2000점부터는 계속 4초다.
const POP_START_MS = 6000;
const POP_MIN_MS = 4000;
const POP_STEP_MS = 100;
const POP_STEP_SCORE = 100;
const FIRST_POP_MS = 8000; // 시작 직후 첫 판만 판을 한 번 훑어볼 시간을 조금 더 준다

function popMsForScore(currentScore) {
  const steps = Math.floor(currentScore / POP_STEP_SCORE);
  return Math.max(POP_MIN_MS, POP_START_MS - steps * POP_STEP_MS);
}
const RESPAWN_MS = 1500; // 터진 칸에 새 사과가 돋아나기까지
const SPROUT_WARN_MS = 700; // 돋아나기 이만큼 전부터 자리를 예고한다
const GOLDEN_CHANCE = 0.06;
const GOLDEN_BONUS = 10;
// 콤보 배율은 완만하게 올라간다. 콤보당 +0.1, 콤보 30에서 ×4.0로 멈춘다.
// (예전엔 콤보 19에 ×10까지 올라 후반 한 번의 실수 여부가 점수를 통째로 갈랐다)
const MULT_PER_COMBO = 0.1;
const MAX_MULTIPLIER = 4;
const MULT_CAP_COMBO = 30;
// 4개 이상을 한 번에 묶으면 초과분 1개당 이만큼 더 준다.
// 2~3개짜리를 반복하는 것보다 크게 묶는 쪽이 이득이 되게 하는 장치다.
const BIG_COMBO_MIN = 4;
const BIG_COMBO_BONUS = 3;
// 콤보는 빠르게 이어 터뜨릴 때만 쌓인다. 직전 판정에서 이 시간을 넘기면
// 터뜨리는 데 성공해도 콤보가 1로 돌아간다.
const COMBO_WINDOW_MS = 2500;

const gridEl = document.getElementById("inf-grid");
const boardEl = gridEl.parentElement;
const selectionBox = document.getElementById("inf-selection-box");
const sumBadge = document.getElementById("inf-sum-badge");
const scoreEl = document.getElementById("inf-score");
const sideScoreEl = document.getElementById("inf-side-score");
const comboEl = document.getElementById("inf-combo");
const multEl = document.getElementById("inf-mult");
const limitEl = document.getElementById("inf-limit");
const timerFillEl = document.getElementById("inf-timer-fill");
const timerSecondsEl = document.getElementById("inf-timer-seconds");
const startOverlay = document.getElementById("inf-start-overlay");
const endOverlay = document.getElementById("inf-end-overlay");
const startBtn = document.getElementById("inf-start-btn");
const retryBtn = document.getElementById("inf-retry-btn");
const finalScoreEl = document.getElementById("inf-final-score");
const finalComboEl = document.getElementById("inf-final-combo");
const nicknameEl = document.getElementById("inf-nickname");
const submitBtn = document.getElementById("inf-submit-btn");
const submitStatusEl = document.getElementById("inf-submit-status");
const rankingBtn = document.getElementById("inf-ranking-btn");
const rankingModal = document.getElementById("inf-ranking-modal");
const rankingClose = document.getElementById("inf-ranking-close");
const rulesBtn = document.getElementById("inf-rules-btn");
const rulesModal = document.getElementById("inf-rules-modal");
const rulesClose = document.getElementById("inf-rules-close");
const rankingList = document.getElementById("inf-ranking-list");

let cells = [];
let score = 0;
let combo = 0;
let bestCombo = 0;
let clearEvents = 0;
let playing = false;
let scoreSubmitted = false;
let startedAt = 0;
let lastPopAt = 0;
let popDeadline = 0;
let currentPopMs = FIRST_POP_MS;
let tickId = null;
let respawnTimers = new Set();
let isSelecting = false;
let startX = 0;
let startY = 0;

function randomValue() {
  return Math.floor(Math.random() * 9) + 1;
}

function makeCell(index) {
  const el = document.createElement("div");
  el.className = "apple";
  const num = document.createElement("span");
  el.appendChild(num);
  gridEl.appendChild(el);
  const cell = { index, el, num, value: 0, golden: false, empty: true, rect: null };
  fillCell(cell);
  return cell;
}

function fillCell(cell) {
  cell.value = randomValue();
  cell.golden = Math.random() < GOLDEN_CHANCE;
  cell.empty = false;
  cell.num.textContent = cell.value;
  cell.el.classList.remove("is-cleared", "is-sprouting");
  cell.el.classList.toggle("is-golden", cell.golden);
}

function buildBoard() {
  gridEl.innerHTML = "";
  cells = [];
  respawnTimers.forEach((id) => clearTimeout(id));
  respawnTimers.clear();
  for (let i = 0; i < COLS * ROWS; i++) {
    cells.push(makeCell(i));
  }
}

function measureRects() {
  const boardRect = boardEl.getBoundingClientRect();
  cells.forEach((cell) => {
    const r = cell.el.getBoundingClientRect();
    cell.rect = {
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
  cells.forEach((cell) => {
    if (cell.empty) return;
    const hit = rectsIntersect(cell.rect, sel);
    cell.el.classList.toggle("is-selecting", hit);
    if (hit) sum += cell.value;
  });

  const isMatch = sum === TARGET_SUM;
  selectionBox.classList.toggle("is-match", isMatch);
  cells.forEach((cell) => {
    if (cell.el.classList.contains("is-selecting")) {
      cell.el.classList.toggle("is-match", isMatch);
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
  cells.forEach((cell) => {
    cell.el.classList.remove("is-selecting", "is-match");
  });
}

function multiplierFor(comboCount) {
  const steps = Math.min(comboCount, MULT_CAP_COMBO);
  return Math.min(1 + steps * MULT_PER_COMBO, MAX_MULTIPLIER);
}

function popCell(cell) {
  cell.empty = true;
  cell.el.classList.add("is-cleared");
  // 예고 이펙트에 터진 사과의 숫자가 남아 보이지 않도록 지운다
  cell.num.textContent = "";

  // 다시 돋아나기 직전에 자리를 예고해준다. 갑자기 튀어나오면
  // 이미 훑어본 칸이 조용히 바뀌어 있어 판을 다시 읽어야 한다.
  const warnId = setTimeout(() => {
    respawnTimers.delete(warnId);
    if (!playing) return;
    cell.el.classList.add("is-sprouting");
  }, RESPAWN_MS - SPROUT_WARN_MS);
  respawnTimers.add(warnId);

  const id = setTimeout(() => {
    respawnTimers.delete(id);
    if (!playing) return;
    cell.el.classList.remove("is-sprouting");
    fillCell(cell);
    measureRects();
  }, RESPAWN_MS);
  respawnTimers.add(id);
}

function finalizeSelection() {
  const selected = cells.filter((c) => !c.empty && c.el.classList.contains("is-selecting"));
  const sum = selected.reduce((acc, c) => acc + c.value, 0);

  if (playing && sum === TARGET_SUM && selected.length > 0) {
    // 콤보는 빠르게 이어 터뜨릴 때만 쌓인다. 뜸을 들이면 1부터 다시 시작한다.
    const now = Date.now();
    const inWindow = lastPopAt > 0 && now - lastPopAt <= COMBO_WINDOW_MS;
    combo = inWindow ? combo + 1 : 1;
    lastPopAt = now;
    bestCombo = Math.max(bestCombo, combo);
    const mult = multiplierFor(combo);
    const goldenCount = selected.filter((c) => c.golden).length;
    const bigBonus =
      selected.length >= BIG_COMBO_MIN
        ? (selected.length - BIG_COMBO_MIN + 1) * BIG_COMBO_BONUS
        : 0;
    const gained = Math.round(
      (selected.length + bigBonus + goldenCount * GOLDEN_BONUS) * mult
    );
    score += gained;
    clearEvents += 1;

    selected.forEach(popCell);

    scoreEl.textContent = score;
    sideScoreEl.textContent = score;
    comboEl.textContent = combo;
    multEl.textContent = `×${mult.toFixed(1)}`;

    // 점수가 오를수록 다음 판정까지 주어지는 시간이 짧아진다
    currentPopMs = popMsForScore(score);
    limitEl.textContent = `${(currentPopMs / 1000).toFixed(1)}초`;
    popDeadline = Date.now() + currentPopMs;
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
  measureRects();
  const p = relativePoint(e);
  isSelecting = true;
  startX = p.x;
  startY = p.y;
  updateSelectionVisual(getSelectionRect(p.x, p.y));
}

function handlePointerMove(e) {
  if (!isSelecting) return;
  const p = relativePoint(e);
  updateSelectionVisual(getSelectionRect(p.x, p.y));
}

function handlePointerUp() {
  if (!isSelecting) return;
  isSelecting = false;
  finalizeSelection();
}

boardEl.addEventListener("pointerdown", handlePointerDown);
window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);

function tick() {
  if (!playing) return;
  const remain = Math.max(0, popDeadline - Date.now());
  const pct = (remain / currentPopMs) * 100;
  timerFillEl.style.height = `${pct}%`;
  timerFillEl.classList.toggle("is-low", pct <= 30);
  timerSecondsEl.textContent = Math.ceil(remain / 1000);
  timerSecondsEl.classList.toggle("is-low", pct <= 30);
  if (remain <= 0) {
    endGame();
    return;
  }
  tickId = requestAnimationFrame(tick);
}

function startGame() {
  score = 0;
  combo = 0;
  bestCombo = 0;
  clearEvents = 0;
  scoreSubmitted = false;
  playing = true;
  startedAt = Date.now();
  lastPopAt = 0;
  currentPopMs = FIRST_POP_MS;
  popDeadline = startedAt + currentPopMs;

  scoreEl.textContent = "0";
  sideScoreEl.textContent = "0";
  comboEl.textContent = "0";
  multEl.textContent = "×1.0";
  limitEl.textContent = `${(POP_START_MS / 1000).toFixed(1)}초`;
  submitStatusEl.textContent = "";

  startOverlay.hidden = true;
  endOverlay.hidden = true;

  buildBoard();
  requestAnimationFrame(() => {
    measureRects();
    tickId = requestAnimationFrame(tick);
  });
}

function endGame() {
  playing = false;
  if (tickId) cancelAnimationFrame(tickId);
  respawnTimers.forEach((id) => clearTimeout(id));
  respawnTimers.clear();
  clearSelectionVisual();

  finalScoreEl.textContent = score;
  finalComboEl.textContent = bestCombo;

  const nick = getNickname();
  nicknameEl.textContent = nick || "닉네임 없음";
  submitBtn.disabled = !nick;

  endOverlay.hidden = false;
}

function getClientId() {
  try {
    return (
      localStorage.getItem("apple-game-client-id") ||
      sessionStorage.getItem("apple-game-client-id") ||
      ""
    );
  } catch {
    return "";
  }
}

async function submitScore() {
  if (scoreSubmitted) return;
  const name = getNickname();
  if (!name) return;

  submitBtn.disabled = true;
  submitStatusEl.textContent = "등록하는 중…";

  const ctx = await getFirestoreApi();
  if (!ctx) {
    submitStatusEl.textContent = "서버에 연결하지 못해 등록하지 못했습니다.";
    submitBtn.disabled = false;
    return;
  }

  try {
    const { db, api } = ctx;
    await api.addDoc(api.collection(db, "infiniteScores"), {
      name: name.slice(0, 12),
      score,
      combo: bestCombo,
      clears: clearEvents,
      durationMs: Date.now() - startedAt,
      cid: getClientId(),
      fp: await getFingerprint().catch(() => ""),
      createdAt: api.serverTimestamp(),
    });
    scoreSubmitted = true;
    submitStatusEl.textContent = "랭킹에 등록되었습니다!";
  } catch (err) {
    submitStatusEl.textContent = "등록에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    submitBtn.disabled = false;
  }
}

async function loadRanking() {
  rankingList.innerHTML = `<li class="ranking-empty">불러오는 중…</li>`;
  const ctx = await getFirestoreApi();
  if (!ctx) {
    rankingList.innerHTML = `<li class="ranking-empty">서버에 연결하지 못했습니다.</li>`;
    return;
  }
  const { db, api } = ctx;
  try {
    const q = api.query(
      api.collection(db, "infiniteScores"),
      api.orderBy("score", "desc"),
      api.limit(10)
    );
    const snap = await api.getDocs(q);
    if (snap.empty) {
      rankingList.innerHTML = `<li class="ranking-empty">아직 기록이 없습니다.</li>`;
      return;
    }
    rankingList.innerHTML = "";
    let rank = 0;
    snap.forEach((doc) => {
      rank += 1;
      const d = doc.data();
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="rank">${rank}</span>
        <span class="name">${escapeHtml(d.name || "")}</span>
        <span class="combo-note">최고 콤보 ${Number(d.combo || 0)}</span>
        <span class="score">${Number(d.score || 0)}점</span>
      `;
      rankingList.appendChild(li);
    });
  } catch {
    rankingList.innerHTML = `<li class="ranking-empty">불러오지 못했습니다.</li>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

startBtn.addEventListener("click", startGame);
retryBtn.addEventListener("click", startGame);
submitBtn.addEventListener("click", submitScore);

rankingBtn.addEventListener("click", () => {
  rankingModal.hidden = false;
  loadRanking();
});
rankingClose.addEventListener("click", () => {
  rankingModal.hidden = true;
});
rankingModal.addEventListener("click", (e) => {
  if (e.target === rankingModal) rankingModal.hidden = true;
});

rulesBtn.addEventListener("click", () => {
  rulesModal.hidden = false;
});
rulesClose.addEventListener("click", () => {
  rulesModal.hidden = true;
});
rulesModal.addEventListener("click", (e) => {
  if (e.target === rulesModal) rulesModal.hidden = true;
});

window.addEventListener("resize", () => {
  if (playing) measureRects();
});

// 시작 전에도 판이 보이도록 미리 깔아둔다
buildBoard();

/* ---------------- 채팅 (game.html과 같은 messages 컬렉션을 공유한다) ---------------- */

const nickLabelEl = document.getElementById("nick-label");
const nickSetupEl = document.getElementById("nick-setup");
const nickInput = document.getElementById("nick-input");
const nickSaveBtn = document.getElementById("nick-save-btn");
const chatListEl = document.getElementById("chat-list");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send");
const chatStatusEl = document.getElementById("chat-status");

let chatLocked = false;

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
  chatInput.disabled = chatLocked || !hasNick;
  chatSendBtn.disabled = chatLocked || !hasNick;
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
      const mine = myNick && m.name === myNick ? "is-mine" : "";
      const time = formatChatTime(m.createdAt);
      return `<li class="${mine}">
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
    chatStatusEl.textContent = err.message || "전송에 실패했습니다.";
    chatInput.value = text;
  } finally {
    chatSendBtn.disabled = chatLocked || !getNickname();
  }
});

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

renderNickname();
watchMessages(renderMessages);
refreshChatLock();
window.setInterval(refreshChatLock, 15000);
