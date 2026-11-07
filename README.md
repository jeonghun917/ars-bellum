# ARS BELLUM

HTML/CSS/JavaScript 기반 전략 게임의 현재 플레이 가능한 개발 원본입니다.

## 현재 기준

- 실행 진입점: `index.html` (모듈 하나 `src/main.js`를 불러옵니다)
- 3D 전투: `m2_prototype.html`
- 외교: 정해진 규칙으로 판정하고, 대사 생성은 키를 넘길 때만 켜집니다

## 3D 전투

게임 메뉴의 **전투 화면: 2D / 3D** 버튼으로 고릅니다(선택은 기억됩니다). 3D를 고르면 연습 전투와 원정
전투가 3D로 열리고, 끝나면 결과(승패, 죽은 병사, 도주한 병사)가 게임으로 돌아갑니다. `m2_prototype.html`을
바로 열어도 됩니다.

주소 끝에 붙이는 옵션:

| 옵션 | 하는 일 |
|---|---|
| (없음) | 20 대 20 기본 전투 |
| `?scale=100` | 한쪽 N명(20~100)의 큰 전투 |
| `?mixed` | 병종이 섞인 전투(40 대 40; `?scale=N`과 같이 쓰면 N명) |
| `?debug` | 진단 창(초당 장면 수, 그리기 호출 수 등) |

조작: 이동 WASD(휴대폰은 가상 스틱), 공격 J, 막기 K, 활 L. **전술** 버튼으로 하늘 시점과 명령 창을 엽니다:
작전, 부대 고르기, 부대 명령, 목표 공격, 재집결, 후퇴, 대형(1 횡대, 2 종대, 3 산개, 4 방패진, 5 쐐기진,
6 원진), 속도(정지, ¼, ½, 1×).

전투 규칙 (코드는 `m2/`, 모두 추가 배율 없이 몸·장비·숫자로만 다름):

- **나(영웅)**: 어느 부대에도 속하지 않고, 게임 속 내 인물의 기술과 장비로 싸웁니다(`M2_HeroLoadout.js`).
- **부대장**: 부대마다 따로 있는 인물. 통솔은 사기, 지휘는 손실 부담, 전술은 쓸 수 있는 작전·명령 칸 수
  (`M2_Commanders.js`).
- **병과와 병종**: 보병·사수·기병 세 병과(`M2_UnitKinds.js`), 그 아래 병종: 방패병, 장창병, 충격보병,
  척후병, 석궁병, 장궁병, 경기병, 중기병. 병사마다 몸이 있어 겹치지 않고, 무거운 쪽이 밀어냅니다
  (`M2_CollisionSystem.js`).
- **대형**: 횡대, 종대, 산개, 방패진, 쐐기진, 원진(`M2_FormationSystem.js`).
- **부대 명령**: 돌격, 장창 대기, 치고 빠지기, 측면 우회, 사격 중지, 집중 사격, 일제 사격, 견제 사격
  (`M2_Orders.js`).
- **작전**: 정면 압박, 모루와 망치, 견제 후 돌격, 궁병 호위, 버티다 역습, 양익 포위, 거짓 후퇴. 가진 병종
  조합과 부대장의 전술로 쓸 수 있는 것이 정해집니다(`M2_Plans.js`). 적도 같은 방식으로 작전을 고릅니다
  (`M2_EnemyAI.js`).
- **사기와 도주**: 손실, 측면·후방 기습으로 사기가 떨어지고, 무너진 병사는 전장 밖으로 달아납니다
  (`M2_MoraleSystem.js`).
- **시야(전장의 안개)**: 병사마다 보는 거리가 있고(보병 20m, 석궁병 24m, 기병 28m, 척후병 45m), 한 편이 본
  것은 그 편 모두가 압니다. 전투 시작 때 적의 배치는 알지만, 그 뒤 안 보이는 적은 마지막으로 본 자리에 흐리게
  보입니다. 적 지휘관도 자기 병사가 본 것만 알고, 아무도 안 보이는 적을 치거나 쏘지 못합니다(`M2_Vision.js`).

병사 모델의 알려진 문제(나중에 자세를 고칠 때 함께): 머리 위로 내려칠 때 손이, 막을 때 방패가 투구에 조금
겹칩니다. 원래 투구에서도 생기는 자세 문제라 모델 검사(`tools/blender/check_soldier.py`)는 이것을 "알려진
문제"로 따로 적고, 새 투구가 원래 투구보다 크게 겹치거나 원래 투구가 안 겹치는 자세에서 겹치면 문제로 잡습니다.

전장 배경(`M2_SceneryLayout.js`, `M2_Scenery.js`, 사용자가 준 들판 사진들을 기준으로): 흐린 하늘 아래 빽빽한 긴 풀밭(아래는
초록, 위는 마른 이삭과 작은 흰 꽃, 바람에 흔들림), 지평선을 따라 둥근 숲 띠, 큰 나무 몇 그루, 말뚝 철조망 울타리. 풀과
숲은 코드로 그린 그림판을 세워 그립니다. 싸우는 곳은 평평하고 풀만 있습니다. 전투에는 아무 영향이 없습니다.

성능 측정(100 대 100)은 `docs/m2-scale/README.md`에 있습니다.

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
