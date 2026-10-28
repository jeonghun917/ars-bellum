# ARS BELLUM

HTML/CSS/JavaScript 기반 전략 게임의 현재 플레이 가능한 개발 원본입니다.

## 현재 기준

- 기준일: 2026-08-02
- 기본 브랜치: `main`
- 실행 진입점: `index.html`
- 외교 보정: 모바일 플레이에서 공격 복귀, 수동 퇴각, 전략적 퇴각, 다음 전투 외교 재사용 확인
- 내부 외교 판정: 브라우저 콘솔에 `[판정]`으로 출력
- 게임 화면 판정 표시: 기본 비활성, `?diploDebug=1`에서만 표시

## 실행

로컬 파일 직접 실행보다 HTTP 서버 실행을 권장합니다.

```bash
python -m http.server 8000
```

브라우저에서 `http://127.0.0.1:8000/index.html`을 엽니다.

## 자동 검사

```bash
node verify.mjs
```

검사 내용:

- `index.html` 외부 스크립트 경로 누락·중복
- 외부 JavaScript 문법
- 인라인 JavaScript 문법
- 세션 전용 절대 경로 유입
- 핵심 파일 존재 여부

## 운영 원칙

- `main`은 현재 실행 가능한 active 원본으로만 유지합니다.
- 변경은 별도 브랜치와 Pull Request를 거칩니다.
- 실행하지 않은 브라우저 검사는 PASS로 기록하지 않습니다.
- ZIP과 과거 감사 자료는 이 저장소의 active 원본에 섞지 않습니다.

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
