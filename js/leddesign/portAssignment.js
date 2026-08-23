// ── portAssignment ──────────────────────────────────
// led-calculator/script.js의 랜선 뱀형(snake) 자동할당 로직을 포트 수·포트당
// 픽셀 상한을 매개변수로 받도록 일반화해 이식한다. 원본:
//   _betaAutoAssignZone  → script.js:4581-4619
//   _balancedCols        → script.js:4556-4579
//   _betaPxOf(픽셀 계산)  → script.js:2915-2924
// 하드코딩됐던 포트 수(16)와 MAX_PX는 각각 portCount/capPerPort 인자로 대체했다
// — v1에서는 그래프 상류에 연결된 장비 프리셋에서 이 값을 가져온다.

if (typeof module !== 'undefined' && typeof SPECS === 'undefined') {
  global.SPECS = require('./specs.js').SPECS;
  global.betaPanels = require('./betaPanels.js').betaPanels;
}

function panelPx(panel) {
  const sp = SPECS[panel.led];
  if (!sp) { return 0; }
  return Math.round(sp.px500.w / 500 * panel.w) * Math.round(sp.px500.h / 500 * panel.h);
}

function portPx(panels, keys) {
  return keys.reduce((total, key) => {
    const p = panels.find(x => x.key === key);
    return total + (p ? panelPx(p) : 0);
  }, 0);
}

function isOverCapacity(px, capPerPort) {
  return px > capPerPort;
}

// total개를 numPorts개 포트에 최대한 균등 분배(홀짝 보정 포함). 원본 _balancedCols 그대로.
function balancedCols(total, numPorts, maxRaw, maxEven) {
  if (numPorts === 1) { return [total]; }
  const base = Math.floor(total / numPorts);
  let perPort;
  if (base < 2 || base % 2 === 0) {
    const ceilBase = Math.ceil(total / numPorts);
    perPort = (base < 2 && ceilBase <= maxRaw) ? ceilBase : base;
  } else {
    const up = base + 1;
    const lastIfUp = total - up * (numPorts - 1);
    if (up <= maxEven && lastIfUp >= 1 && lastIfUp <= maxRaw) {
      perPort = up;
    } else {
      const down = base - 1;
      const lastIfDown = total - down * (numPorts - 1);
      perPort = (down >= 1 && lastIfDown >= 1 && lastIfDown <= maxRaw) ? down : base;
    }
  }
  const takes = [];
  let rem = total;
  for (let p = 0; p < numPorts - 1; p += 1) { takes.push(perPort); rem -= perPort; }
  takes.push(rem);
  return takes;
}

// 구역 하나의 패널을 x좌표(열) 기준으로 묶어 왼→오, 각 열은 위(작은 y)부터
// 정렬한 목록으로 반환한다. LAN(용량 기준)·PWR(포트당 열 수 기준) 자동 배정이
// 공통으로 쓰는 전처리 단계.
function columnsOfZone(zone) {
  const panels = betaPanels(zone);
  const colMap = new Map();
  panels.forEach(p => {
    if (!colMap.has(p.x)) { colMap.set(p.x, []); }
    colMap.get(p.x).push(p);
  });
  return [...colMap.keys()].sort((a, b) => a - b)
    .map(ck => colMap.get(ck).slice().sort((a, b) => a.y - b.y));
}

// 열 목록 하나(구역 하나 분량일 수도, 여러 구역에 걸친 조각일 수도 있음)를
// 열 단위 뱀형으로 assignments(길이 portCount인 key 배열들)에 availableIndices
// [portOff]부터 채운다. availableIndices는 실제 쓸 수 있는 포트 번호만 순서대로
// 나열한 목록(같은 샌딩카드를 공유하는 다른 LED디스플레이가 이미 쓰고 있는
// 포트는 제외하고 넘어온다) — portCount 전체가 아니라 이 목록 길이 기준으로
// 채워야 예약된 포트를 건너뛰고 다음 빈 포트로 이어갈 수 있다. 반환값은 실제로
// 사용한(=availableIndices에서 소비한) 포트 수.
function autoAssignColumnsToPorts(columns, portOff, availableIndices, capPerPort, assignments) {
  const totalCols = columns.length;
  if (totalCols === 0) { return 0; }

  const maxColPx = Math.max(...columns.map(col => col.reduce((sum, p) => sum + panelPx(p), 0)));
  if (maxColPx === 0) { return 0; }

  const maxRaw = Math.max(1, Math.floor(capPerPort / maxColPx));
  const maxEven = maxRaw >= 2 ? (maxRaw % 2 === 0 ? maxRaw : maxRaw - 1) : maxRaw;
  const numPorts = Math.min(availableIndices.length - portOff, Math.ceil(totalCols / maxEven));
  if (numPorts <= 0) { return 0; }
  const takes = balancedCols(totalCols, numPorts, maxRaw, maxEven);

  let colStart = 0;
  for (let pi = 0; pi < takes.length; pi += 1) {
    const portIdx = availableIndices[portOff + pi];
    if (portIdx === undefined) { break; }
    for (let ci = 0; ci < takes[pi]; ci += 1) {
      const ordered = ci % 2 === 0 ? columns[colStart + ci].slice().reverse() : columns[colStart + ci]; // 짝수열: 하→상, 홀수열: 상→하
      ordered.forEach(p => assignments[portIdx].push(p.key));
    }
    colStart += takes[pi];
  }
  return takes.length;
}

