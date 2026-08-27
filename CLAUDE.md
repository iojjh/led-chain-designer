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
  nodes: [{ id, type: 'input'|'console'|'sending'|'led'|'power'|'distro'|'prompter', x, y, label, config }],
  edges: [{ id, kind: 'video'|'lan'|'power', from:{nodeId,portId}, to:{nodeId,portId} }],
}
```

포트 호환 규칙(`graphOps.js`):
- `input.out` → `console.in`(캔버스에는 도트 하나로 통합돼 있음). `isPairAllowed`는 여전히 엣지에 실제로 저장된 물리 포트 id(예: `hdmi1-2`)가 `devices.js`의 `getConsoleInputPorts(node)` 목록에 있는지로 판정한다. 장비 프리셋의 `inputs[]` 항목은 커넥터 종류당 실제 개수를 `count`로 갖고(`{id:'hdmi1', count:4}` = HDMI 4개), `getConsoleInputPorts`가 이를 `hdmi1-1..hdmi1-4`처럼 개별 슬롯으로 펼친다 — "HDMI 포트가 4개면 인풋소스 4개가 동시에 HDMI로 연결될 수 있다"는 실제 배선을 그대로 반영하기 위함(`count` 생략 시 1개). 장비 미지정(수동 모드)이면 `config.manualInputPorts`개의 범용 포트(in1, in2, …)를 반환한다. **어느 물리 슬롯을 쓸지는 캔버스 드래그가 아니라 연결 시점에 `interactions.js`의 `resolveConsoleInputConnection`이 정한다** — 빈 슬롯이 없으면 거부(토스트), 하나만 남았으면 자동 연결, 여럿이면 `#portPicker` 팝업으로 사용자가 고른다. 슬롯 하나에는 엣지가 하나만 연결될 수 있으므로(`targetPortOccupied`) "콘솔이 몇 개의 인풋소스를 받을 수 있는지"가 장비 스펙에서 자연히 정해진다.
- `console.out[*]` → 입력 쪽과 완전히 대칭 구조다. `devices.js`의 `getConsoleOutputPorts(node)`가 그 콘솔의 실제 물리 출력 포트 목록(장비별로 다름 — 아래 "콘솔 출력 포트 모델" 참고)을 돌려주고, `isPairAllowed`는 엣지의 `from.portId`가 그 목록에 있는지로 판정한다. 어느 물리 포트를 쓸지는 연결 시점에 `interactions.js`의 `resolveConsoleOutputConnection`이 정한다(빈 포트 없으면 거부, 하나면 자동, 여럿이면 `#portPicker`) — 다만 목적지 타입에 따라 후보 포트를 먼저 걸러낸다(`isPairAllowed`로 사전 필터링): `outputKind==='lan-ports'`면 `sending.in` 또는 `led.in`에, `outputKind==='video-signal'`이면 `sending.in`에만 연결 가능. 포트에 `aux:true`가 있으면(콘솔의 모니터링/프리뷰용 AUX 출력) `prompter.in`에도 직결 가능 — PGM 계열 포트는 프롬프터에 연결할 수 없다.
- `sending.out` → `led.in`만. **`led.in`은 예외적으로 여러 상류 연결을 동시에 받을 수 있다**(`graphOps.js`의 `targetAllowsMultiple` — 캔버스에는 도트 하나로 통합 표시되지만 `targetPortOccupied` 점유 검사를 건너뜀). 큰 화면 하나를 샌딩카드 여러 대가 나눠 담당하는 실제 구성을 반영하기 위함. LED 설계 세부 페이지의 LAN 배선 탭은 이때 연결된 샌딩카드마다 포트를 그룹으로 나눠 표시한다(`ledDesignView.js`/`ledPortGroups.js`의 `resolveLedPortGroups`/`resolveLedPortLayout`). 검증(`validationEngine.js`)도 샌딩카드별로 LAN 포트 배정에서 실제 그 카드 소속 포트에 배정된 패널의 픽셀만 합산해 판정한다(`pxAssignedToSendingCard`) — 배정이 현재 그래프 구성과 안 맞으면(연결 직후 등) 보수적으로 LED 전체 요구량으로 폴백.

  **카드 그룹 순서 고정(`cfg.lanGroupOrder`, 2026-08-27):** `cfg.lanPorts`는 배열 인덱스로 물리 포트를 표현하는데, 그 인덱스가 어느 샌딩카드 소속인지는 예전엔 매번 `resolveLedPortGroups`가 **캔버스 y좌표로 그 자리에서 재정렬**해 정했다 — 그래서 연결/배선을 전혀 안 건드리고 캔버스에서 카드 두 대의 위아래 위치만 바꿔도 기존 포트 배정이 다른 카드 것으로 뒤바뀌어 보이는 문제가 있었다. `resolveLedPortGroups`는 이제 `cfg.lanGroupOrder`(마지막으로 배정이 확정된 시점의 카드 순서, nodeId 목록)를 우선 따르고, 거기 없는 카드(새로 연결됨)만 y좌표 순으로 뒤에 붙인다 — 이 함수 자체는 순수 읽기 함수라 `lanGroupOrder`를 쓰지 않는다. 실제로 저장(고정)하는 건 `ledDesignView.js`의 `ensurePortsSized`(포트 패널을 열 때마다)와 `autoAssignLanForLedNode`/`resetPortAssignments`(배정을 다시 쓸 때)다. 이 고정된 순서 덕에 **샌딩카드가 LED에 새로 연결될 때도**(`rebalanceLanPortsForSendingConnect`) 기존 카드들의 배정을 전혀 안 건드리고 새 카드 몫만 배열 끝에 빈 포트로 추가할 수 있다(예전엔 카드 수가 바뀔 때마다 전체를 균등 재배정해 커스텀 배선이 통째로 사라졌다 — 사용자 확인). 카드 연결 해제 시(`rebalanceLanAfterSendingDisconnect`)는 여전히 전체 재배정한다(제거된 카드가 맡던 몫은 어차피 다시 나눠야 하므로).

  **LAN 포트 수 조절·카드 순서 교환(2026-08-27):** LAN 탭 헤더의 `#ledLanPortControls`(±, ◀▶)는 PWR의 포트 추가/제거 버튼과 대칭이지만 대상이 다르다 — **지금 선택된 포트(`_led.activePort`)가 속한 그룹(카드)** 기준으로 그 그룹의 포트만 늘리거나 줄인다(`addLanPortToActiveGroup`/`removeLanPortFromActiveGroup`, `ledDesignView.js`). 실제 장비 프리셋(`deviceId` 있음)은 포트 수가 벤더 스펙으로 고정이라 조절 버튼이 비활성화되고(`lanGroupPortCountAdjustable`), 미연결 기본값 그룹(`nodeId===null`, `cfg.requiredLanPorts`)과 수동 설정 샌딩카드(`deviceId` 없음, `node.config.portCount`)만 조절 가능하다. 포트를 추가/제거하면 그 그룹이 `cfg.lanPorts` 배열에서 차지하는 구간(`lanGroupBoundaries`)만 `splice`로 늘고 줄어, 다른 그룹의 기존 배정 위치는 전혀 안 흔들린다. ◀▶(`moveLanGroupOrder`)는 활성 그룹을 인접 그룹과 통째로 맞바꾼다 — `cfg.lanGroupOrder`뿐 아니라 그 그룹이 차지하던 배열 슬라이스 자체도 함께 옮겨 배선 내용이 그룹을 따라간다(순서만 바뀌고 어느 카드가 어떤 패널을 맡는지는 그대로). 캔버스 드래그로는 더 이상 순서가 안 바뀌므로, 순서를 의도적으로 바꾸고 싶을 때 쓰는 명시적 조작이다.
