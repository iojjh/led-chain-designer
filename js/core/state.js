// ── state ───────────────────────────────────────────
// 앱 전역 상태는 이 단일 State 객체로만 관리한다. 새 전역 변수 선언 금지.

const State = {
  graph: { version: 1, nodes: [], edges: [] },
  ui: {
    selectedId: null, selectedEdgeId: null, pan: { x: 0, y: 0 }, zoom: 1,
    validation: { nodeIssues: new Map(), edgeIssues: new Map(), nodeProvisional: new Set() },
    // 이번 selectNode가 "사용자가 방금 명시적으로 고른 것"인지 표시 — true일 때만
    // renderPropertiesPanel이 닫혀 있던 패널을 강제로 연다(propertiesPanel.js 참고).
    pendingPanelOpen: false,
  },
};

function getNode(nodeId) {
  return State.graph.nodes.find(n => n.id === nodeId) || null;
}

function addNode(type, x, y) {
  const config = defaultConfig(type);
  // 인풋소스는 기본 종류(vmix)에 맞는 라벨로 바로 시작한다 — 그렇지 않으면
  // 드롭다운이 이미 'vmix'를 가리키고 있어 사용자가 처음 그 값을 선택해도
  // change 이벤트가 안 일어나 이름이 영영 '인풋소스'로 남는 버그가 생긴다.
  const label = type === 'input' ? inputKindLabel(config.sourceKind) : NODE_TYPES[type].label;
  const node = { id: makeId('n'), type, x, y, label, config };
  State.graph.nodes.push(node);
  return node;
}

function removeNode(nodeId) {
  State.graph.nodes = State.graph.nodes.filter(n => n.id !== nodeId);
  const stillExists = new Set(State.graph.edges
    .filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId)
    .map(e => e.id));
  if (State.ui.selectedEdgeId && !stillExists.has(State.ui.selectedEdgeId)) {
    State.ui.selectedEdgeId = null;
  }
  State.graph.edges = State.graph.edges.filter(
    e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId
  );
  if (State.ui.selectedId === nodeId) { State.ui.selectedId = null; }
}

function moveNode(nodeId, x, y) {
  const node = getNode(nodeId);
  if (node) { node.x = x; node.y = y; }
}

function selectNode(nodeId) {
  State.ui.selectedId = nodeId;
  State.ui.selectedEdgeId = null;
  if (nodeId) { State.ui.pendingPanelOpen = true; }
}

function selectEdge(edgeId) {
  State.ui.selectedEdgeId = edgeId;
  State.ui.selectedId = null;
}

function addEdge(fromNodeId, fromPortId, toNodeId, toPortId) {
  const check = canConnect(State.graph, fromNodeId, fromPortId, toNodeId, toPortId);
  if (!check.ok) { return null; }
  const fromNode = getNode(fromNodeId);
  // 콘솔의 출력은 캔버스엔 도트 하나(getPorts)로 통합돼 있지만 실제 물리
  // 포트는 여러 개라(devices.js) 엣지 kind는 그 실제 포트 목록에서 찾는다.
  const outPort = fromNode.type === 'console'
    ? getConsoleOutputPorts(fromNode).find(p => p.id === fromPortId)
    : getPorts(fromNode).out.find(p => p.id === fromPortId);
  const edge = {
    id: makeId('e'),
    kind: outPort ? outPort.kind : 'video',
    from: { nodeId: fromNodeId, portId: fromPortId },
    to: { nodeId: toNodeId, portId: toPortId },
  };
  State.graph.edges.push(edge);
  return edge;
}

function removeEdge(edgeId) {
  State.graph.edges = State.graph.edges.filter(e => e.id !== edgeId);
  if (State.ui.selectedEdgeId === edgeId) { State.ui.selectedEdgeId = null; }
}
