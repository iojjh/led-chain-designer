const {
  snapAreaToGrid, resolutionForArea, planFullAreaLed, boundingBoxOfZones, boundingResolutionForZones, zoneBounds,
  zoneGridCells, labelCellForZone, boundingResolutionForPanels,
} = require('../js/leddesign/ledAreaSetup.js');

describe('snapAreaToGrid', () => {
  test('exact multiples of 500mm pass through unchanged', () => {
    expect(snapAreaToGrid(3000, 1500)).toEqual({ areaW: 3000, areaH: 1500, cols: 6, rows: 3 });
  });

  test('rounds to nearest 500mm', () => {
    expect(snapAreaToGrid(3200, 1400)).toEqual({ areaW: 3000, areaH: 1500, cols: 6, rows: 3 });
  });

  test('empty input clamps to a single 500mm cell', () => {
    expect(snapAreaToGrid(0, 0)).toEqual({ areaW: 500, areaH: 500, cols: 1, rows: 1 });
  });
});

describe('resolutionForArea', () => {
  test('3mm pitch: SPECS px500 density scaled to the full area', () => {
    // SPECS['3mm'].px500 = {w:128,h:128} → 128px per 500mm
    expect(resolutionForArea(3000, 1500, '3mm')).toEqual({ w: 768, h: 384 });
  });

  test('missing area returns zeroed resolution', () => {
    expect(resolutionForArea(0, 1500, '3mm')).toEqual({ w: 0, h: 0 });
  });

  test('unknown pitch returns zeroed resolution', () => {
    expect(resolutionForArea(3000, 1500, '9mm')).toEqual({ w: 0, h: 0 });
  });
});

describe('planFullAreaLed', () => {
  test('builds a single zone spanning the snapped area and matches betaPanels totals', () => {
    const plan = planFullAreaLed({ areaW: 1000, areaH: 500, panelW: 500, panelH: 500, pitch: '3mm' });
    expect(plan.zone.rows).toBe(1);
    expect(plan.zone.cols).toBe(2);
    expect(plan.zone.led).toBe('3mm');
    expect(plan.panelCount).toBe(2);
    expect(plan.totalPx).toBe(128 * 128 * 2);
    expect(plan.resolution).toEqual({ w: 256, h: 128 });
    expect(plan.areaW).toBe(1000);
    expect(plan.areaH).toBe(500);
  });

  test('resolution matches the sum of individually tiled panel pixels even with remainder rows/cols', () => {
    // 1200x700mm은 500mm 배수가 아니므로 스냅 후 1000x500(2x1칸)이 된다.
    const plan = planFullAreaLed({ areaW: 1200, areaH: 700, panelW: 500, panelH: 1000, pitch: '2mm' });
    expect(plan.resolution.w * plan.resolution.h).toBeGreaterThan(0);
    expect(plan.totalPx).toBe(plan.resolution.w * plan.resolution.h);
  });
});

function zone(overrides) {
  return { id: 'z', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 1, panelW: 500, panelH: 500, ...overrides };
}

describe('boundingBoxOfZones', () => {
  test('no zones returns null', () => {
    expect(boundingBoxOfZones([])).toBeNull();
  });

  test('single zone: bounding box is the zone itself', () => {
    expect(boundingBoxOfZones([zone({ startRow: 2, startCol: 1, rows: 3, cols: 4 })]))
      .toEqual({ minRow: 2, minCol: 1, maxRow: 5, maxCol: 5 });
  });

  test('two disjoint zones (L-shaped layout): bounding box spans both', () => {
    const zones = [
      zone({ startRow: 0, startCol: 0, rows: 2, cols: 2 }),
      zone({ startRow: 2, startCol: 2, rows: 1, cols: 3 }),
    ];
    expect(boundingBoxOfZones(zones)).toEqual({ minRow: 0, minCol: 0, maxRow: 3, maxCol: 5 });
  });
});

