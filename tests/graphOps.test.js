const { isPairAllowed, canConnect, upstreamOf, downstreamOf, incomingEdge } = require('../js/core/graphOps.js');

function node(id, type, config) {
  return { id, type, x: 0, y: 0, label: type, config: config || {} };
}

describe('isPairAllowed', () => {
  test('input.out -> console.in is allowed', () => {
    expect(isPairAllowed(node('a', 'input'), 'out', node('b', 'console'), 'in')).toBe(true);
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
    expect(canConnect(graph, 'a', 'out', 'a', 'in').ok).toBe(false);
  });

  test('rejects duplicate edge', () => {
    const graph = {
      nodes: [node('a', 'input'), node('b', 'console')],
      edges: [{ id: 'e1', kind: 'video', from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' } }],
    };
    expect(canConnect(graph, 'a', 'out', 'b', 'in').ok).toBe(false);
  });

  test('rejects a second edge into an already-occupied input port', () => {
    const graph = {
      nodes: [node('a', 'input'), node('b', 'console'), node('c', 'input')],
      edges: [{ id: 'e1', kind: 'video', from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' } }],
    };
    expect(canConnect(graph, 'c', 'out', 'b', 'in').ok).toBe(false);
  });

  test('accepts a valid new connection', () => {
    const graph = { nodes: [node('a', 'input'), node('b', 'console')], edges: [] };
    expect(canConnect(graph, 'a', 'out', 'b', 'in').ok).toBe(true);
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
