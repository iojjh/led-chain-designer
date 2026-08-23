// ── validationEngine ────────────────────────────────
// 그래프를 순회해 영상/랜 경로(입력→콘솔→샌딩카드→LED)의 용량 이슈를 계산하고
// (runValidation) 노드 배지·엣지 색·이슈 패널에 반영한다(renderValidation).
// power/distro 경로는 v1에서 검증하지 않는다(구조만 존재).

if (typeof module !== 'undefined' && typeof resolveLedPortLayout === 'undefined') {
  global.resolveLedPortLayout = require('../leddesign/ledPortGroups.js').resolveLedPortLayout;
  global.betaPanels = require('../leddesign/betaPanels.js').betaPanels;
  global.panelPx = require('../leddesign/portAssignment.js').panelPx;
  global.downstreamOf = require('../core/graphOps.js').downstreamOf;
  global.getDevice = require('../devices/devices.js').getDevice;
  global.checkConsoleOutput = require('./capacityRules.js').checkConsoleOutput;
  global.checkSendingOutput = require('./capacityRules.js').checkSendingOutput;
  global.checkSendingInput = require('./capacityRules.js').checkSendingInput;
  global.checkConsoleSingleOutput = require('./capacityRules.js').checkConsoleSingleOutput;
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

function hasZones(ledNode) {
  return !!(ledNode.config.ledDesign.zones && ledNode.config.ledDesign.zones.length);
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

    if (node.type === 'console') {
      const device = node.config.deviceId ? getDevice('console', node.config.deviceId) : null;

      const downstream = downstreamOf(graph, node.id);
      if (downstream.length > 0) {
        const requiredPx = downstream.reduce((sum, n) => sum + requiredPxOfDownstreamNode(graph, n), 0);
        const res = checkConsoleOutput(node.config, device, requiredPx);
        if (!res.ok) { addNodeIssue(node.id, res); }

        // 합산 용량은 남아돌아도 특정 연결 하나가 커넥터 1개의 상한을 넘을 수
        // 있으므로, 하류 장비별로 개별 확인한다(checkConsoleOutput과 별개).
        downstream.forEach(n => {
          const singlePx = requiredPxOfDownstreamNode(graph, n);
          const singleRes = checkConsoleSingleOutput(device, singlePx);
          if (!singleRes.ok) { addNodeIssue(node.id, { ...singleRes, message: `${n.label} 방향: ${singleRes.message}` }); }
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
  module.exports = { runValidation };
}
