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

// 사이에 공백이나 기호를 끼워 넣는 우회를 막기 위해 한글·영문·숫자만 남기고 비교한다.
function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/g, "");
}

export function findProfanity(text) {
  const cleaned = normalize(text);
  return BANNED.find((word) => cleaned.includes(word)) ?? null;
}

export function isClean(text) {
  return findProfanity(text) === null;
}

export const BANNED_WORDS = BANNED;
