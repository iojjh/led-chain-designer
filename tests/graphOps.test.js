const { isPairAllowed, canConnect, upstreamOf, downstreamOf, incomingEdge } = require('../js/core/graphOps.js');

function node(id, type, config) {
  return { id, type, x: 0, y: 0, label: type, config: config || {} };
}

describe('isPairAllowed', () => {
  test('input.out -> console.in1 is allowed (manual-mode console, default 2 generic ports)', () => {
    expect(isPairAllowed(node('a', 'input'), 'out', node('b', 'console'), 'in1')).toBe(true);
  });

  test('input.out -> console with an unknown portId is not allowed', () => {
    expect(isPairAllowed(node('a', 'input'), 'out', node('b', 'console'), 'nope')).toBe(false);
  });

  test('input.out -> a device-preset console\'s real connector slot ids are allowed, others are not', () => {
    // EC90의 HDMI는 4개짜리 커넥터 타입이라 hdmi1-1..hdmi1-4로 펼쳐진다.
    const ec90 = node('b', 'console', { deviceId: 'magnimage-ec90' });
    expect(isPairAllowed(node('a', 'input'), 'out', ec90, 'hdmi1-1')).toBe(true);
    expect(isPairAllowed(node('a', 'input'), 'out', ec90, 'hdmi1-4')).toBe(true);
    expect(isPairAllowed(node('a', 'input'), 'out', ec90, 'hdmi1-5')).toBe(false); // HDMI는 4개뿐
    expect(isPairAllowed(node('a', 'input'), 'out', ec90, 'dp1-1')).toBe(true);
    expect(isPairAllowed(node('a', 'input'), 'out', ec90, 'dvi1-1')).toBe(false); // EC90 has no DVI input
  });

  test('input.out -> sending.in is not allowed', () => {
    expect(isPairAllowed(node('a', 'input'), 'out', node('b', 'sending'), 'in')).toBe(false);
  });

  test('lan-ports console can connect directly to led, via one of its real output ports', () => {
    const c = node('a', 'console', { outputKind: 'lan-ports' });
    expect(isPairAllowed(c, 'out1', node('b', 'led'), 'in')).toBe(true);
  });

  test('video-signal console cannot connect directly to led', () => {
    const c = node('a', 'console', { outputKind: 'video-signal' });
    expect(isPairAllowed(c, 'out1', node('b', 'led'), 'in')).toBe(false);
  });

  test('video-signal console can still connect to sending', () => {
    const c = node('a', 'console', { outputKind: 'video-signal' });
    expect(isPairAllowed(c, 'out1', node('b', 'sending'), 'in')).toBe(true);
  });

  test('console -> sending with an unknown output portId is not allowed', () => {
    const c = node('a', 'console', {});
    expect(isPairAllowed(c, 'nope', node('b', 'sending'), 'in')).toBe(false);
  });

  test('a device-preset console\'s real output port ids are allowed, others are not', () => {
    // J6 splicer 모드는 실제 DVI1~DVI4만 허용, switcher 모드는 dvi2/dvi4가 없음.
    const j6Splicer = node('a', 'console', { deviceId: 'novastar-j6', mode: 'splicer' });
    expect(isPairAllowed(j6Splicer, 'dvi4', node('b', 'sending'), 'in')).toBe(true);
    expect(isPairAllowed(j6Splicer, 'dvi5', node('b', 'sending'), 'in')).toBe(false);

    // switcher 모드(단일 DVI, 기본값)는 dvi1/dvi2/dvi3 모두 허용, dvi4는 없음.
    const j6Switcher = node('a', 'console', { deviceId: 'novastar-j6', mode: 'switcher' });
    expect(isPairAllowed(j6Switcher, 'dvi2', node('b', 'sending'), 'in')).toBe(true);
    expect(isPairAllowed(j6Switcher, 'dvi4', node('b', 'sending'), 'in')).toBe(false);

    // 듀얼링크가 켜지면 dvi2는 dvi1에 합쳐져 사라진다.
    const j6SwitcherDual = node('a', 'console', { deviceId: 'novastar-j6', mode: 'switcher', dviLink: 'dual' });
    expect(isPairAllowed(j6SwitcherDual, 'dvi1', node('b', 'sending'), 'in')).toBe(true);
    expect(isPairAllowed(j6SwitcherDual, 'dvi2', node('b', 'sending'), 'in')).toBe(false);

    // EC90은 실제 출력 채널 4개(pgm1/pgm2/aux1/aux2)만 허용 — A/B는 별개 포트가 아니다.
    const ec90 = node('a', 'console', { deviceId: 'magnimage-ec90' });
    expect(isPairAllowed(ec90, 'aux1', node('b', 'sending'), 'in')).toBe(true);
    expect(isPairAllowed(ec90, '1a', node('b', 'sending'), 'in')).toBe(false);
  });

  test('console -> prompter.in is allowed only via an AUX-flagged output port', () => {
    const j6Switcher = node('a', 'console', { deviceId: 'novastar-j6', mode: 'switcher' });
    expect(isPairAllowed(j6Switcher, 'dvi3', node('b', 'prompter'), 'in')).toBe(true); // DVI3 = AUX
    expect(isPairAllowed(j6Switcher, 'dvi1', node('b', 'prompter'), 'in')).toBe(false); // DVI1 = PGM
    expect(isPairAllowed(j6Switcher, 'dvi2', node('b', 'prompter'), 'in')).toBe(false); // DVI2 = PGM

    const j6Splicer = node('a', 'console', { deviceId: 'novastar-j6', mode: 'splicer' });
    expect(isPairAllowed(j6Splicer, 'dvi1', node('b', 'prompter'), 'in')).toBe(false); // splicer엔 AUX 개념이 없음

    const ec90 = node('a', 'console', { deviceId: 'magnimage-ec90' });
    expect(isPairAllowed(ec90, 'aux1', node('b', 'prompter'), 'in')).toBe(true);
    expect(isPairAllowed(ec90, 'pgm1', node('b', 'prompter'), 'in')).toBe(false);
  });

  test('sending.out -> led.in is allowed', () => {
    expect(isPairAllowed(node('a', 'sending'), 'out', node('b', 'led'), 'in')).toBe(true);
  });

  test('power.out -> distro.in is allowed, power.out -> led is not', () => {
    expect(isPairAllowed(node('a', 'power'), 'out', node('b', 'distro'), 'in')).toBe(true);
    expect(isPairAllowed(node('a', 'power'), 'out', node('b', 'led'), 'pwrIn')).toBe(false);
  });

  test('distro.out -> led.pwrIn is allowed', () => {
    expect(isPairAllowed(node('a', 'distro'), 'out', node('b', 'led'), 'pwrIn')).toBe(true);
  });
});

