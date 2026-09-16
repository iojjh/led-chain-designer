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
  core/        state.js, idgen.js, nodeTypes.js, canvasRenderer.js, nodeCardRenderer.js, interactions.js, graphOps.js, onboarding.js
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

  **연결 시 포트 배분 방식 확인(2026-08-28, 3가지로 확장 2026-09-03):** 이미 배정(자동이든 커스텀이든)이 있는 LED에 샌딩카드가 새로 연결되면 `rebalanceLanPortsForSendingConnect`가 `openPortPicker`(원래 물리 포트 선택용 팝업을 heading 인자로 일반화해 재사용)로 3가지 중 고르게 한다 — **①전체 균등 재배정**: `autoAssignLanForLedNode`로 카드 전체 배선을 처음부터 다시 계산(기존 커스텀 배선 포함 전부 사라짐). **②카드 몫 이전**: `growLanPortsForNewCard`로 새 카드 몫 빈 포트를 추가한 뒤 `transferActivePortsToNewestGroup`이 기존 카드들의 이미 채워진 포트 중 일부를 통째로(그 포트의 패널 구성은 그대로 둔 채) 새 카드 소속으로 옮겨 카드별 "활성 포트 개수"만 균등해지게 한다 — 배선 모양(어떤 패널들이 한 포트에 묶여 있는지) 자체는 절대 안 바뀌고 그 포트가 어느 카드 것인지만 바뀐다(사용자 요청 — "배선은 안 건드리고 포트만 균등 배분"). ③**포트만 추가**: `growLanPortsForNewCard`만 실행, 기존 배선 전혀 안 건드림(새 카드 포트는 빈 채로 남아 수동 배정 대기). 배정이 통째로 비어 있으면(자유 설계에서 LAN 탭을 아직 안 건드린 경우) 지울 게 없으므로 묻지 않고 조용히 넘어간다. **이 LED에 연결되는 첫 번째 샌딩카드일 때도 묻지 않는다**(사용자 요청, 2026-09-03) — `resolveLedPortLayout`의 그룹이 하나뿐이면(비교·균형을 맞출 다른 카드가 아직 없음) 곧장 `growLanPortsForNewCard`만 실행한다. 빠른 설정으로 만든 LED는 "미연결 기본값" 그룹 기준으로 이미 자동 배정이 끝나 있는데, 그 상태에서 실제 카드가 처음 연결될 때 `hasExistingBundles`만으로 판정하면(이 값도 이미 true) 팝업이 떠버리는 문제가 있었다.

  **LAN 포트 수 조절·카드 안 포트 이동(2026-08-28):** LAN 탭 헤더의 `#ledLanPortControls`는 두 줄이다 — 윗줄 `±`(포트 수 조절), 아랫줄 `◀▶`(포트 이동). 둘 다 **지금 선택된 포트(`_led.activePort`)가 속한 그룹(카드)** 을 대상으로 한다. `±`(`addLanPortToActiveGroup`/`removeLanPortFromActiveGroup`, `ledDesignView.js`)는 그 그룹의 포트만 늘리거나 줄인다 — 실제 장비 프리셋(`deviceId` 있음)은 포트 수가 벤더 스펙으로 고정이라 비활성화되고(`lanGroupPortCountAdjustable`), 미연결 기본값 그룹(`nodeId===null`, `cfg.requiredLanPorts`)과 수동 설정 샌딩카드(`deviceId` 없음, `node.config.portCount`)만 조절 가능하다. 포트를 추가/제거하면 그 그룹이 `cfg.lanPorts` 배열에서 차지하는 구간(`lanGroupBoundaries`)만 `splice`로 늘고 줄어, 다른 그룹의 기존 배정 위치는 전혀 안 흔들린다. `◀▶`(`moveActiveLanPort(dir)`)는 활성 포트를 **그 카드 안에서** 인접 포트와 한 칸 맞바꾼다 — `cfg.lanPorts`의 두 슬롯 내용(배정된 패널 묶음)만 교환하므로 다른 카드나 `cfg.lanGroupOrder`에는 영향이 없고, 그룹 경계는 못 넘는다(경계에 닿으면 버튼 비활성). 맞바꾼 직후 두 포트 칩을 서로의 옛 자리에서 미끄러져 들어오는 FLIP 애니메이션으로 그린다(스왑 전 위치를 재두고 재렌더 후 `_flipChipFrom`이 강제 리플로우로 출발 상태를 확정 — rAF 타이밍에 의존하면 `file://`에서 씹혔음, `.led-port-chip.swapping`). 여러 칸 이동은 반복해 누른다. 같은 샌딩카드를 공유하는 다른 LED디스플레이가 쓰는 슬롯과는 못 바꾼다(`sharedUsageOf` → 토스트). **샌딩카드(그룹)끼리의 순서를 바꾸는 UI는 없다** — 카드가 처음 연결된 시점의 y좌표 순으로 `cfg.lanGroupOrder`에 고정되고(위 "카드 그룹 순서 고정" 참고), 이후엔 캔버스에서 y를 바꿔도 그 순서가 유지된다(예전 `moveLanGroupOrder` ◀▶ 버튼은 제거됨, 사용자 요청).

  **PWR 탭도 같은 구조(`#ledPwrPortControls`, `renderPwrPortControls`):** 윗줄 `±`(전체 포트 수 `cfg.pwrPortCount` 조절), 아랫줄 `◀▶`(`moveActivePwrPort(dir)` — 활성 포트를 인접 포트와 맞바꿈). LAN과 달리 카드 그룹이 없어 경계는 전체 포트 범위(`0..pwrPortCount()`)로만 보고, 공유 포트 가드도 없다. 슬롯 스왑·FLIP 애니메이션은 LAN·PWR 공용 헬퍼(`_swapPortSlotsAnimated`/`_flipChipFrom`/`_portChipEl`/`_portChipRects`, `#ledPortStrip .led-port-chip[data-port]` 기준)를 쓴다 — **LAN·PWR 포트 시뮬은 거의 대칭이므로 한쪽을 고치면 다른 쪽도 검토·반영한다(사용자 요청, 2026-08-28).** 두 컨트롤 다 `.led-port-controls-col`로 세로 2줄 배치.

  **PWR 자동 할당 밀도 조절(`cfg.pwrColsPerPort`, 2026-09-03):** PWR 배선은 LAN처럼 픽셀 상한이 아니라 "포트당 열 수"로 채운다(`portAssignment.js`의 `autoAssignPwrZones(zones, portCount, minColsPerPort)`) — 기본 2열, PWR 탭 액션 줄의 `#ledPwrColsSelect`("포트당 N열", 2~6)로 조절한다. 셀렉트를 바꾸면 그 자리에서 `pushAssignHistory` 후 `autoAssignPwrForLedNode`를 다시 돌린다(되돌리기 대상). `minColsPerPort×portCount`로도 전체 열이 안 담기면 자동 배정이 열 수를 더 늘린다(누락 방지). `requiredPwrPortCount(zones, minColsPerPort)`도 이 값으로 나눠 필요한 최소 포트 수를 계산 — 부족하면 `autoAssignPwrForLedNode`가 `cfg.pwrPortCount`를 그만큼 올린다. LAN에는 대응 개념이 없다(LAN은 장비 스펙의 포트당 픽셀 상한이 밀도를 정함).
