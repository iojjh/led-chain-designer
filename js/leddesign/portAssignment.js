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

// 구역 하나를 열(column) 단위 뱀형으로 assignments(길이 portCount인 key 배열들)에
// portOff부터 채운다. 반환값은 이 구역이 실제로 사용한 포트 수.
function autoAssignZoneToPorts(zone, portOff, portCount, capPerPort, assignments) {
  const panels = betaPanels(zone);
  const colMap = new Map();
  panels.forEach(p => {
    if (!colMap.has(p.x)) { colMap.set(p.x, []); }
    colMap.get(p.x).push(p);
  });
  const colKeys = [...colMap.keys()].sort((a, b) => a - b);
  const totalCols = colKeys.length;
  if (totalCols === 0) { return 0; }

  const maxColPx = Math.max(...colKeys.map(ck =>
    colMap.get(ck).reduce((sum, p) => sum + panelPx(p), 0)
  ));
  if (maxColPx === 0) { return 0; }

  const maxRaw = Math.max(1, Math.floor(capPerPort / maxColPx));
  const maxEven = maxRaw >= 2 ? (maxRaw % 2 === 0 ? maxRaw : maxRaw - 1) : maxRaw;
  const numPorts = Math.min(portCount - portOff, Math.ceil(totalCols / maxEven));
  if (numPorts <= 0) { return 0; }
  const takes = balancedCols(totalCols, numPorts, maxRaw, maxEven);

  let colStart = 0;
  for (let pi = 0; pi < takes.length; pi += 1) {
    const portIdx = portOff + pi;
    if (portIdx >= portCount) { break; }
    for (let ci = 0; ci < takes[pi]; ci += 1) {
      const col = colMap.get(colKeys[colStart + ci]).slice().sort((a, b) => a.y - b.y);
      const ordered = ci % 2 === 0 ? col.slice().reverse() : col; // 짝수열: 하→상, 홀수열: 상→하
      ordered.forEach(p => assignments[portIdx].push(p.key));
    }
    colStart += takes[pi];
  }
  return takes.length;
}

// 여러 구역을 (startRow, startCol) 순서로 훑으며 portCount개 포트에 순서대로 채운다.
// 반환: portCount 길이의 key 배열 목록.
function autoAssignAllZones(zones, portCount, capPerPort) {
  const assignments = Array.from({ length: portCount }, () => []);
  const sorted = [...zones].sort((a, b) =>
    a.startRow !== b.startRow ? a.startRow - b.startRow : a.startCol - b.startCol
  );
  let portOff = 0;
  sorted.forEach(zone => {
    portOff = Math.min(portCount, portOff + autoAssignZoneToPorts(zone, portOff, portCount, capPerPort, assignments));
  });
  return assignments;
}

if (typeof module !== 'undefined') {
  module.exports = { panelPx, portPx, isOverCapacity, balancedCols, autoAssignZoneToPorts, autoAssignAllZones };
}
