const { getProjectState, applyProjectState } = require('../js/save/projectState.js');

function sampleState() {
  return {
    graph: {
      version: 1,
      nodes: [
        { id: 'n1', type: 'input', x: 0, y: 0, label: '입력', config: { resolutionW: 1920, resolutionH: 1080, sourceLabel: '노트북' } },
        {
          id: 'n2', type: 'led', x: 200, y: 0, label: 'LED디스플레이',
          config: {
            ledDesign: {
              areaW: 4000, areaH: 2000,
              zones: [{ id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 4, cols: 4, panelW: 500, panelH: 500 }],
              lanPorts: [['z1:0:0']], lanOrder: [['z1:0:0']],
              pwrPorts: [[]], pwrOrder: [[]],
              spareAdj: { l1: 2, sl: 20 },
            },
            totalRequiredPx: 262144,
          },
        },
      ],
      edges: [{ id: 'e1', kind: 'video', from: { nodeId: 'n1', portId: 'out' }, to: { nodeId: 'n2', portId: 'in' } }],
    },
    ui: { selectedId: 'n2', selectedEdgeId: null, pan: { x: 10, y: 20 }, zoom: 1.5 },
  };
}

test('getProjectState captures a name, date, and deep copy of the graph', () => {
  const state = sampleState();
  const snapshot = getProjectState('현장1', state);
  expect(snapshot.name).toBe('현장1');
  expect(typeof snapshot.date).toBe('string');
  expect(snapshot.graph).toEqual(state.graph);
  expect(snapshot.graph).not.toBe(state.graph); // 깊은 복사 — 참조 공유 아님
});

test('round trip through JSON (simulating localStorage) preserves the graph exactly', () => {
  const state = sampleState();
  const snapshot = getProjectState('현장1', state);
  const roundTripped = JSON.parse(JSON.stringify(snapshot));

  const fresh = { graph: { version: 1, nodes: [], edges: [] }, ui: { selectedId: 'stale', selectedEdgeId: 'stale', pan: { x: 0, y: 0 }, zoom: 1 } };
  applyProjectState(fresh, roundTripped);

  expect(fresh.graph).toEqual(state.graph);
});

test('applyProjectState clears the previous selection', () => {
  const fresh = { graph: { version: 1, nodes: [], edges: [] }, ui: { selectedId: 'n1', selectedEdgeId: 'e1', pan: { x: 0, y: 0 }, zoom: 1 } };
  applyProjectState(fresh, { name: 'x', date: '', graph: { version: 1, nodes: [], edges: [] } });
  expect(fresh.ui.selectedId).toBeNull();
  expect(fresh.ui.selectedEdgeId).toBeNull();
});

test('mutating the returned snapshot does not affect the original state graph', () => {
  const state = sampleState();
  const snapshot = getProjectState('현장1', state);
  snapshot.graph.nodes[0].label = '변경됨';
  expect(state.graph.nodes[0].label).toBe('입력');
});
