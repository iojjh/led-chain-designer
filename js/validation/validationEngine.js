// ── validationEngine ────────────────────────────────
// 그래프를 순회해 영상/랜 경로(입력→콘솔→샌딩카드→LED)의 용량 이슈를 계산하고
// (runValidation) 노드 배지·엣지 색·이슈 패널에 반영한다(renderValidation).
// power/distro 경로는 v1에서 검증하지 않는다(구조만 존재).

function ledRequiredPx(ledNode) {
  return ledNode.config.totalRequiredPx || 0;
}

// sending 또는 led 노드가 실제로 요구하는 픽셀 총량(콘솔 출력 검증에 사용).
function requiredPxOfDownstreamNode(graph, node) {
  if (node.type === 'led') { return ledRequiredPx(node); }
  if (node.type === 'sending') {
    return downstreamOf(graph, node.id)
      .filter(n => n.type === 'led')
      .reduce((sum, n) => sum + ledRequiredPx(n), 0);
  }
  return 0;
}

// 그래프만 받아 이슈 맵을 돌려주는 오케스트레이션 함수. checkConsoleOutput 등
// capacityRules.js의 순수 함수를 호출하지만, 장비 조회(getDevice)와 그래프 순회
// (downstreamOf)는 이 파일에서 수행한다. 인풋소스→콘솔 구간은 해상도를 입력받지
// 않으므로 픽셀 용량 검사가 없다 — 포트 점유(graphOps)만으로 연결 가능 여부가 정해진다.
function runValidation(graph) {
  const nodeIssues = new Map();
  const edgeIssues = new Map();

  function addNodeIssue(nodeId, issue) {
    if (!nodeIssues.has(nodeId)) { nodeIssues.set(nodeId, []); }
    nodeIssues.get(nodeId).push(issue);
  }

  graph.nodes.forEach(node => {
    if (node.type === 'console') {
      const device = node.config.deviceId ? getDevice('console', node.config.deviceId) : null;

      const downstream = downstreamOf(graph, node.id);
      if (downstream.length > 0) {
        const requiredPx = downstream.reduce((sum, n) => sum + requiredPxOfDownstreamNode(graph, n), 0);
        const res = checkConsoleOutput(node.config, device, requiredPx);
        if (!res.ok) { addNodeIssue(node.id, res); }
      }
    }

    if (node.type === 'sending') {
      const device = node.config.deviceId ? getDevice('sending', node.config.deviceId) : null;
      const downstream = downstreamOf(graph, node.id).filter(n => n.type === 'led');
      if (downstream.length > 0) {
        const requiredPx = downstream.reduce((sum, n) => sum + ledRequiredPx(n), 0);
        const res = checkSendingOutput(node.config, device, requiredPx);
        if (!res.ok) { addNodeIssue(node.id, res); }
      }
    }
  });

  return { nodeIssues, edgeIssues };
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