- `power.out` → `distro.in`만, `distro.out` → `led.pwrIn`만 (v1은 연결만, 용량 계산 없음).
- `console.out[aux]` → `prompter.in`만. `prompter`는 콘솔의 AUX 출력(모니터링/프리뷰)을 샌딩카드·LED 없이 바로 받는 단순 종착점(`in` 포트 하나, `out` 없음, `config` 없음) — 무대 프롬프터·컨피던스 모니터처럼 PGM 경로(→샌딩카드→LED)와 무관하게 콘솔 화면을 그대로 보여주는 용도.

인풋소스→콘솔, 콘솔→샌딩카드/LED/프롬프터 엣지는 캔버스에서 연결된 실제 물리 포트의 라벨(예: "HDMI2.0", "DVI1")을 라인 중간에 표시한다(`canvasRenderer.js`의 `edgeLabelFor`/`drawEdgeLabel`). J6가 듀얼링크 중이면(아래 참고) DVI1에서 나가는 선에 "(듀얼링크)"가 덧붙는다. **인풋소스는 해상도를 입력받지 않으므로**(사용자 요청) 그 구간의 픽셀 용량 검증은 없다 — "몇 개까지 연결 가능한지"는 포트 개수만으로 구조적으로 강제된다.

### 콘솔 출력 포트 모델 (`devices.js`)

