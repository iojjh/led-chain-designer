const {
  panelPx, portPx, isOverCapacity, balancedCols, autoAssignAllZones, autoAssignPwrZones,
  autoAssignAllZonesBalanced, requiredLanPortCount, requiredPwrPortCount,
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

describe('autoAssignAllZonesBalanced', () => {
  // 2행×20열(500x500 패널, 3mm) — 20개의 연속된 열, 열마다 2장씩(각 16,384px) =
  // 열당 32,768px, 전체 655,360px. capPerPort를 넉넉하게 줘서 "용량 때문에
  // 어쩔 수 없이 여러 포트에 나뉘는" 게 아니라 순수하게 균등 배분 로직만 검증한다.
  const wideZone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 2, cols: 20, panelW: 500, panelH: 500 };
  const HUGE_CAP = 999999999;

  function pxInPortRange(assignments, panels, from, to) {
    return assignments.slice(from, to).reduce((sum, keys) => sum + portPx(panels, keys), 0);
  }

  test('two identical cards: total pixel load is split ~evenly, each card gets a contiguous half (not interleaved)', () => {
    const groups = [{ portCount: 8, capPerPort: HUGE_CAP }, { portCount: 8, capPerPort: HUGE_CAP }];
    const assignments = autoAssignAllZonesBalanced([wideZone], groups, null);
    expect(assignments).toHaveLength(16);

    const panels = betaPanels(wideZone);
    const cardAPx = pxInPortRange(assignments, panels, 0, 8);
    const cardBPx = pxInPortRange(assignments, panels, 8, 16);
    const totalPx = panels.reduce((s, p) => s + panelPx(p), 0);

    expect(cardAPx + cardBPx).toBe(totalPx); // 전부 배정됨(누락 없음)
    expect(cardAPx).toBe(totalPx / 2); // 20열이 정확히 반씩 나뉘는 케이스라 딱 절반
    expect(cardBPx).toBe(totalPx / 2);

    // 카드 A에 배정된 패널은 전부 왼쪽 절반 열(x < 10*500)이어야 한다(연속 구간).
    const cardAKeys = new Set(assignments.slice(0, 8).flat());
    panels.filter(p => cardAKeys.has(p.key)).forEach(p => expect(p.x).toBeLessThan(10 * 500));
  });

  test('three identical cards: still roughly even, later cards do not accumulate rounding drift', () => {
    const groups = [
      { portCount: 4, capPerPort: HUGE_CAP },
      { portCount: 4, capPerPort: HUGE_CAP },
      { portCount: 4, capPerPort: HUGE_CAP },
    ];
    const assignments = autoAssignAllZonesBalanced([wideZone], groups, null);
    const panels = betaPanels(wideZone);
    const loads = [
      pxInPortRange(assignments, panels, 0, 4),
      pxInPortRange(assignments, panels, 4, 8),
      pxInPortRange(assignments, panels, 8, 12),
    ];
    const totalPx = panels.reduce((s, p) => s + panelPx(p), 0);
    expect(loads.reduce((a, b) => a + b, 0)).toBe(totalPx);
    // 20열을 3등분하면 정확히 나눠떨어지지 않으니(6.66...), 어느 한쪽에 과도하게
    // 쏠리지 않고 열 하나(32,768px) 오차 이내로 고르게 나뉘어야 한다.
    const maxLoad = Math.max(...loads);
    const minLoad = Math.min(...loads);
    expect(maxLoad - minLoad).toBeLessThanOrEqual(32768);
  });

  test('a single card behaves the same as just giving it everything', () => {
    const groups = [{ portCount: 8, capPerPort: HUGE_CAP }];
    const assignments = autoAssignAllZonesBalanced([wideZone], groups, null);
    const panels = betaPanels(wideZone);
    const totalPx = panels.reduce((s, p) => s + panelPx(p), 0);
    expect(assignments.flat()).toHaveLength(panels.length);
    expect(pxInPortRange(assignments, panels, 0, 8)).toBe(totalPx);
  });

  test('reserved indices (shared-card ports another LED already uses) are respected within each card\'s own range', () => {
    const groups = [{ portCount: 8, capPerPort: HUGE_CAP }, { portCount: 8, capPerPort: HUGE_CAP }];
    // 카드 A(0-7)의 포트 0번, 카드 B(8-15)의 포트 8번이 예약됨.
    const assignments = autoAssignAllZonesBalanced([wideZone], groups, [0, 8]);
    expect(assignments[0]).toEqual([]);
    expect(assignments[8]).toEqual([]);
    const panels = betaPanels(wideZone);
    const totalPx = panels.reduce((s, p) => s + panelPx(p), 0);
    expect(pxInPortRange(assignments, panels, 0, 16)).toBe(totalPx); // 예약된 포트만 피하고 나머지엔 전부 배정
  });

  test('no zones or no groups: all-empty result, no crash', () => {
    expect(autoAssignAllZonesBalanced([], [{ portCount: 4, capPerPort: HUGE_CAP }], null).every(p => p.length === 0)).toBe(true);
    expect(autoAssignAllZonesBalanced([wideZone], [], null)).toEqual([]);
  });
});