- `power.out` → `distro.in`만, `distro.out` → `led.pwrIn`만 (v1은 연결만, 용량 계산 없음).
- `console.out[aux]` → `prompter.in`만. `prompter`는 콘솔의 AUX 출력(모니터링/프리뷰)을 샌딩카드·LED 없이 바로 받는 단순 종착점(`in` 포트 하나, `out` 없음, `config` 없음) — 무대 프롬프터·컨피던스 모니터처럼 PGM 경로(→샌딩카드→LED)와 무관하게 콘솔 화면을 그대로 보여주는 용도.

인풋소스→콘솔, 콘솔→샌딩카드/LED/프롬프터 엣지는 캔버스에서 연결된 실제 물리 포트의 라벨(예: "HDMI2.0", "DVI1")을 라인 중간에 표시한다(`canvasRenderer.js`의 `edgeLabelFor`/`drawEdgeLabel`). J6가 듀얼링크 중이면(아래 참고) DVI1에서 나가는 선에 "(듀얼링크)"가 덧붙는다. **인풋소스는 해상도를 입력받지 않으므로**(사용자 요청) 그 구간의 픽셀 용량 검증은 없다 — "몇 개까지 연결 가능한지"는 포트 개수만으로 구조적으로 강제된다.

### 콘솔 출력 포트 모델 (`devices.js`)

