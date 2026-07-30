import { getFirestoreApi } from "./firebase-app.js";

const MESSAGES = "messages";
const MESSAGE_LIMIT = 60;
const NICK_KEY = "apple-game-nickname";

// 접속자 수는 모두가 주기적으로 신호를 보내야 해서 실시간 리스너를 쓰면
// 읽기 횟수가 접속자 수의 제곱으로 늘어난다. 하나의 문서에 모아두고
// 주기적으로 한 번씩만 읽는다.
const PRESENCE_PATH = ["meta", "presence"];
const HEARTBEAT_MS = 45000;
const POLL_MS = 20000;
const ONLINE_WINDOW_MS = 100000;
const STALE_MS = 15 * 60 * 1000;

const clientId =
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function getNickname() {
  try {
    return sessionStorage.getItem(NICK_KEY) || "";
  } catch {
    return "";
  }
}

export function setNickname(name) {
  const trimmed = name.trim().slice(0, 12);
  try {
    sessionStorage.setItem(NICK_KEY, trimmed);
  } catch {
    /* 저장 실패해도 이번 세션 동안은 화면 상태로만 유지된다 */
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
