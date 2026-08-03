import { claimPass, savedPass } from "./pass.js?v=59";

// 입장 화면. 코드가 맞으면 게임 페이지로 넘긴다.
// 화면을 건너뛰고 game.html 을 직접 열 수는 있지만, 그쪽에서도 코드를 확인하고
// 점수·채팅 쓰기는 서버 규칙이 코드 보유자만 받도록 막는다.

const input = document.getElementById("pass-input");
const btn = document.getElementById("pass-btn");
const statusEl = document.getElementById("pass-status");

function go() {
  location.replace("game.html?v=59");
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

// 이미 코드를 넣은 적이 있으면 자동으로 들어간다
(async () => {
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
input.addEventListener("input", () => {
  input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
