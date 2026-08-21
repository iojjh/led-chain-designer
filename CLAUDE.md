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
  leddesign/   specs.js, betaPanels.js, betaAreaInchLabel.js, portAssignment.js, ledPortGroups.js, ledDesignView.js
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
- `input.out` → `console.in`(캔버스에는 도트 하나로 통합돼 있음). `isPairAllowed`는 여전히 엣지에 실제로 저장된 물리 포트 id(예: `hdmi1-2`)가 `devices.js`의 `getConsoleInputPorts(node)` 목록에 있는지로 판정한다. 장비 프리셋의 `inputs[]` 항목은 커넥터 종류당 실제 개수를 `count`로 갖고(`{id:'hdmi1', count:4}` = HDMI 4개), `getConsoleInputPorts`가 이를 `hdmi1-1..hdmi1-4`처럼 개별 슬롯으로 펼친다 — "HDMI 포트가 4개면 인풋소스 4개가 동시에 HDMI로 연결될 수 있다"는 실제 배선을 그대로 반영하기 위함(`count` 생략 시 1개). 장비 미지정(수동 모드)이면 `config.manualInputPorts`개의 범용 포트(in1, in2, …)를 반환한다. **어느 물리 슬롯을 쓸지는 캔버스 드래그가 아니라 연결 시점에 `interactions.js`의 `resolveConsoleInputConnection`이 정한다** — 빈 슬롯이 없으면 거부(토스트), 하나만 남았으면 자동 연결, 여럿이면 `#portPicker` 팝업으로 사용자가 고른다. 슬롯 하나에는 엣지가 하나만 연결될 수 있으므로(`targetPortOccupied`) "콘솔이 몇 개의 인풋소스를 받을 수 있는지"가 장비 스펙에서 자연히 정해진다.
- `console.out[*]`: `outputKind==='lan-ports'`면 `sending.in` 또는 `led.in`에 직접 연결 가능. `outputKind==='video-signal'`이면 `sending.in`에만 연결 가능.
- `sending.out` → `led.in`만. **`led.in`은 예외적으로 여러 상류 연결을 동시에 받을 수 있다**(`graphOps.js`의 `targetAllowsMultiple` — 캔버스에는 도트 하나로 통합 표시되지만 `targetPortOccupied` 점유 검사를 건너뜀). 큰 화면 하나를 샌딩카드 여러 대가 나눠 담당하는 실제 구성을 반영하기 위함. LED 설계 세부 페이지의 LAN 배선 탭은 이때 연결된 샌딩카드마다(캔버스 세로 위치 순) 포트를 그룹으로 나눠 표시한다(`ledDesignView.js`/`ledPortGroups.js`의 `resolveLedPortGroups`/`resolveLedPortLayout`). 검증(`validationEngine.js`)도 샌딩카드별로 LAN 포트 배정에서 실제 그 카드 소속 포트에 배정된 패널의 픽셀만 합산해 판정한다(`pxAssignedToSendingCard`) — 배정이 현재 그래프 구성과 안 맞으면(연결 직후 등) 보수적으로 LED 전체 요구량으로 폴백.
- `power.out` → `distro.in`만, `distro.out` → `led.pwrIn`만 (v1은 연결만, 용량 계산 없음).

인풋소스→콘솔 엣지는 캔버스에서 연결된 포트의 라벨(예: "HDMI2.0")을 라인 중간에 표시한다(`canvasRenderer.js`의 `edgeLabelFor`/`drawEdgeLabel`). **인풋소스는 해상도를 입력받지 않으므로**(사용자 요청) 이 구간의 픽셀 용량 검증은 없다 — "몇 개까지 연결 가능한지"는 포트 개수만으로 구조적으로 강제된다.

인풋소스 노드의 `config.sourceKind`는 `nodeTypes.js`의 `INPUT_KINDS`(vmix/resolume/ppt/relay/etc) 중 하나다. 새 인풋소스는 생성 시점에 바로 그 종류의 라벨(예: "vMix")로 시작한다(`state.js`의 `addNode`) — 드롭다운 기본값이 이미 vmix라 사용자가 다시 vmix를 선택해도 change 이벤트가 안 일어나는 문제를 회피하기 위함.

속성 패널(`propertiesPanel.js`)은 모든 노드에 **삭제** 버튼을, `input`/`console`/`sending`(실제 설정 필드가 있는 타입)에는 추가로 **확인**(현재 폼 값을 강제 재적용하고 패널을 닫음)과 **초기화**(그 타입의 `defaultConfig`로 되돌림) 버튼을 제공한다. 빈 캔버스·다른 노드·엣지를 클릭하면 `selectNode`/`selectEdge`가 선택을 바꾸고 그때마다 `renderPropertiesPanel()`이 호출돼 패널이 자동으로 닫히거나 대상이 바뀐다.

## v1 범위

- 6개 노드 타입 모두 배치·연결 가능. **용량 검증은 영상/랜 경로(콘솔→샌딩카드→LED)만.** 전원 경로(메인전원/분전함)는 구조만 존재, 검증 로직은 이후 버전.
- 콘솔 장비 프리셋(`js/devices/devices.js`의 `DEVICES.console`)은 **NovaStar J6, Magnimage MIG-EC90 두 개만** 유지한다(사용자 요청으로 축소). NovaStar MCTRL4K/MCTRL660PRO는 `DEVICES.sending`에만 남아 있다 — 콘솔로 쓰고 싶으면 수동 모드로 직접 구성.
- LED디스플레이 노드 클릭 → LED 설계 세부 페이지(`ledDesignView.js`)로 전환. 포트당 픽셀 상한은 그래프 상류에 연결된 장비의 스펙에서 가져오고, 미연결 시에만 `MAX_PX`(655,360) 기본값 사용.

## 버전 업 규칙

기능 변경 후: `APP_VERSION`(js/app.js, package.json의 version과 맞춤)과 `CACHE_VERSION`(service-worker.js) 동기화 → 커밋 → **푸시 전 사용자 확인 후 진행**.

`APP_VERSION`은 사용자에게 보이는 시맨틱 버전이다 — 업데이트가 적용되면(자동 백그라운드 갱신이든 배너의 수동 새로고침이든) `js/app.js` 하단의 버전 비교 블록이 `localStorage`에 저장된 이전 값과 비교해 바뀌었으면 `#updateToast`로 "vX.X.X로 업데이트되었습니다"를 짧게 띄운다. `CACHE_VERSION`만 올리고 `APP_VERSION`을 그대로 두면 이 알림이 뜨지 않으니 항상 같이 올릴 것.
