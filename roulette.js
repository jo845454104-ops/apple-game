import { getFirestoreApi } from "./firebase-app.js?v=31";
import { getClientId } from "./chat.js?v=31";
import { getFingerprint } from "./fingerprint.js?v=31";

export const ROULETTE_MIN_SCORE = 100;

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

export async function recordPrize(name, prize, score) {
  const ctx = await getFirestoreApi();
  if (!ctx) return;
  const { db, api } = ctx;
  let fp = "";
  try {
    fp = await getFingerprint();
  } catch {
    /* 지문 없이도 기록은 남긴다 */
  }
  await api.addDoc(api.collection(db, "rewards"), {
    name: String(name).slice(0, 12),
    prize: String(prize).slice(0, 20),
    score,
    cid: getClientId(),
    fp,
    createdAt: api.serverTimestamp(),
  });
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
