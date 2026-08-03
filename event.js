import { getFirestoreApi } from "./firebase-app.js?v=51";
import { getClientId } from "./chat.js?v=51";
import { getFingerprint } from "./fingerprint.js?v=51";

// 돌발 이벤트
// 서버(예약 작업)를 쓰지 않고도 모든 참가자가 같은 이벤트를 보게 하려면
// 일정이 날짜에서 똑같이 계산되어야 한다. 그래서 날짜를 씨앗으로 삼아
// 정해진 규칙으로 뽑는다. 같은 날이면 누구 화면에서든 결과가 같다.

export const EVENT_PRIZE = "커피";
export const EVENT_DURATION_MIN = 30;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 매시 50분~정각은 쉬는 시간이라 이벤트를 걸치지 않게 한다.
// 30분짜리 이벤트가 쉬는 시간 전에 끝나려면 정각~20분 사이에 시작해야 한다.
const EVENT_HOURS = [14, 15, 16];
const START_MINUTE_MAX = 20;

// 시작 30분 전부터 예고 배너를 띄운다
export const NOTICE_LEAD_MIN = 30;

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

function pad(n) {
  return String(n).padStart(2, "0");
}

// 오늘(한국시간 기준) 열리는 이벤트 목록을 계산한다.
export function todayEvents(now = new Date()) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const d = kst.getUTCDate();
  const dow = kst.getUTCDay(); // 0=일, 6=토

  // 평일에만 연다
  if (dow === 0 || dow === 6) return [];

  const rand = mulberry32(y * 10000 + m * 100 + d);
  const count = rand() < 0.5 ? 1 : 2;
  const dateStr = `${y}${pad(m)}${pad(d)}`;

  // 서로 다른 시간대를 골라 두 이벤트가 겹치지 않게 한다
  const hours = [...EVENT_HOURS];
  for (let i = hours.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [hours[i], hours[j]] = [hours[j], hours[i]];
  }

  const list = [];
  for (let i = 0; i < count; i += 1) {
    const hour = hours[i];
    const minute = Math.floor(rand() * (START_MINUTE_MAX + 1)); // 0~20분
    const target = 107 + Math.floor(rand() * 6); // 107~112
    list.push({ id: `${dateStr}-${i + 1}`, startMin: hour * 60 + minute, target });
  }

  list.sort((a, b) => a.startMin - b.startMin);

  // 한국시간 분 단위를 실제 시각으로 바꾼다
  return list.map((e) => {
    const startUTC = Date.UTC(y, m - 1, d, 0, e.startMin) - KST_OFFSET_MS;
    return {
      ...e,
      startAt: new Date(startUTC),
      endAt: new Date(startUTC + EVENT_DURATION_MIN * 60000),
    };
  });
}

// 지금 진행 중인 이벤트
export function activeEvent(now = new Date()) {
  return todayEvents(now).find((e) => now >= e.startAt && now < e.endAt) ?? null;
}

// 다음에 열릴 이벤트
export function nextEvent(now = new Date()) {
  return todayEvents(now).find((e) => now < e.startAt) ?? null;
}

// 곧 시작하는 이벤트 (기본 30분 전부터)
export function upcomingEvent(now = new Date(), leadMin = NOTICE_LEAD_MIN) {
  const e = nextEvent(now);
  if (!e) return null;
  return e.startAt - now <= leadMin * 60000 ? e : null;
}

export async function claimEvent(name, nickKey, eventId, score) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  let fp = "";
  try {
    fp = await getFingerprint();
  } catch {
    /* 지문 없이도 기록은 남긴다 */
  }

  // 문서 ID를 "닉네임__이벤트"로 고정해 이벤트당 한 번만 받게 한다
  const ref = api.doc(db, "events", `${nickKey}__${eventId}`);
  const exists = await api.getDoc(ref).catch(() => null);
  if (exists?.exists()) {
    return { ok: false, reason: "이미 이번 이벤트 상품을 받았습니다." };
  }
  try {
    await api.setDoc(ref, {
      name: String(name).slice(0, 12),
      nk: nickKey,
      ev: eventId,
      prize: EVENT_PRIZE,
      score,
      cid: getClientId(),
      fp,
      createdAt: api.serverTimestamp(),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "이벤트 시간이 지났거나 조건을 만족하지 않습니다." };
  }
}

export async function fetchMyEventPrizes(nickKey) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const out = [];
  for (const e of todayEvents()) {
    const snap = await api
      .getDoc(api.doc(db, "events", `${nickKey}__${e.id}`))
      .catch(() => null);
    if (snap?.exists()) out.push({ ...snap.data(), target: e.target });
  }
  return out;
}

export async function watchEventWinners(onList, limit = 20) {
  const ctx = await getFirestoreApi();
  if (!ctx) return () => {};
  const { db, api } = ctx;
  const q = api.query(
    api.collection(db, "events"),
    api.orderBy("createdAt", "desc"),
    api.limit(limit)
  );
  return api.onSnapshot(q, (snap) => onList(snap.docs.map((d) => d.data())));
}
