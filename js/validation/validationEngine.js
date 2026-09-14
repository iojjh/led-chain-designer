// ── validationEngine ────────────────────────────────
// 그래프를 순회해 영상/랜 경로(입력→콘솔→샌딩카드→LED)의 용량 이슈를 계산하고
// (runValidation) 노드 배지·엣지 색·이슈 패널에 반영한다(renderValidation).
// power/distro 경로는 v1에서 검증하지 않는다(구조만 존재).

if (typeof module !== 'undefined' && typeof resolveLedPortLayout === 'undefined') {
  global.resolveLedPortLayout = require('../leddesign/ledPortGroups.js').resolveLedPortLayout;
  global.betaPanels = require('../leddesign/betaPanels.js').betaPanels;
  global.boundingResolutionForZones = require('../leddesign/ledAreaSetup.js').boundingResolutionForZones;
  global.boundingResolutionForPanels = require('../leddesign/ledAreaSetup.js').boundingResolutionForPanels;
  global.panelPx = require('../leddesign/portAssignment.js').panelPx;
  global.downstreamOf = require('../core/graphOps.js').downstreamOf;
  global.upstreamOf = require('../core/graphOps.js').upstreamOf;
  global.getDevice = require('../devices/devices.js').getDevice;
  global.getConsoleOutputPorts = require('../devices/devices.js').getConsoleOutputPorts;
  global.checkConsoleOutput = require('./capacityRules.js').checkConsoleOutput;
  global.checkSendingOutput = require('./capacityRules.js').checkSendingOutput;
  global.checkSendingInput = require('./capacityRules.js').checkSendingInput;
  global.checkConsoleSingleOutput = require('./capacityRules.js').checkConsoleSingleOutput;
  global.checkLedLanPortCount = require('./capacityRules.js').checkLedLanPortCount;
  global.maxHzForPx = require('./capacityRules.js').maxHzForPx;
}

function ledRequiredPx(ledNode) {
  return ledNode.config.totalRequiredPx || 0;
}

// 샌딩카드 하나가 LED 하나에 대해 실제로 담당하는 패널 목록 — LED의 LAN 포트
// 배정에서 그 카드 소속 포트(ledPortGroups.js 그룹 순서)에 배정된 패널만 골라낸다.
// 아직 포트 배정 배열이 현재 그래프 구성(연결/해제 직후 등)과 맞지 않으면
// 배정 전이라 판단 불가 — 이때는 null(호출자가 각자의 보수적 폴백을 쓴다).
// 배정 자체는 유효하지만 이 카드 몫이 아직 비어 있으면 빈 배열([])을 반환해
// "배정 불가(null)"와 "배정됐지만 0개(empty)"를 구분한다.
function panelsAssignedToSendingCard(graph, ledNode, sendingNodeId) {
  const cfg = ledNode.config.ledDesign;
  const layout = resolveLedPortLayout(graph, ledNode.id);
  const lanPorts = cfg.lanPorts;
  if (!lanPorts || lanPorts.length !== layout.ports.length) { return null; }

  const panels = cfg.zones.flatMap(z => betaPanels(z));
  const assigned = [];
  layout.ports.forEach((group, idx) => {
    if (group.nodeId !== sendingNodeId) { return; }
    (lanPorts[idx] || []).forEach(key => {
      const panel = panels.find(p => p.key === key);
      if (panel) { assigned.push(panel); }
    });
  });
  return assigned;
}

// 샌딩카드 하나가 LED 하나에 대해 실제로 담당하는 픽셀 총량. 샌딩카드 여러
// 대가 LED 하나를 나눠 담당할 수 있으므로(graphOps.js targetAllowsMultiple),
// 카드별 실제 부담을 반영해야 불필요한 초과 경고를 피할 수 있다. 배정 정보를
// 신뢰할 수 없으면(panelsAssignedToSendingCard가 null) 보수적으로 LED 전체
// 요구량을 반환한다.
function pxAssignedToSendingCard(graph, ledNode, sendingNodeId) {
  const panels = panelsAssignedToSendingCard(graph, ledNode, sendingNodeId);
  if (!panels) { return ledRequiredPx(ledNode); }
  return panels.reduce((sum, p) => sum + panelPx(p), 0);
}

// sending 또는 led 노드가 실제로 요구하는 픽셀 총량(콘솔 출력 검증에 사용).
function requiredPxOfDownstreamNode(graph, node) {
  if (node.type === 'led') { return ledRequiredPx(node); }
  if (node.type === 'sending') {
    return downstreamOf(graph, node.id)
      .filter(n => n.type === 'led')
      .reduce((sum, ledNode) => sum + pxAssignedToSendingCard(graph, ledNode, node.id), 0);
  }
  return 0;
}

