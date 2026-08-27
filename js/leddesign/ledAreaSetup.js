// ── ledAreaSetup ────────────────────────────────────
// LED디스플레이 노드를 캔버스에 추가할 때 뜨는 "설치면적/패널크기/피치" 팝업이
// 쓰는 순수 계산. 입력값으로 그리드 전체를 덮는 구역 하나를 만들고, 그 결과
// 해상도·패널 장수·총 픽셀을 함께 돌려준다 — 팝업 미리보기와 실제 노드 추가
// 양쪽에서 이 결과를 그대로 재사용해 계산이 갈라지지 않게 한다.
// 그리드는 500mm 단위이므로 입력 면적은 가장 가까운 500mm로 스냅한다
// (ledDesignView.js의 gridDims 스냅 규칙과 동일).

if (typeof module !== 'undefined') {
  if (typeof SPECS === 'undefined') { global.SPECS = require('./specs.js').SPECS; }
  if (typeof betaPanels === 'undefined') { global.betaPanels = require('./betaPanels.js').betaPanels; }
  if (typeof panelPx === 'undefined') { global.panelPx = require('./portAssignment.js').panelPx; }
  if (typeof makeId === 'undefined') { global.makeId = require('../core/idgen.js').makeId; }
}

function snapAreaToGrid(areaW, areaH) {
  const cols = Math.max(1, Math.round((areaW || 0) / 500));
  const rows = Math.max(1, Math.round((areaH || 0) / 500));
  return { areaW: cols * 500, areaH: rows * 500, cols, rows };
}

// 500mm당 픽셀 밀도는 피치로 고정되므로, 실제 패널 타일링(remainder 처리 등)과
// 무관하게 전체 면적에서 직접 계산해도 betaPanels 합산 결과와 항상 일치한다.
function resolutionForArea(areaW, areaH, pitch) {
  const sp = SPECS[pitch];
  if (!sp || !areaW || !areaH) { return { w: 0, h: 0 }; }
  return {
    w: Math.round(sp.px500.w / 500 * areaW),
    h: Math.round(sp.px500.h / 500 * areaH),
  };
}

function planFullAreaLed({ areaW, areaH, panelW, panelH, pitch }) {
  const snapped = snapAreaToGrid(areaW, areaH);
  const zone = {
    id: makeId('lz'),
    led: pitch,
    startRow: 0, startCol: 0, rows: snapped.rows, cols: snapped.cols,
    panelW, panelH,
  };
  const panels = betaPanels(zone);
  const totalPx = panels.reduce((sum, p) => sum + panelPx(p), 0);
  return {
    zone,
    areaW: snapped.areaW,
    areaH: snapped.areaH,
    panelCount: panels.length,
    totalPx,
    resolution: resolutionForArea(snapped.areaW, snapped.areaH, pitch),
  };
}

// 구역 하나(사각형 또는 zone.cells 자유 구역)의 바운딩 박스(격자 칸 좌표계).
function zoneBounds(zone) {
  if (zone.cells) {
    const rows = zone.cells.map(c => c.row);
    const cols = zone.cells.map(c => c.col);
    return { minRow: Math.min(...rows), minCol: Math.min(...cols), maxRow: Math.max(...rows) + 1, maxCol: Math.max(...cols) + 1 };
  }
  return { minRow: zone.startRow, minCol: zone.startCol, maxRow: zone.startRow + zone.rows, maxCol: zone.startCol + zone.cols };
}

// 구역이 실제로 차지하는 500mm 격자 칸을 {row,col} 낱개 목록으로 돌려준다 —
// 사각형 구역(rows×cols)과 자유 구역(zone.cells)을 같은 모양(칸 단위 목록)
// 으로 다뤄야, 가이드 이미지의 배경 채우기·테두리 그리기처럼 오목한 모양도
// 실제 칸만 정확히(바운딩 박스가 아니라) 다룰 수 있다.
function zoneGridCells(zone) {
  if (zone.cells) { return zone.cells.map(c => ({ row: c.row, col: c.col })); }
  const cells = [];
  for (let r = 0; r < zone.rows; r++) {
    for (let c = 0; c < zone.cols; c++) { cells.push({ row: zone.startRow + r, col: zone.startCol + c }); }
  }
  return cells;
}

