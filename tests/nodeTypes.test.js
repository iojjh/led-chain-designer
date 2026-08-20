const { NODE_ORDER, defaultConfig, getPorts } = require('../js/core/nodeTypes.js');

test('defaultConfig returns a config object for every node type', () => {
  NODE_ORDER.forEach(type => {
    expect(typeof defaultConfig(type)).toBe('object');
  });
});

test('led default config carries an empty ledDesign shape', () => {
  const cfg = defaultConfig('led');
  expect(cfg.ledDesign.zones).toEqual([]);
  expect(cfg.totalRequiredPx).toBe(0);
});

test('input node has one output port and no input ports', () => {
  const ports = getPorts({ type: 'input', config: {} });
  expect(ports.in).toHaveLength(0);
  expect(ports.out).toHaveLength(1);
});

test('console output port kind follows outputKind config', () => {
  const lan = getPorts({ type: 'console', config: { outputKind: 'lan-ports' } });
  expect(lan.out[0].kind).toBe('lan');

  const video = getPorts({ type: 'console', config: { outputKind: 'video-signal' } });
  expect(video.out[0].kind).toBe('video');
});

test('led node has no output ports (sink)', () => {
  const ports = getPorts({ type: 'led', config: {} });
  expect(ports.out).toHaveLength(0);
  expect(ports.in.map(p => p.id)).toEqual(['in', 'pwrIn']);
});
