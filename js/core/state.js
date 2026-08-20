// ── state ───────────────────────────────────────────
// 앱 전역 상태는 이 단일 State 객체로만 관리한다. 새 전역 변수 선언 금지.

const State = {
  graph: { version: 1, nodes: [], edges: [] },
  ui: {
    selectedId: null, selectedEdgeId: null, pan: { x: 0, y: 0 }, zoom: 1,
    validation: { nodeIssues: new Map(), edgeIssues: new Map() },
  },
};

function getNode(nodeId) {
  return State.graph.nodes.find(n => n.id === nodeId) || null;
}

function addNode(type, x, y) {
  const node = {
    id: makeId('n'),
    type,
    x, y,
    label: NODE_TYPES[type].label,
    config: defaultConfig(type),
  };
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
}

function selectEdge(edgeId) {
  State.ui.selectedEdgeId = edgeId;
  State.ui.selectedId = null;
}

function addEdge(fromNodeId, fromPortId, toNodeId, toPortId) {
  const check = canConnect(State.graph, fromNodeId, fromPortId, toNodeId, toPortId);
  if (!check.ok) { return null; }
  const fromNode = getNode(fromNodeId);
  const outPort = getPorts(fromNode).out.find(p => p.id === fromPortId);
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
