import { getFirestoreApi } from "./firebase-app.js?v=64";

// 입장 코드
// 운영자가 CLI로 발급한 코드를 가진 사람만 게임에 들어온다.
// 코드 하나는 한 기기만 쓸 수 있고, 이미 쓰는 사람이 있으면 나중 사람이 거부된다.

const PASS_KEY = "apple-game-pass";
const CID_KEY = "apple-game-client-id";

// 이 시간 동안 신호가 없으면 자리를 비운 것으로 보고 다른 기기가 이어받는다.
export const IDLE_MS = 90 * 1000;
export const BEAT_MS = 30 * 1000;

export function savedPass() {
  try {
    return localStorage.getItem(PASS_KEY) || "";
  } catch {
    return "";
  }
}

export function savePass(code) {
  try {
    localStorage.setItem(PASS_KEY, code);
  } catch {
    /* 저장 못 해도 이번 세션은 쓸 수 있다 */
  }
}

export function forgetPass() {
  try {
    localStorage.removeItem(PASS_KEY);
  } catch {
    /* 무시 */
  }
}

// 기기 ID는 chat.js 가 만들지만 입장 화면에서는 chat.js 를 띄우지 않는다.
// 그래서 여기서도 같은 방식으로 찾고, 없으면 같은 규칙으로 만들어 둔다.
// localStorage 만 보면 그것만 지워진 브라우저에서 빈 값이 나와
// 자리를 잡지 못한 채 들어가게 된다.
function myCid() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const v = store.getItem(CID_KEY);
      if (v) return v;
    } catch {
      /* 막힌 저장소는 건너뛴다 */
    }
  }
  try {
    const m = document.cookie.match(/(?:^|;\s*)agid=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {
    /* 쿠키를 못 읽어도 아래에서 새로 만든다 */
  }

  // chat.js 와 같은 형태로 만들어야 서버 규칙의 형식 검사를 통과한다
  const fresh =
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  for (const store of [localStorage, sessionStorage]) {
    try {
      store.setItem(CID_KEY, fresh);
    } catch {
      /* 하나 실패해도 나머지에 남는다 */
    }
  }
  try {
    document.cookie = `agid=${encodeURIComponent(fresh)};path=/;max-age=31536000;SameSite=Lax`;
  } catch {
    /* 쿠키 저장 실패는 무시한다 */
  }
  return fresh;
}

// 코드를 점유한다.
// 이미 다른 기기가 쓰고 있으면 실패한다(나중 사람 거부).
export async function claimPass(code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(clean)) {
    return { ok: false, reason: "코드는 영문·숫자 8자리입니다." };
  }

  const ctx = await getFirestoreApi();
  if (!ctx) return { ok: false, reason: "서버에 연결하지 못했습니다." };
  const { db, api } = ctx;

  const ref = api.doc(db, "passes", clean);
  const snap = await api.getDoc(ref).catch(() => null);
  if (!snap?.exists()) return { ok: false, reason: "없는 코드입니다." };

  const data = snap.data();
  const cid = myCid();
  const seen = data.lastSeen?.toMillis ? data.lastSeen.toMillis() : 0;
  const busy = data.holder && data.holder !== cid && Date.now() - seen < IDLE_MS;
  if (busy) {
    const left = Math.max(1, Math.ceil((IDLE_MS - (Date.now() - seen)) / 1000));
    return {
      ok: false,
      reason:
        `이 코드를 지금 다른 기기에서 쓰고 있습니다.\n` +
        `그 기기에서 창을 닫으면 약 ${left}초 뒤에 풀립니다.`,
    };
  }

  try {
    await api.updateDoc(ref, {
      holder: cid,
      holderNk: getNick(),
      lastSeen: api.serverTimestamp(),
    });
  } catch (err) {
    // 점유 여부는 위에서 이미 걸렀으므로 여기까지 왔다면 다른 이유다.
    // 둘을 같은 문구로 묶으면 원인을 못 찾으니 구분해서 알린다.
    return {
      ok: false,
      reason: "서버가 입장을 거부했습니다. 새로고침 후 다시 시도해 주세요.",
    };
  }

  savePass(clean);
  return { ok: true, label: data.label || "" };
}

function getNick() {
  try {
    return (localStorage.getItem("apple-game-nickname") || "").slice(0, 12);
  } catch {
    return "";
  }
}

// 아직 내 자리가 맞는지 확인하면서 신호를 갱신한다.
// 남이 가져갔으면 false 를 돌려준다.
export async function beat() {
  const code = savedPass();
  if (!code) return false;
  const ctx = await getFirestoreApi();
  if (!ctx) return true; // 서버가 잠깐 안 되는 것으로 쫓아내지는 않는다

  const { db, api } = ctx;
  const ref = api.doc(db, "passes", code);
  const snap = await api.getDoc(ref).catch(() => null);
  if (!snap?.exists()) return false;

  const cid = myCid();
  if (snap.data().holder && snap.data().holder !== cid) return false;

  try {
    await api.updateDoc(ref, {
      holder: cid,
      holderNk: getNick(),
      lastSeen: api.serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

// 자리를 비운다. 페이지를 떠날 때 불러 다음 사람이 바로 쓰게 한다.
export async function releasePass() {
  const code = savedPass();
  if (!code) return;
  const ctx = await getFirestoreApi();
  if (!ctx) return;
  const { db, api } = ctx;
  await api
    .updateDoc(api.doc(db, "passes", code), {
      holder: "",
      holderNk: "",
      lastSeen: api.serverTimestamp(),
    })
    .catch(() => {});
}
