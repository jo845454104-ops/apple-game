# 🍎 사과게임 (DSA 아카데미 대회용)

일본 게임사이엔(ゲーム菜園)의 "사과게임"을 그대로 재현한 웹 게임입니다.
17×10(170개) 사과 중 드래그로 합이 10이 되는 사과들을 골라 터뜨리고, 2분 동안 최대한 높은 점수를 얻는 것이 목표입니다.

## 실행 방법

별도 빌드 없이 정적 파일만으로 동작합니다.

```bash
cd apple-game
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속. (또는 VSCode Live Server 등 아무 정적 서버 사용 가능)

## 게임 방법

- 마우스/터치로 드래그하면 선택 박스가 나타납니다.
- 박스 안에 걸친 사과들의 합이 10이 되면 박스와 사과가 빨갛게 변합니다.
- 그 상태로 드래그를 놓으면 사과가 사라지고 개당 1점을 얻습니다.
- 제한 시간 2분 안에 최대한 많은 점수를 모으세요. (전부 클리어하면 걸린 시간이 표시됩니다)
- 우측 하단 `연한 색` 체크박스로 사과 채도를 낮출 수 있고, `BGM` 체크박스로 배경음을 켤 수 있습니다.

## 온라인 랭킹(리더보드)

Firebase Firestore 기반의 **온라인 공유 랭킹**이 이미 연결되어 있습니다.
게임이 끝나면 닉네임을 입력해 등록할 수 있고, 상단 `🏆 랭킹` 버튼으로 모든 참가자의 상위 10위를 볼 수 있습니다.

- 프로젝트: `jo8454-ea749` (리전: asia-northeast3 / 서울)
- 컬렉션: `scores` (필드: `name`, `score`, `createdAt`)
- 보안 규칙: [firestore.rules](firestore.rules) — 누구나 읽기/등록 가능하되, 닉네임 1~12자·점수 0~170 범위를 검증하고 **수정과 삭제는 차단**합니다.

규칙을 수정했다면 아래 명령으로 다시 배포하세요.

```bash
npx firebase-tools deploy --only firestore:rules --project jo8454-ea749
```

`firebase-config.js`의 값을 플레이스홀더(`YOUR_...`)로 되돌리면 서버 없이 로컬(localStorage) 랭킹으로 자동 전환됩니다.

> 참고: 웹 클라이언트의 `apiKey`는 비밀값이 아니라 프로젝트 식별자라 공개 저장소에 포함되어도 무방합니다. 실제 접근 통제는 위 보안 규칙이 담당합니다.

## GitHub로 공유하기

```bash
git add -A
git commit -m "사과게임 초기 구현"
git branch -M main
git remote add origin <본인 GitHub 저장소 URL>
git push -u origin main
```

이후 GitHub Pages(Settings > Pages > Deploy from branch `main`)를 켜면 `https://<아이디>.github.io/<저장소명>/`으로 바로 플레이할 수 있습니다.

## 파일 구조

- `index.html` — 마크업
- `style.css` — 원본과 동일한 초록 프레임 + 17×10 그리드 스타일
- `script.js` — 게임 로직 (드래그 선택, 합 판정, 타이머)
- `firebase-config.js` — Firebase 프로젝트 설정
- `leaderboard.js` — 점수 등록/조회 (Firebase 우선, 미설정 시 localStorage로 폴백)
- `firestore.rules` — Firestore 보안 규칙
