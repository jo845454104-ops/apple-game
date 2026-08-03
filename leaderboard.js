import { getFirestoreApi } from "./firebase-app.js?v=57";
import { getClientId } from "./chat.js?v=57";
import { getFingerprint } from "./fingerprint.js?v=57";

const COLLECTION_NAME = "scores";
const LOCAL_KEY = "apple-game-local-leaderboard";
const TOP_N = 10;

// 랭킹은 매주 월요일 한국시간 08:00에 한 번만 초기화된다.
// 기록을 실제로 지우는 대신 "직전 초기화 이후 기록만 보여주는" 방식이라 예약 작업이 필요 없다.
const RESET_HOUR_KST = 8;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 0=일, 1=월 ... 6=토 → 월요일만 초기화
function isResetDay(kstDate) {
  return kstDate.getUTCDay() === 1;
}

function kstResetMoment(kstDate) {
  return (
    Date.UTC(
      kstDate.getUTCFullYear(),
      kstDate.getUTCMonth(),
      kstDate.getUTCDate(),
      RESET_HOUR_KST
    ) - KST_OFFSET_MS
  );
}

export function getResetCutoff(now = Date.now()) {
  // 오늘부터 거슬러 올라가며 이미 지나간 월~목 18시 중 가장 최근을 찾는다
  for (let back = 0; back < 14; back += 1) {
    const kst = new Date(now + KST_OFFSET_MS - back * DAY_MS);
    if (!isResetDay(kst)) continue;
    const moment = kstResetMoment(kst);
    if (moment <= now) return new Date(moment);
  }
  return new Date(now - 14 * DAY_MS);
}

export function getNextReset(now = Date.now()) {
  for (let ahead = 0; ahead < 14; ahead += 1) {
    const kst = new Date(now + KST_OFFSET_MS + ahead * DAY_MS);
    if (!isResetDay(kst)) continue;
    const moment = kstResetMoment(kst);
    if (moment > now) return new Date(moment);
  }
  return new Date(now + 14 * DAY_MS);
}

function readLocalScores() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalScores(list) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}

function submitLocalScore(name, score) {
  const list = readLocalScores();
  list.push({ name, score, createdAt: Date.now() });
  list.sort((a, b) => b.score - a.score);
  writeLocalScores(list.slice(0, 50));
}

function fetchLocalTopScores() {
  const cutoff = getResetCutoff().getTime();
  return readLocalScores()
    .filter((s) => (s.createdAt ?? 0) >= cutoff)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
}

// 100점을 넘는 기록은 수순(리플레이)까지 검사해서 통과해야 랭킹에 오른다.
// 게임 자체는 막지 않는다. 검증에 걸리면 기록만 등록되지 않는다.
export const VERIFY_MIN_SCORE = 100;

function boardFromSeed(seed, total) {
  let a = seed >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const values = [];
  for (let i = 0; i < total; i++) values.push(Math.floor(rand() * 9) + 1);
  return values;
}

// 수순이 게임 규칙에 맞는지 확인한다.
// 지운 칸들의 합이 10이어야 하고, 같은 칸을 두 번 지울 수 없으며,
// 매칭 간격이 사람이 낼 수 있는 속도여야 한다.
export function verifyReplay({ score, clears, durationMs, seed, moves }) {
  if (!Array.isArray(moves) || moves.length === 0) {
    return "리플레이 기록이 없어 검증할 수 없습니다";
  }
  if (moves.length !== clears) return "수순 개수가 매칭 횟수와 다릅니다";

  const values = boardFromSeed(Number(seed) || 0, 170);
  const used = new Set();
  let total = 0;
  let prevT = 0;

  for (const move of moves) {
    if (!Array.isArray(move) || move.length !== 2) return "수순 형식 오류";
    const [t, idx] = move;
    if (!Number.isFinite(t) || t < 0 || t > durationMs + 2000) {
      return "수순 시각이 플레이 시간을 벗어납니다";
    }
    if (t - prevT < 200) return "사람이 낼 수 없는 속도의 연속 매칭";
    prevT = t;

    if (!Array.isArray(idx) || idx.length < 2 || idx.length > 10) {
      return "한 번에 지운 사과 수가 비정상입니다";
    }
    let sum = 0;
    for (const i of idx) {
      if (!Number.isInteger(i) || i < 0 || i >= 170) return "칸 번호 오류";
      if (used.has(i)) return "이미 지운 칸을 다시 지웠습니다";
      used.add(i);
      sum += values[i];
    }
    if (sum !== 10) return "합이 10이 아닌 매칭이 있습니다";
    total += idx.length;
  }

  if (total !== score) return "수순으로 지운 사과 수가 점수와 다릅니다";
  return null;
}

