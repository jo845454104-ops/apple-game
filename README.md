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

## 온라인 랭킹(리더보드) 설정

기본 상태에서는 `firebase-config.js`가 플레이스홀더 값이라 **로컬(브라우저) 랭킹**으로만 동작합니다.
모두가 점수를 공유하는 온라인 랭킹을 쓰려면 아래처럼 본인 Firebase 프로젝트를 연결하세요.

1. https://console.firebase.google.com 에서 새 프로젝트 생성 (무료 Spark 요금제로 충분)
2. 프로젝트 설정 > 일반 > "내 앱"에서 웹 앱(</>) 추가 → 설정 객체(`firebaseConfig`) 복사
3. `firebase-config.js`의 값을 복사한 값으로 교체
4. Firebase 콘솔 좌측 메뉴 **Firestore Database** 생성 (테스트 모드로 시작해도 무방)
5. 저장 후 새로고침하면 자동으로 온라인 랭킹으로 전환됩니다. (랭킹 모달 상단에 "온라인 공유 랭킹"이라고 표시됨)

> Firestore 테스트 모드는 일정 기간 후 보안 규칙이 잠깁니다. 대회 기간이 길다면 아래처럼 `scores` 컬렉션에 한해 읽기/쓰기만 허용하는 규칙을 설정하세요.
>
> ```
> rules_version = '2';
> service cloud.firestore {
>   match /databases/{database}/documents {
>     match /scores/{doc} {
>       allow read: if true;
>       allow create: if request.resource.data.name is string
>         && request.resource.data.score is int
>         && request.resource.data.score >= 0
>         && request.resource.data.score <= 170;
>       allow update, delete: if false;
>     }
>   }
> }
> ```

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
- `firebase-config.js` — Firebase 프로젝트 설정 (본인 값으로 교체 필요)
- `leaderboard.js` — 점수 등록/조회 (Firebase 우선, 미설정 시 localStorage로 폴백)