// J6가 switcher 모드일 때 PGM 출력을 단일 DVI(DVI1+DVI2 각각 독립 연결)로
// 쓸지, 듀얼링크(DVI1 하나로 합쳐 더 높은 해상도, DVI2 비활성)로 쓸지는
// 사용자가 고르지 않고 실제 연결 상태를 보고 자동으로 정한다(사용자 요청,
// 2026-08-26) — 콘솔에 샌딩카드가 정확히 하나만 연결돼 있을 때 그 카드가
// 실제로 내보내는 해상도가 DVI 1개 상한(device.perOutputMaxPx)을 넘으면
// 듀얼링크가 필요하다고 판단한다. 그 외(샌딩카드가 0개거나 2개 이상 —
// DVI1/DVI2를 독립적으로 나눠 쓰는 정상적인 구성)에는 굳이 합칠 이유가
// 없으니 기본값(단일)을 쓴다.
function resolveJ6DualLink(graph, consoleNode) {
  const device = consoleNode.config.deviceId ? getDevice('console', consoleNode.config.deviceId) : null;
  if (!device || device.id !== 'novastar-j6') { return 'single'; }
  const mode = consoleNode.config.mode || device.defaultMode;
  if (mode !== 'switcher') { return 'single'; }
  const sendingNodes = downstreamOf(graph, consoleNode.id).filter(n => n.type === 'sending');
  if (sendingNodes.length !== 1) { return 'single'; }
  const requiredPx = requiredPxOfDownstreamNode(graph, sendingNodes[0]);
  return requiredPx > device.perOutputMaxPx ? 'dual' : 'single';
}

// 그래프의 모든 콘솔 노드에 resolveJ6DualLink 결과를 반영하고(node.config.dviLink),
// 듀얼링크로 전환되며 사라진 DVI2 같은 포트를 가리키던 엣지는 정리한다 — 그래프를
// 그리기 직전(renderValidation)에 한 번씩 돌려 항상 최신 연결 상태를 반영한다.
function applyAutoJ6DualLink(graph) {
  graph.nodes.forEach(node => {
    if (node.type !== 'console') { return; }
    node.config.dviLink = resolveJ6DualLink(graph, node);
    const validOutIds = new Set(getConsoleOutputPorts(node).map(p => p.id));
    graph.edges = graph.edges.filter(e => !(e.from.nodeId === node.id && !validOutIds.has(e.from.portId)));
  });
}

function hasZones(ledNode) {
  return !!(ledNode.config.ledDesign.zones && ledNode.config.ledDesign.zones.length);
}

// 샌딩카드가 실제로 내보내는 해상도(가로×세로)와, 그 해상도로 낼 수 있는 최대
// 주사율(사용자 요청, 2026-08-26). 이 카드에 실제로 배정된 LAN 포트가 있으면
// (panelsAssignedToSendingCard) 그 패널들만 감싸는 최소 사각형을 실제 해상도로
// 쓴다(boundingResolutionForPanels — 배정이 비직사각형·불연속이어도 그 전체를
// 담는 bbox로 근사, 사용자 요청 2026-08-27). 아직 배정이 없거나(연결 직후
// 자동/수동 배정을 한 번도 안 한 상태) 배정 정보를 신뢰할 수 없으면(연결 직후
// 등) LED 전체 픽셀 해상도(boundingResolutionForZones)를 카드 수만큼 가로로
// 균등 분할한 걸로 근사한다(정확한 열 배정 비율이 아니라 "카드 수만큼 반으로/
// N등분" — 사용자가 명시적으로 요청한 단순화). 주사율은 상류 콘솔의 실제 출력
// 해상도 표(device.outputResolutionTable)에서 이 픽셀수를 감당하는 최대 Hz를
// 찾아 정한다 — 콘솔이 없거나 장비 프리셋이 없으면(수동 모드) 주사율은 판단 불가.
//
// 샌딩카드 하나가 서로 다른(심지어 피치가 다른) LED 노드 여러 대에 나눠
// 연결될 수도 있다(사용자 신고, 2026-09-14 — 크기가 다른 LED 두 대에
// 연결했더니 카드에 첫 번째로 찾은 LED의 해상도만 뜨고 두 번째는 통째로
// 무시됨). 하류 LED를 downstreamOf에서 하나만 find하지 않고 전부 모아 각자의
// 몫(parts, 피치가 다르면 그 LED 자기 픽셀 기준으로 각각 계산)을 구한 뒤, 실제
// 배선이 가로로 이어붙이는 구성이므로(LAN 배선 탭이 카드별로 좌우 순서대로
// 포트를 나눠 담당) 가로 해상도는 단순히 더하고 세로 해상도는 가장 큰 LED
// 기준으로 통합해 "이 카드가 최종적으로 내보내는 하나의 직사각형" 해상도로
// 보여준다(사용자 요청, 2026-09-14 — 한때 LED별로 "1248×832+4608×1024"처럼
// 나열했으나, 실제 신호는 한 직사각형으로 합쳐 내보내는 것이므로 그 최종
// 해상도 하나만 보여주는 쪽으로 되돌렸다). 주사율도 이 합쳐진 w×h 기준으로
// 판단한다(단일 LED일 때와 동일한 방식 — 표시되는 해상도와 항상 일치시키기 위함).
function resolveSendingCardOutput(graph, sendingNode) {
  const ledNodes = downstreamOf(graph, sendingNode.id).filter(n => n.type === 'led' && hasZones(n));
  if (!ledNodes.length) { return null; }

  const parts = ledNodes.map(ledNode => {
    const assignedPanels = panelsAssignedToSendingCard(graph, ledNode, sendingNode.id);
    const actual = assignedPanels && assignedPanels.length ? boundingResolutionForPanels(assignedPanels) : null;
    if (actual) { return actual; }

    const full = boundingResolutionForZones(ledNode.config.ledDesign.zones);
    if (!full || full.w === 0 || full.h === 0) { return null; }
    const cardCount = upstreamOf(graph, ledNode.id).filter(n => n.type === 'sending').length || 1;
    return { w: Math.floor(full.w / cardCount), h: full.h };
  }).filter(Boolean);

  if (!parts.length) { return null; }

  const w = parts.reduce((sum, p) => sum + p.w, 0);
  const h = Math.max(...parts.map(p => p.h));

  const consoleNode = upstreamOf(graph, sendingNode.id).find(n => n.type === 'console');
  const device = consoleNode && consoleNode.config.deviceId ? getDevice('console', consoleNode.config.deviceId) : null;
  const hz = (device && device.outputResolutionTable) ? maxHzForPx(device.outputResolutionTable, w * h) : null;

  return { w, h, hz };
}