콘솔마다 실제 출력 커넥터 구성이 다르고(벤더 매뉴얼 기준), `getConsoleOutputPorts`가 이를 하나의 포트 목록으로 정규화한다:
- **NovaStar J6**: splicer 모드는 `DVI1~DVI4` 4그룹(모두 대등, AUX 없음). switcher 모드(신규 노드 기본값)는 `DVI1`·`DVI2`(PGM, 단일 DVI에서 각각 독립 연결 가능) + `DVI3`(`aux:true`). 콘솔에 샌딩카드가 **정확히 하나만** 연결돼 있고 그 카드가 실제로 내보내는 해상도가 DVI 1개 상한(`perOutputMaxPx`)을 넘으면, `validationEngine.js`의 `resolveJ6DualLink`가 `node.config.dviLink`를 `'dual'`로 자동 전환한다 — 이때 `DVI1`·`DVI2`의 대역폭이 `DVI1` 하나로 합쳐져 `DVI2`는 더 이상 연결 가능한 포트가 아니다(`applyAutoJ6DualLink`가 `renderValidation()`마다 재판정하고, 사라진 포트를 가리키던 엣지는 정리한다). 속성 패널은 `getConsoleDisabledOutputPorts`로 이렇게 사라진 포트를 "사용불가"로 명시하고, 콘솔 카드 요약과 그 포트에서 나가는 엣지 라벨에도 듀얼링크 상태를 표시한다.
- **미러(같은 신호를 내보내는 포트 쌍)**: J6·EC90·EC100 MAIN은 논리 채널 하나(예: EC90 PGM1, J6 DVI1, EC100 main1)가 실제로는 물리 커넥터 A/B 한 쌍이고, EC100 AUX의 switcher 모드도 AUX1↔AUX2·AUX3↔AUX4가 벤더 매뉴얼상 "copy each other"(같은 신호)인 쌍이다 — 둘 다 성격이 같아 이 앱은 같은 방식으로 모델링한다: 두 포트를 각각 독립 연결 가능한 포트로 두되(예: `pgm1`/`pgm1b`, `dvi1`/`dvi1b`, `main1`/`main1b`, `aux1`/`aux2`), `devices.js`의 `mirror` 필드에 같은 값을 매겨 "이 포트들은 항상 같은 신호"임을 표시한다(라벨은 A/B 쌍이면 실제 커넥터 이름 — EC90/EC100은 "HDMI 1a"/"1b", J6는 매뉴얼에 공식 명칭이 없어 "DVI1"/"DVI1 (백업)" — EC100 AUX switcher 쌍은 원래 이름 그대로 "AUX1"/"AUX2"). 같은 신호이므로 미러 쌍을 서로 다른 목적지에 연결하면 "같은 화면을 두 군데로 동시에" 내보낼 수 있지만(정상 용도), **하나의 LED를 나눠 담당하는 샌딩카드 두 대**(서로 다른 화면 조각을 받아야 함)에 같은 미러 쌍을 하나씩 물리면 둘 다 똑같은 신호를 받아 화면을 나눌 수 없다 — 이 조합은 어느 엣지를 나중에 잇느냐에 따라 두 순서로 만들어질 수 있어(① 두 샌딩카드가 이미 같은 LED에 연결된 뒤 콘솔↔샌딩카드 미러 포트를 잇는 경우, ② 콘솔↔샌딩카드 미러 포트를 먼저 다 이어둔 뒤 두 샌딩카드를 나중에 같은 LED에 연결하는 경우) `graphOps.js`의 `mirrorPortConflict(graph, fromNode, fromPortId, toNode)`가 둘 다 걸러낸다: `fromType==='console'`(①, `consoleToSendingMirrorConflict`)과 `fromType==='sending' && toType==='led'`(②, `sendingToLedMirrorConflict` — 샌딩카드의 기존 상류 엣지에서 콘솔 포트를 거꾸로 찾아 판정) 양쪽 다 `canConnect`에서 막는다. `interactions.js`의 `resolveConsoleOutputConnection`도 ① 방향 필터를 거쳐 애초에 그런 포트를 자동 연결·피커 후보에서 뺀다(②는 일반 드래그-연결 경로라 별도 필터 없이 `canConnect` 거부로만 막힘 — 사용자 확인, 2026-08-26). J6 듀얼링크는 A·B 둘 다 함께 사라지거나(DVI2/DVI2b) 합쳐진다(DVI1/DVI1b 둘 다 `maxPx:null`, `mirror`는 유지). EC100 AUX의 mosaic 모드(`aux1`~`aux4`)는 매뉴얼상 진짜 독립("4 independent... outputs")이라 `mirror`가 없다.

  `mirrorPortConflict`는 새 엣지를 이으려는 시점만 막을 뿐, **기존에 이미 유효했던 연결이 나중에 무효가 되는 경우**(포트 id는 그대로인데 `mirror` 값만 바뀌는 경우 — 예: EC100 mosaic에서 독립적으로 쓰던 `aux1`/`aux2`가 switcher로 전환하면 미러 쌍이 됨)까지는 못 잡는다. `mode`(J6 splicer↔switcher)/`auxMode`(EC100 switcher↔mosaic) 필드는 라이브 적용(확인 버튼 없이 `change` 즉시 반영)이라, `propertiesPanel.js`의 `applyFieldValue`가 이 두 필드 변경 시 `pruneOrphanConsoleEdges`(포트가 아예 사라진 경우만 정리) 대신 `resetConsoleEdges(node)`를 호출해 그 콘솔에 물린 연결선을 방향 상관없이 전부 지운다 — 부분 정리는 "의미만 바뀐" 경우를 놓치므로, 모드가 바뀌면 항상 처음부터 다시 잇게 하는 쪽을 택했다(사용자 확인, 2026-08-26). 실제로 뭔가 지워졌을 때만 토스트로 알린다.
