// 닉네임에 쓸 수 없는 표현. 채팅과 랭킹 이름에 공통으로 적용된다.
// 서버 규칙(firestore.rules)에도 같은 목록이 들어가 있으니 한쪽만 고치지 말 것.
const BANNED = [
  "시발", "씨발", "시바", "씨바", "쉬발", "쒸발", "시팔", "씨팔", "십알",
  "병신", "븅신", "빙신", "등신",
  "좆", "좇", "존나", "졸라", "존만",
  "지랄", "니미", "애미", "애비", "니애미", "느금",
  "새끼", "쌔끼", "새기", "개새", "개년", "개놈", "썅", "쌍놈", "쌍년",
  "미친놈", "미친년", "또라이", "돌아이",
  "보지", "자지", "꼬추", "섹스", "야동", "강간", "성기", "젖탱",
  "게이", "레즈", "호모", "트젠",
  "장애인", "찐따", "일베", "틀딱", "급식충", "맘충", "한남", "김치녀",
  "죽어라", "자살", "꺼져",
  "fuck", "shit", "bitch", "asshole", "dick", "pussy", "gay", "fag",
];

// 특정 사람을 사칭하거나 조롱하는 닉네임. 적발 시 닉네임 초기화가 아니라
// 기기 차단까지 이어진다.
const TARGETED = ["정식"];

// 사이에 공백이나 기호를 끼워 넣는 우회를 막기 위해 한글·영문·숫자만 남기고 비교한다.
function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/g, "");
}

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = "\u0000ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";

// "ㅈ ㅓ ㅇ ㅅ ㅣ ㄱ"처럼 자모를 낱개로 흩어 쓰는 우회를 잡기 위해
// 완성된 글자를 자모로 풀어 같은 형태로 맞춘 뒤 비교한다.
function toJamo(text) {
  let out = "";
  for (const ch of String(text).toLowerCase()) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00;
      out += CHO[Math.floor(idx / 588)];
      out += JUNG[Math.floor((idx % 588) / 28)];
      const jong = JONG[idx % 28];
      if (jong !== "\u0000") out += jong;
    } else if (/[ㄱ-ㅎㅏ-ㅣa-z0-9]/.test(ch)) {
      out += ch;
    }
  }
  return out;
}

function matchIn(list, text) {
  const cleaned = normalize(text);
  const jamo = toJamo(text);
  return (
    list.find((word) => cleaned.includes(word) || jamo.includes(toJamo(word))) ?? null
  );
}

export function findProfanity(text) {
  return matchIn(BANNED, text) ?? matchIn(TARGETED, text);
}

export function isClean(text) {
  return findProfanity(text) === null;
}

export function findTargeted(text) {
  return matchIn(TARGETED, text);
}

export const BANNED_WORDS = BANNED;
export const TARGETED_WORDS = TARGETED;