// 콘솔의 출력 포트별로, 그 포트가 실제로 물려 있는 샌딩카드 방향의 해상도·
// 최대 Hz를 계산한다(사용자 요청, 2026-08-26) — resolveSendingCardOutput을
// 그대로 재사용하므로 샌딩카드 카드에 표시되는 값과 항상 일치한다. 해상도는
// 그 포트 하나의 몫(모자이크로 2대가 나눠 맡으면 그 절반)을 보여준다 — 한때
// (2026-08-26) "콘솔 입력 쪽에서 맞춰 보내야 하는 합쳐진 캔버스 크기"라는
// 이유로 최종 LED 전체 해상도를 대신 보여준 적이 있었지만, 포트별로 실제
// 내보내는 몫과 다른 값이 떠서 오히려 헷갈린다는 사용자 요청(2026-08-27)으로
// 되돌렸다 — 합쳐진 크기가 필요하면 resolveConsoleCombinedOutputs를 따로 쓴다.
// 프롬프터로 연결된 포트는 샌딩카드가 없어 대상에서 빠지고, 아직 LED
// 해상도가 안 잡혔거나 샌딩카드가 없는 포트도 결과에서 빠진다(콘솔 자체가
// 여러 포트를 동시에 쓸 수 있어 배열로 반환 — 샌딩카드는 한 대만 연결되는 게
// 보통이라 배열이 아니었던 것과 다름).
function resolveConsoleOutputInfo(graph, consoleNode) {
  const ports = getConsoleOutputPorts(consoleNode);
  return graph.edges
    .filter(e => e.from.nodeId === consoleNode.id)
    .map(e => {
      const toNode = graph.nodes.find(n => n.id === e.to.nodeId);
      if (!toNode || toNode.type !== 'sending') { return null; }
      const out = resolveSendingCardOutput(graph, toNode);
      if (!out) { return null; }
      const port = ports.find(p => p.id === e.from.portId);
      return {
        portId: e.from.portId,
        portLabel: port ? port.label : e.from.portId,
        w: out.w,
        h: out.h,
        hz: out.hz,
      };
    })
    .filter(Boolean);
}

// 콘솔에서 나가는 포트들을 목적지 LED별로 묶어, 같은 LED로 2개 이상의 포트가
// 모자이크로 합류하는 경우에만 그 LED의 최종(합쳐진) 해상도를 반환한다
// (사용자 요청, 2026-08-27 — 포트별 몫은 위 resolveConsoleOutputInfo가 이미
// 보여주므로, 여기서는 "다 합치면 결국 얼마인지"만 따로 보여준다). 포트가
// 하나만 물린 LED는 애초에 "합계"라는 개념이 없으므로 제외한다.
function resolveConsoleCombinedOutputs(graph, consoleNode) {
  const byLed = new Map();
  graph.edges.filter(e => e.from.nodeId === consoleNode.id).forEach(e => {
    const toNode = graph.nodes.find(n => n.id === e.to.nodeId);
    if (!toNode || toNode.type !== 'sending') { return; }
    const ledNode = downstreamOf(graph, toNode.id).find(n => n.type === 'led' && hasZones(n));
    if (!ledNode) { return; }
    const entry = byLed.get(ledNode.id) || { count: 0, ledNode };
    entry.count += 1;
    byLed.set(ledNode.id, entry);
  });

  const result = [];
  byLed.forEach(({ count, ledNode }) => {
    if (count < 2) { return; }
    const full = boundingResolutionForZones(ledNode.config.ledDesign.zones);
    if (full && full.w && full.h) { result.push({ ledNodeId: ledNode.id, w: full.w, h: full.h }); }
  });
  return result;
}

