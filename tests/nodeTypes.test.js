const { NODE_ORDER, INPUT_KINDS, inputKindLabel, defaultConfig, getPorts } = require('../js/core/nodeTypes.js');

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

test('console always shows exactly one visual input port, regardless of device/manual config', () => {
  // 실제 물리 포트가 몇 개든(장비 프리셋 또는 manualInputPorts) 캔버스에는 입력
  // 도트를 하나로 통합해 보여준다 — 어떤 물리 포트로 연결됐는지는
  // devices.js의 getConsoleInputPorts + 엣지의 portId로 별도 관리된다.
  const manual = getPorts({ type: 'console', config: {} });
  expect(manual.in.map(p => p.id)).toEqual(['in']);

  const withDevice = getPorts({ type: 'console', config: { deviceId: 'novastar-j6' } });
  expect(withDevice.in.map(p => p.id)).toEqual(['in']);
});

test('INPUT_KINDS covers vmix/resolume/ppt/relay/etc and inputKindLabel resolves them', () => {
  expect(INPUT_KINDS.map(k => k.id)).toEqual(['vmix', 'resolume', 'ppt', 'relay', 'etc']);
  expect(inputKindLabel('vmix')).toBe('vMix');
  expect(inputKindLabel('unknown-kind')).toBe('인풋소스');
});

test('input default config starts as vmix kind', () => {
  expect(defaultConfig('input').sourceKind).toBe('vmix');
});

test('led node has no output ports (sink)', () => {
  const ports = getPorts({ type: 'led', config: {} });
  expect(ports.out).toHaveLength(0);
  expect(ports.in.map(p => p.id)).toEqual(['in', 'pwrIn']);
});