// 여러 구역(사각형이든 자유 구역이든)을 함께 감싸는 최소 바운딩 박스(격자 칸
// 좌표계). 자유 배치 캔버스가 격자를 얼마나 자동으로 넓혀야 하는지, 카드
// 요약이 비정형 설치 전체를 "최소 직사각형" 하나로 어떻게 잡을지 계산하는 데
// 공통으로 쓴다. 구역이 없으면 null.
function boundingBoxOfZones(zones) {
  if (!zones.length) { return null; }
  const bounds = zones.map(zoneBounds);
  return {
    minRow: Math.min(...bounds.map(b => b.minRow)),
    minCol: Math.min(...bounds.map(b => b.minCol)),
    maxRow: Math.max(...bounds.map(b => b.maxRow)),
    maxCol: Math.max(...bounds.map(b => b.maxCol)),
  };
}

// 구역들을 감싸는 최소 직사각형의 해상도 — 전부 같은 피치를 쓸 때만 하나의 px
// 밀도로 환산할 수 있으므로, 피치가 섞여 있거나 구역이 없으면 null(호출자가
// "해상도 표시 불가" 상태로 폴백).
function boundingResolutionForZones(zones) {
  const bbox = boundingBoxOfZones(zones);
  if (!bbox) { return null; }
  const pitches = new Set(zones.map(z => z.led));
  if (pitches.size !== 1) { return null; }
  const w = (bbox.maxCol - bbox.minCol) * 500;
  const h = (bbox.maxRow - bbox.minRow) * 500;
  return resolutionForArea(w, h, zones[0].led);
}

// betaPanels() 결과의 임의 부분집합(예: 샌딩카드 하나에 실제 배정된 패널만)을
// 감싸는 최소 사각형의 해상도 — 배정이 비직사각형·불연속이어도 그 전체를
// 담는 bounding box 기준으로 근사한다(사용자 요청, 2026-08-27). 피치가
// 섞여 있거나 패널이 없으면 boundingResolutionForZones와 동일하게 null.
function boundingResolutionForPanels(panels) {
  if (!panels.length) { return null; }
  const pitches = new Set(panels.map(p => p.led));
  if (pitches.size !== 1) { return null; }
  const minX = Math.min(...panels.map(p => p.x));
  const minY = Math.min(...panels.map(p => p.y));
  const maxX = Math.max(...panels.map(p => p.x + p.w));
  const maxY = Math.max(...panels.map(p => p.y + p.h));
  return resolutionForArea(maxX - minX, maxY - minY, panels[0].led);
}

// 구역 라벨(이름·피치 등)을 그릴 칸 하나를 고른다 — 결과는 격자 칸 좌표계의
// "중심점"(row/col에 0.5를 더한 소수 좌표)이라 호출자가 그대로 셀 크기를
// 곱해 픽셀 좌표로 바꾸면 된다. 사각형 구역은 바운딩 박스 중심이 항상 구역
// 내부이므로 그대로 쓰면 되지만, 자유 구역(zone.cells)은 오목한/도넛형
// 모양이면 바운딩 박스 중심이 실제로는 구역 밖(빈 칸)에 떨어질 수 있다 —
// 그 중심에 가장 가까운 실제 칸을 대신 골라, 라벨이 항상 구역 내부에
// 표시되게 한다(사용자 요청).
function labelCellForZone(zone) {
  const bounds = zoneBounds(zone);
  const centerRow = (bounds.minRow + bounds.maxRow) / 2;
  const centerCol = (bounds.minCol + bounds.maxCol) / 2;
  if (!zone.cells) {
    return { row: centerRow, col: centerCol };
  }
  let best = zone.cells[0];
  let bestDist = Infinity;
  zone.cells.forEach(c => {
    const dr = (c.row + 0.5) - centerRow;
    const dc = (c.col + 0.5) - centerCol;
    const dist = dr * dr + dc * dc;
    if (dist < bestDist) { bestDist = dist; best = c; }
  });
  return { row: best.row + 0.5, col: best.col + 0.5 };
}

if (typeof module !== 'undefined') {
  module.exports = {
    snapAreaToGrid, resolutionForArea, planFullAreaLed, zoneBounds, zoneGridCells, boundingBoxOfZones, boundingResolutionForZones,
    boundingResolutionForPanels, labelCellForZone,
  };
}
