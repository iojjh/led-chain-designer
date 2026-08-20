// ── graphOps ────────────────────────────────────────
// 순수 함수: 포트 연결 가능 여부 판정 + 그래프 순회 헬퍼. DOM에 의존하지
// 않고 노드/엣지 배열만 받아 동작하므로 전부 테스트 대상이다.

// 콘솔의 입력 포트 목록은 장비 프리셋에 따라 달라지므로(devices.js) 여기서만
// 예외적으로 그 조회 함수를 가져온다. devices.js는 순수 데이터/함수뿐이라
// 의존해도 순환 참조나 DOM 결합이 생기지 않는다.
if (typeof module !== 'undefined' && typeof getConsoleInputPorts === 'undefined') {
  global.getConsoleInputPorts = require('../devices/devices.js').getConsoleInputPorts;
}

// 타입쌍 허용 규칙 (fromNode.out[fromPortId] → toNode.in[toPortId]):
// - input.out            → console.in* (콘솔의 실제 입력 포트 중 하나 — 장비 스펙에서 파생)
// - console.out          → sending.in  (항상 허용)
//                        → led.in      (콘솔 outputKind가 'lan-ports'일 때만 — 샌딩카드 내장형 콘솔)
// - sending.out          → led.in
// - power.out            → distro.in
// - distro.out           → led.pwrIn
function isPairAllowed(fromNode, fromPortId, toNode, toPortId) {
  const fromType = fromNode.type;
  const toType = toNode.type;

  if (fromType === 'input' && fromPortId === 'out') {
    if (toType !== 'console') { return false; }
    return getConsoleInputPorts(toNode).some(p => p.id === toPortId);
  }
  if (fromType === 'console' && fromPortId === 'out') {
    if (toType === 'sending' && toPortId === 'in') { return true; }
    if (toType === 'led' && toPortId === 'in') {
      const outputKind = (fromNode.config && fromNode.config.outputKind) || 'lan-ports';
      return outputKind === 'lan-ports';
    }
    return false;
  }
  if (fromType === 'sending' && fromPortId === 'out') {
    return toType === 'led' && toPortId === 'in';
  }
  if (fromType === 'power' && fromPortId === 'out') {
    return toType === 'distro' && toPortId === 'in';
  }
  if (fromType === 'distro' && fromPortId === 'out') {
    return toType === 'led' && toPortId === 'pwrIn';
  }
  return false;
}

function edgeExists(edges, fromNodeId, fromPortId, toNodeId, toPortId) {
  return edges.some(e =>
    e.from.nodeId === fromNodeId && e.from.portId === fromPortId &&
    e.to.nodeId === toNodeId && e.to.portId === toPortId
  );
}

// 입력 포트 한 개는 하나의 상류 연결만 받을 수 있다(현실 배선 제약).
function targetPortOccupied(edges, toNodeId, toPortId, ignoreEdgeId) {
  return edges.some(e =>
    e.id !== ignoreEdgeId && e.to.nodeId === toNodeId && e.to.portId === toPortId
  );
}

// LED디스플레이의 입력 포트('in')는 예외적으로 여러 샌딩카드(또는 lan-ports
// 콘솔)를 동시에 받을 수 있다 — 실제 현장에서 큰 화면 하나를 여러 샌딩카드가
// 나눠 담당하는 구성과 일치시키기 위함(캔버스에는 도트 하나로 통합 표시).
// LAN 배선 탭에서 포트를 샌딩카드별로 그룹핑해 보여주는 것도 이 다중 연결을
// 전제로 한다(ledDesignView.js의 resolveLedPortGroups).
function targetAllowsMultiple(toNode, toPortId) {
  return toNode.type === 'led' && toPortId === 'in';
}

function canConnect(graph, fromNodeId, fromPortId, toNodeId, toPortId) {
  if (fromNodeId === toNodeId) { return { ok: false, reason: 'self-loop' }; }
  const fromNode = graph.nodes.find(n => n.id === fromNodeId);
  const toNode = graph.nodes.find(n => n.id === toNodeId);
  if (!fromNode || !toNode) { return { ok: false, reason: 'missing-node' }; }
  if (!isPairAllowed(fromNode, fromPortId, toNode, toPortId)) {
    return { ok: false, reason: 'incompatible-ports' };
  }
  if (edgeExists(graph.edges, fromNodeId, fromPortId, toNodeId, toPortId)) {
    return { ok: false, reason: 'duplicate-edge' };
  }
  if (!targetAllowsMultiple(toNode, toPortId) && targetPortOccupied(graph.edges, toNodeId, toPortId)) {
    return { ok: false, reason: 'target-port-occupied' };
  }
  return { ok: true };
}

function upstreamOf(graph, nodeId) {
  return graph.edges
    .filter(e => e.to.nodeId === nodeId)
    .map(e => graph.nodes.find(n => n.id === e.from.nodeId))
    .filter(Boolean);
}

function downstreamOf(graph, nodeId) {
  return graph.edges
    .filter(e => e.from.nodeId === nodeId)
    .map(e => graph.nodes.find(n => n.id === e.to.nodeId))
    .filter(Boolean);
}

// 특정 노드의 특정 입력 포트로 들어오는 엣지(있다면 하나뿐) 반환.
function incomingEdge(graph, nodeId, portId) {
  return graph.edges.find(e => e.to.nodeId === nodeId && e.to.portId === portId) || null;
}

if (typeof module !== 'undefined') {
  module.exports = {
    isPairAllowed, edgeExists, targetPortOccupied, canConnect,
    upstreamOf, downstreamOf, incomingEdge,
  };
}
