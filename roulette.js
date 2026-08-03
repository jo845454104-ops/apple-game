import { getFirestoreApi } from "./firebase-app.js?v=50";
import { getClientId } from "./chat.js?v=50";
import { getFingerprint } from "./fingerprint.js?v=50";

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
// angle은 원판에 그려지는 각도(시각용)이고, 당첨은 아래 확률로만 정해진다.
export const PRIZES = [
  { id: "meal", label: "식사권", emoji: "🍱", chance: 0.01, angle: 6, color: "#f59e0b" },
  { id: "coffee", label: "커피", emoji: "☕", chance: 3, angle: 40, color: "#8b5cf6" },
  { id: "date", label: "정식이와 데이트권", emoji: "💕", chance: 5, angle: 50, color: "#ec4899" },
  { id: "flick", label: "정식 딱밤", emoji: "👉", chance: 20, angle: 90, color: "#3b82f6" },
  { id: "none", label: "꽝", emoji: "💨", chance: 71.99, angle: 174, color: "#94a3b8" },
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

export async function recordPrize(name, nickKey, prize, score) {
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

// 내 닉네임으로 이번 회차에 받은 당첨권을 가져온다.
export async function fetchMyPrizes(nickKey) {
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
