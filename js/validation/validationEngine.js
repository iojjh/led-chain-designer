// ── validationEngine ────────────────────────────────
// 그래프를 순회해 영상/랜 경로(입력→콘솔→샌딩카드→LED)의 용량 이슈를 계산하고
// (runValidation) 노드 배지·엣지 색·이슈 패널에 반영한다(renderValidation).
// power/distro 경로는 v1에서 검증하지 않는다(구조만 존재).

if (typeof module !== 'undefined' && typeof resolveLedPortLayout === 'undefined') {
  global.resolveLedPortLayout = require('../leddesign/ledPortGroups.js').resolveLedPortLayout;
  global.betaPanels = require('../leddesign/betaPanels.js').betaPanels;
  global.boundingResolutionForZones = require('../leddesign/ledAreaSetup.js').boundingResolutionForZones;
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

// 샌딩카드 하나가 LED 하나에 대해 실제로 담당하는 픽셀 — LED의 LAN 포트 배정에서
// 그 카드 소속 포트(ledPortGroups.js 그룹 순서)에 배정된 패널만 합산한다. 샌딩카드
// 여러 대가 LED 하나를 나눠 담당할 수 있으므로(graphOps.js targetAllowsMultiple),
// 카드별 실제 부담을 반영해야 불필요한 초과 경고를 피할 수 있다. 아직 포트 배정
// 배열이 현재 그래프 구성(연결/해제 직후 등)과 맞지 않으면 배정 전이라 판단 불가 —
// 이때는 보수적으로 LED 전체 요구량을 반환한다.
function pxAssignedToSendingCard(graph, ledNode, sendingNodeId) {
  const cfg = ledNode.config.ledDesign;
  const layout = resolveLedPortLayout(graph, ledNode.id);
  const lanPorts = cfg.lanPorts;
  if (!lanPorts || lanPorts.length !== layout.ports.length) { return ledRequiredPx(ledNode); }

  const panels = cfg.zones.flatMap(z => betaPanels(z));
  let total = 0;
  layout.ports.forEach((group, idx) => {
    if (group.nodeId !== sendingNodeId) { return; }
    (lanPorts[idx] || []).forEach(key => {
      const panel = panels.find(p => p.key === key);
      if (panel) { total += panelPx(panel); }
    });
  });
  return total;
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
// 주사율(사용자 요청, 2026-08-26). LED 전체 픽셀 해상도는 LED 카드 요약에도
// 쓰는 boundingResolutionForZones(ledAreaSetup.js)를 그대로 재사용한다(구역
// 바운딩 박스 기준 — 피치가 섞여 있으면 null). 같은 LED에 샌딩카드가 여러 대
// 연결돼 있으면 가로로 균등 분할한 걸로 근사한다(정확한 열 배정 비율이 아니라
// "카드 수만큼 반으로/N등분" — 사용자가 명시적으로 요청한 단순화). 주사율은
// 상류 콘솔의 실제 출력 해상도 표(device.outputResolutionTable)에서 이
// 픽셀수를 감당하는 최대 Hz를 찾아 정한다 — 콘솔이 없거나 장비 프리셋이
// 없으면(수동 모드) 주사율은 판단 불가.
function resolveSendingCardOutput(graph, sendingNode) {
  const ledNode = downstreamOf(graph, sendingNode.id).find(n => n.type === 'led' && hasZones(n));
  if (!ledNode) { return null; }

  const full = boundingResolutionForZones(ledNode.config.ledDesign.zones);
  if (!full || full.w === 0 || full.h === 0) { return null; }
  const cardCount = upstreamOf(graph, ledNode.id).filter(n => n.type === 'sending').length || 1;
  const w = Math.floor(full.w / cardCount);
  const h = full.h;

  const consoleNode = upstreamOf(graph, sendingNode.id).find(n => n.type === 'console');
  const device = consoleNode && consoleNode.config.deviceId ? getDevice('console', consoleNode.config.deviceId) : null;
  const hz = (device && device.outputResolutionTable) ? maxHzForPx(device.outputResolutionTable, w * h) : null;

  return { w, h, hz };
}

// 콘솔의 출력 포트별로, 그 포트가 실제로 물려 있는 샌딩카드가 내보내는
// 해상도·최대 Hz를 계산한다(사용자 요청, 2026-08-26) — resolveSendingCardOutput을
// 그대로 재사용하므로(그 함수가 이미 상류 콘솔의 outputResolutionTable로 Hz를
// 정함) 샌딩카드 카드에 표시되는 값과 항상 일치한다. 프롬프터로 연결된 포트는
// 샌딩카드가 없어 대상에서 빠지고, 아직 LED 해상도가 안 잡혔거나 샌딩카드가
// 없는 포트도 결과에서 빠진다(콘솔 자체가 여러 포트를 동시에 쓸 수 있어 배열로
// 반환 — 샌딩카드는 한 대만 연결되는 게 보통이라 배열이 아니었던 것과 다름).
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
      return { portId: e.from.portId, portLabel: port ? port.label : e.from.portId, w: out.w, h: out.h, hz: out.hz };
    })
    .filter(Boolean);
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
}

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
  };
}