콘솔마다 실제 출력 커넥터 구성이 다르고(벤더 매뉴얼 기준), `getConsoleOutputPorts`가 이를 하나의 포트 목록으로 정규화한다:
- **NovaStar J6**: splicer 모드는 `DVI1~DVI4` 4그룹(모두 대등, AUX 없음). switcher 모드(신규 노드 기본값)는 `DVI1`·`DVI2`(PGM, 단일 DVI에서 각각 독립 연결 가능) + `DVI3`(`aux:true`). 콘솔에 샌딩카드가 **정확히 하나만** 연결돼 있고 그 카드가 실제로 내보내는 해상도가 DVI 1개 상한(`perOutputMaxPx`)을 넘으면, `validationEngine.js`의 `resolveJ6DualLink`가 `node.config.dviLink`를 `'dual'`로 자동 전환한다 — 이때 `DVI1`·`DVI2`의 대역폭이 `DVI1` 하나로 합쳐져 `DVI2`는 더 이상 연결 가능한 포트가 아니다(`applyAutoJ6DualLink`가 `renderValidation()`마다 재판정하고, 사라진 포트를 가리키던 엣지는 정리한다). 속성 패널은 `getConsoleDisabledOutputPorts`로 이렇게 사라진 포트를 "사용불가"로 명시하고, 콘솔 카드 요약과 그 포트에서 나가는 엣지 라벨에도 듀얼링크 상태를 표시한다.
- **미러(같은 신호를 내보내는 포트 쌍)**: J6·EC90·EC100 MAIN은 논리 채널 하나(예: EC90 PGM1, J6 DVI1, EC100 main1)가 실제로는 물리 커넥터 A/B 한 쌍이고, EC100 AUX의 switcher 모드도 AUX1↔AUX2·AUX3↔AUX4가 벤더 매뉴얼상 "copy each other"(같은 신호)인 쌍이다 — 둘 다 성격이 같아 이 앱은 같은 방식으로 모델링한다: 두 포트를 각각 독립 연결 가능한 포트로 두되(예: `pgm1`/`pgm1b`, `dvi1`/`dvi1b`, `main1`/`main1b`, `aux1`/`aux2`), `devices.js`의 `mirror` 필드에 같은 값을 매겨 "이 포트들은 항상 같은 신호"임을 표시한다(라벨은 A/B 쌍이면 실제 커넥터 이름 — EC90/EC100은 "HDMI 1a"/"1b", J6는 매뉴얼에 공식 명칭이 없어 "DVI1"/"DVI1 (백업)" — EC100 AUX switcher 쌍은 원래 이름 그대로 "AUX1"/"AUX2"). 같은 신호이므로 미러 쌍을 서로 다른 목적지에 연결하면 "같은 화면을 두 군데로 동시에" 내보낼 수 있지만(정상 용도), **하나의 LED를 나눠 담당하는 샌딩카드 두 대**(서로 다른 화면 조각을 받아야 함)에 같은 미러 쌍을 하나씩 물리면 둘 다 똑같은 신호를 받아 화면을 나눌 수 없다 — 이 조합은 어느 엣지를 나중에 잇느냐에 따라 두 순서로 만들어질 수 있어(① 두 샌딩카드가 이미 같은 LED에 연결된 뒤 콘솔↔샌딩카드 미러 포트를 잇는 경우, ② 콘솔↔샌딩카드 미러 포트를 먼저 다 이어둔 뒤 두 샌딩카드를 나중에 같은 LED에 연결하는 경우) `graphOps.js`의 `mirrorPortConflict(graph, fromNode, fromPortId, toNode)`가 둘 다 걸러낸다: `fromType==='console'`(①, `consoleToSendingMirrorConflict`)과 `fromType==='sending' && toType==='led'`(②, `sendingToLedMirrorConflict` — 샌딩카드의 기존 상류 엣지에서 콘솔 포트를 거꾸로 찾아 판정) 양쪽 다 `canConnect`에서 막는다. `interactions.js`의 `resolveConsoleOutputConnection`도 ① 방향 필터를 거친다 — 다만 후보 목록에서 아예 빼지는 않고(사용자 요청, 2026-09-03: 예전엔 숨겼는데 그러면 왜 후보가 줄었는지 안 보여서), `#portPicker`에 남겨두되 `disabled` 처리해 회색으로 표시하고 클릭이 안 먹게 한다(호버 시 사유 툴팁). 실제로 고를 수 있는(비활성 아닌) 후보가 하나뿐이면 그때만 곧장 연결하고, 비활성 후보가 하나라도 섞여 있으면 피커를 띄워 보여준다(②는 일반 드래그-연결 경로라 별도 필터 없이 `canConnect` 거부로만 막힘 — 사용자 확인, 2026-08-26). J6 듀얼링크는 A·B 둘 다 함께 사라지거나(DVI2/DVI2b) 합쳐진다(DVI1/DVI1b 둘 다 `maxPx:null`, `mirror`는 유지). EC100 AUX의 mosaic 모드(`aux1`~`aux4`)는 매뉴얼상 진짜 독립("4 independent... outputs")이라 `mirror`가 없다.

  `mirrorPortConflict`는 새 엣지를 이으려는 시점만 막을 뿐, **기존에 이미 유효했던 연결이 나중에 무효가 되는 경우**(포트 id는 그대로인데 `mirror` 값만 바뀌는 경우 — 예: EC100 mosaic에서 독립적으로 쓰던 `aux1`/`aux2`가 switcher로 전환하면 미러 쌍이 됨)까지는 못 잡는다. `mode`(J6 splicer↔switcher)/`auxMode`(EC100 switcher↔mosaic) 필드는 라이브 적용(확인 버튼 없이 `change` 즉시 반영)이라, `propertiesPanel.js`의 `applyFieldValue`가 이 두 필드 변경 시 `pruneOrphanConsoleEdges`(포트가 아예 사라진 경우만 정리) 대신 `resetConsoleEdges(node)`를 호출해 그 콘솔에 물린 연결선을 방향 상관없이 전부 지운다 — 부분 정리는 "의미만 바뀐" 경우를 놓치므로, 모드가 바뀌면 항상 처음부터 다시 잇게 하는 쪽을 택했다(사용자 확인, 2026-08-26). 실제로 뭔가 지워졌을 때만 토스트로 알린다.