// EC90/EC100처럼 모자이크(채널 N+M을 좌우로 이어붙여 더 넓은 화면 하나로
// 출력)로 쓸 수 있는 콘솔은 device.mosaicOutputPairs에 실제로 짝지어야 하는
// "a" 포트 쌍이 있다(devices.js 참고 — J6는 이 개념이 정확히 들어맞지 않아
// 필드 자체가 없다, 사용자 확인 2026-09-14). 그 쌍의 두 포트가 각각 다른
// 샌딩카드에 연결돼 있을 때만(하나만 연결됐거나 짝이 아닌 포트끼리 연결됐으면
// 모자이크가 아니므로 제외) 두 카드의 실제 해상도(resolveSendingCardOutput)를
// 가로로 합쳐 보여준다 — 세로는 두 카드가 어긋나 있을 수 있어 보수적으로
// max를 쓴다.
function resolveConsoleMosaicOutputs(graph, consoleNode) {
  const device = consoleNode.config.deviceId ? getDevice('console', consoleNode.config.deviceId) : null;
  if (!device || !device.mosaicOutputPairs) { return []; }

  return device.mosaicOutputPairs.map(pair => {
    const outs = pair.map(portId => {
      const edge = graph.edges.find(e => e.from.nodeId === consoleNode.id && e.from.portId === portId);
      if (!edge) { return null; }
      const toNode = graph.nodes.find(n => n.id === edge.to.nodeId);
      if (!toNode || toNode.type !== 'sending') { return null; }
      return resolveSendingCardOutput(graph, toNode);
    });
    if (outs.some(o => !o)) { return null; }
    const label = pair.map(id => (id.match(/(\d+)$/) || [null, id])[1]).join('+');
    return { pairLabel: label, w: outs[0].w + outs[1].w, h: Math.max(outs[0].h, outs[1].h) };
  }).filter(Boolean);
}

// 구역이 없는 LED는 totalRequiredPx가 0이라 위 checkConsoleOutput/checkSendingOutput이
// "0 <= limit"로 트리비얼하게 통과한다 — 진짜 용량 확인이 아니라 LED 해상도가 아직
// 없어서 나온 잠정 결과다. 상류(console/sending) 배지를 회색 "?"로 낮춰 표시하려면
// 호출자가 이 상태를 알아야 하므로 별도로 계산해 반환한다.
function hasUnconfirmedLedDownstream(graph, node) {
  if (node.type === 'led') { return !hasZones(node); }
  if (node.type === 'sending') {
    return downstreamOf(graph, node.id).some(n => n.type === 'led' && !hasZones(n));
  }
  return false;
}