// 서버 규칙이 검증하는 값과 같은 조건을 클라이언트에서도 확인해,
// 조작된 기록은 등록 단계에서 걸러진다.
export function checkPlausible({ score, clears, durationMs }) {
  if (!Number.isInteger(score) || score < 0 || score > 170) return "점수 범위 오류";
  if (!Number.isInteger(clears) || clears < 0) return "매칭 횟수 오류";
  if (score > 0 && (clears * 2 > score || clears * 3 < score)) return "매칭 기록 불일치";
  if (!Number.isFinite(durationMs) || durationMs > 125000) return "플레이 시간 오류";
  if (durationMs < score * 700) return "플레이 시간이 점수에 비해 너무 짧습니다";
  return null;
}

export async function submitScore(name, score, meta = {}) {
  const clears = Number(meta.clears ?? 0);
  const durationMs = Number(meta.durationMs ?? 0);

  const problem = checkPlausible({ score, clears, durationMs });
  if (problem) throw new Error(problem);

  // 100점을 넘으면 수순까지 맞아야 랭킹에 오른다
  if (score > VERIFY_MIN_SCORE) {
    const replayProblem = verifyReplay({
      score, clears, durationMs,
      seed: meta.seed, moves: meta.moves,
    });
    if (replayProblem) throw new Error(`리플레이 검증 실패: ${replayProblem}`);
  }

  const ctx = await getFirestoreApi();
  if (ctx) {
    const { db, api } = ctx;
    await api.addDoc(api.collection(db, COLLECTION_NAME), {
      name: name.slice(0, 12),
      score,
      clears,
      durationMs,
      cid: getClientId(),
      fp: await getFingerprint().catch(() => ""),
      // 리플레이 검증용. 보드 시드와 수순을 함께 남겨
      // 상위 기록이 진짜인지 재생해 확인할 수 있게 한다.
      seed: Number(meta.seed ?? 0),
      moves: JSON.stringify(meta.moves ?? []).slice(0, 20000),
      createdAt: api.serverTimestamp(),
    });
    return { online: true };
  }
  submitLocalScore(name.slice(0, 12), score);
  return { online: false };
}

// 운영자용: 문서 ID까지 포함해 가져온다 (삭제 명령 생성에 필요)
export async function fetchScoresForAdmin(limit = 50) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api.getDocs(
    api.query(
      api.collection(db, COLLECTION_NAME),
      api.where("createdAt", ">=", api.Timestamp.fromDate(getResetCutoff())),
      api.orderBy("createdAt", "desc"),
      api.limit(limit)
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.score - a.score);
}

// 내 기록 모아보기. 이름으로 찾되 오늘 회차만 본다.
export async function fetchMyScores(name, limit = 200) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api.getDocs(
    api.query(
      api.collection(db, COLLECTION_NAME),
      api.where("createdAt", ">=", api.Timestamp.fromDate(getResetCutoff())),
      api.orderBy("createdAt", "desc"),
      api.limit(limit)
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.name === name);
}

export async function fetchTopScores() {
  const ctx = await getFirestoreApi();
  if (ctx) {
    const { db, api } = ctx;
    // createdAt 한 필드에만 조건과 정렬을 걸어 복합 색인 없이 조회한다.
    // 점수 정렬은 받아온 뒤 클라이언트에서 처리한다.
    const q = api.query(
      api.collection(db, COLLECTION_NAME),
      api.where("createdAt", ">=", api.Timestamp.fromDate(getResetCutoff())),
      api.orderBy("createdAt", "desc"),
      api.limit(500)
    );
    const snap = await api.getDocs(q);
    const scores = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
    return { online: true, scores };
  }
  return { online: false, scores: fetchLocalTopScores() };
}
