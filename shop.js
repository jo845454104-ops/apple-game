import { getFirestoreApi } from "./firebase-app.js?v=78";
import { getClientId } from "./chat.js?v=78";

// 개인이 자기 이름으로 발급하는 증정권
// 일련번호가 곧 문서 ID다. "닉네임__종류__회차" 형태로 고정해서
// 같은 회차에 같은 종류를 두 번 만들 수 없다. 이것으로 발급 주기가 강제된다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const TICKET_KINDS = {
  COFFEE: { label: "커피권", emoji: "☕", everyDays: 1, note: "1일에 1장" },
  DATE: { label: "데이트권", emoji: "💕", everyDays: 3, note: "3일에 1장" },
  MEAL: { label: "식사권", emoji: "🍱", everyDays: 7, note: "7일에 1장" },
};

// 발급 회차. 주기가 0이면 항상 같은 값이라 평생 한 장만 만들 수 있다.
export function periodOf(kind, now = Date.now()) {
  const days = TICKET_KINDS[kind]?.everyDays ?? 0;
  if (days === 0) return "once";
  const kstDays = Math.floor((now + KST_OFFSET_MS) / DAY_MS);
  return `P${Math.floor(kstDays / days)}`;
}

export function serialOf(nickKey, kind, now = Date.now()) {
  return `${nickKey}__${kind}__${periodOf(kind, now)}`;
}

// 사람이 읽기 좋은 표기: 커피권 (문창호) · A3F9-2K
export function prettySerial(serial) {
  const [nick, kind, period] = String(serial).split("__");
  const label = TICKET_KINDS[kind]?.label ?? kind;
  let hash = 0;
  for (const ch of serial) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const code = hash.toString(36).toUpperCase().padStart(6, "0").slice(-6);
  return {
    title: `${label} (${nick})`,
    code: `${code.slice(0, 4)}-${code.slice(4)}`,
    period,
  };
}

export async function issueTicket({ kind, name, nickKey }) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  if (!TICKET_KINDS[kind]) throw new Error("알 수 없는 증정권 종류입니다.");

  const { db, api } = ctx;
  const period = periodOf(kind);
  const serial = serialOf(nickKey, kind);
  const ref = api.doc(db, "tickets", serial);

  const exists = await api.getDoc(ref).catch(() => null);
  if (exists?.exists()) {
    const info = TICKET_KINDS[kind];
    throw new Error(
      info.everyDays === 0
        ? `${info.label}은 1인 1장만 발급할 수 있습니다.`
        : `${info.label}은 ${info.everyDays}일에 1장만 발급할 수 있습니다.`
    );
  }

  await api.setDoc(ref, {
    kind,
    owner: name.slice(0, 12),
    ownerNk: nickKey,
    ownerCid: getClientId(),
    issuedTo: nickKey, // 최초 발급자. 이전돼도 바뀌지 않는다.
    period,
    state: "active",
    createdAt: api.serverTimestamp(),
  });
  return serial;
}

// 내 증정권. 전체를 받아와 걸러내면 사람이 늘수록 한도(300건)에 먼저 걸려
// 자기 것이 안 보이게 된다. 서버에서 내 것만 골라 받는다.
export async function myTickets(nickKey) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api
    .getDocs(
      api.query(
        api.collection(db, "tickets"),
        api.where("ownerNk", "==", nickKey),
        api.limit(200)
      )
    )
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => ({ serial: d.id, ...d.data() }));
}

// 전산 확인: 일련번호로 진위와 상태를 조회한다
export async function verifyTicket(serialOrCode) {
  const ctx = await getFirestoreApi();
  if (!ctx) return { found: false, reason: "서버에 연결되어 있지 않습니다." };
  const { db, api } = ctx;
  const input = String(serialOrCode).trim();

  let snap = await api.getDoc(api.doc(db, "tickets", input)).catch(() => null);

  // 짧은 코드(A3F9-2K)로도 찾을 수 있게 한다
  if (!snap?.exists()) {
    const wanted = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const all = await api.getDocs(
      api.query(api.collection(db, "tickets"), api.limit(300))
    );
    const hit = all.docs.find(
      (d) => prettySerial(d.id).code.replace("-", "") === wanted
    );
    if (!hit) return { found: false, reason: "그런 일련번호가 없습니다." };
    snap = hit;
  }

  const data = snap.data();
  return {
    found: true,
    serial: snap.id,
    ...data,
    ...prettySerial(snap.id),
    valid: data.state === "active",
  };
}

export async function useTicket(serial) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  const ref = api.doc(db, "tickets", serial);
  const snap = await api.getDoc(ref).catch(() => null);
  if (!snap?.exists()) throw new Error("그런 증정권이 없습니다.");
  if (snap.data().state === "used") throw new Error("이미 사용된 증정권입니다.");

  await api.updateDoc(ref, { state: "used", usedAt: api.serverTimestamp() });
  return true;
}

// 대결에서 이긴 사람에게 티켓 소유권을 넘긴다
export async function transferTicket(serial, toName, toNk, toCid, fromNk) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  await api.updateDoc(api.doc(db, "tickets", serial), {
    owner: String(toName).slice(0, 12),
    ownerNk: toNk,
    ownerCid: toCid,
    wonFrom: fromNk,
  });
}