// 그래프만 받아 이슈 맵을 돌려주는 오케스트레이션 함수. checkConsoleOutput 등
// capacityRules.js의 순수 함수를 호출하지만, 장비 조회(getDevice)와 그래프 순회
// (downstreamOf)는 이 파일에서 수행한다. 인풋소스→콘솔 구간은 해상도를 입력받지
// 않으므로 픽셀 용량 검사가 없다 — 포트 점유(graphOps)만으로 연결 가능 여부가 정해진다.
function runValidation(graph) {
  const nodeIssues = new Map();
  const edgeIssues = new Map();
  const nodeProvisional = new Set();

  function addNodeIssue(nodeId, issue) {
    if (!nodeIssues.has(nodeId)) { nodeIssues.set(nodeId, []); }
    nodeIssues.get(nodeId).push(issue);
  }

  graph.nodes.forEach(node => {
    if (node.type === 'led' && !hasZones(node)) { nodeProvisional.add(node.id); }

    // 픽셀 용량과는 별개로 "물리 LAN 포트 자체가 모자란지" 검사 — 실제로
    // 뭔가(샌딩카드 또는 lan-ports 콘솔)에 연결돼 있을 때만 의미가 있다
    // (미연결 기본값 그룹은 진짜 장비가 아니므로 대상이 아님).
    if (node.type === 'led') {
      const layout = resolveLedPortLayout(graph, node.id);
      if (layout.groups.length > 0 && layout.groups[0].nodeId !== null) {
        const availablePorts = layout.groups.reduce((sum, g) => sum + g.portCount, 0);
        const res = checkLedLanPortCount(node.config.ledDesign, availablePorts);
        if (!res.ok) { addNodeIssue(node.id, res); }
      }
    }

    if (node.type === 'console') {
      const device = node.config.deviceId ? getDevice('console', node.config.deviceId) : null;

      const downstream = downstreamOf(graph, node.id);
      if (downstream.length > 0) {
        const requiredPx = downstream.reduce((sum, n) => sum + requiredPxOfDownstreamNode(graph, n), 0);
        const res = checkConsoleOutput(node.config, device, requiredPx);
        if (!res.ok) { addNodeIssue(node.id, res); }

        // 합산 용량은 남아돌아도 특정 연결 하나가 커넥터 1개의 상한을 넘을 수
        // 있으므로, 하류 장비별로 개별 확인한다(checkConsoleOutput과 별개).
        // 다만 이미 듀얼링크로 전환된 J6는(resolveJ6DualLink) 애초에 단일 DVI
        // 상한을 넘어서 전환된 것이므로, 같은 상한으로 또 검사하면 항상
        // "초과"로 잘못 표시된다 — 합쳐진 DVI1의 실제 상한은 문서에 없으니
        // perOutputMaxPx를 비워 이 검사만 보류한다.
        const singleOutputDevice = (device && node.config.dviLink === 'dual')
          ? { ...device, perOutputMaxPx: null }
          : device;
        downstream.forEach(n => {
          const singlePx = requiredPxOfDownstreamNode(graph, n);
          const singleRes = checkConsoleSingleOutput(singleOutputDevice, singlePx);
          if (!singleRes.ok) {
            // EC90은 PGM1+PGM2(또는 AUX1+AUX2) 두 채널을 모자이크로 합치면
            // 채널 하나의 상한보다 큰 해상도를 낼 수 있다(devices.js 주석 참고)
            // — 경고만 띄우고 자동으로 채널을 나누거나 설정을 바꾸지는 않는다
            // (사용자 요청, 2026-08-26).
            const mosaicHint = device && device.id === 'magnimage-ec90'
              ? ' — 2번째 채널(PGM2/AUX2)에 샌딩카드를 하나 더 연결하고 콘솔에서 모자이크 모드를 켜면 나눠서 낼 수 있습니다'
              : '';
            addNodeIssue(node.id, { ...singleRes, message: `${n.label} 방향: ${singleRes.message}${mosaicHint}` });
          }
        });

        if (downstream.some(n => hasUnconfirmedLedDownstream(graph, n))) { nodeProvisional.add(node.id); }
      }
    }

    if (node.type === 'sending') {
      const device = node.config.deviceId ? getDevice('sending', node.config.deviceId) : null;
      const downstream = downstreamOf(graph, node.id).filter(n => n.type === 'led');
      if (downstream.length > 0) {
        const requiredPx = downstream.reduce((sum, ledNode) => sum + pxAssignedToSendingCard(graph, ledNode, node.id), 0);
        const res = checkSendingOutput(node.config, device, requiredPx);
        if (!res.ok) { addNodeIssue(node.id, res); }

        // LAN 출력 용량과는 별개로, 콘솔에서 이 카드로 들어오는 영상 신호
        // 자체가 카드의 입력 상한을 넘는지도 확인한다(카드는 해상도를 바꾸지
        // 않으므로 하류 LED 요구량 = 카드가 받아야 하는 입력량).
        const inputRes = checkSendingInput(node.config, device, requiredPx);
        if (!inputRes.ok) { addNodeIssue(node.id, inputRes); }

        if (downstream.some(n => !hasZones(n))) { nodeProvisional.add(node.id); }
      }
    }
  });

  return { nodeIssues, edgeIssues, nodeProvisional };
}

// ── 현장 자재 요약(집계) ──────────────────────────────
// 500×500mm 패널은 1랙 24장, 그 외(500×1000/1000×500mm)는 1랙 12장
// (led-calculator의 panelMeta와 동일 규칙, 사용자 확인 2026-09-14).
const RACK_SIZE_500x500 = 24;
const RACK_SIZE_DEFAULT = 12;
const LAN_SHORT_BUNDLE_SIZE = 20;
const PWR_SHORT_BUNDLE_SIZE = 10;

