import { claimPass, applyNickname, savedPass, startGuest, isGuest } from "./pass.js?v=81";

// 입장 화면. 코드가 맞으면 게임 페이지로 넘긴다.
// 화면을 건너뛰고 game.html 을 직접 열 수는 있지만, 그쪽에서도 코드를 확인하고
// 점수·채팅 쓰기는 서버 규칙이 코드 보유자만 받도록 막는다.

const input = document.getElementById("pass-input");
const btn = document.getElementById("pass-btn");
const statusEl = document.getElementById("pass-status");
const guestBtn = document.getElementById("guest-btn");
const foundBox = document.getElementById("pass-found");
const foundNickEl = document.getElementById("found-nick");
const continueBtn = document.getElementById("continue-btn");
const freshBtn = document.getElementById("fresh-btn");

function go() {
  location.replace("game.html?v=81");
}

function sanitize(value) {
  return value.toUpperCase().replace(/[^A-Z0-9가-힣]/g, "").slice(0, 20);
}

async function tryEnter(code, quiet) {
  if (!quiet) {
    statusEl.textContent = "확인하는 중…";
    statusEl.className = "gate__status";
    btn.disabled = true;
  }
  const res = await claimPass(code);
  btn.disabled = false;

  if (res.ok) {
    const alreadyHasNickname = (() => {
      try {
        return Boolean(localStorage.getItem("apple-game-nickname"));
      } catch {
        return false;
      }
    })();

    // 이 코드에 예전 닉네임이 걸려 있고 아직 닉네임이 없으면, 바로 들어가지 않고 고르게 한다.
    if (res.nick && !alreadyHasNickname) {
      statusEl.textContent = "";
      foundNickEl.textContent = res.nick;
      foundBox.hidden = false;
      continueBtn.onclick = async () => {
        continueBtn.disabled = true;
        freshBtn.disabled = true;
        continueBtn.textContent = "불러오는 중…";
        await applyNickname(res.nick, res.code);
        go();
      };
      freshBtn.onclick = () => go();
      return true;
    }

    statusEl.textContent = "확인되었습니다. 들어갑니다…";
    statusEl.className = "gate__status is-ok";
    go();
    return true;
  }
  if (!quiet) {
    statusEl.textContent = res.reason;
    statusEl.className = "gate__status is-bad";
  }
  return false;
}

// 게스트로 시작한 적이 있으면 코드 확인 없이 바로 들어간다
if (isGuest()) {
  go();
}

// 이미 코드를 넣은 적이 있으면 자동으로 들어간다
(async () => {
  if (isGuest()) return;
  const code = savedPass();
  if (!code) return;
  statusEl.textContent = "저장된 코드로 들어가는 중…";
  const ok = await tryEnter(code, true);
  if (!ok) {
    statusEl.textContent = "저장된 코드를 쓸 수 없습니다. 다시 넣어 주세요.";
    statusEl.className = "gate__status is-bad";
    input.value = code;
  }
})();

btn.addEventListener("click", () => tryEnter(input.value, false));
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryEnter(input.value, false);
});
guestBtn?.addEventListener("click", () => {
  startGuest();
  go();
});

// 한글 입력(IME) 조합 중에 값을 덮어쓰면 조합이 끊겨 한 글자도 못 친다.
// 조합이 끝난 뒤에만 정리한다.
let composing = false;
input.addEventListener("compositionstart", () => {
  composing = true;
});
input.addEventListener("compositionend", () => {
  composing = false;
  input.value = sanitize(input.value);
});
input.addEventListener("input", () => {
  if (composing) return;
  input.value = sanitize(input.value);
});
