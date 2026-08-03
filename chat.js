import { getFirestoreApi } from "./firebase-app.js?v=58";
import { isClean, findProfanity, findTargeted, nicknameKey } from "./profanity.js?v=58";
import { getFingerprint, getHardwareFingerprint } from "./fingerprint.js?v=58";

const MESSAGES = "messages";
const MESSAGE_LIMIT = 100;
const PRUNE_INTERVAL_MS = 30000;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    // 하드웨어 지문은 같은 기종 PC끼리 겹쳐 무고한 사람까지 막으므로 쓰지 않는다
    ids.push(await getFingerprint());
  } catch {
    /* 지문을 못 만들어도 기기 ID로는 남긴다 */
  }
  // 차단 등록은 운영자만 할 수 있다(웹 쓰기는 규칙에서 막혀 있다).
  // 여기서는 실패해도 조용히 넘어가고, 화면 잠금은 로컬에서 처리한다.
  await Promise.all(
    ids.map((id) => api.setDoc(api.doc(db, "blocked", id), payload).catch(() => {}))
  );
}

// 운영자가 접속자 목록에서 특정 기기를 즉시 차단한다.
// 차단은 운영자 도구로만 가능하다. 웹에서 바로 차단할 수 있게 두면
// 접속자 목록에 공개된 기기 ID로 누구나 남을 차단할 수 있기 때문이다.
// 여기서는 차단 대상 ID만 알려주고, 실제 등록은 Firebase 콘솔에서 한다.
export function blockTargets(targetId, fingerprint) {
  return [targetId, fingerprint].filter(Boolean);
}

// 내 당첨권 조회용
export function myClientId() {
  return clientId;
}

// 운영자용: 최근 채팅을 가져온다 (삭제 대상 선택용)
// 운영자 긴급 스위치 상태. config/settings.chatLocked 로 채팅을 잠근다.
export async function fetchChatLocked() {
  const ctx = await getFirestoreApi();
  if (!ctx) return false;
  const { db, api } = ctx;
  try {
    const snap = await api.getDoc(api.doc(db, "config", "settings"));
    return snap.exists() ? snap.data().chatLocked === true : false;
  } catch {
    return false;
  }
}

export async function fetchRecentMessages(limit = 40) {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api.getDocs(
    api.query(api.collection(db, MESSAGES), api.orderBy("createdAt", "desc"), api.limit(limit))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 운영자용: 조건에 맞는 채팅을 지운다. 올라온 지 2분이 안 된 글은 규칙상 남는다.
export async function deleteMessages(ids) {
  const ctx = await getFirestoreApi();
  if (!ctx) return { ok: 0, fail: 0 };
  const { db, api } = ctx;
  let ok = 0;
  let fail = 0;
  await Promise.all(
    ids.map((id) =>
      api.deleteDoc(api.doc(db, MESSAGES, id)).then(() => ok++).catch(() => fail++)
    )
  );
  return { ok, fail };
}

export async function fetchBlockedList() {
  const ctx = await getFirestoreApi();
  if (!ctx) return [];
  const { db, api } = ctx;
  const snap = await api.getDocs(
    api.query(api.collection(db, "blocked"), api.limit(100))
  );
  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    active: blockStillActive(d.data()),
  }));
}

// 차단은 매일 한국시간 09:00에 풀린다.
// 기록을 실제로 지우지 않고 "직전 09시 이후에 걸린 차단만 유효"로 판단해,
// 예약 작업 없이도 매일 자동으로 초기화된다.
const BLOCK_RESET_HOUR_KST = 9;

export function blockResetCutoff(now = Date.now()) {
  const kst = new Date(now + KST_OFFSET_MS);
  const today =
    Date.UTC(
      kst.getUTCFullYear(),
      kst.getUTCMonth(),
      kst.getUTCDate(),
      BLOCK_RESET_HOUR_KST
    ) - KST_OFFSET_MS;
  return today <= now ? today : today - DAY_MS;
}

// 아직 살아 있는 차단인지 확인한다
function blockStillActive(data) {
  if (!data) return false;
  const at = data.createdAt?.seconds ? data.createdAt.seconds * 1000 : 0;
  return at >= blockResetCutoff();
}