- **Magnimage EC90**: PROGRAM 2채널(1/2) + AUX 2채널(3/4), 채널마다 물리 HDMI 커넥터가 A/B 한 쌍(위 항목 참고 — 둘 다 독립 연결 가능한 포트). 라벨은 실제 배선 시 참고할 물리 커넥터 이름("HDMI 1a"/"HDMI 1b" 등)을 쓴다. "모자이크"(PGM1+PGM2를 이어붙여 더 넓은 화면 하나로 출력)는 두 채널을 각각 다른 샌딩카드에 연결하는 것만으로 이미 가능해 별도 설정이 없고, 샌딩카드 하나가 채널 하나의 상한을 넘는 해상도를 요구하면 검증 이슈에 "2번째 채널+샌딩카드로 나눠 모자이크로 연결"하라는 안내만 붙는다(경고만, 자동 전환 없음 — J6 듀얼링크와의 차이).
- 세 콘솔 다 `outputResolutionTable`(벤더 매뉴얼의 해상도별 지원 Hz 표)을 갖고, `capacityRules.js`의 `maxHzForPx(table, requiredPx)`가 "Hz별로 그 Hz를 지원하는 최대 해상도의 픽셀수"를 예산 삼아 필요 픽셀수를 감당하는 최고 Hz를 찾는다. 샌딩카드 노드 카드 본문에 표시되는 "해상도 · 최대 NHz"가 이 계산 결과다(`validationEngine.js`의 `resolveSendingCardOutput`). 이 카드에 실제로 배정된 LAN 포트가 있으면(`panelsAssignedToSendingCard`) 그 패널들만 감싸는 최소 사각형(`ledAreaSetup.js`의 `boundingResolutionForPanels`)을 실제 해상도로 쓴다 — 수동 배선으로 담당 구역이 비직사각형·불연속이어도 그 전체를 담는 bounding box로 근사한다(사용자 요청, 2026-08-27). 아직 배정이 없거나(연결 직후 등) 배정 정보를 신뢰할 수 없으면 LED 전체 해상도(`boundingResolutionForZones`)를 카드 수만큼 가로로 균등 분할해 근사하는 기존 방식으로 폴백한다.

  **샌딩카드 하나가 서로 다른(심지어 피치가 다른) LED 노드 여러 대에 연결된 경우(2026-09-14):** `led.in`이 상류 연결을 여러 개 받을 수 있는 것과 대칭으로, 샌딩카드의 단일 `out` 도트도 서로 다른 LED 노드 객체 여러 개에 엣지를 만들 수 있다(예: 큰 LED 하나 + 작은 LED 하나를 한 카드가 나눠 담당). `resolveSendingCardOutput`은 처음엔 `downstreamOf().find()`로 하류 LED를 하나만 찾아, 카드가 실제로는 두 화면에 나가고 있어도 먼저 찾힌 LED 하나의 해상도만 보여줬다(사용자 신고 — "크기가 다른 LED 두 개를 연결했을 때 해상도표시가 이상해"). 한때 LED별 몫을 "1248×832+4608×1024"처럼 나열하는 방식으로 고쳤었으나, 실제 배선(LAN 배선 탭)은 카드별로 화면을 좌우로 나눠 맡아 결국 하나로 이어붙여 내보내는 구성이므로 그 최종 해상도 하나만 보여주는 쪽으로 되돌렸다(사용자 요청) — 하류 LED 전부를 모아 각자의 몫을 구한 뒤(피치가 달라도 각 LED는 자기 픽셀 기준으로 따로 계산), 가로 해상도는 단순히 더하고 세로 해상도는 그 중 가장 큰 값을 취해 "이 카드가 최종적으로 내보내는 하나의 직사각형"으로 합친다. 주사율도 이 합쳐진 `w×h` 기준으로 계산해 표시되는 해상도와 항상 일치시킨다(단일 LED였을 때와 동일한 방식). 모자이크처럼 콘솔 포트 두 개가 실제로 이어붙는 경우는 이미 `resolveConsoleCombinedOutputs`/`resolveConsoleMosaicOutputs`가 따로 다룬다.

인풋소스 노드의 `config.sourceKind`는 `nodeTypes.js`의 `INPUT_KINDS`(vmix/resolume/ppt/relay/etc) 중 하나다. 새 인풋소스는 생성 시점에 바로 그 종류의 라벨(예: "vMix")로 시작한다(`state.js`의 `addNode`) — 드롭다운 기본값이 이미 vmix라 사용자가 다시 vmix를 선택해도 change 이벤트가 안 일어나는 문제를 회피하기 위함.

