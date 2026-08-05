import { getFirestoreApi } from "./firebase-app.js?v=77";
import { getClientId } from "./chat.js?v=77";
import { fetchMyPrizes } from "./roulette.js?v=77";
import { fetchMyEventPrizes } from "./event.js?v=77";

// 멀티플레이 대결
// 방을 만들면 시드가 정해지고, 두 사람이 같은 배치로 겨룬다.
// 결과는 리플레이 수순과 함께 남겨 나중에 진위를 확인할 수 있다.

const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// 방 비밀번호는 원문을 저장하지 않고 해시만 남긴다.
async function hashPw(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`duel:${text}`)
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function makeRoomCode() {
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}

// 내가 걸 수 있는 당첨권을 모은다.
// 리플레이 검증을 통과한 기록에서 나온 것만 "확인됨"으로 표시한다.
export async function myStakes(nickKey) {
  const [prizes, eventPrizes] = await Promise.all([
    fetchMyPrizes(nickKey),
    fetchMyEventPrizes(nickKey),
  ]);
  const all = [
    ...prizes.map((p) => ({ ...p, from: "룰렛" })),
    ...eventPrizes.map((p) => ({ ...p, from: "돌발 이벤트" })),
  ];
  return all.filter((p) => p.prize && p.prize !== "꽝");
}

export async function createRoom({ code, name, nickKey, seed, stakes, password }) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  const ref = api.doc(db, "duels", code);

  const exists = await api.getDoc(ref).catch(() => null);
  if (exists?.exists()) throw new Error("같은 방 번호가 이미 있습니다. 다시 시도하세요.");

  await api.setDoc(ref, {
    host: name.slice(0, 12),
    hostNk: nickKey,
    hostCid: getClientId(),
    seed,
    stake: (stakes || []).length ? `${stakes.length}장` : "없음",
    hostStakes: stakes || [],
    pw: password ? await hashPw(password) : "",
    state: "waiting",
    createdAt: api.serverTimestamp(),
  });
  return code;
}

// 도전자가 올린 판돈을 갱신한다 (거래창처럼 여러 장)
export async function setGuestStakes(code, stakes) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  await api.updateDoc(api.doc(db, "duels", code), { guestStakes: stakes });
}

export async function joinRoom({ code, name, nickKey, password }) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  const ref = api.doc(db, "duels", code);
  const snap = await api.getDoc(ref).catch(() => null);

  if (!snap?.exists()) throw new Error("그런 방이 없습니다.");
  const data = snap.data();
  if (data.hostCid === getClientId()) throw new Error("자기 방에는 참가할 수 없습니다.");
  if (data.guestCid && data.guestCid !== getClientId()) {
    throw new Error("이미 다른 사람이 참가한 방입니다.");
  }
  if (data.pw) {
    if (!password) throw new Error("비밀번호가 필요한 방입니다.");
    if ((await hashPw(password)) !== data.pw) {
      throw new Error("비밀번호가 올바르지 않습니다.");
    }
  }

  await api.updateDoc(ref, {
    guest: name.slice(0, 12),
    guestNk: nickKey,
    guestCid: getClientId(),
    guestStakes: [],
    state: "playing",
    startedAt: api.serverTimestamp(),
  });
  return { ...data, code };
}

export async function submitResult({ code, isHost, score, moves }) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  const payload = isHost
    ? { hostScore: score, hostMoves: JSON.stringify(moves ?? []).slice(0, 20000) }
    : { guestScore: score, guestMoves: JSON.stringify(moves ?? []).slice(0, 20000) };
  await api.updateDoc(api.doc(db, "duels", code), payload);
}

// 대결 중에 나가면 기권 처리되어 상대가 이긴다
export async function forfeit(code, whoNk) {
  const ctx = await getFirestoreApi();
  if (!ctx) return;
  const { db, api } = ctx;
  await api
    .updateDoc(api.doc(db, "duels", code), { forfeit: whoNk, state: "done" })
    .catch(() => {});
}

export async function watchRoom(code, onChange) {
  const ctx = await getFirestoreApi();
  if (!ctx) return () => {};
  const { db, api } = ctx;
  return api.onSnapshot(api.doc(db, "duels", code), (snap) => {
    onChange(snap.exists() ? { code, ...snap.data() } : null);
  });
}

// 최근에 만들어져 아직 상대를 기다리는 방들
export async function openRooms(limit = 15) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api.getDocs(
    api.query(
      api.collection(db, "duels"),
      api.orderBy("createdAt", "desc"),
      api.limit(50)
    )
  );
  return snap.docs
    .map((d) => ({ code: d.id, ...d.data() }))
    .filter((r) => r.state === "waiting" && r.hostCid !== getClientId())
    .slice(0, limit);
}

// 끝난 대결의 기록.
// 방 문서에 점수와 수순이 그대로 남으므로 따로 저장할 것이 없다.
// 누가 무엇을 걸고 어떻게 됐는지, 리플레이까지 여기서 다 나온다.
export async function recentDuels(limit = 20) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api.getDocs(
    api.query(
      api.collection(db, "duels"),
      api.orderBy("createdAt", "desc"),
      api.limit(60)
    )
  );
  return snap.docs
    .map((d) => ({ code: d.id, ...d.data() }))
    .filter((r) => r.guest && duelWinner(r))
    .slice(0, limit);
}

export function duelWinner(room) {
  // 한쪽이 나가면 남은 쪽이 바로 이긴다
  if (room.forfeit) {
    if (room.forfeit === room.hostNk) return "guest";
    if (room.forfeit === room.guestNk) return "host";
  }
  const h = room.hostScore;
  const g = room.guestScore;
  if (typeof h !== "number" || typeof g !== "number") return null;
  if (h === g) return "draw";
  return h > g ? "host" : "guest";
}

export function isForfeitWin(room) {
  return Boolean(room?.forfeit);
}
