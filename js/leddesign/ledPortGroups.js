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
  return [{ nodeId: null, portCount: 8, capPerPort: MAX_PX, label: '미연결 — 기본값 사용' }];
}

// 그룹들을 실제 포트 배열 인덱스에 맞춰 펼친 전체 레이아웃 — ports[i]로 i번
// 포트가 어느 그룹(장비) 소속이고 상한이 얼마인지 바로 조회한다.
function resolveLedPortLayout(graph, ledNodeId) {
  const groups = resolveLedPortGroups(graph, ledNodeId);
  const ports = [];
  groups.forEach(g => {
    for (let i = 0; i < g.portCount; i += 1) { ports.push(g); }
  });
  return { groups, ports };
}

if (typeof module !== 'undefined') {
  module.exports = { resolveLedPortGroups, resolveLedPortLayout };
}