속성 패널(`propertiesPanel.js`)은 모든 노드에 **삭제** 버튼을, `input`/`console`/`sending`(실제 설정 필드가 있는 타입)에는 추가로 **확인**(현재 폼 값을 강제 재적용하고 패널을 닫음)과 **초기화**(그 타입의 `defaultConfig`로 되돌림) 버튼을 제공한다. 빈 캔버스·다른 노드·엣지를 클릭하면 `selectNode`/`selectEdge`가 선택을 바꾸고 그때마다 `renderPropertiesPanel()`이 호출돼 패널이 자동으로 닫히거나 대상이 바뀐다.

`closePropertiesPanel()`은 "선택은 유지한 채 패널만 숨긴다"(예: 팔레트에서 장비 프리셋을 바로 골랐을 때·LED 빠른 설정 — 이미 다른 팝업에서 같은 값을 입력받았으니 패널을 또 띄우면 중복). 이때 `State.ui.selectedId`는 그대로 남는데, 노드 연결처럼 선택과 무관한 작업 뒤에도 `renderPropertiesPanel()`을 광범위하게 호출한다(포트 배정 등 화면에 반영할 정보가 바뀔 수 있어서) — 예전엔 이 호출이 "선택돼 있으면 무조건 연다"는 규칙 하나만 봤기 때문에, 방금 닫아둔 그 노드의 패널이 전혀 무관한 다른 두 노드를 연결할 때마다 저절로 다시 튀어나오는 버그가 있었다(사용자 확인, 2026-08-28). `State.ui.pendingPanelOpen`(`selectNode`가 true로 세팅, `closePropertiesPanel`이 false로 취소, `renderPropertiesPanel`이 한 번 읽으면 바로 소비)로 "이번 렌더가 방금의 명시적 선택 때문인지"를 구분해, 닫혀 있던 패널은 그 경우에만 강제로 열고 그 외엔(이미 열려 있던 패널의 내용 갱신은 그대로 하되) 닫힌 채로 둔다.

## v1 범위

