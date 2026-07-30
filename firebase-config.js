// Firebase 프로젝트 설정
// 1) https://console.firebase.google.com 에서 새 프로젝트를 만드세요 (무료 Spark 요금제로 충분합니다).
// 2) 프로젝트 설정 > 일반 > "내 앱" 에서 웹 앱을 추가하면 아래와 같은 설정 객체를 받을 수 있습니다.
// 3) 아래 값을 본인 프로젝트 값으로 교체하세요. (플레이스홀더로 두면 온라인 랭킹 대신 로컬 랭킹으로 자동 전환됩니다)
// 4) Firestore Database를 만들고(테스트 모드로 시작), 컬렉션 이름은 leaderboard.js의 COLLECTION_NAME과 맞으면 됩니다 ("scores").

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.startsWith("YOUR_");
}