// 프로젝트(캔버스 전체) 기준으로 현장에 가져가야 할 것들을 한 번에 집계한다
// (사용자 요청, 2026-09-14 — 이슈 패널과 별개인 "설치 요약" 패널이 씀).
// 개별 조각은 전부 기존 순수 계산을 그대로 재사용해, 카드·속성 패널에 이미
// 표시되는 값과 절대 갈라지지 않게 한다: 샌딩카드 해상도는
// resolveSendingCardOutput, LED 최종 해상도는 boundingResolutionForZones,
// 케이블 개수는 ledDesignView.js의 renderCableSum과 동일한 공식(1번=사용
// 포트 수[랜은 ×2], 숏=포트별 (배정 장수-1)의 합 + 각 LED 노드에 이미
// 저장된 spareAdj)이다.
function computeProjectSummary(graph) {
  const ledNodes = graph.nodes.filter(n => n.type === 'led');

  // LED 노드별 해상도·피치 — 사용자가 캔버스에 배치한 LED마다 실제로 뭘
  // 쓰고 있는지 한눈에 보려는 목적(사용자 요청, 2026-09-15). 피치는 그 LED의
  // 구역들이 전부 같으면 그 값, 섞여 있으면(예: 한 LED디스플레이 노드 안에
  // 2mm/3mm 구역이 공존) "/"로 이어붙여 보여준다 — 이 경우
  // boundingResolutionForZones는 피치가 섞이면 null을 반환하므로 해상도 자체는
  // 표시하지 못한다(피치별로 실제 크기가 달라 하나의 W×H로 합칠 수 없음).
  const ledNodeResolutions = ledNodes
    .filter(n => hasZones(n))
    .map(n => {
      const zones = n.config.ledDesign.zones;
      const pitch = Array.from(new Set(zones.map(z => z.led))).join('/');
      const res = boundingResolutionForZones(zones);
      return { nodeId: n.id, label: n.label, pitch, w: res ? res.w : null, h: res ? res.h : null };
    });

  // 최종 전체 해상도 — 구역이 있는 LED 노드들의 해상도를 가로로 이어붙인다
  // (폭은 합, 높이는 가장 큰 값 — 노드마다 세로가 다를 수 있어 보수적으로 최댓값).
  const ledResolutions = ledNodeResolutions.filter(r => r.w && r.h);
  const totalResolution = ledResolutions.length
    ? { w: ledResolutions.reduce((sum, r) => sum + r.w, 0), h: Math.max(...ledResolutions.map(r => r.h)) }
    : null;

  // 샌딩카드별 해상도 — 카드 요약에 표시되는 것과 동일한 계산.
  const sendingCards = graph.nodes.filter(n => n.type === 'sending')
    .map(n => {
      const out = resolveSendingCardOutput(graph, n);
      return out ? { nodeId: n.id, label: n.label, w: out.w, h: out.h, hz: out.hz } : null;
    })
    .filter(Boolean);

  // 콘솔 모자이크 출력(아웃풋1+2/3+4) — EC90/EC100처럼 짝지어 쓰는 콘솔만.
  const mosaicOutputs = [];
  graph.nodes.filter(n => n.type === 'console').forEach(n => {
    resolveConsoleMosaicOutputs(graph, n).forEach(m => {
      mosaicOutputs.push({ consoleNodeId: n.id, consoleLabel: n.label, pairLabel: m.pairLabel, w: m.w, h: m.h });
    });
  });

  // LED 패널·랙 수 — 피치×패널크기별로 묶는다(랙 크기가 패널 크기에 따라 다름).
  const panelGroups = new Map();
  ledNodes.forEach(n => {
    (n.config.ledDesign.zones || []).forEach(zone => {
      betaPanels(zone).forEach(p => {
        const sizeKey = `${p.w}×${p.h}`;
        const key = `${p.led}|${sizeKey}`;
        if (!panelGroups.has(key)) {
          const rackSize = (p.w === 500 && p.h === 500) ? RACK_SIZE_500x500 : RACK_SIZE_DEFAULT;
          panelGroups.set(key, { pitch: p.led, sizeKey, area: p.w * p.h, rackSize, count: 0 });
        }
        panelGroups.get(key).count += 1;
      });
    });
  });
  const pitchOrder = ['2mm', '3mm', '4mm'];
  const panelGroupList = Array.from(panelGroups.values())
    .sort((a, b) => pitchOrder.indexOf(a.pitch) - pitchOrder.indexOf(b.pitch) || a.area - b.area)
    .map(({ pitch, sizeKey, rackSize, count }) => ({ pitch, sizeKey, rackSize, count, racks: Math.ceil(count / rackSize) }));

  const panelTotalsByPitchMap = new Map();
  panelGroupList.forEach(g => {
    const entry = panelTotalsByPitchMap.get(g.pitch) || { pitch: g.pitch, count: 0, racks: 0 };
    entry.count += g.count;
    entry.racks += g.racks;
    panelTotalsByPitchMap.set(g.pitch, entry);
  });
  const panelTotalsByPitch = pitchOrder
    .map(p => panelTotalsByPitchMap.get(p))
    .filter(Boolean);

  // 케이블 개수 — LED디스플레이 세부 페이지의 renderCableSum/updateCableSum과
  // 동일한 공식을 프로젝트 내 모든 LED 노드에 대해 합산한다. 필요(net)와
  // 여유(spare, 각 LED 노드에 이미 저장된 spareAdj)를 따로 더해뒀다가 합계와
  // 함께 보여준다(사용자 요청, 2026-09-14 — 그 LED 페이지와 동일한 "필요 N ·
  // 여유 M" 표기).
  let lan1Net = 0;
  let lan1Spare = 0;
  let lanShortNet = 0;
  let lanShortSpare = 0;
  let pwr1Net = 0;
  let pwr1Spare = 0;
  let pwrShortNet = 0;
  let pwrShortSpare = 0;
  ledNodes.forEach(n => {
    const cfg = n.config.ledDesign;
    const spare = cfg.spareAdj || {};
    const lanPorts = cfg.lanPorts || [];
    const lanUsed = lanPorts.filter(a => a.length > 0).length;
    lan1Net += lanUsed * 2;
    lan1Spare += spare.l1 || 0;
    lanShortNet += lanPorts.reduce((sum, a) => sum + Math.max(0, a.length - 1), 0);
    lanShortSpare += spare.sl || 0;

    const pwrPorts = cfg.pwrPorts || [];
    const pwrUsed = pwrPorts.filter(a => a.length > 0).length;
    pwr1Net += pwrUsed;
    pwr1Spare += spare.c1 || 0;
    pwrShortNet += pwrPorts.reduce((sum, a) => sum + Math.max(0, a.length - 1), 0);
    pwrShortSpare += spare.sp || 0;
  });
  const lanShort = lanShortNet + lanShortSpare;
  const pwrShort = pwrShortNet + pwrShortSpare;

  return {
    ledNodeResolutions,
    totalResolution,
    sendingCards,
    mosaicOutputs,
    panelGroups: panelGroupList,
    panelTotalsByPitch,
    totalPanelCount: panelGroupList.reduce((sum, g) => sum + g.count, 0),
    cables: {
      lan1: lan1Net + lan1Spare,
      lan1Net,
      lan1Spare,
      lanShort,
      lanShortNet,
      lanShortSpare,
      lanShortBundles: Math.ceil(lanShort / LAN_SHORT_BUNDLE_SIZE),
      pwr1: pwr1Net + pwr1Spare,
      pwr1Net,
      pwr1Spare,
      pwrShort,
      pwrShortNet,
      pwrShortSpare,
      pwrShortBundles: Math.ceil(pwrShort / PWR_SHORT_BUNDLE_SIZE),
    },
  };
}

