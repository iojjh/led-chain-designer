// ── ledPortGroups ───────────────────────────────────
// LED디스플레이 노드의 LAN 포트를 상류에 연결된 샌딩카드(또는 lan-ports 콘솔)
// 단위로 그룹핑하는 순수 함수. LED디스플레이 하나에 샌딩카드 여러 대가 동시에
// 연결될 수 있으므로(graphOps.js의 targetAllowsMultiple), ledDesignView.js(포트
// 배정 UI에서 카드별로 나눠 표시)와 validationEngine.js(카드별 실제 담당 픽셀
// 계산)가 이 로직을 공유한다.

if (typeof module !== 'undefined' && typeof getDevice === 'undefined') {
  global.getDevice = require('../devices/devices.js').getDevice;
  global.upstreamOf = require('../core/graphOps.js').upstreamOf;
  global.MAX_PX = require('./specs.js').MAX_PX;
}

// 연결된 샌딩카드마다(캔버스에 세로로 쌓인 순서, 위→아래) 그 장비의 실제 포트
// 수·포트당 픽셀 상한으로 그룹을 하나씩 만든다. 샌딩카드가 하나도 없고
// lan-ports 콘솔이 직결돼 있으면 그 콘솔 하나를 그룹으로 쓰고, 아무 것도
// 연결돼 있지 않으면 기본값 그룹 하나를 반환한다.
function resolveLedPortGroups(graph, ledNodeId) {
  const upstream = upstreamOf(graph, ledNodeId);
  const sendingNodes = upstream.filter(n => n.type === 'sending').sort((a, b) => a.y - b.y);

  if (sendingNodes.length > 0) {
    return sendingNodes.map(n => {
      const device = n.config.deviceId ? getDevice('sending', n.config.deviceId) : null;
      return device
        ? { nodeId: n.id, portCount: device.portCount, capPerPort: device.perPortMaxPx8bit, label: `${device.vendor} ${device.name}` }
        : { nodeId: n.id, portCount: n.config.portCount || 8, capPerPort: n.config.perPortMaxPx || MAX_PX, label: '샌딩카드 (수동 설정)' };
    });
  }
  const consoleNode = upstream.find(n => n.type === 'console');
  if (consoleNode) {
    const device = consoleNode.config.deviceId ? getDevice('console', consoleNode.config.deviceId) : null;
    return [device
      ? { nodeId: consoleNode.id, portCount: device.outputs.portCount, capPerPort: device.outputs.perPortMaxPx8bit, label: `${device.vendor} ${device.name} (직결)` }
      : { nodeId: consoleNode.id, portCount: 8, capPerPort: MAX_PX, label: '콘솔 (수동 설정, 직결)' }];
  }
  // 아무 것도 연결돼 있지 않을 때의 기본 포트 수는 보통 8이지만, 자동 배정이
  // 이미 그보다 많은 포트가 필요하다고 확인해둔 적 있으면(requiredLanPorts,
  // nodeTypes.js 참고) 그 값을 그대로 쓴다 — 자동 배정이 "포트가 모자라서
  // 일부 패널을 못 담는" 대신 포트 수 자체를 늘려 전부 담을 수 있게 하기 위함
  // (ledDesignView.js의 autoAssignLanForLedNode).
  const ledNode = graph.nodes.find(n => n.id === ledNodeId);
  const cfg = ledNode && ledNode.config && ledNode.config.ledDesign;
  const portCount = (cfg && cfg.requiredLanPorts) || 8;
  return [{ nodeId: null, portCount, capPerPort: MAX_PX, label: '미연결 — 기본값 사용' }];
}

// 그룹들을 실제 포트 배열 인덱스에 맞춰 펼친 전체 레이아웃 — ports[i]로 i번
// 포트가 어느 그룹(장비) 소속이고 상한이 얼마인지 바로 조회한다. portIndexInGroup은
// 그 장비 안에서 몇 번째 물리 포트인지(카드 자체의 슬롯 번호) — nodeId와 묶으면
// "실제 어느 케이블 구멍인지"가 정해지므로, 같은 샌딩카드를 공유하는 다른
// LED디스플레이의 포트와 대조할 때(resolveSharedPortUsage) 이 값으로 매칭한다.
function resolveLedPortLayout(graph, ledNodeId) {
  const groups = resolveLedPortGroups(graph, ledNodeId);
  const ports = [];
  groups.forEach(g => {
    for (let i = 0; i < g.portCount; i += 1) { ports.push({ ...g, portIndexInGroup: i }); }
  });
  return { groups, ports };
}

// 하나의 샌딩카드(또는 lan-ports 콘솔)에 LED디스플레이가 2개 이상 연결된 경우,
// 물리적으로 같은 포트(같은 nodeId + portIndexInGroup)를 다른 LED디스플레이가
// 이미 배정에 쓰고 있는지 조회한다. 반환값은 이 LED디스플레이 자신의
// layout.ports와 같은 길이 — 각 자리에 그 포트를 실제로 쓰고 있는 "다른"
// LED디스플레이 정보(있다면 { ledNodeId, label, panelKeys }) 또는 null.
// 미연결 기본값 그룹(nodeId===null)은 애초에 공유 대상 장비가 없으므로 제외.
function resolveSharedPortUsage(graph, ledNodeId) {
  const layout = resolveLedPortLayout(graph, ledNodeId);
  const otherLedNodes = graph.nodes.filter(n => n.type === 'led' && n.id !== ledNodeId);
  const otherLayouts = otherLedNodes.map(n => ({ node: n, layout: resolveLedPortLayout(graph, n.id) }));

  return layout.ports.map(port => {
    if (!port.nodeId) { return null; }
    for (const other of otherLayouts) {
      const idx = other.layout.ports.findIndex(p => p.nodeId === port.nodeId && p.portIndexInGroup === port.portIndexInGroup);
      if (idx === -1) { continue; }
      const otherCfg = other.node.config && other.node.config.ledDesign;
      const panelKeys = (otherCfg && otherCfg.lanPorts && otherCfg.lanPorts[idx]) || [];
      if (panelKeys.length > 0) {
        return { ledNodeId: other.node.id, label: other.node.label || 'LED디스플레이', panelKeys };
      }
    }
    return null;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { resolveLedPortGroups, resolveLedPortLayout, resolveSharedPortUsage };
}
