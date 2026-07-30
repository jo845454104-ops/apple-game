import { getFirestoreApi } from "./firebase-app.js";

const MESSAGES = "messages";
const MESSAGE_LIMIT = 100;
const PRUNE_TRIGGER = MESSAGE_LIMIT + 40;
const PRUNE_INTERVAL_MS = 60000;
const NICK_KEY = "apple-game-nickname";

// 접속자 수는 모두가 주기적으로 신호를 보내야 해서 실시간 리스너를 쓰면
// 읽기 횟수가 접속자 수의 제곱으로 늘어난다. 하나의 문서에 모아두고
// 주기적으로 한 번씩만 읽는다.
const PRESENCE_PATH = ["meta", "presence"];
const CLIENT_ID_KEY = "apple-game-client-id";
const HEARTBEAT_MS = 30000;
const POLL_MS = 15000;
const ONLINE_WINDOW_MS = 75000;
const STALE_MS = 15 * 60 * 1000;

// 새로고침할 때마다 새 ID를 만들면 같은 사람이 여러 명으로 집계된다.
// 브라우저에 저장해두고 계속 같은 ID를 쓴다.
function loadClientId() {
  try {
    const saved = localStorage.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
    const fresh =
      Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
}

const clientId = loadClientId();

export function getNickname() {
  try {
    return localStorage.getItem(NICK_KEY) || "";
  } catch {
    return "";
  }
}

export function hasNickname() {
  return getNickname().length > 0;
}

// 닉네임은 이 브라우저에 계속 남고, 한 번 정하면 다시 바꿀 수 없다.
export function setNickname(name) {
  const trimmed = name.trim().slice(0, 12);
  if (!trimmed) return "";
  try {
    if (localStorage.getItem(NICK_KEY)) return localStorage.getItem(NICK_KEY);
    localStorage.setItem(NICK_KEY, trimmed);
  } catch {
    /* 저장이 막혀 있어도 화면 상태로는 진행된다 */
  }
  return trimmed;
}

export async function sendMessage(nickname, text) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("채팅 서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  await api.addDoc(api.collection(db, MESSAGES), {
    name: nickname.trim().slice(0, 12),
    text: text.trim().slice(0, 200),
    createdAt: api.serverTimestamp(),
  });
}

let lastPruneAt = 0;

// 최근 100개만 남기고 오래된 대화를 지운다. 규칙상 10분이 지난 메시지만
// 삭제할 수 있으므로 방금 올라온 대화가 사라질 일은 없다.
async function pruneOldMessages(db, api) {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  try {
    const coll = api.collection(db, MESSAGES);
    const countSnap = await api.getCountFromServer(coll);
    const total = countSnap.data().count;
    if (total < PRUNE_TRIGGER) return;

    const excess = Math.min(total - MESSAGE_LIMIT, 60);
    const oldest = await api.getDocs(
      api.query(coll, api.orderBy("createdAt", "asc"), api.limit(excess))
    );
    await Promise.all(oldest.docs.map((d) => api.deleteDoc(d.ref).catch(() => {})));
  } catch (err) {
    console.error("오래된 대화 정리 실패", err);
  }
}

export async function watchMessages(onMessages) {
  const ctx = await getFirestoreApi();
  if (!ctx) {
    onMessages(null);
    return () => {};
  }
  const { db, api } = ctx;
  const q = api.query(
    api.collection(db, MESSAGES),
    api.orderBy("createdAt", "desc"),
    api.limit(MESSAGE_LIMIT)
  );
  return api.onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data()).reverse();
      onMessages(list);
      if (snap.size >= MESSAGE_LIMIT) pruneOldMessages(db, api);
    },
    (err) => {
      console.error("채팅 구독 실패", err);
      onMessages(null);
    }
  );
}

export async function startPresence(onCount) {
  const ctx = await getFirestoreApi();
  if (!ctx) {
    onCount(null);
    return () => {};
  }
  const { db, api } = ctx;
  const ref = api.doc(db, ...PRESENCE_PATH);

  const beat = async () => {
    try {
      await api.setDoc(ref, { clients: { [clientId]: Date.now() } }, { merge: true });
    } catch (err) {
      console.error("접속 신호 전송 실패", err);
    }
  };

  const poll = async () => {
    try {
      const snap = await api.getDoc(ref);
      const clients = snap.exists() ? snap.data().clients || {} : {};
      const now = Date.now();
      const stale = [];
      let count = 0;

      Object.entries(clients).forEach(([id, ts]) => {
        const age = now - Number(ts);
        if (age < ONLINE_WINDOW_MS) count += 1;
        else if (age > STALE_MS) stale.push(id);
      });

      onCount(Math.max(count, 1));

      if (stale.length) {
        const updates = {};
        stale.forEach((id) => {
          updates[`clients.${id}`] = api.deleteField();
        });
        await api.updateDoc(ref, updates).catch(() => {});
      }
    } catch (err) {
      console.error("접속자 수 조회 실패", err);
    }
  };

  const leave = () => {
    api
      .updateDoc(ref, { [`clients.${clientId}`]: api.deleteField() })
      .catch(() => {});
  };

  await beat();
  await poll();

  const beatId = window.setInterval(beat, HEARTBEAT_MS);
  const pollId = window.setInterval(poll, POLL_MS);
  window.addEventListener("pagehide", leave);

  return () => {
    window.clearInterval(beatId);
    window.clearInterval(pollId);
    window.removeEventListener("pagehide", leave);
    leave();
  };
}
