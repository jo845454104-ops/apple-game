import { savedPass, beat, releasePass, forgetPass, isGuest, BEAT_MS } from "./pass.js?v=68";

// 게임 페이지 문지기.
// 코드가 없거나 남이 그 코드를 가져갔으면 입장 화면으로 돌려보낸다.
// 게스트(코드 없이 시작)는 애초에 자리를 차지하지 않으니 이 검사를 건너뛴다.
// 화면을 가리는 것만으로는 개발자도구를 못 막으므로, 실제 방어는
// 서버 규칙(점수·채팅 쓰기에 코드 확인)이 담당한다. 여기는 안내에 가깝다.

function toGate(message) {
  try {
    if (message) sessionStorage.setItem("apple-game-gate-msg", message);
  } catch {
    /* 무시 */
  }
  location.replace("index.html?v=68");
}

if (!isGuest() && !savedPass()) {
  toGate("입장 코드가 필요합니다.");
}

(async () => {
  if (isGuest() || !savedPass()) return;
  const ok = await beat();
  if (!ok) {
    forgetPass();
    toGate("다른 기기에서 이 코드를 쓰고 있습니다.");
  }
})();

// 자리를 지키고 있다고 계속 알린다. 끊기면 90초 뒤 다른 기기가 이어받는다.
window.setInterval(async () => {
  if (isGuest() || !savedPass()) return;
  const ok = await beat();
  if (!ok) {
    forgetPass();
    toGate("다른 기기에서 이 코드를 쓰기 시작했습니다.");
  }
}, BEAT_MS);

// 페이지를 떠나면 자리를 비워 다음 사람이 바로 쓸 수 있게 한다
window.addEventListener("pagehide", () => {
  if (!isGuest()) releasePass();
});
