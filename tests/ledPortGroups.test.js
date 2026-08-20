const { resolveLedPortGroups, resolveLedPortLayout } = require('../js/leddesign/ledPortGroups.js');
const { MAX_PX } = require('../js/leddesign/specs.js');

function node(id, type, config, y) {
  return { id, type, x: 0, y: y || 0, label: type, config: config || {} };
}

test('no upstream device: falls back to one default group', () => {
  const graph = { nodes: [node('led1', 'led')], edges: [] };
  const groups = resolveLedPortGroups(graph, 'led1');
  expect(groups).toEqual([{ nodeId: null, portCount: 8, capPerPort: MAX_PX, label: '미연결 — 기본값 사용' }]);
});

test('single sending card preset: one group sized to the device spec', () => {
  const graph = {
    nodes: [node('s1', 'sending', { deviceId: 'novastar-mctrl4k' }), node('led1', 'led')],
    edges: [{ id: 'e1', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } }],
  };
  const groups = resolveLedPortGroups(graph, 'led1');
  expect(groups).toEqual([{ nodeId: 's1', portCount: 16, capPerPort: 655360, label: 'NovaStar MCTRL4K (내장 샌딩 포트)' }]);
});

test('two sending cards feeding the same LED: one group per card, ordered top-to-bottom (y)', () => {
  const graph = {
    nodes: [
      node('sBottom', 'sending', { deviceId: 'novastar-mctrl660pro' }, 200),
      node('sTop', 'sending', { deviceId: 'novastar-mctrl4k' }, 50),
      node('led1', 'led'),
    ],
    edges: [
      { id: 'e1', kind: 'lan', from: { nodeId: 'sBottom', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      { id: 'e2', kind: 'lan', from: { nodeId: 'sTop', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
    ],
  };
  const groups = resolveLedPortGroups(graph, 'led1');
  expect(groups.map(g => g.nodeId)).toEqual(['sTop', 'sBottom']);
  expect(groups[0].portCount).toBe(16);
  expect(groups[1].portCount).toBe(6);

  const layout = resolveLedPortLayout(graph, 'led1');
  expect(layout.ports.length).toBe(22);
  expect(layout.ports[0].nodeId).toBe('sTop');
  expect(layout.ports[15].nodeId).toBe('sTop');
  expect(layout.ports[16].nodeId).toBe('sBottom');
  expect(layout.ports[21].nodeId).toBe('sBottom');
});

test('no sending card but a lan-ports console directly connected: console becomes the single group', () => {
  // 콘솔 프리셋(J6/EC90)은 모두 outputKind가 video-signal이라 lan-ports 직결 시나리오는
  // 실제로는 수동 설정된 콘솔에서만 발생한다 — 여기서는 그 경우를 검증한다.
  const graph = {
    nodes: [node('c1', 'console', { outputKind: 'lan-ports' }), node('led1', 'led')],
    edges: [{ id: 'e1', kind: 'lan', from: { nodeId: 'c1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } }],
  };
  const groups = resolveLedPortGroups(graph, 'led1');
  expect(groups).toEqual([{ nodeId: 'c1', portCount: 8, capPerPort: MAX_PX, label: '콘솔 (수동 설정, 직결)' }]);
});