- **Magnimage EC90**: PROGRAM 2채널(1/2) + AUX 2채널(3/4), 채널마다 물리 HDMI 커넥터가 A/B 한 쌍(위 항목 참고 — 둘 다 독립 연결 가능한 포트). 라벨은 실제 배선 시 참고할 물리 커넥터 이름("HDMI 1a"/"HDMI 1b" 등)을 쓴다. "모자이크"(PGM1+PGM2를 이어붙여 더 넓은 화면 하나로 출력)는 두 채널을 각각 다른 샌딩카드에 연결하는 것만으로 이미 가능해 별도 설정이 없고, 샌딩카드 하나가 채널 하나의 상한을 넘는 해상도를 요구하면 검증 이슈에 "2번째 채널+샌딩카드로 나눠 모자이크로 연결"하라는 안내만 붙는다(경고만, 자동 전환 없음 — J6 듀얼링크와의 차이).
- 세 콘솔 다 `outputResolutionTable`(벤더 매뉴얼의 해상도별 지원 Hz 표)을 갖고, `capacityRules.js`의 `maxHzForPx(table, requiredPx)`가 "Hz별로 그 Hz를 지원하는 최대 해상도의 픽셀수"를 예산 삼아 필요 픽셀수를 감당하는 최고 Hz를 찾는다. 샌딩카드 노드 카드 본문에 표시되는 "해상도 · 최대 NHz"가 이 계산 결과다(`validationEngine.js`의 `resolveSendingCardOutput`). 이 카드에 실제로 배정된 LAN 포트가 있으면(`panelsAssignedToSendingCard`) 그 패널들만 감싸는 최소 사각형(`ledAreaSetup.js`의 `boundingResolutionForPanels`)을 실제 해상도로 쓴다 — 수동 배선으로 담당 구역이 비직사각형·불연속이어도 그 전체를 담는 bounding box로 근사한다(사용자 요청, 2026-08-27). 아직 배정이 없거나(연결 직후 등) 배정 정보를 신뢰할 수 없으면 LED 전체 해상도(`boundingResolutionForZones`)를 카드 수만큼 가로로 균등 분할해 근사하는 기존 방식으로 폴백한다.

