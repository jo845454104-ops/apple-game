import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const COLLECTION_NAME = "scores";
const LOCAL_KEY = "apple-game-local-leaderboard";
const TOP_N = 10;

let firestore = null;
let firestoreApi = null;
let initPromise = null;

async function initFirebase() {
  if (!isFirebaseConfigured()) return null;
  if (firestore) return firestore;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { initializeApp } = await import(
        "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js"
      );
      const api = await import(
        "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js"
      );
      const app = initializeApp(firebaseConfig);
      firestore = api.getFirestore(app);
      firestoreApi = api;
      return firestore;
    } catch (err) {
      console.error("Firebase 초기화 실패, 로컬 랭킹으로 전환합니다.", err);
      firestore = null;
      firestoreApi = null;
      return null;
    }
  })();

  return initPromise;
}

function readLocalScores() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalScores(list) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}

function submitLocalScore(name, score) {
  const list = readLocalScores();
  list.push({ name, score, createdAt: Date.now() });
  list.sort((a, b) => b.score - a.score);
  writeLocalScores(list.slice(0, 50));
}

function fetchLocalTopScores() {
  return readLocalScores()
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
}

export async function submitScore(name, score) {
  const db = await initFirebase();
  if (db && firestoreApi) {
    const { collection, addDoc, serverTimestamp } = firestoreApi;
    await addDoc(collection(db, COLLECTION_NAME), {
      name: name.slice(0, 12),
      score,
      createdAt: serverTimestamp(),
    });
    return { online: true };
  }
  submitLocalScore(name.slice(0, 12), score);
  return { online: false };
}

export async function fetchTopScores() {
  const db = await initFirebase();
  if (db && firestoreApi) {
    const { collection, query, orderBy, limit, getDocs } = firestoreApi;
    const q = query(
      collection(db, COLLECTION_NAME),
      orderBy("score", "desc"),
      limit(TOP_N)
    );
    const snap = await getDocs(q);
    return {
      online: true,
      scores: snap.docs.map((d) => d.data()),
    };
  }
  return { online: false, scores: fetchLocalTopScores() };
}
