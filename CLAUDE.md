# CLAUDE.md

LED 설치 현장 신호/전원 체인 노드-그래프 설계·검증 도구 (Vanilla JS/HTML/CSS PWA, 빌드 도구 없음).

자매 프로젝트 `led-calculator`(LED 설치 계산기)의 검증된 순수 로직(SPECS, betaPanels 등)을 이식하되, 인터페이스는 n8n 스타일 노드-그래프 에디터로 완전히 새로 설계한다. 설계 배경과 노드 타입/장비 프리셋 스펙 출처는 최초 구현 계획(2026-08-20 대화)을 참고.

## 코드 스타일 (led-calculator와 동일 규칙 승계)

- 비교 연산자: `===`/`!==`만 사용.
- 변수 선언: `const` 우선, 재할당 시 `let`. `var` 금지. 전역 상태는 `State` 단일 객체로만 관리 — 새 전역 변수 선언 금지.
- 함수 스타일: 일반 함수는 `function` 선언문, 인라인 콜백은 화살표 함수. 내부 헬퍼는 `_` 접두어.
- 들여쓰기 2칸, 섹션 구분 주석 `// ── 섹션명 ─────...`.
- 주석은 WHY가 불명확한 경우에만 작성.

## 모듈 로딩 규칙 (중요 — led-calculator와의 차이점)

**ES 모듈(`type="module"`) 금지.** `index.html`은 정해진 순서의 일반 `<script>` 태그로 각 파일을 로드한다 (`file://`로 직접 열어도 동작해야 하므로 ES 모듈의 CORS 제약을 피함).

순수 로직 파일(`js/core/graphOps.js`, `js/devices/devices.js`, `js/validation/capacityRules.js`, `js/leddesign/*.js`, `js/save/projectState.js` 등)은 파일 끝에 다음을 반드시 추가한다:

```js
if (typeof module !== 'undefined') { module.exports = { ... }; }
```

이렇게 하면 브라우저(`<script>` 전역 등록)와 Jest(`require()`)가 **동일 파일**을 사용한다. led-calculator의 `tests/betaPanels.js`처럼 로직을 테스트 폴더에 손으로 복제하는 방식은 이 프로젝트에서 금지 — 원본과 테스트 사본이 갈라지는(drift) 문제를 원천 차단하기 위함.

## 프로젝트 구조

```
index.html, manifest.json, service-worker.js, style.css, package.json
icons/
js/
  core/        state.js, idgen.js, nodeTypes.js, canvasRenderer.js, nodeCardRenderer.js, interactions.js, graphOps.js
  devices/     devices.js
  validation/  capacityRules.js, validationEngine.js
  leddesign/   specs.js, betaPanels.js, betaAreaInchLabel.js, portAssignment.js, ledDesignView.js
  save/        projectState.js, saveStore.js
  app.js
tests/         (각 순수 모듈당 *.test.js)
```

## 노드-그래프 데이터 모델

```js
GraphState = {
  version: 1,
  nodes: [{ id, type: 'input'|'console'|'sending'|'led'|'power'|'distro', x, y, label, config }],
  edges: [{ id, kind: 'video'|'lan'|'power', from:{nodeId,portId}, to:{nodeId,portId} }],
}
```

포트 호환 규칙(`graphOps.js`):
- `input.out` → `console.in[*]`만.
- `console.out[*]`: `outputKind==='lan-ports'`면 `sending.in` 또는 `led.in`에 직접 연결 가능. `outputKind==='video-signal'`이면 `sending.in`에만 연결 가능.
- `sending.out` → `led.in`만.
- `power.out` → `distro.in`만, `distro.out` → `led.pwrIn`만 (v1은 연결만, 용량 계산 없음).

## v1 범위

- 6개 노드 타입 모두 배치·연결 가능. **용량 검증은 영상/랜 경로(입력→콘솔→샌딩카드→LED)만.** 전원 경로(메인전원/분전함)는 구조만 존재, 검증 로직은 이후 버전.
- 장비 프리셋(`js/devices/devices.js`)은 `console`과 `sending` 카테고리 모두에서 조회 가능해야 한다 — NovaStar MCTRL4K/MCTRL660PRO는 콘솔과 샌딩카드 양쪽 역할을 겸하는 실제 장비이므로 두 카테고리에 동일 스펙으로 등록한다.
- LED디스플레이 노드 클릭 → LED 설계 세부 페이지(`ledDesignView.js`)로 전환. 포트당 픽셀 상한은 그래프 상류에 연결된 장비의 스펙에서 가져오고, 미연결 시에만 `MAX_PX`(655,360) 기본값 사용.

## 버전 업 규칙

기능 변경 후: `CACHE_VERSION`(service-worker.js) 동기화 → 커밋 → **푸시 전 사용자 확인 후 진행**.
