import {
  firebaseConfig,
  isFirebaseConfigured,
  recaptchaSiteKey,
  isAppCheckConfigured,
} from "./firebase-config.js?v=39";

const SDK_VERSION = "10.13.2";

let initPromise = null;

// leaderboard.js와 chat.js가 같은 Firebase 앱 인스턴스를 공유한다.
// initializeApp을 두 번 호출하면 예외가 나므로 여기서 한 번만 만든다.
export async function getFirestoreApi() {
  if (!isFirebaseConfigured()) return null;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { initializeApp, getApps, getApp } = await import(
        `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`
      );
      const api = await import(
        `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`
      );
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

      // App Check: 이 요청이 진짜 우리 웹페이지에서 왔는지 증명한다.
      // 파이썬 스크립트 등 브라우저 밖에서 오는 요청은 토큰을 만들 수 없어 거부된다.
      if (isAppCheckConfigured()) {
        try {
          const { initializeAppCheck, ReCaptchaV3Provider } = await import(
            `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-check.js`
          );
          initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true,
          });
        } catch (err) {
          console.error("App Check 초기화 실패", err);
        }
      }
      return { db: api.getFirestore(app), api };
    } catch (err) {
      console.error("Firebase 초기화 실패, 오프라인 모드로 전환합니다.", err);
      return null;
    }
  })();

  return initPromise;
}