// ── DOM 표면화 ──────────────────────────────────────
let _issuesListEl = null;
let _issuesCountEl = null;

function initValidationUi(issuesListEl, issuesCountEl) {
  _issuesListEl = issuesListEl;
  _issuesCountEl = issuesCountEl;
}

function renderValidation() {
  applyAutoJ6DualLink(State.graph);
  const result = runValidation(State.graph);
  State.ui.validation = result;
  renderNodeCards();
  render();
  renderIssuesPanel(result);
  renderSummaryPanel(computeProjectSummary(State.graph));
}

let _prevIssueCount = 0;

function renderIssuesPanel(result) {
  if (!_issuesListEl) { return; }
  const rows = [];
  result.nodeIssues.forEach((issues, nodeId) => {
    const node = getNode(nodeId);
    if (!node) { return; }
    issues.forEach(issue => rows.push({ nodeId, label: node.label, message: issue.message }));
  });

  _issuesCountEl.textContent = String(rows.length);
  _issuesListEl.innerHTML = rows.length
    ? rows.map(r => `<div class="issue-row" data-node-id="${r.nodeId}"><b>${escapeHtml(r.label)}</b><span>${escapeHtml(r.message)}</span></div>`).join('')
    : '<div class="issue-empty">문제 없음</div>';

  _issuesListEl.querySelectorAll('.issue-row').forEach(row => {
    row.addEventListener('click', () => panToNode(row.dataset.nodeId));
  });

  // 문제가 하나라도 있으면 패널 헤더를 눈에 띄게(빨강) 하고, 0→N으로 새로
  // 생긴 순간엔 접혀 있던 패널을 한 번 펼치고 살짝 흔들어 알린다 — 그 뒤엔
  // 사용자가 다시 접을 수 있고, 접힌 상태를 강제로 다시 열지 않는다.
  const panel = document.getElementById('issuesPanel');
  if (panel) {
    panel.classList.toggle('has-issues', rows.length > 0);
    if (rows.length > 0 && _prevIssueCount === 0) {
      panel.classList.remove('collapsed');
      panel.classList.remove('issues-nudge');
      void panel.offsetWidth; // 애니메이션 재시작 보장
      panel.classList.add('issues-nudge');
    }
  }
  _prevIssueCount = rows.length;
}

