// ── graphOps ────────────────────────────────────────
// 순수 함수: 포트 연결 가능 여부 판정 + 그래프 순회 헬퍼. DOM에 의존하지
// 않고 노드/엣지 배열만 받아 동작하므로 전부 테스트 대상이다.

// 콘솔의 입력 포트 목록은 장비 프리셋에 따라 달라지므로(devices.js) 여기서만
// 예외적으로 그 조회 함수를 가져온다. devices.js는 순수 데이터/함수뿐이라
// 의존해도 순환 참조나 DOM 결합이 생기지 않는다.
if (typeof module !== 'undefined' && typeof getConsoleInputPorts === 'undefined') {
  global.getConsoleInputPorts = require('../devices/devices.js').getConsoleInputPorts;
}
if (typeof module !== 'undefined' && typeof getConsoleOutputPorts === 'undefined') {
  global.getConsoleOutputPorts = require('../devices/devices.js').getConsoleOutputPorts;
}

// 타입쌍 허용 규칙 (fromNode.out[fromPortId] → toNode.in[toPortId]):
// - input.out            → console.in*  (콘솔의 실제 입력 포트 중 하나 — 장비 스펙에서 파생)
// - console.out*         → sending.in   (콘솔의 실제 출력 포트 중 하나면 항상 허용)
//                        → led.in       (콘솔 outputKind가 'lan-ports'일 때만 — 샌딩카드 내장형 콘솔)
//                        → prompter.in  (그 출력 포트가 AUX일 때만 — devices.js의 aux 플래그)
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
  if (fromType === 'console') {
    const port = getConsoleOutputPorts(fromNode).find(p => p.id === fromPortId);
    if (!port) { return false; }
    if (toType === 'sending' && toPortId === 'in') { return true; }
    if (toType === 'led' && toPortId === 'in') {
      const outputKind = (fromNode.config && fromNode.config.outputKind) || 'lan-ports';
      return outputKind === 'lan-ports';
    }
    if (toType === 'prompter' && toPortId === 'in') { return !!port.aux; }
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

// 콘솔 출력 포트 중 mirror 필드가 같은 것끼리는 항상 같은 신호를 내보내는
// "미러" 쌍이다(devices.js — 메인/백업 A·B, EC100 AUX 스위처 모드의 1/2·3/4
// 등). 같은 화면을 두 군데로 "복제"해 내보내는 용도로는 미러 쌍을 각각 다른
// 목적지에 연결해도 되지만, 샌딩카드 두 대가 하나의 LED를 나눠 담당하는
// 상황(서로 다른 화면 조각을 받아야 함)에서 그 두 샌딩카드에 같은 미러 쌍을
// 하나씩 물리면 둘 다 똑같은 신호를 받게 돼 화면을 나눌 수 없다 — 그런
// 조합만 걸러낸다(사용자 확인, 2026-08-26). 이 잘못된 조합은 어느 쪽 엣지를
// 나중에 잇느냐에 따라 두 가지 순서로 만들어질 수 있어 둘 다 막아야 한다:
// (1) 두 샌딩카드가 이미 같은 LED에 연결된 상태에서 콘솔→샌딩카드 미러 포트를
//     나중에 잇는 경우, (2) 콘솔→샌딩카드 미러 포트를 먼저 다 이어둔 뒤 두
//     샌딩카드를 나중에 같은 LED에 연결하는 경우 — (2)를 놓치면 "반쪽짜리
//     검증"이 된다(사용자 지적, 2026-08-26).
function mirrorPortConflict(graph, fromNode, fromPortId, toNode) {
  if (fromNode.type === 'console' && toNode.type === 'sending') {
    return consoleToSendingMirrorConflict(graph, fromNode, fromPortId, toNode);
  }
  if (fromNode.type === 'sending' && toNode.type === 'led') {
    return sendingToLedMirrorConflict(graph, fromNode, toNode);
  }
  return false;
}

// 순서 (1): 콘솔의 미러 포트(fromPortId)를 지금 이으려는 샌딩카드(toNode)가
// 이미 어떤 LED로 연결돼 있고, 그 LED에 같은 콘솔의 미러 형제 포트로 연결된
// 다른 샌딩카드가 이미 있으면 막는다.
function consoleToSendingMirrorConflict(graph, consoleNode, portId, sendingNode) {
  const ports = getConsoleOutputPorts(consoleNode);
  const port = ports.find(p => p.id === portId);
  if (!port || !port.mirror) { return false; }
  const siblingIds = new Set(ports.filter(p => p.mirror === port.mirror && p.id !== portId).map(p => p.id));
  if (!siblingIds.size) { return false; }
  const ledIds = new Set(downstreamOf(graph, sendingNode.id).filter(n => n.type === 'led').map(n => n.id));
  if (!ledIds.size) { return false; }
  return graph.edges.some(e => {
    if (e.from.nodeId !== consoleNode.id || !siblingIds.has(e.from.portId)) { return false; }
    const otherNode = graph.nodes.find(n => n.id === e.to.nodeId);
    if (!otherNode || otherNode.type !== 'sending' || otherNode.id === sendingNode.id) { return false; }
    const otherLedIds = downstreamOf(graph, otherNode.id).filter(n => n.type === 'led').map(n => n.id);
    return otherLedIds.some(id => ledIds.has(id));
  });
}

// 순서 (2): 지금 이으려는 샌딩카드(sendingNode)가 이미 어떤 콘솔 출력 포트에
// 물려 있고, 그 포트의 미러 형제 포트로 연결된 다른 샌딩카드가 이미 같은
// LED(ledNode)에 연결돼 있으면 막는다 — consoleToSendingMirrorConflict와
// 정확히 대칭(어느 엣지가 먼저 생겼는지만 다름)이지만, 이번엔 "콘솔→샌딩"이
// 아니라 "샌딩→LED" 엣지를 이으려는 시점에 판정해야 하므로 콘솔 포트 정보를
// 샌딩카드의 기존 상류 엣지에서 거꾸로 찾는다.
function sendingToLedMirrorConflict(graph, sendingNode, ledNode) {
  const upstream = incomingEdge(graph, sendingNode.id, 'in');
  if (!upstream) { return false; }
  const consoleNode = graph.nodes.find(n => n.id === upstream.from.nodeId);
  if (!consoleNode || consoleNode.type !== 'console') { return false; }
  const ports = getConsoleOutputPorts(consoleNode);
  const port = ports.find(p => p.id === upstream.from.portId);
  if (!port || !port.mirror) { return false; }

  const otherSendingIds = graph.edges
    .filter(e => e.to.nodeId === ledNode.id && e.from.nodeId !== sendingNode.id)
    .map(e => e.from.nodeId);
  return otherSendingIds.some(otherId => {
    const otherUpstream = incomingEdge(graph, otherId, 'in');
    if (!otherUpstream || otherUpstream.from.nodeId !== consoleNode.id) { return false; }
    const otherPort = ports.find(p => p.id === otherUpstream.from.portId);
    return !!otherPort && otherPort.mirror === port.mirror;
  });
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
  if (mirrorPortConflict(graph, fromNode, fromPortId, toNode)) {
    return { ok: false, reason: 'mirror-port-conflict' };
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
    isPairAllowed, edgeExists, targetPortOccupied, mirrorPortConflict, canConnect,
    upstreamOf, downstreamOf, incomingEdge,
  };
}
