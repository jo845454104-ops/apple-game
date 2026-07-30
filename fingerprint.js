// 기기·브라우저 특성을 모아 지문을 만든다. 저장소를 지우거나 시크릿 창을 써도
// 같은 기기·같은 브라우저면 같은 값이 나오므로 우회가 훨씬 어려워진다.
// 다른 브라우저나 다른 기기로 오면 값이 달라진다는 한계는 그대로 남는다.

function canvasSignature() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "16px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 120, 30);
    ctx.fillStyle = "#069";
    ctx.fillText("사과게임 fingerprint 🍎", 2, 12);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("사과게임 fingerprint 🍎", 4, 20);
    return canvas.toDataURL();
  } catch {
    return "canvas-error";
  }
}

function webglSignature() {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return "no-webgl";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : "";
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "";
    return `${vendor}|${renderer}|${gl.getParameter(gl.VERSION)}`;
  } catch {
    return "webgl-error";
  }
}

function fontSignature() {
  try {
    const candidates = [
      "Arial", "Batang", "Gulim", "Dotum", "Malgun Gothic",
      "AppleGothic", "Apple SD Gothic Neo", "Times New Roman",
      "Courier New", "Georgia", "Tahoma", "Verdana",
    ];
    const span = document.createElement("span");
    span.style.cssText =
      "position:absolute;left:-9999px;font-size:72px;white-space:nowrap;";
    span.textContent = "가나다ABCabc123";
    document.body.appendChild(span);

    const baseline = {};
    ["monospace", "sans-serif", "serif"].forEach((base) => {
      span.style.fontFamily = base;
      baseline[base] = `${span.offsetWidth}x${span.offsetHeight}`;
    });

    const present = candidates.filter((font) =>
      ["monospace", "sans-serif", "serif"].some((base) => {
        span.style.fontFamily = `'${font}',${base}`;
        return `${span.offsetWidth}x${span.offsetHeight}` !== baseline[base];
      })
    );

    document.body.removeChild(span);
    return present.join(",");
  } catch {
    return "font-error";
  }
}

async function sha256(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let cachedHw = null;

// 브라우저를 바꿔도 유지되는 값만 모은 하드웨어 지문.
// GPU 모델·화면 규격·CPU 코어 수는 같은 PC라면 크롬이든 엣지든 동일하다.
// 다만 같은 기종을 여러 대 쓰는 환경(학원 실습실 등)에서는 서로 겹칠 수 있다.
export async function getHardwareFingerprint() {
  if (cachedHw) return cachedHw;
  const parts = [
    webglSignature(),
    screen.width + "x" + screen.height + "x" + screen.colorDepth,
    screen.availWidth + "x" + screen.availHeight,
    navigator.hardwareConcurrency ?? "",
    navigator.deviceMemory ?? "",
    navigator.platform ?? "",
    navigator.maxTouchPoints ?? "",
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  cachedHw = "hw" + (await sha256(parts.join("|"))).slice(0, 22);
  return cachedHw;
}

let cached = null;

export async function getFingerprint() {
  if (cached) return cached;

  const parts = [
    navigator.userAgent,
    navigator.language,
    (navigator.languages || []).join(","),
    navigator.hardwareConcurrency ?? "",
    navigator.maxTouchPoints ?? "",
    navigator.deviceMemory ?? "",
    navigator.platform ?? "",
    screen.width + "x" + screen.height + "x" + screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    new Date().getTimezoneOffset(),
    canvasSignature(),
    webglSignature(),
    fontSignature(),
  ];

  // 앞 24자리만 써도 충돌 가능성은 사실상 없고 문서 ID로 다루기 편하다
  cached = (await sha256(parts.join("|"))).slice(0, 24);
  return cached;
}