describe('requiredLanPortCount', () => {
  test('matches how many ports autoAssignAllZones actually ends up using when given plenty of room', () => {
    const bigZone = { id: 'z2', led: '3mm', startRow: 0, startCol: 0, rows: 8, cols: 8, panelW: 500, panelH: 500 };
    const required = requiredLanPortCount([bigZone], 655360);
    const assignments = autoAssignAllZones([bigZone], 999, 655360);
    const usedPorts = assignments.filter(keys => keys.length > 0).length;
    expect(required).toBe(usedPorts);
  });

  test('zero when there are no zones (or all zones are empty)', () => {
    expect(requiredLanPortCount([], 655360)).toBe(0);
  });

  test('a small zone that fits one port needs exactly one port', () => {
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 4, cols: 4, panelW: 500, panelH: 500 };
    expect(requiredLanPortCount([zone], 655360)).toBe(1);
  });
});

describe('requiredPwrPortCount', () => {
  test('defaults to ceil(totalColumns / 2)', () => {
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 7, panelW: 500, panelH: 500 };
    expect(requiredPwrPortCount([zone])).toBe(4); // 7열 / 2 = 3.5 -> 4
  });

  test('zero when there are no columns', () => {
    expect(requiredPwrPortCount([])).toBe(0);
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

  test('minColsPerPort lets the caller pack 3·4·… columns per port', () => {
    // 12열(1행×12열). 3열/포트 → 4포트, 4열/포트 → 3포트 사용.
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 12, panelW: 500, panelH: 500 };
    const at3 = autoAssignPwrZones([zone], 18, 3);
    const used3 = at3.map((k, i) => (k.length ? i : -1)).filter(i => i !== -1);
    expect(used3).toEqual([0, 1, 2, 3]);
    at3.slice(0, 4).forEach(k => expect(k).toHaveLength(3));

    const at4 = autoAssignPwrZones([zone], 18, 4);
    const used4 = at4.map((k, i) => (k.length ? i : -1)).filter(i => i !== -1);
    expect(used4).toEqual([0, 1, 2]);
    at4.slice(0, 3).forEach(k => expect(k).toHaveLength(4));

    // 빠진 값·이상값이면 기본 2로 폴백
    expect(autoAssignPwrZones([zone], 18).map((k, i) => (k.length ? i : -1)).filter(i => i !== -1)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('minColsPerPort still bumps higher when the fixed port count cannot fit it', () => {
    // 20열 / 포트 4개 + 3열/포트 요청 → 3×4=12 < 20이라 5열/포트로 올라간다.
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 20, panelW: 500, panelH: 500 };
    const assignments = autoAssignPwrZones([zone], 4, 3);
    assignments.forEach(k => expect(k).toHaveLength(5));
    expect(assignments.flat()).toHaveLength(betaPanels(zone).length);
  });
});

describe('requiredPwrPortCount with minColsPerPort', () => {
  test('divides total columns by the requested density', () => {
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 12, panelW: 500, panelH: 500 };
    expect(requiredPwrPortCount([zone], 2)).toBe(6);
    expect(requiredPwrPortCount([zone], 3)).toBe(4);
    expect(requiredPwrPortCount([zone], 4)).toBe(3);
    expect(requiredPwrPortCount([zone])).toBe(6); // 기본 2
  });
});