// 설치 요약 패널 — 이슈 패널과 별개로, 캔버스 전체(프로젝트 전체) 기준의
// LED 노드별 해상도·피치/최종 해상도·LED 장수/랙 수·케이블 개수를 한눈에
// 보여준다(사용자 요청, 2026-09-14, 이름·LED별 정보 2026-09-15).
// computeProjectSummary의 순수 결과를 그대로 DOM에 옮기기만 한다.
function renderSummaryPanel(summary) {
  const bodyEl = document.getElementById('summaryBody');
  if (!bodyEl) { return; }
  const countEl = document.getElementById('summaryCount');
  if (countEl) { countEl.textContent = `${summary.totalPanelCount.toLocaleString()}장`; }

  const resRows = [];
  summary.ledNodeResolutions.forEach(l => {
    const resLabel = (l.w && l.h) ? `${l.w}×${l.h}` : '구역 없음';
    resRows.push(`<div class="summary-row"><span>${escapeHtml(l.label)} (${escapeHtml(l.pitch)})</span><b>${resLabel}</b></div>`);
  });
  if (summary.totalResolution) {
    resRows.push(`<div class="summary-row"><span>전체(LED 가로 합)</span><b>${summary.totalResolution.w}×${summary.totalResolution.h}</b></div>`);
  }
  summary.mosaicOutputs.forEach(m => {
    resRows.push(`<div class="summary-row"><span>${escapeHtml(m.consoleLabel)} 출력${m.pairLabel}</span><b>${m.w}×${m.h}</b></div>`);
  });
  summary.sendingCards.forEach(c => {
    const hzLabel = c.hz ? ` · 최대 ${c.hz}Hz` : '';
    resRows.push(`<div class="summary-row"><span>${escapeHtml(c.label)}</span><b>${c.w}×${c.h}${hzLabel}</b></div>`);
  });

  const panelRows = summary.panelGroups.map(g => (
    `<div class="summary-row"><span>${g.pitch} ${g.sizeKey}</span><b>${g.count.toLocaleString()}장 · ${g.racks}랙</b></div>`
  ));
  if (summary.panelTotalsByPitch.length > 1) {
    summary.panelTotalsByPitch.forEach(t => panelRows.push(
      `<div class="summary-row summary-row-total"><span>${t.pitch} 합계</span><b>${t.count.toLocaleString()}장 · ${t.racks}랙</b></div>`
    ));
  }

  const c = summary.cables;
  const cableItem = (label, total, net, spare, bundles) => `
    <div class="summary-row">
      <span>${label}</span>
      <span class="summary-row-value">
        <b>${total.toLocaleString()}개${bundles ? ` (${bundles}묶음)` : ''}</b>
        <small class="summary-row-note">필요 ${net.toLocaleString()} · 여유 ${spare.toLocaleString()}</small>
      </span>
    </div>
  `;
  const cableRows = [
    cableItem('1번 랜', c.lan1, c.lan1Net, c.lan1Spare),
    cableItem('숏랜', c.lanShort, c.lanShortNet, c.lanShortSpare, c.lanShortBundles),
    cableItem('1번 파워', c.pwr1, c.pwr1Net, c.pwr1Spare),
    cableItem('숏파워', c.pwrShort, c.pwrShortNet, c.pwrShortSpare, c.pwrShortBundles),
  ];

  bodyEl.innerHTML = `
    <div class="summary-section">
      <div class="summary-section-title">해상도</div>
      ${resRows.length ? resRows.join('') : '<div class="issue-empty">LED 구역이 아직 없습니다</div>'}
    </div>
    <div class="summary-section">
      <div class="summary-section-title">LED 패널</div>
      ${panelRows.length ? panelRows.join('') : '<div class="issue-empty">LED 구역이 아직 없습니다</div>'}
    </div>
    <div class="summary-section">
      <div class="summary-section-title">케이블</div>
      ${cableRows.join('')}
    </div>
  `;
}

function panToNode(nodeId) {
  const node = getNode(nodeId);
  if (!node) { return; }
  const canvasEl = document.getElementById('graphCanvas');
  const rect = canvasEl.getBoundingClientRect();
  State.ui.pan.x = rect.width / 2 - (node.x + CARD_WIDTH / 2) * State.ui.zoom;
  State.ui.pan.y = rect.height / 2 - (node.y + CARD_MIN_HEIGHT / 2) * State.ui.zoom;
  selectNode(nodeId);
  renderNodeCards();
  renderPropertiesPanel();
  render();
}

if (typeof module !== 'undefined') {
  module.exports = {
    runValidation, resolveJ6DualLink, applyAutoJ6DualLink, resolveSendingCardOutput, resolveConsoleOutputInfo,
    resolveConsoleCombinedOutputs, resolveConsoleMosaicOutputs, computeProjectSummary,
  };
}