- 7개 노드 타입 모두 배치·연결 가능(`prompter`는 콘솔 AUX 출력 전용 종착점, 위 "콘솔 출력 포트 모델" 참고). **용량 검증은 영상/랜 경로(콘솔→샌딩카드→LED)만.** 전원 경로(메인전원/분전함)와 프롬프터 경로는 구조만 존재, 검증 로직은 이후 버전.
- 콘솔 장비 프리셋(`js/devices/devices.js`의 `DEVICES.console`)은 **NovaStar J6, Magnimage MIG-EC90, Magnimage MIG-EC100 세 개만** 유지한다(사용자 요청으로 축소·확장). NovaStar MCTRL4K/MCTRL660PRO는 `DEVICES.sending`에만 남아 있다 — 콘솔로 쓰고 싶으면 수동 모드로 직접 구성. EC100은 J6/EC90과 달리 콘솔 전체가 하나의 모드로 전환되지 않고 MAIN(항상 4채널 고정, 물리 커넥터 이름 그대로 "HDMI 1a"~"4a")과 AUX(`config.auxMode`로 switcher 2채널 "AUX1/2"·"AUX3/4"/mosaic 4채널 "AUX1"~"4" 전환)가 서로 독립적으로 구성돼, `getConsoleOutputPorts`에 세 번째 형태(`device.outputGroups` — 그룹마다 고정 목록 또는 config 값으로 고르는 목록)로 모델링돼 있다. 입력 12개도 커넥터 타입별로 안 묶이고 실제 후면 패널 번호 그대로 섞여 있어서(1~4·9~12 HDMI/DP, 5·7 SDI, 6·8 HDMI1.4) `device.inputs`의 타입별 count 방식 대신 `device.inputSlots`(물리 슬롯 순서 그대로 나열)를 쓴다 — `getConsoleInputPorts`가 이 형태를 우선 확인한다. 속성 패널의 입력/출력 포트 목록은 포트 수가 많은 장비에서 지저분해지지 않도록 기본으로 접혀 있고 헤더를 누르면 펼쳐진다(`propertiesPanel.js`의 `portListSection`).
- LED디스플레이 노드 클릭 → LED 설계 세부 페이지(`ledDesignView.js`)로 전환. 포트당 픽셀 상한은 그래프 상류에 연결된 장비의 스펙에서 가져오고, 미연결 시에만 `MAX_PX`(655,360) 기본값 사용. 캔버스의 LED 노드 카드 본문은 `nodeCardRenderer.js`의 `cardSummary`가 `"3mm · 512×512 · 16장 · 1,038,336px"`처럼 피치·해상도·장수·픽셀을 한 줄로 보여준다(피치 표시, 사용자 요청 2026-09-15) — 구역이 여럿이라 피치가 섞여 있으면(자유 설계에서 구역마다 다르게 그린 경우) `"2mm/3mm"`처럼 이어붙인다.

  **가이드 이미지 중앙 해상도 표시 옵션(2026-09-16):** "여백 정리" 완료 후 나오는 "가이드 이미지 저장"(`generateGuideImageDataUrl`/`drawGuideZone`)은 원래 항상 배경(어두운 배경+비네팅+워터마크)·패널 격자선·구역 테두리와 함께 중앙에 해상도 텍스트(흰 숫자+주황 바)를 그렸다. 모달에 `#guideImageShowResChk` 체크박스를 추가해 이 중앙 해상도 텍스트만 껐다 켤 수 있게 했다(격자 모양·워터마크 패턴·테두리는 항상 그대로 — 사용자 요청, "체크 해제시 led격자 모양과 패턴만"). `generateGuideImageDataUrl(cfg, {showResolution})`이 이 값을 `drawGuideZone`까지 그대로 전달하고, `drawGuideZone`은 구역 테두리를 그린 직후 `showResolution`이 false면 곧장 리턴해 해상도 텍스트 블록을 건너뛴다. 체크박스를 바꾸면 모달을 닫지 않고 `refreshGuideImage()`가 그 자리에서 다시 그린다 — 체크 상태는 DOM에 남아 같은 세션에서 모달을 다시 열어도 마지막 선택이 유지된다.

  좁고 긴 구역(예: 1칸 폭에 세로로 긴 자유 구역)은 폰트 크기가 `cellPx`(피치가 가늘수록 커짐) 기준으로 정해지다 보니 텍스트 전체 폭이 캔버스 폭보다 넓어져 양옆이 잘려 나가는 문제가 있었다(사용자 신고, 2026-09-16). `drawGuideZone`은 이제 실제 측정한 텍스트 폭(`totalTW`)이 `cv.width * 0.92`를 넘으면 그 비율만큼 폰트 크기를 줄여 다시 측정하고, 그러고도 라벨 칸이 구역 가장자리에 가까워(오목한 자유 구역 등) 중앙 정렬 위치가 캔버스를 벗어날 수 있으므로 가로·세로 위치(강조 바 포함)를 캔버스 안쪽으로 클램프한다 — 폰트 축소(텍스트 자체가 캔버스보다 넓은 경우)와 위치 클램프(텍스트는 들어가지만 중앙 정렬 위치가 가장자리에 걸치는 경우) 둘 다 필요해서 함께 적용한다.

  **되돌리기(`onUndoButtonClick`, 2026-08-28, LAN/PWR도 스냅샷 방식으로 통일 2026-09-03):** 모드별로 이력만 따로 두고 방식은 같다 — 조작 직전에 그 대상을 JSON 스냅샷으로 쌓고 통째로 복원한다. LAN/PWR 배선은 그 모드의 포트 배열(`cfg.lanPorts`/`cfg.pwrPorts`)을 스냅샷하고(`pushAssignHistory`, `_led.lanAssignHistory`/`pwrAssignHistory`, `undoLastAssignment`) — 단일 칸 재배정(`setPanelPort`, 드래그 페인트는 칸마다 쌓여 한 칸씩 풀림), 자동 할당(`ledAutoAssignBtn`), 전체 초기화(`ledResetAllBtn`), 포트 이동 스왑(`_swapPortSlotsAnimated` → `moveActiveLanPort`/`moveActivePwrPort`)이 전부 대상이다. 포트 수 자체를 바꾸는 `±`(`addLanPortToActiveGroup` 등)는 레이아웃(`lanGroupOrder`/경계) 정합성 문제로 대상이 아니다. 예전엔 `{key, prevPortIdx}` 한 칸만 담아 초기화·자동 할당은 이력을 비우기만 했다(사용자 요청으로 확장). 구역 편집은 격자 크기·포트 배정까지 연쇄로 바뀌므로 조작 직전에 `ledDesign` config 전체를 JSON 스냅샷으로 쌓고(`pushZoneHistory`, `_led.zoneHistory`) 통째로 복원한다(`undoLastZoneEdit`) — 구역 생성/삭제/편집, 격자 확장·축소, 여백 정리, 전체 초기화 전부 대상. 스냅샷 복원 시 `exitCompactView`를 부르면 안 된다(compact로 되돌리는 undo가 바로 풀림). **버튼 배치:** 데스크톱은 사이드 패널에 `↩ 되돌리기`(LAN/PWR는 `#ledUndoAssignBtn`, 구역 탭은 `#ledZoneUndoBtn`, 둘 다 `.led-side-undo-btn`). 모바일(`@media max-width:700px`)은 사이드 버튼을 숨기고 모드 툴바 오른쪽 끝(⛶ 왼쪽)에 아이콘만 — `#ledToolbarUndoBtn`(↺, 모든 탭) + 구역 탭 자유(칸 선택) 모드에서만 `#ledZoneConfirmToolbarBtn`(✓ 구역 확정, `updateZoneDraftBar`가 토글). 셋 다 `.led-toolbar-action-btn`.

## 처음 사용자 안내 (`js/core/onboarding.js`, 2026-09-03)

강제 튜토리얼 없이 상황에 맞을 때만 뜨는 넛지 모음. 전부 그래프 뷰(`#graphView`) 안에 있고, LED 설계 페이지가 열리면 `.view[hidden]`으로 자동으로 안 보인다.

