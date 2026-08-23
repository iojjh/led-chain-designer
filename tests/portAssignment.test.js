const {
  panelPx, portPx, isOverCapacity, balancedCols, autoAssignAllZones, autoAssignPwrZones,
} = require('../js/leddesign/portAssignment.js');
const { betaPanels } = require('../js/leddesign/betaPanels.js');

test('panelPx: 3mm 500x500 panel uses px500 resolution directly', () => {
  expect(panelPx({ led: '3mm', w: 500, h: 500 })).toBe(128 * 128);
});

test('panelPx: 3mm 500x1000 panel uses px1000 height', () => {
  expect(panelPx({ led: '3mm', w: 500, h: 1000 })).toBe(128 * 256);
});

test('panelPx: unknown LED pitch returns 0', () => {
  expect(panelPx({ led: 'nope', w: 500, h: 500 })).toBe(0);
});

test('portPx sums panel px for the given keys', () => {
  const panels = [
    { key: 'a', led: '3mm', w: 500, h: 500 },
    { key: 'b', led: '3mm', w: 500, h: 500 },
  ];
  expect(portPx(panels, ['a', 'b'])).toBe(2 * 128 * 128);
});

test('isOverCapacity is strict (equal to cap is not over)', () => {
  expect(isOverCapacity(100, 100)).toBe(false);
  expect(isOverCapacity(101, 100)).toBe(true);
});

describe('balancedCols', () => {
  test('single port takes everything', () => {
    expect(balancedCols(7, 1, 10, 10)).toEqual([7]);
  });

  test('evenly divisible splits equally', () => {
    expect(balancedCols(6, 3, 10, 10)).toEqual([2, 2, 2]);
  });

  test('always returns numPorts entries summing to total', () => {
    for (let total = 1; total <= 20; total += 1) {
      for (let ports = 1; ports <= 5; ports += 1) {
        const takes = balancedCols(total, ports, 10, 10);
        expect(takes).toHaveLength(ports);
        expect(takes.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
});

describe('autoAssignAllZones', () => {
  const zone = {
    id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 4, cols: 4, panelW: 500, panelH: 500,
  };

  test('every panel of a single zone is assigned exactly once when a port is available', () => {
    const assignments = autoAssignAllZones([zone], 8, 655360);
    const panels = betaPanels(zone);
    const assignedKeys = assignments.flat();
    expect(assignedKeys).toHaveLength(panels.length);
    expect(new Set(assignedKeys).size).toBe(panels.length);
  });

  test('with ample ports/capacity, no port exceeds the per-port cap', () => {
    const bigZone = {
      id: 'z2', led: '3mm', startRow: 0, startCol: 0, rows: 8, cols: 8, panelW: 500, panelH: 500,
    };
    const assignments = autoAssignAllZones([bigZone], 16, 655360);
    const panels = betaPanels(bigZone);
    assignments.forEach(keys => {
      expect(isOverCapacity(portPx(panels, keys), 655360)).toBe(false);
    });
  });

  test('with zero available ports, nothing is assigned', () => {
    const assignments = autoAssignAllZones([zone], 0, 655360);
    expect(assignments.flat()).toHaveLength(0);
  });

  test('reserved indices (already used by another LED sharing the same card) are never written to, and assignment continues into the next free port', () => {
    const assignments = autoAssignAllZones([zone], 8, 655360, [0, 1, 2]);
    expect(assignments[0]).toEqual([]);
    expect(assignments[1]).toEqual([]);
    expect(assignments[2]).toEqual([]);
    const panels = betaPanels(zone);
    const assignedKeys = assignments.flat();
    expect(assignedKeys).toHaveLength(panels.length);
    expect(new Set(assignedKeys).size).toBe(panels.length);
  });
});

describe('autoAssignPwrZones', () => {
  test('defaults to 2 columns per port when the fixed port count is enough', () => {
    // 4열(4×4 500×500 패널) / 8포트 — 2열/포트면 2포트만으로 다 담긴다.
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 4, cols: 4, panelW: 500, panelH: 500 };
    const assignments = autoAssignPwrZones([zone], 8);
    const usedPorts = assignments.map((keys, i) => (keys.length ? i : -1)).filter(i => i !== -1);
    expect(usedPorts).toEqual([0, 1]);
    assignments.slice(0, 2).forEach(keys => expect(keys).toHaveLength(8)); // 열 하나당 4개 패널(rows=4) × 2열

    const panels = betaPanels(zone);
    const assignedKeys = assignments.flat();
    expect(assignedKeys).toHaveLength(panels.length);
    expect(new Set(assignedKeys).size).toBe(panels.length);
  });

  test('bumps columns per port beyond 2 when the fixed port count cannot fit everything at 2/port', () => {
    // 6열(1행×6열) / 포트 2개 — 2열/포트로는 4열까지밖에 못 담으므로 3열/포트로 늘어나야 함.
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 6, panelW: 500, panelH: 500 };
    const assignments = autoAssignPwrZones([zone], 2);
    expect(assignments).toHaveLength(2);
    expect(assignments[0]).toHaveLength(3); // 3열 × 1행
    expect(assignments[1]).toHaveLength(3);

    const panels = betaPanels(zone);
    const assignedKeys = assignments.flat();
    expect(assignedKeys).toHaveLength(panels.length); // 전부 배정(누락 없음)
    expect(new Set(assignedKeys).size).toBe(panels.length);
  });

  test('never writes into a port index beyond portCount even when columns divide unevenly', () => {
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 7, panelW: 500, panelH: 500 };
    const assignments = autoAssignPwrZones([zone], 3);
    expect(assignments).toHaveLength(3);
    const panels = betaPanels(zone);
    expect(assignments.flat()).toHaveLength(panels.length);
  });

  test('zero zones or zero ports: all ports come back empty, no crash', () => {
    expect(autoAssignPwrZones([], 18).every(p => p.length === 0)).toBe(true);
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 2, cols: 2, panelW: 500, panelH: 500 };
    expect(autoAssignPwrZones([zone], 0)).toEqual([]);
  });
});
