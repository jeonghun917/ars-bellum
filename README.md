# ARS BELLUM

HTML/CSS/JavaScript 기반 전략 게임의 현재 플레이 가능한 개발 원본입니다.

## 현재 기준

- 실행 진입점: `index.html` (모듈 하나 `src/main.js`를 불러옵니다)
- 3D 전투: `m2_prototype.html`
- 외교: 정해진 규칙으로 판정하고, 대사 생성은 키를 넘길 때만 켜집니다

## 실행

로컬 파일 직접 실행보다 HTTP 서버 실행을 권장합니다.

```bash
node tests/support/static-server.mjs .
```

브라우저에서 `http://127.0.0.1:4173/index.html`을 엽니다.

## 자동 검사

```bash
node verify.mjs   # index.html의 스크립트, src/ 아래 모든 모듈의 문법과 가져오는 파일
npm test          # 아래 Tests 참고: 모든 검사
```

## 운영 원칙

- `main`은 현재 실행 가능한 active 원본으로만 유지합니다.
- 변경은 별도 브랜치와 Pull Request를 거칩니다.
- 실행하지 않은 브라우저 검사는 PASS로 기록하지 않습니다.
- ZIP과 과거 감사 자료는 이 저장소의 active 원본에 섞지 않습니다.

## Running the game

Open `index.html` through any static web server (for example `node tests/support/static-server.mjs .`
and then http://127.0.0.1:4173/index.html). The page loads one module, `src/main.js`.

- `index.html`: the game (menu, world map, settlements, saving, 2D battles). Code in `src/`;
  how it is organised is in `docs/REWRITE.md`.
- `m2_prototype.html`: the 3D battle (code in `m2/`, three.js in `vendor/`).
- `battle2d.html`: the 2D battle on its own, for development.

Saves are kept in the browser under `ars_bellum_save_v2`. A save of the earlier version
(`ars_bellum_save_v1`) is read and converted on first open, and is never changed or deleted.

## Tests

```
npm ci
npx playwright install chromium   # once
npm test
```

`npm test` runs every check listed in `tests/checks.json` (the one list of required checks) and writes
`test-results/results.json`. Each check is PASS, FAIL or NOT_TESTED, and anything that is not PASS
carries a reason (for example `browser_missing`, `timeout:…`, `assertion_failed:…`). A test title starts
with its check id in brackets; a listed id without a result, or a result without a listed id, fails the
run. To use a local Chromium, set `PW_CHROMIUM_PATH`.