- **안내 패널(`#graphHelpPanel`)** — 3스텝 퀵스타트 + 제스처 요약 + 색상 범례(상태 배지 ✓/!/?, 연결선 kind별 색). 캔버스가 비면 자동으로 뜨고(`_helpAutoShown`), 첫 노드가 생기면 알아서 닫힌다. 우상단 `#helpBtn`(`?`)으로 언제든 다시 연다 — 이렇게 직접 열면 `_helpAutoShown=false`가 돼 노드가 생겨도 안 닫힌다. `_helpDismissed`는 사용자가 ✕/토글로 닫았거나 예시를 불러왔음을 표시(캔버스가 다시 완전히 빌 때까지 자동 표시 안 함).
- **예시 현장(`SAMPLE_GRAPH` → `loadSampleGraph`)** — 인풋소스→콘솔→샌딩카드→LED가 이어진 최소 체인. 콘솔·샌딩카드는 수동(장비 미지정) 모드라 포트 id도 수동 기본값(`in1`/`out1`). `State.graph`를 통째로 갈아끼우고 저장 슬롯 불러오기와 같은 후처리(`panToLeftmostNode` 등).
- **연결 힌트 스트립(`#connectHint`)** — 노드 ≥2 & 엣지 0일 때만. ✕로 닫으면 `localStorage`(`onboard-connect-hint-dismissed`)에 기록해 다시 안 뜬다.
- **드롭 타깃 하이라이트** — 연결 드래그 중 커서 밑 카드에 `.node-card.drop-target`(`interactions.js`의 `_highlightDropTarget`, `resolveDropTarget` 재사용). 정확한 입력 도트를 안 맞혀도 카드 영역이면 연결된다는 걸 보여준다.
- **"꾹 눌러 이동" 1회 토스트(`maybeHoldToMoveHint`)** — 카드를 롱프레스 전에 빠르게 끌어 제스처가 취소된 첫 순간에만(`localStorage` `onboard-hold-to-move-seen`).
- **상태 배지 탭** — `nodeCardRenderer.js`(데스크톱 click)와 `interactions.js`의 `tryFocusNodeFromBadgeTap`(터치)이 `panToNode` + 문제 있으면 이슈 패널 펼침.
- **이슈 패널 강조** — 문제 ≥1이면 `#issuesPanel.has-issues`(헤더 빨강), 0→N 전이 순간 접혀 있으면 한 번 펼치고 `.issues-nudge`로 흔든다(`validationEngine.js`의 `_prevIssueCount`).

`refreshOnboarding()`는 `renderNodeCards()` 끝에서 매번 불린다(그래프 변화에 반응). `onboarding.js`는 순수 로직이 아니라 DOM 전용이라 `module.exports` 가드도 테스트도 없다.

## 일정에서 LED 추가 (`js/leddesign/scheduleParse.js`, `js/save/scheduleFeed.js`, 2026-09-10)

자매 앱 `led-calculator`의 밴드 일정 파싱(§13)을 이식. 데이터 소스는 계산기앱과 **같은 Outlook 공유 캘린더의 ICS**. 사람 작업은 밴드→Outlook 뿐(계산기용으로 이미 하던 것). **앱은 읽기 전용**.