describe('canConnect', () => {
  test('rejects self-loop', () => {
    const graph = { nodes: [node('a', 'console')], edges: [] };
    expect(canConnect(graph, 'a', 'out', 'a', 'in1').ok).toBe(false);
  });

  test('rejects duplicate edge', () => {
    const graph = {
      nodes: [node('a', 'input'), node('b', 'console')],
      edges: [{ id: 'e1', kind: 'video', from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in1' } }],
    };
    expect(canConnect(graph, 'a', 'out', 'b', 'in1').ok).toBe(false);
  });

  test('rejects a second edge into an already-occupied input port', () => {
    const graph = {
      nodes: [node('a', 'input'), node('b', 'console'), node('c', 'input')],
      edges: [{ id: 'e1', kind: 'video', from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in1' } }],
    };
    expect(canConnect(graph, 'c', 'out', 'b', 'in1').ok).toBe(false);
  });

  test('a second, DIFFERENT input source can connect to a different free port on the same console', () => {
    const graph = {
      nodes: [node('a', 'input'), node('b', 'console'), node('c', 'input')],
      edges: [{ id: 'e1', kind: 'video', from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in1' } }],
    };
    expect(canConnect(graph, 'c', 'out', 'b', 'in2').ok).toBe(true);
  });

  test('accepts a valid new connection', () => {
    const graph = { nodes: [node('a', 'input'), node('b', 'console')], edges: [] };
    expect(canConnect(graph, 'a', 'out', 'b', 'in1').ok).toBe(true);
  });

  test('led.in is an exception — a second, different sending card can still connect to it', () => {
    const graph = {
      nodes: [node('a', 'sending'), node('b', 'led'), node('c', 'sending')],
      edges: [{ id: 'e1', kind: 'lan', from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' } }],
    };
    expect(canConnect(graph, 'c', 'out', 'b', 'in').ok).toBe(true);
  });

  test('led.in still rejects a duplicate edge from the SAME sending card', () => {
    const graph = {
      nodes: [node('a', 'sending'), node('b', 'led')],
      edges: [{ id: 'e1', kind: 'lan', from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' } }],
    };
    expect(canConnect(graph, 'a', 'out', 'b', 'in').ok).toBe(false);
  });
});

describe('graph traversal', () => {
  const graph = {
    nodes: [node('a', 'input'), node('b', 'console'), node('c', 'sending')],
    edges: [
      { id: 'e1', kind: 'video', from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' } },
      { id: 'e2', kind: 'lan', from: { nodeId: 'b', portId: 'out' }, to: { nodeId: 'c', portId: 'in' } },
    ],
  };

  test('upstreamOf finds direct predecessors', () => {
    expect(upstreamOf(graph, 'b').map(n => n.id)).toEqual(['a']);
  });

  test('downstreamOf finds direct successors', () => {
    expect(downstreamOf(graph, 'b').map(n => n.id)).toEqual(['c']);
  });

  test('incomingEdge finds the edge feeding a specific port', () => {
    expect(incomingEdge(graph, 'c', 'in').id).toBe('e2');
    expect(incomingEdge(graph, 'c', 'missing')).toBeNull();
  });
});