export async function isBlockedOnServer() {
  const ctx = await getFirestoreApi();
  if (!ctx) return null;
  const { db, api } = ctx;
  const ids = [clientId];
  try {
    // 하드웨어 지문은 실습실처럼 같은 기종이 많은 환경에서 겹치므로 확인에서 제외한다
    ids.push(await getFingerprint());
  } catch {
    /* 지문 실패 시 기기 ID로만 확인한다 */
  }
  for (const id of ids) {
    try {
      const snap = await api.getDoc(api.doc(db, "blocked", id));
      // 오전 9시 이전에 걸린 차단은 이미 풀린 것으로 본다
      if (snap.exists() && blockStillActive(snap.data())) {
        return snap.data().reason || "부정 행위 감지";
      }
    } catch {
      /* 조회 실패는 무시하고 다음 ID를 확인한다 */
    }
  }
  return null;
}

// 운영자가 지정한 강제 닉네임 변경.
// 해당 기기가 접속하면 저장된 닉네임을 이 값으로 바꾼다.
const FORCED_NICKNAMES = {
  rhnqrg5dms76f2j9: "태진땅",
};

export function getNickname() {
  // 강제 변경 대상이면 무조건 지정된 이름을 쓴다
  const forced = FORCED_NICKNAMES[clientId];
  if (forced) {
    try {
      if (localStorage.getItem(NICK_KEY) !== forced) {
        localStorage.setItem(NICK_KEY, forced);
      }
    } catch {
      /* 저장 실패해도 화면에는 지정된 이름이 쓰인다 */
    }
    return forced;
  }
  return getStoredNickname();
}

function getStoredNickname() {
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

const SEND_COOLDOWN_MS = 1000;
let lastSentAt = 0;
let lastSentText = "";

// 서버 규칙으로 잡기 어려운 도배 패턴을 여기서 먼저 거른다.
export function checkMessage(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return "메시지를 입력하세요.";
  if (Date.now() - lastSentAt < SEND_COOLDOWN_MS) {
    return "너무 빠릅니다. 잠시 후 다시 보내세요.";
  }
  if (trimmed === lastSentText) return "같은 메시지를 연달아 보낼 수 없습니다.";
  if (/^(.)\1{4,}$/.test(trimmed)) return "같은 글자만 반복할 수 없습니다.";
  if (/^[.,!?~\-_/\s]+$/.test(trimmed)) return "의미 있는 내용을 입력하세요.";
  return null;
}

export async function sendMessage(nickname, text) {
  const problem = checkMessage(text);
  if (problem) throw new Error(problem);
  // 기기 ID를 새로 만들어도 지문으로 걸리도록 함께 보낸다
  let fp = "";
  try {
    fp = await getFingerprint();
  } catch {
    /* 지문 생성 실패 시에도 전송은 진행한다 */
  }
  const ctx = await getFirestoreApi();
  if (!ctx) throw new Error("채팅 서버에 연결되어 있지 않습니다.");
  const { db, api } = ctx;
  await api.addDoc(api.collection(db, MESSAGES), {
    name: nickname.trim().slice(0, 12),
    text: text.trim().slice(0, 200),
    // 문제가 된 발언의 작성 기기를 찾아 차단할 수 있도록 남긴다
    cid: clientId,
    // 서버가 닉네임 소유권을 확인할 수 있도록 예약 키를 함께 보낸다
    nk: nicknameKey(nickname),
    fp,
    createdAt: api.serverTimestamp(),
  });
  lastSentAt = Date.now();
  lastSentText = String(text).trim();
}

let lastPruneAt = 0;

// 채팅은 시간이 지났다고 지우지 않는다. 100개를 넘을 때만
// 오래된 것부터 밀어내 항상 최근 100개가 남게 한다.
// (예전에는 2시간이 지나면 지워서 대화가 통째로 사라지는 문제가 있었다)
// 규칙상 2분이 지나야 삭제할 수 있어, 방금 오간 대화는 누구도 지울 수 없다.
async function pruneOldMessages(db, api) {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  try {
    const coll = api.collection(db, MESSAGES);
    const remove = new Map();

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

let blockedCache = new Set();
let blockedCacheAt = 0;

async function refreshBlockedCache(db, api) {
  if (Date.now() - blockedCacheAt < 30000) return blockedCache;
  try {
    const snap = await api.getDocs(api.query(api.collection(db, "blocked"), api.limit(200)));
    blockedCache = new Set(
      snap.docs.filter((d) => blockStillActive(d.data())).map((d) => d.id)
    );
    blockedCacheAt = Date.now();
  } catch {
    /* 조회 실패 시 이전 목록을 그대로 쓴다 */
  }
  return blockedCache;
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
      const blockedSet = await refreshBlockedCache(db, api);
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
        // 차단된 기기는 접속자 목록과 인원수에서 제외한다
        if (blockedSet.has(id) || (fp && blockedSet.has(fp))) {
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
