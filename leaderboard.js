import { getFirestoreApi } from "./firebase-app.js?v=32";
import { getClientId } from "./chat.js?v=32";
import { getFingerprint } from "./fingerprint.js?v=32";

const COLLECTION_NAME = "scores";
const LOCAL_KEY = "apple-game-local-leaderboard";
const TOP_N = 10;

// 랭킹은 매일 한국시간 18:00에 초기화된다. 룰렛 회차와 같은 기준이다. 기록을 지우는 대신
// 직전 17:30 이후에 등록된 기록만 보여주는 방식이라 예약 작업이 필요 없다.
const RESET_HOUR_KST = 18;
const RESET_MINUTE_KST = 0;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getResetCutoff() {
  const now = Date.now();
  const kstNow = new Date(now + KST_OFFSET_MS);
  const todayResetKst = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    RESET_HOUR_KST,
    RESET_MINUTE_KST
  );

  let cutoff = todayResetKst - KST_OFFSET_MS;
  if (cutoff > now) cutoff -= DAY_MS;
  return new Date(cutoff);
}

export function getNextReset() {
  return new Date(getResetCutoff().getTime() + DAY_MS);
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
      .map((d) => d.data())
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
    return { online: true, scores };
  }
  return { online: false, scores: fetchLocalTopScores() };
}
