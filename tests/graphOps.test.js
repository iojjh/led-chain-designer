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

  test('lan-ports console can connect directly to led', () => {
    const c = node('a', 'console', { outputKind: 'lan-ports' });
    expect(isPairAllowed(c, 'out', node('b', 'led'), 'in')).toBe(true);
  });

  test('video-signal console cannot connect directly to led', () => {
    const c = node('a', 'console', { outputKind: 'video-signal' });
    expect(isPairAllowed(c, 'out', node('b', 'led'), 'in')).toBe(false);
  });

  test('video-signal console can still connect to sending', () => {
    const c = node('a', 'console', { outputKind: 'video-signal' });
    expect(isPairAllowed(c, 'out', node('b', 'sending'), 'in')).toBe(true);
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
