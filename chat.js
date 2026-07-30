import { getFirestoreApi } from "./firebase-app.js?v=20";
import { isClean, findProfanity, findTargeted, nicknameKey } from "./profanity.js?v=20";
import { getFingerprint, getHardwareFingerprint } from "./fingerprint.js?v=20";

const MESSAGES = "messages";
const MESSAGE_LIMIT = 100;
const MESSAGE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 30000;
const NICK_KEY = "apple-game-nickname";

// 접속자 수는 모두가 주기적으로 신호를 보내야 해서 실시간 리스너를 쓰면
// 읽기 횟수가 접속자 수의 제곱으로 늘어난다. 하나의 문서에 모아두고
// 주기적으로 한 번씩만 읽는다.
const PRESENCE_PATH = ["meta", "presence"];
const CLIENT_ID_KEY = "apple-game-client-id";
const HEARTBEAT_MS = 30000;
const POLL_MS = 15000;
const ONLINE_WINDOW_MS = 75000;
const STALE_MS = 5 * 60 * 1000;

// 새로고침할 때마다 새 ID를 만들면 같은 사람이 여러 명으로 집계된다.
// 브라우저에 저장해두고 계속 같은 ID를 쓴다.
// 저장 위치를 여러 곳에 두어, 한 곳을 지워도 나머지에서 되살린다.
function readAnyStore() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const v = store.getItem(CLIENT_ID_KEY);
      if (v) return v;
    } catch {
      /* 접근이 막힌 저장소는 건너뛴다 */
    }
  }
  try {
    const m = document.cookie.match(/(?:^|;\s*)agid=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {
    /* 쿠키를 못 읽어도 나머지로 진행한다 */
  }
  return null;
}

function writeAllStores(id) {
  for (const store of [localStorage, sessionStorage]) {
    try {
      store.setItem(CLIENT_ID_KEY, id);
    } catch {
      /* 하나 실패해도 나머지에 남는다 */
    }
  }
  try {
    document.cookie = `agid=${encodeURIComponent(id)};path=/;max-age=31536000;SameSite=Lax`;
  } catch {
    /* 쿠키 저장 실패는 무시한다 */
  }
  // IndexedDB에도 남긴다. 저장소 삭제 시 함께 지워지는 경우가 많지만
  // 일부만 지우는 경우를 대비한 추가 경로다.
  try {
    const req = indexedDB.open("apple-game", 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains("kv")) idb.createObjectStore("kv");
    };
    req.onsuccess = () => {
      try {
        const idb = req.result;
        const tx = idb.transaction("kv", "readwrite");
        tx.objectStore("kv").put(id, CLIENT_ID_KEY);
      } catch {
        /* 저장 실패는 무시한다 */
      }
    };
  } catch {
    /* IndexedDB를 못 써도 나머지로 충분하다 */
  }
}

function loadClientId() {
  const saved = readAnyStore();
  if (saved) {
    writeAllStores(saved);
    return saved;
  }
  const fresh =
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  writeAllStores(fresh);
  return fresh;
}

const clientId = loadClientId();

