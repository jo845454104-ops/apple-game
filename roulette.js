import { getFirestoreApi } from "./firebase-app.js?v=84";
import { getClientId } from "./chat.js?v=84";
import { getFingerprint } from "./fingerprint.js?v=84";

export const ROULETTE_MIN_SCORE = 100;
export const DAILY_SPINS = 3;

// 한국시간 18시(UTC 9시)에 하루가 바뀐다. 서버 규칙과 같은 값을 만들어야 한다.
function dayOfYearUTC(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

export function periodKey(now = new Date()) {
  const doy = now.getUTCHours() >= 9 ? dayOfYearUTC(now) : dayOfYearUTC(now) - 1;
  return String(now.getUTCFullYear() * 1000 + doy);
}

// 다음 초기화 시각 (한국시간 오후 6시)
export function nextResetAt(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(9, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// 확률 합계는 100%. 나머지는 전부 꽝이다.
// angle은 원판에 그려지는 각도(시각용, 합 360)이고, 당첨은 아래 확률로만 정해진다.
export const PRIZES = [
  { id: "meal", label: "식사권", emoji: "🍱", chance: 0.01, angle: 6, color: "#f59e0b" },
  { id: "coffee", label: "커피", emoji: "☕", chance: 2, angle: 30, color: "#8b5cf6" },
  { id: "date", label: "정식이와 데이트권", emoji: "💕", chance: 1, angle: 20, color: "#ec4899" },
  { id: "flick", label: "정식 딱밤", emoji: "👉", chance: 3, angle: 30, color: "#3b82f6" },
  { id: "hit", label: "창호 때리기", emoji: "🥊", chance: 20, angle: 74, color: "#10b981" },
  { id: "none", label: "꽝", emoji: "💨", chance: 73.99, angle: 200, color: "#94a3b8" },
];

// 원판에서 각 구간이 차지하는 시작 각도를 미리 계산해둔다.
export function segments() {
  let start = 0;
  return PRIZES.map((p) => {
    const seg = { ...p, start, end: start + p.angle };
    start += p.angle;
    return seg;
  });
}

export function drawPrize() {
  const roll = Math.random() * 100;
  let acc = 0;
  for (const p of PRIZES) {
    acc += p.chance;
    if (roll < acc) return p;
  }
  return PRIZES[PRIZES.length - 1];
}

// 이번 회차에 이 닉네임이 몇 번 돌렸는지 센다.
export async function usedSpins(nickKey) {
  const ctx = await getFirestoreApi();
  if (!ctx) return 0;
  const { db, api } = ctx;
  const period = periodKey();
  let used = 0;
  for (let n = 1; n <= DAILY_SPINS; n += 1) {
    const snap = await api
      .getDoc(api.doc(db, "rewards", `${nickKey}__${period}__${n}`))
      .catch(() => null);
    if (snap?.exists()) used += 1;
  }
  return used;
}

export async function remainingSpins(nickKey) {
  return Math.max(0, DAILY_SPINS - (await usedSpins(nickKey)));
}

export async function recordPrize(name, nickKey, prize, score, scoreId) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  let fp = "";
  try {
    fp = await getFingerprint();
  } catch {
    /* 지문 없이도 기록은 남긴다 */
  }

  const period = periodKey();
  // 1→3 순서로 비어 있는 자리에 기록한다. 이미 있으면 규칙이 거부하므로
  // 하루 3회를 넘길 수 없다.
  for (let n = 1; n <= DAILY_SPINS; n += 1) {
    const id = `${nickKey}__${period}__${n}`;
    const ref = api.doc(db, "rewards", id);
    const exists = await api.getDoc(ref).catch(() => null);
    if (exists?.exists()) continue;
    try {
      await api.setDoc(ref, {
        name: String(name).slice(0, 12),
        nk: nickKey,
        n,
        prize: String(prize).slice(0, 20),
        score,
        // 이 룰렛의 근거가 된 점수 문서. 서버 규칙이 이 문서를 실제로 열어보고
        // 이름·기기·점수가 맞는지 확인하므로, 점수를 등록하지 않고는 돌릴 수 없다.
        sid: String(scoreId || ""),
        cid: getClientId(),
        fp,
        createdAt: api.serverTimestamp(),
      });
      return { ok: true, used: n, left: DAILY_SPINS - n };
    } catch {
      // 동시에 같은 자리를 쓰면 다음 번호로 넘어간다
    }
  }
  return { ok: false, reason: "오늘 룰렛 기회를 모두 사용했습니다." };
}

// 내가 받은 당첨권 전부. 회차와 상관없이 모은다.
// 예전에는 이번 회차만 봤는데, 룰렛 회차가 매일 18시에 바뀌는 탓에
// 어제 받은 당첨권이 화면에서 사라진 것처럼 보였다. 기록은 그대로 있었다.
export async function fetchMyPrizes(nickKey) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api
    .getDocs(
      api.query(
        api.collection(db, "rewards"),
        api.where("nk", "==", nickKey),
        api.limit(200)
      )
    )
    .catch(() => null);
  if (!snap) return [];
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

// 오늘 회차에 받은 것만 (남은 횟수 표시용)
export async function fetchTodayPrizes(nickKey) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const period = periodKey();
  const out = [];
  for (let n = 1; n <= DAILY_SPINS; n += 1) {
    const snap = await api
      .getDoc(api.doc(db, "rewards", `${nickKey}__${period}__${n}`))
      .catch(() => null);
    if (snap?.exists()) out.push({ n, ...snap.data() });
  }
  return out;
}

export async function fetchRecentPrizes(limit = 20) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api.getDocs(
    api.query(
      api.collection(db, "rewards"),
      api.orderBy("createdAt", "desc"),
      api.limit(limit)
    )
  );
  return snap.docs.map((d) => d.data());
}

export async function watchPrizes(onList, limit = 20) {
  const ctx = await getFirestoreApi();
  if (!ctx) return () => {};
  const { db, api } = ctx;
  const q = api.query(
    api.collection(db, "rewards"),
    api.orderBy("createdAt", "desc"),
    api.limit(limit)
  );
  return api.onSnapshot(q, (snap) => onList(snap.docs.map((d) => d.data())));
}
