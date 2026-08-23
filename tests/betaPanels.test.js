const { betaPanels } = require('../js/leddesign/betaPanels.js');

function zone(overrides) {
  return {
    id: 'z1', led: '3mm',
    startRow: 0, startCol: 0,
    rows: 4, cols: 4,
    panelW: 1000, panelH: 1000,
    ...overrides,
  };
}

describe('betaPanels — 패널 수', () => {
  test('패널크기 == 셀크기(500×500): 각 셀이 독립 패널', () => {
    const panels = betaPanels(zone({ rows: 4, cols: 4, panelW: 500, panelH: 500 }));
    expect(panels).toHaveLength(16);
  });

  test('500×1000 패널, 4×4 구역 → 4개 전체 패널 (잔여 없음)', () => {
    const panels = betaPanels(zone({ rows: 4, cols: 4, panelW: 1000, panelH: 1000 }));
    expect(panels).toHaveLength(4);
  });

  test('1000×1000 패널, 5×4 구역 → 잔여 행 1개 포함, 합계 8', () => {
    const panels = betaPanels(zone({ rows: 5, cols: 4, panelW: 1000, panelH: 1000 }));
    expect(panels).toHaveLength(8);
  });

  test('1000×1000 패널, 4×5 구역 → 잔여 열 1개 포함, 합계 8', () => {
    const panels = betaPanels(zone({ rows: 4, cols: 5, panelW: 1000, panelH: 1000 }));
    expect(panels).toHaveLength(8);
  });

  test('1000×1000 패널, 5×5 구역 → 잔여 행+열 모두 포함, 합계 13', () => {
    const panels = betaPanels(zone({ rows: 5, cols: 5, panelW: 1000, panelH: 1000 }));
    expect(panels).toHaveLength(13);
  });
});

describe('betaPanels — 좌표', () => {
  test('(0,0) 시작, 500×500 패널 → 첫 패널 x=0 y=0', () => {
    const panels = betaPanels(zone({ startRow: 0, startCol: 0, rows: 2, cols: 2, panelW: 500, panelH: 500 }));
    expect(panels[0]).toMatchObject({ x: 0, y: 0, w: 500, h: 500 });
  });

  test('startRow=2, startCol=3 → x=1500 y=1000 (첫 패널)', () => {
    const panels = betaPanels(zone({ startRow: 2, startCol: 3, rows: 2, cols: 2, panelW: 500, panelH: 500 }));
    expect(panels[0]).toMatchObject({ x: 1500, y: 1000 });
  });

  test('key에 zoneId가 포함됨', () => {
    const panels = betaPanels(zone({ id: 'myZone', rows: 2, cols: 2, panelW: 500, panelH: 500 }));
    panels.forEach(p => expect(p.key).toMatch(/^myZone:/));
  });
});

describe('betaPanels — 엣지 케이스', () => {
  test('1×1 구역, 500×500 패널 → 패널 1개', () => {
    const panels = betaPanels(zone({ rows: 1, cols: 1, panelW: 500, panelH: 500 }));
    expect(panels).toHaveLength(1);
  });

  test('패널크기가 구역보다 크면 잔여행만 생성', () => {
    const panels = betaPanels(zone({ rows: 1, cols: 2, panelW: 1000, panelH: 1000 }));
    expect(panels).toHaveLength(2);
  });

  test('모든 패널 key가 유일함', () => {
    const panels = betaPanels(zone({ rows: 5, cols: 5, panelW: 1000, panelH: 1000 }));
    const keys = panels.map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('전체 패널 면적 합 = 구역 면적', () => {
    const panels = betaPanels(zone({ rows: 5, cols: 4, panelW: 1000, panelH: 1000 }));
    const totalArea = panels.reduce((sum, p) => sum + p.w * p.h, 0);
    expect(totalArea).toBe(5 * 4 * 500 * 500);
  });

  test('잔여행 패널은 항상 h=500, 잔여열 패널은 항상 w=500', () => {
    const rowPanels = betaPanels(zone({ rows: 3, cols: 2, panelW: 1000, panelH: 1000 }));
    rowPanels.filter(p => p.key.includes(':rr:')).forEach(p => expect(p.h).toBe(500));

    const colPanels = betaPanels(zone({ rows: 2, cols: 3, panelW: 1000, panelH: 1000 }));
    colPanels.filter(p => p.key.includes(':rc')).forEach(p => expect(p.w).toBe(500));
  });
});

describe('betaPanels — 자유 구역(zone.cells, 이 앱만의 확장)', () => {
  test('칸 하나당 500×500 패널 하나, panelW/H는 무시된다', () => {
    const freeZone = { id: 'f1', led: '4mm', panelW: 1000, panelH: 1000, cells: [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 3, col: 5 }] };
    const panels = betaPanels(freeZone);
    expect(panels).toHaveLength(3);
    panels.forEach(p => expect(p).toMatchObject({ w: 500, h: 500, led: '4mm', zoneId: 'f1' }));
  });

  test('좌표는 칸 인덱스 × 500', () => {
    const panels = betaPanels({ id: 'f1', led: '3mm', cells: [{ row: 2, col: 3 }] });
    expect(panels[0]).toMatchObject({ x: 1500, y: 1000 });
  });

  test('키는 zoneId:row:col 형식이고 유일하다', () => {
    const panels = betaPanels({ id: 'f1', led: '3mm', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }] });
    expect(panels.map(p => p.key)).toEqual(['f1:0:0', 'f1:0:1', 'f1:1:0']);
    expect(new Set(panels.map(p => p.key)).size).toBe(3);
  });

  test('빈 cells 배열이면 패널 없음', () => {
    expect(betaPanels({ id: 'f1', led: '3mm', cells: [] })).toEqual([]);
  });
});