describe('boundingResolutionForZones', () => {
  test('no zones returns null', () => {
    expect(boundingResolutionForZones([])).toBeNull();
  });

  test('mixed pitches return null (no single px density to convert with)', () => {
    const zones = [zone({ led: '2mm' }), zone({ led: '3mm', startCol: 1 })];
    expect(boundingResolutionForZones(zones)).toBeNull();
  });

  test('same-pitch L-shaped layout resolves to the bounding rectangle resolution', () => {
    const zones = [
      zone({ led: '3mm', startRow: 0, startCol: 0, rows: 2, cols: 2 }),
      zone({ led: '3mm', startRow: 2, startCol: 2, rows: 1, cols: 3 }),
    ];
    // bbox: 3 rows x 5 cols of 500mm => 1500x2500mm; 3mm px500={w:128,h:128}
    expect(boundingResolutionForZones(zones)).toEqual(resolutionForArea(2500, 1500, '3mm'));
  });

  test('freeform zone.cells: bounding box is the min/max of the selected cells', () => {
    const zones = [{ id: 'f1', led: '3mm', cells: [{ row: 1, col: 1 }, { row: 3, col: 4 }, { row: 2, col: 0 }] }];
    expect(zoneBounds(zones[0])).toEqual({ minRow: 1, minCol: 0, maxRow: 4, maxCol: 5 });
    // bbox: 3 rows x 5 cols of 500mm => 1500x2500mm
    expect(boundingResolutionForZones(zones)).toEqual(resolutionForArea(2500, 1500, '3mm'));
  });

  test('mix of a rect zone and a freeform zone combines correctly', () => {
    const rect = { id: 'r1', led: '3mm', startRow: 0, startCol: 0, rows: 2, cols: 2 };
    const free = { id: 'f1', led: '3mm', cells: [{ row: 4, col: 4 }] };
    expect(boundingBoxOfZones([rect, free])).toEqual({ minRow: 0, minCol: 0, maxRow: 5, maxCol: 5 });
  });
});

describe('boundingResolutionForPanels (bbox of an arbitrary panel subset — used for a sending card\'s actual assigned resolution)', () => {
  function panel(x, y, w, h, led) {
    return { key: `${x},${y}`, x, y, w: w || 500, h: h || 500, led: led || '3mm' };
  }

  test('no panels returns null', () => {
    expect(boundingResolutionForPanels([])).toBeNull();
  });

  test('mixed pitches return null (no single px density to convert with)', () => {
    expect(boundingResolutionForPanels([panel(0, 0, 500, 500, '2mm'), panel(500, 0, 500, 500, '3mm')])).toBeNull();
  });

  test('a contiguous rectangular subset resolves to its exact bounding rectangle', () => {
    const panels = [panel(0, 0), panel(500, 0), panel(0, 500), panel(500, 500)];
    // bbox: 1000x1000mm
    expect(boundingResolutionForPanels(panels)).toEqual(resolutionForArea(1000, 1000, '3mm'));
  });

  test('a scattered/non-rectangular subset (custom port wiring) still resolves to its bounding rectangle', () => {
    // 좌상단 한 칸 + 우하단 한 칸(사이는 이 카드에 배정 안 됨) — 실제로는
    // 정사각형이 아니지만, 사용자 요청대로 그 둘을 감싸는 최소 사각형으로 근사한다.
    const panels = [panel(0, 0), panel(2000, 1500)];
    expect(boundingResolutionForPanels(panels)).toEqual(resolutionForArea(2500, 2000, '3mm'));
  });
});

describe('zoneGridCells', () => {
  test('rectangular zone expands to every (row,col) it spans', () => {
    const zone = { startRow: 1, startCol: 2, rows: 2, cols: 3 };
    expect(zoneGridCells(zone)).toEqual([
      { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 },
      { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 },
    ]);
  });

  test('freeform zone passes its own cells through unchanged (shape, not order, matters)', () => {
    const zone = { cells: [{ row: 5, col: 5 }, { row: 5, col: 6 }] };
    expect(zoneGridCells(zone)).toEqual(zone.cells);
  });
});

describe('labelCellForZone', () => {
  test('rectangular zone: label sits at the bounding box center (always inside a rectangle)', () => {
    const zone = { startRow: 0, startCol: 0, rows: 2, cols: 4 };
    expect(labelCellForZone(zone)).toEqual({ row: 1, col: 2 });
  });

  test('L-shaped freeform zone: bounding-box center falls in the empty notch, so the label snaps to the nearest real cell instead', () => {
    // L 모양: (0,0)(0,1)(0,2) 가로줄 + (1,0)(2,0) 세로줄 — 바운딩 박스는
    // 0~3행 0~3열이라 중심(1.5,1.5)은 L의 안쪽 빈 칸(구역에 없는 칸)이다.
    const zone = {
      cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }, { row: 2, col: 0 }],
    };
    expect(zoneBounds(zone)).toEqual({ minRow: 0, minCol: 0, maxRow: 3, maxCol: 3 });

    const label = labelCellForZone(zone);
    // 바운딩 박스 중심(1.5,1.5) 그대로가 아니라, 실제 구역 칸 중 하나로 스냅돼야 한다.
    expect(label).not.toEqual({ row: 1.5, col: 1.5 });
    const labelRow = Math.floor(label.row);
    const labelCol = Math.floor(label.col);
    expect(zone.cells.some(c => c.row === labelRow && c.col === labelCol)).toBe(true);
  });

  test('single-cell freeform zone: label is that cell\'s own center', () => {
    const zone = { cells: [{ row: 5, col: 7 }] };
    expect(labelCellForZone(zone)).toEqual({ row: 5.5, col: 7.5 });
  });
});