- Outlook ICS 응답엔 CORS 헤더가 없어 브라우저에서 직접 못 읽는다(무료 공개 프록시도 게이트/불안정). 그래서 `apps-script/ics-proxy.gs`를 **웹 앱으로 배포한 자체 프록시**(`doGet`이 서버에서 ICS를 받아 CORS 열어 반환)를 거친다. 시트·트리거·지연 없음. 그 `/exec` URL을 `scheduleFeed.js`의 `SCHEDULE_ICS_PROXY_URL`에 넣는다 — 비면 기능 비활성("설정되지 않았습니다"). 설정: `일정-피드-설정.md`.
- `parseIcs(raw)` / `stripSchedFooter(s)` / `icsDate(v)` (`scheduleFeed.js`, 순수, 테스트) — 계산기 `_parseIcs`·`_stripSchedFooter` 이식. `fetchScheduleEntries()`는 프록시 fetch → `parseIcs` → 시작일이 오늘-`SCHEDULE_RECENT_DAYS`(7) 이후인 것만 → `N*M` 있는 것만 → 날짜 오름차순 → `{date,title,body}` 배열.
- `parseScheduleText(text)` (`scheduleParse.js`, 순수) — `{label, pitch:'3mm', areaWm, areaHm}[]` 배열 반환. 피치를 못 찾거나 지원 밖(2/3/4mm 아님)이면 `'3mm'` 가정, 면적이 없으면 throw. 멀티(좌우·중앙)는 섹션이 **2개 이상** 깔끔히 잡힐 때만("중앙 6*3, 좌우 3*2.5"). 자유 텍스트에 "중앙무대"·"좌우중계" 단어만 섞이면 첫 `N*M` 하나만 뽑는 단일 모드로 폴백(실측 Outlook 데이터 기준). `panelSizeForPitch(pitch)` — 2mm는 500×500, 그 외 500×1000.

  **여러 조가 줄마다 나뉜 "목록" 형태(2026-09-16, 사용자 제보 실측 스크린샷 2건):** 밴드가 한 일정에 LED를 여러 조 나열해두는 경우가 실제로 있다(예: "1.진입로 / 3mm 중앙 6*4 좌우 3*4 / 4mm 콘솔 6*3.5 / 2.대로 / 4mm 10*6" — 중앙·좌·우·콘솔·10×6 5개 화면). 위 단일/멀티 로직은 원래 텍스트 전체에서 피치 하나만 뽑아 모든 섹션에 그대로 적용했기 때문에, 이런 목록에서는 뒤쪽 줄(4mm 콘솔, 4mm 10×6)이 통째로 누락됐다. `parseScheduleListLines`가 `parseScheduleText` 맨 앞에서 먼저 시도한다 — 줄마다 "자기 피치(Nmm)+크기(N*M)"를 **함께** 갖춘 줄이 2개 이상이면(서로 다른 화면을 나열한 목록이 거의 확실) 그 목록 모드로 들어가 줄마다(한 줄에 여럿이면 그 줄 안에서도 피치 등장 위치 기준으로 나눠) 크기를 전부 뽑는다. 반대로 "광복절"/"경기도자비엔날레" 테스트 사례처럼 부가 설명·다른 장비 치수가 **한 줄에** 뒤섞여 있으면 그 줄 하나만 자격을 갖췄으므로(2개 미만) 목록 모드로 안 들어가고 위 기존 로직으로 그대로 폴백한다 — "같은 줄에 크기가 여럿"만으로는 목록으로 보지 않는 게 핵심 오탐 방지 장치(실측 데이터에서 두 번째 `N*M`이 진짜 두 번째 화면이 아니라 부가 장비 치수였던 사례가 있었음). 목록 모드에서 크기 앞에 좌/좌측/우/우측/중앙이 있으면 그 라벨을, 없으면 크기 앞의 설명 단어(예: "콘솔")를, 그것도 없으면 크기 뒤의 괄호 설명(예: "3*2(게임중계화면)")을 라벨로 쓴다 — 그래도 라벨이 없으면(부가 설명 전혀 없는 항목) 노드 이름이 전부 똑같아 구분이 안 되므로 목록 순번(`"2"`, `"3"` …)을 붙인다. 좌/우는 있는데 중앙이 명시적으로 안 잡혔으면(라벨 없이 "6*4 좌우 3*4") 라벨 없는 첫 항목을 중앙으로 보는 규칙은 기존 단일 그룹 로직과 동일하게 유지.
- 적용(`saveStore.js`의 `applyScheduleEntry`)은 `interactions.js` `onLedAddConfirm`의 빠른 설정(rect) 분기(`:1022-1051`)를 섹션마다 반복 — `planFullAreaLed` → `createPositionedNode('led')`(같은 타입 노드를 자동으로 아래/오른쪽에 쌓아 팬아웃) → `ledDesign` 채우기 → `autoAssignLanForLedNode`/`autoAssignPwrForLedNode`. 섹션끼리 **엣지로 연결하지 않는다**. `finalizeAddedNode`/`renderValidation`은 루프가 끝난 뒤 마지막 노드에 대해 **한 번만**(반복 호출 시 팬이 튐).
- 모달·목록 UI는 `saveStore.js`의 `renderCloudList` 옆(`initScheduleUi`/`openScheduleModal`/`closeScheduleModal`/`renderScheduleList`/`onScheduleImportClick`/`applyScheduleEntry`). `initScheduleUi()`는 `app.js`에서 `initSaveLoadUi()` 다음에 호출. 진입점은 팔레트의 `data-type="schedule"` 버튼 + `interactions.js` 카테고리 핸들러의 한 줄 분기(노드 타입이 아니라 모달 오프너). 순수 모듈 2개는 `tests/scheduleParse.test.js`·`tests/scheduleFeed.test.js`.

## 버전 업 규칙

기능 변경 후: `APP_VERSION`(js/app.js, package.json의 version과 맞춤)과 `CACHE_VERSION`(service-worker.js) 동기화 → 커밋 → **푸시 전 사용자 확인 후 진행**.

`APP_VERSION`은 사용자에게 보이는 시맨틱 버전이다 — 업데이트가 적용되면(자동 백그라운드 갱신이든 배너의 수동 새로고침이든) `js/app.js` 하단의 버전 비교 블록이 `localStorage`에 저장된 이전 값과 비교해 바뀌었으면 `#updateToast`로 "vX.X.X로 업데이트되었습니다"를 짧게 띄운다. `CACHE_VERSION`만 올리고 `APP_VERSION`을 그대로 두면 이 알림이 뜨지 않으니 항상 같이 올릴 것.