// 구역 하나짜리 얇은 래퍼(기존 시그니처 유지 — autoAssignAllZones가 구역
// 단위로 순회하며 이 함수를 호출한다).
function autoAssignZoneToPorts(zone, portOff, availableIndices, capPerPort, assignments) {
  return autoAssignColumnsToPorts(columnsOfZone(zone), portOff, availableIndices, capPerPort, assignments);
}

// PWR 자동 배정: LAN처럼 픽셀 상한을 기준으로 포트당 열 수를 계산하지 않고,
// "포트당 열 수" 자체를 기준으로 채운다 — 기본은 포트당 2열. 그 기본값으로는
// 고정된 포트 수(portCount) 안에 전체 열을 다 못 담을 때만(2×portCount <
// 전체 열 수) 포트당 열 수를 필요한 만큼(3, 4, …) 늘려서 모든 패널이 항상
// 어딘가에는 배정되게 한다(사용자 요청 — 포트 수를 늘리는 대신 우선 열을
// 더 눌러 담는 쪽을 기본으로 함. 포트 수 자체를 늘리고 싶으면 UI의 포트
// 추가 버튼으로 portCount를 먼저 늘린 뒤 다시 자동 배정하면 된다).
// 구역 경계와 무관하게 전체 열을 (startRow, startCol) 순서로 이어붙여 채우므로
// (LAN과 달리 포트 하나에 서로 다른 구역의 열이 섞일 수 있음) "전체 LED"
// 기준으로 판단한다는 요청과 맞다.
function autoAssignPwrZones(zones, portCount) {
  const assignments = Array.from({ length: portCount }, () => []);
  if (portCount <= 0) { return assignments; }

  const sorted = [...zones].sort((a, b) =>
    a.startRow !== b.startRow ? a.startRow - b.startRow : a.startCol - b.startCol
  );
  const allColumns = sorted.flatMap(zone => columnsOfZone(zone));
  const totalCols = allColumns.length;
  if (totalCols === 0) { return assignments; }

  const colsPerPort = Math.max(2, Math.ceil(totalCols / portCount));

  let portIdx = 0;
  let ci = 0;
  allColumns.forEach(col => {
    if (portIdx >= portCount) { return; } // colsPerPort 계산상 이론적으로 발생하지 않는 방어 코드
    const ordered = ci % 2 === 0 ? col.slice().reverse() : col; // 짝수열: 하→상, 홀수열: 상→하(포트마다 새로 시작)
    ordered.forEach(p => assignments[portIdx].push(p.key));
    ci += 1;
    if (ci >= colsPerPort) { portIdx += 1; ci = 0; }
  });
  return assignments;
}

// 여러 구역을 (startRow, startCol) 순서로 훑으며 portCount개 포트에 순서대로 채운다.
// reservedIndices(있다면)는 다른 LED디스플레이가 이미 쓰고 있어 이번 배정에서
// 건너뛸 포트 번호들 — 결과 배열은 여전히 portCount 길이지만 그 인덱스들은
// 손대지 않고 빈 채로 남는다. 반환: portCount 길이의 key 배열 목록.
function autoAssignAllZones(zones, portCount, capPerPort, reservedIndices) {
  const reserved = reservedIndices ? new Set(reservedIndices) : null;
  const availableIndices = [];
  for (let i = 0; i < portCount; i += 1) {
    if (!reserved || !reserved.has(i)) { availableIndices.push(i); }
  }
  const assignments = Array.from({ length: portCount }, () => []);
  const sorted = [...zones].sort((a, b) =>
    a.startRow !== b.startRow ? a.startRow - b.startRow : a.startCol - b.startCol
  );
  let portOff = 0;
  sorted.forEach(zone => {
    portOff = Math.min(availableIndices.length, portOff + autoAssignZoneToPorts(zone, portOff, availableIndices, capPerPort, assignments));
  });
  return assignments;
}