인풋소스 노드의 `config.sourceKind`는 `nodeTypes.js`의 `INPUT_KINDS`(vmix/resolume/ppt/relay/etc) 중 하나다. 새 인풋소스는 생성 시점에 바로 그 종류의 라벨(예: "vMix")로 시작한다(`state.js`의 `addNode`) — 드롭다운 기본값이 이미 vmix라 사용자가 다시 vmix를 선택해도 change 이벤트가 안 일어나는 문제를 회피하기 위함.

속성 패널(`propertiesPanel.js`)은 모든 노드에 **삭제** 버튼을, `input`/`console`/`sending`(실제 설정 필드가 있는 타입)에는 추가로 **확인**(현재 폼 값을 강제 재적용하고 패널을 닫음)과 **초기화**(그 타입의 `defaultConfig`로 되돌림) 버튼을 제공한다. 빈 캔버스·다른 노드·엣지를 클릭하면 `selectNode`/`selectEdge`가 선택을 바꾸고 그때마다 `renderPropertiesPanel()`이 호출돼 패널이 자동으로 닫히거나 대상이 바뀐다.

## v1 범위

- 7개 노드 타입 모두 배치·연결 가능(`prompter`는 콘솔 AUX 출력 전용 종착점, 위 "콘솔 출력 포트 모델" 참고). **용량 검증은 영상/랜 경로(콘솔→샌딩카드→LED)만.** 전원 경로(메인전원/분전함)와 프롬프터 경로는 구조만 존재, 검증 로직은 이후 버전.
- 콘솔 장비 프리셋(`js/devices/devices.js`의 `DEVICES.console`)은 **NovaStar J6, Magnimage MIG-EC90, Magnimage MIG-EC100 세 개만** 유지한다(사용자 요청으로 축소·확장). NovaStar MCTRL4K/MCTRL660PRO는 `DEVICES.sending`에만 남아 있다 — 콘솔로 쓰고 싶으면 수동 모드로 직접 구성. EC100은 J6/EC90과 달리 콘솔 전체가 하나의 모드로 전환되지 않고 MAIN(항상 4채널 고정, 물리 커넥터 이름 그대로 "HDMI 1a"~"4a")과 AUX(`config.auxMode`로 switcher 2채널 "AUX1/2"·"AUX3/4"/mosaic 4채널 "AUX1"~"4" 전환)가 서로 독립적으로 구성돼, `getConsoleOutputPorts`에 세 번째 형태(`device.outputGroups` — 그룹마다 고정 목록 또는 config 값으로 고르는 목록)로 모델링돼 있다. 입력 12개도 커넥터 타입별로 안 묶이고 실제 후면 패널 번호 그대로 섞여 있어서(1~4·9~12 HDMI/DP, 5·7 SDI, 6·8 HDMI1.4) `device.inputs`의 타입별 count 방식 대신 `device.inputSlots`(물리 슬롯 순서 그대로 나열)를 쓴다 — `getConsoleInputPorts`가 이 형태를 우선 확인한다. 속성 패널의 입력/출력 포트 목록은 포트 수가 많은 장비에서 지저분해지지 않도록 기본으로 접혀 있고 헤더를 누르면 펼쳐진다(`propertiesPanel.js`의 `portListSection`).
- LED디스플레이 노드 클릭 → LED 설계 세부 페이지(`ledDesignView.js`)로 전환. 포트당 픽셀 상한은 그래프 상류에 연결된 장비의 스펙에서 가져오고, 미연결 시에만 `MAX_PX`(655,360) 기본값 사용.

## 버전 업 규칙

기능 변경 후: `APP_VERSION`(js/app.js, package.json의 version과 맞춤)과 `CACHE_VERSION`(service-worker.js) 동기화 → 커밋 → **푸시 전 사용자 확인 후 진행**.

`APP_VERSION`은 사용자에게 보이는 시맨틱 버전이다 — 업데이트가 적용되면(자동 백그라운드 갱신이든 배너의 수동 새로고침이든) `js/app.js` 하단의 버전 비교 블록이 `localStorage`에 저장된 이전 값과 비교해 바뀌었으면 `#updateToast`로 "vX.X.X로 업데이트되었습니다"를 짧게 띄운다. `CACHE_VERSION`만 올리고 `APP_VERSION`을 그대로 두면 이 알림이 뜨지 않으니 항상 같이 올릴 것.