// IndexedDB에만 남아 있던 값이 있으면 그것으로 되살려 차단을 유지한다
(async () => {
  try {
    const idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open("apple-game", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("kv")) {
          req.result.createObjectStore("kv");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const prior = await new Promise((resolve) => {
      const tx = idb.transaction("kv", "readonly");
      const r = tx.objectStore("kv").get(CLIENT_ID_KEY);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
    if (prior && prior !== clientId) writeAllStores(prior);
  } catch {
    /* 복원 실패는 무시한다 */
  }
})();

// 저장된 닉네임이 사칭·조롱용이면 그 단어를 돌려준다 (차단 판단용)
export function getTargetedViolation() {
  try {
    return findTargeted(localStorage.getItem(NICK_KEY) || "");
  } catch {
    return null;
  }
}

export function getClientId() {
  return clientId;
}

// 조작이 감지된 기기를 서버에 남긴다. 브라우저 저장소를 지워도
// 같은 기기 ID면 다시 차단된다.
export async function reportCheat(reason, name) {
  const ctx = await getFirestoreApi();
  if (!ctx) return;
  const { db, api } = ctx;
  const payload = {
    reason: String(reason).slice(0, 200),
    name: String(name || "").slice(0, 12),
    createdAt: api.serverTimestamp(),
  };
  // 저장소를 지우거나 시크릿 창으로 와도 같은 기기면 지문으로 다시 걸린다
  const ids = [clientId];
  try {
    ids.push(await getFingerprint(), await getHardwareFingerprint());
  } catch {
    /* 지문을 못 만들어도 기기 ID로는 남긴다 */
  }
  await Promise.all(
    ids.map((id) =>
      api.setDoc(api.doc(db, "blocked", id), payload).catch((err) => {
        console.error("차단 기록 실패", err);
      })
    )
  );
}

// 운영자가 접속자 목록에서 특정 기기를 즉시 차단한다.
export async function blockClient(targetId, name, fingerprint, hardware) {
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  const payload = {
    reason: "운영자 차단",
    name: String(name || "").slice(0, 12),
    createdAt: api.serverTimestamp(),
  };
  const ids = [targetId, fingerprint, hardware].filter(Boolean);
  await Promise.all(
    ids.map((id) => api.setDoc(api.doc(db, "blocked", id), payload))
  );
}

export async function fetchBlockedList() {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api.getDocs(
    api.query(api.collection(db, "blocked"), api.limit(100))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function isBlockedOnServer() {
  const ctx = await getFirestoreApi();
  if (!ctx) return null;
  const { db, api } = ctx;
  const ids = [clientId];
  try {
    ids.push(await getFingerprint(), await getHardwareFingerprint());
  } catch {
    /* 지문 실패 시 기기 ID로만 확인한다 */
  }
  for (const id of ids) {
    try {
      const snap = await api.getDoc(api.doc(db, "blocked", id));
      if (snap.exists()) return snap.data().reason || "부정 행위 감지";
    } catch {
      /* 조회 실패는 무시하고 다음 ID를 확인한다 */
    }
  }
  return null;
}

export function getNickname() {
  try {
    const saved = localStorage.getItem(NICK_KEY) || "";
    // 예전에 정해둔 닉네임이라도 금지어가 들어 있으면 무효로 하고 다시 받는다
    if (saved && !isClean(saved)) {
      localStorage.removeItem(NICK_KEY);
      return "";
    }
    return saved;
  } catch {
    return "";
  }
}

export function hasNickname() {
  return getNickname().length > 0;
}

// 닉네임은 이 브라우저에 계속 남고, 한 번 정하면 다시 바꿀 수 없다.
// 닉네임을 서버에 선점 등록한다. 이미 누가 쓰고 있으면 실패한다.
// 문서 ID가 닉네임이고 create만 허용돼 있어 먼저 등록한 사람이 갖는다.
export async function reserveNickname(name) {
  const trimmed = String(name).trim().slice(0, 12);
  const ctx = await getFirestoreApi();
  if (!ctx) return { ok: true, offline: true };

  const { db, api } = ctx;
  // 점·공백을 끼워 넣어 남의 닉네임을 가져가는 것을 막기 위해
  // 기호를 뺀 형태를 예약 키로 쓴다.
  const ref = api.doc(db, "nicknames", nicknameKey(trimmed));

  const existing = await api.getDoc(ref).catch(() => null);
  if (existing?.exists()) {
    if (existing.data().owner === clientId) return { ok: true };
    return { ok: false, reason: "이미 사용 중인 닉네임입니다." };
  }

  try {
    await api.setDoc(ref, {
      owner: clientId,
      createdAt: api.serverTimestamp(),
    });
    return { ok: true };
  } catch {
    // 동시에 같은 이름을 등록하면 나중 요청이 여기로 떨어진다
    return { ok: false, reason: "이미 사용 중인 닉네임입니다." };
  }
}

export function clearNickname() {
  try {
    localStorage.removeItem(NICK_KEY);
  } catch {
    /* 저장소를 못 써도 화면 상태는 갱신된다 */
  }
}

export function checkNickname(name) {
  const trimmed = String(name).trim().slice(0, 12);
  if (!trimmed) return "닉네임을 입력해주세요.";
  const bad = findProfanity(trimmed);
  if (bad) return "사용할 수 없는 표현이 포함되어 있습니다.";
  return null;
}

export function setNickname(name) {
  const trimmed = name.trim().slice(0, 12);
  if (!trimmed || !isClean(trimmed)) return "";
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
    // 문제가 된 발언의 작성 기기를 찾아 차단할 수 있도록 남긴다
    cid: clientId,
    createdAt: api.serverTimestamp(),
  });
}

let lastPruneAt = 0;

// 두 가지 기준으로 대화를 정리한다.
//  1) 올라온 지 2시간이 지난 메시지는 개수와 상관없이 삭제
//  2) 100개를 넘으면 오래된 것부터 삭제해 100개만 남김
// 규칙상 2분이 지나야 삭제할 수 있어, 방금 오간 대화는 누구도 지울 수 없다.
async function pruneOldMessages(db, api) {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  try {
    const coll = api.collection(db, MESSAGES);
    const remove = new Map();

    const expired = await api.getDocs(
      api.query(
        coll,
        api.where(
          "createdAt",
          "<",
          api.Timestamp.fromMillis(now - MESSAGE_MAX_AGE_MS)
        ),
        api.limit(100)
      )
    );
    expired.docs.forEach((d) => remove.set(d.id, d.ref));

    const countSnap = await api.getCountFromServer(coll);
    const total = countSnap.data().count;
    if (total > MESSAGE_LIMIT) {
      const excess = Math.min(total - MESSAGE_LIMIT, 100);
      const oldest = await api.getDocs(
        api.query(coll, api.orderBy("createdAt", "asc"), api.limit(excess))
      );
      oldest.docs.forEach((d) => remove.set(d.id, d.ref));
    }

    if (remove.size === 0) return;
    await Promise.all(
      [...remove.values()].map((ref) => api.deleteDoc(ref).catch(() => {}))
    );
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
      pruneOldMessages(db, api);
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
      // 접속자 목록에 이름을 띄우기 위해 닉네임도 함께 보낸다
      const nick = getNickname();
      let fp = "";
      let hw = "";
      try {
        fp = await getFingerprint();
        hw = await getHardwareFingerprint();
      } catch {
        /* 지문 없이도 접속자 수는 집계된다 */
      }
      await api.setDoc(
        ref,
        { clients: { [clientId]: { t: Date.now(), n: nick, f: fp, h: hw } } },
        { merge: true }
      );
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
      const online = [];

      // 형식에 맞지 않는 항목은 누가 임의로 심은 가짜다
      const looksReal = (id, ts) =>
        /^[a-z0-9]{12,32}$/.test(id) &&
        Number.isFinite(Number(ts)) &&
        Math.abs(now - Number(ts)) < 24 * 60 * 60 * 1000;

      Object.entries(clients).forEach(([id, value]) => {
        // 예전 형식은 값이 숫자 하나였다
        const ts = typeof value === "object" && value !== null ? value.t : value;
        const nick = typeof value === "object" && value !== null ? value.n : "";
        const fp = typeof value === "object" && value !== null ? value.f : "";
        const hw = typeof value === "object" && value !== null ? value.h : "";
        if (!looksReal(id, ts)) {
          stale.push(id);
          return;
        }
        const age = now - Number(ts);
        if (age < ONLINE_WINDOW_MS) {
          online.push({ id, fp: fp || "", hw: hw || "", name: nick || "", isMe: id === clientId });
        } else if (age > STALE_MS) {
          stale.push(id);
        }
      });

      online.sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.name.localeCompare(b.name)));
      onCount(Math.max(online.length, 1), online);

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