// 샌딩카드가 2대 이상 연결된 LED의 LAN 자동 배정 — 카드마다 담당 픽셀량이
// 최대한 균등하도록, 전체 열(구역 경계 무시하고 startRow/startCol 순서로
// 이어붙임)을 먼저 카드별로 "연속된 덩어리"로 나눈 뒤(왼쪽부터 목표치만큼
// 채우고 다음 카드로 넘어가는 방식 — 화면을 좌우로 쪼개 카드마다 이어진
// 구역을 맡기는 실제 배선 관행과 맞춤. 카드끼리 열을 번갈아 섞으면 배선이
// 뒤죽박죽돼 실무에서 안 씀), 카드마다 자기 몫만 그 카드 자신의 포트 수·
// 상한(capPerPort)으로 채운다(autoAssignColumnsToPorts 재사용). groups는
// ledPortGroups.js의 resolveLedPortLayout이 주는 순서(캔버스 세로 위치순)
// 그대로 각 {portCount, capPerPort}를 받는다 — 이 함수는 전체 ports 배열에서
// 그룹별 포트 오프셋도 이 순서로 스스로 계산한다.
function autoAssignAllZonesBalanced(zones, groups, reservedIndices) {
  const totalPortCount = groups.reduce((sum, g) => sum + g.portCount, 0);
  const assignments = Array.from({ length: totalPortCount }, () => []);
  if (groups.length === 0) { return assignments; }

  const reserved = reservedIndices ? new Set(reservedIndices) : null;
  const sortedZones = [...zones].sort((a, b) =>
    a.startRow !== b.startRow ? a.startRow - b.startRow : a.startCol - b.startCol
  );
  const allColumns = sortedZones.flatMap(zone => columnsOfZone(zone));
  if (allColumns.length === 0) { return assignments; }

  const colPxOf = col => col.reduce((sum, p) => sum + panelPx(p), 0);
  const totalPx = allColumns.reduce((sum, col) => sum + colPxOf(col), 0);

  // 카드별로 몇 개의 "연속된" 열을 맡을지 결정 — 남은 픽셀량 ÷ 남은 카드 수를
  // 매 카드마다 다시 계산해(고정된 1/N이 아니라) 앞 카드에서 생긴 반올림
  // 오차가 뒤 카드로 누적되지 않게 한다. 마지막 카드는 반올림 오차 없이
  // 남은 열을 전부 가져간다.
  const groupColumns = groups.map(() => []);
  let colIdx = 0;
  let remainingPx = totalPx;
  groups.forEach((group, gi) => {
    const isLast = gi === groups.length - 1;
    if (isLast) {
      while (colIdx < allColumns.length) { groupColumns[gi].push(allColumns[colIdx]); colIdx += 1; }
      return;
    }
    const target = remainingPx / (groups.length - gi);
    let acc = 0;
    while (colIdx < allColumns.length) {
      const col = allColumns[colIdx];
      const px = colPxOf(col);
      // 이미 이 카드에 하나 이상 담겼고, 다음 열을 더하면 목표치를 넘어서면
      // 다음 카드로 넘긴다. 첫 열은 목표치를 이미 넘더라도 일단 담아 카드가
      // 통째로 빈 채 남지 않게 한다.
      if (groupColumns[gi].length > 0 && acc + px > target) { break; }
      groupColumns[gi].push(col);
      acc += px;
      remainingPx -= px;
      colIdx += 1;
    }
  });

  let portOffset = 0;
  groups.forEach((group, gi) => {
    const groupIndices = [];
    for (let i = 0; i < group.portCount; i += 1) {
      const idx = portOffset + i;
      if (!reserved || !reserved.has(idx)) { groupIndices.push(idx); }
    }
    portOffset += group.portCount;
    autoAssignColumnsToPorts(groupColumns[gi], 0, groupIndices, group.capPerPort, assignments);
  });

  return assignments;
}

if (typeof module !== 'undefined') {
  module.exports = {
    panelPx, portPx, isOverCapacity, balancedCols, columnsOfZone,
    autoAssignZoneToPorts, autoAssignAllZones, autoAssignPwrZones, autoAssignAllZonesBalanced,
  };
}
