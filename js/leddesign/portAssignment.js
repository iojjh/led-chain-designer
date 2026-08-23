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

// 구역 하나를 열(column) 단위 뱀형으로 assignments(길이 portCount인 key 배열들)에
// availableIndices[portOff]부터 채운다. availableIndices는 실제 쓸 수 있는 포트
// 번호만 순서대로 나열한 목록(같은 샌딩카드를 공유하는 다른 LED디스플레이가 이미
// 쓰고 있는 포트는 제외하고 넘어온다) — portCount 전체가 아니라 이 목록 길이
// 기준으로 채워야 예약된 포트를 건너뛰고 다음 빈 포트로 이어갈 수 있다.
// 반환값은 이 구역이 실제로 사용한(=availableIndices에서 소비한) 포트 수.
function autoAssignZoneToPorts(zone, portOff, availableIndices, capPerPort, assignments) {
  const columns = columnsOfZone(zone);
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

if (typeof module !== 'undefined') {
  module.exports = {
    panelPx, portPx, isOverCapacity, balancedCols, columnsOfZone,
    autoAssignZoneToPorts, autoAssignAllZones, autoAssignPwrZones,
  };
}
