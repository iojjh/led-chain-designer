// ── ledDesignView ───────────────────────────────────
// LED디스플레이 노드의 세부 페이지: 구역(zone) 격자 편집 + LAN/PWR 포트 자동할당.
// 알고리즘은 specs.js/betaPanels.js/portAssignment.js(포팅됨)를 그대로 쓰고,
// 여기서는 DOM/캔버스 렌더링과 상호작용만 새로 구성한다.

const CELL_PX = 26; // 500mm 셀 하나의 화면 픽셀 크기

const _led = {
  nodeId: null,
  canvas: null,
  ctx: null,
  dragStart: null, // {row, col}
  dragCur: null,
  selectedZoneId: null,
  portTab: 'lan',
};

function getLedNode() { return getNode(_led.nodeId); }
function getLedConfig() { return getLedNode().config.ledDesign; }

function recomputeTotalPx() {
  const cfg = getLedConfig();
  const total = cfg.zones.reduce((sum, zone) =>
    sum + betaPanels(zone).reduce((s, p) => s + panelPx(p), 0), 0);
  getLedNode().config.totalRequiredPx = total;
  return total;
}

// 구역이 추가/삭제/변경되면 기존 포트 배정은 무효화(패널 key가 달라지므로) —
// 사용자가 자동 할당을 다시 눌러야 한다.
function resetPortAssignments() {
  const cfg = getLedConfig();
  const lanSpec = resolveLedPortSpec();
  cfg.lanPorts = Array.from({ length: lanSpec.portCount }, () => []);
  cfg.pwrPorts = Array.from({ length: PWR_PORT_COUNT }, () => []);
}

// LED 노드 상류(샌딩카드 또는 lan-ports 콘솔 직결)에서 포트 수·포트당 픽셀 상한을 가져온다.
function resolveLedPortSpec() {
  const graph = State.graph;
  const upstream = upstreamOf(graph, _led.nodeId);
  const sendingNode = upstream.find(n => n.type === 'sending');
  const consoleNode = upstream.find(n => n.type === 'console');

  if (sendingNode) {
    const device = sendingNode.config.deviceId ? getDevice('sending', sendingNode.config.deviceId) : null;
    return device
      ? { portCount: device.portCount, capPerPort: device.perPortMaxPx8bit, sourceLabel: `${device.vendor} ${device.name}` }
      : { portCount: sendingNode.config.portCount || 8, capPerPort: sendingNode.config.perPortMaxPx || MAX_PX, sourceLabel: '샌딩카드 (수동 설정)' };
  }
  if (consoleNode) {
    const device = consoleNode.config.deviceId ? getDevice('console', consoleNode.config.deviceId) : null;
    return device
      ? { portCount: device.outputs.portCount, capPerPort: device.outputs.perPortMaxPx8bit, sourceLabel: `${device.vendor} ${device.name} (직결)` }
      : { portCount: 8, capPerPort: MAX_PX, sourceLabel: '콘솔 (수동 설정, 직결)' };
  }
  return { portCount: 8, capPerPort: MAX_PX, sourceLabel: '미연결 — 기본값 사용' };
}

function openLedDesignView(nodeId) {
  _led.nodeId = nodeId;
  _led.selectedZoneId = null;
  _led.dragStart = null;
  _led.dragCur = null;

  const cfg = getLedConfig();
  if (!cfg.lanPorts || cfg.lanPorts.length === 0) { resetPortAssignments(); }

  document.getElementById('graphView').hidden = true;
  document.getElementById('ledDesignView').hidden = false;

  if (!_led.canvas) { initLedDesignView(); }

  document.getElementById('ledAreaW').value = cfg.areaW || '';
  document.getElementById('ledAreaH').value = cfg.areaH || '';

  renderLedDesignView();
}

function closeLedDesignView() {
  recomputeTotalPx();
  document.getElementById('ledDesignView').hidden = true;
  document.getElementById('graphView').hidden = false;
  renderValidation();
}

function initLedDesignView() {
  _led.canvas = document.getElementById('ledGridCanvas');
  _led.ctx = _led.canvas.getContext('2d');

  document.getElementById('ledBackBtn').addEventListener('click', closeLedDesignView);

  document.getElementById('ledAreaW').addEventListener('change', e => {
    getLedConfig().areaW = Number(e.target.value) || 0;
    renderLedDesignView();
  });
  document.getElementById('ledAreaH').addEventListener('change', e => {
    getLedConfig().areaH = Number(e.target.value) || 0;
    renderLedDesignView();
  });

  _led.canvas.addEventListener('mousedown', onGridMouseDown);
  window.addEventListener('mousemove', onGridMouseMove);
  window.addEventListener('mouseup', onGridMouseUp);

  document.querySelectorAll('.led-port-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _led.portTab = btn.dataset.tab;
      document.querySelectorAll('.led-port-tab').forEach(b => b.classList.toggle('on', b === btn));
      renderPortPanel();
    });
  });

  document.getElementById('ledAutoAssignBtn').addEventListener('click', () => {
    const cfg = getLedConfig();
    if (_led.portTab === 'lan') {
      const spec = resolveLedPortSpec();
      cfg.lanPorts = autoAssignAllZones(cfg.zones, spec.portCount, spec.capPerPort);
    } else {
      cfg.pwrPorts = autoAssignAllZones(cfg.zones, PWR_PORT_COUNT, 300000); // 원본 betaAutoAssignPwr의 경험적 상수
    }
    renderPortPanel();
  });
}

function gridDims() {
  const cfg = getLedConfig();
  const cols = Math.max(1, Math.round((cfg.areaW || 0) / 500));
  const rows = Math.max(1, Math.round((cfg.areaH || 0) / 500));
  return { cols, rows };
}

function cellFromEvent(e) {
  const rect = _led.canvas.getBoundingClientRect();
  const col = Math.floor((e.clientX - rect.left) / CELL_PX);
  const row = Math.floor((e.clientY - rect.top) / CELL_PX);
  const { cols, rows } = gridDims();
  return { row: Math.min(Math.max(row, 0), rows - 1), col: Math.min(Math.max(col, 0), cols - 1) };
}

function zoneAtCell(row, col) {
  const cfg = getLedConfig();
  return cfg.zones.find(z =>
    row >= z.startRow && row < z.startRow + z.rows &&
    col >= z.startCol && col < z.startCol + z.cols
  ) || null;
}

function rectOverlapsZone(startRow, startCol, rows, cols, zones) {
  return zones.some(z =>
    startCol < z.startCol + z.cols && startCol + cols > z.startCol &&
    startRow < z.startRow + z.rows && startRow + rows > z.startRow
  );
}

function onGridMouseDown(e) {
  const cell = cellFromEvent(e);
  const zone = zoneAtCell(cell.row, cell.col);
  if (zone) {
    _led.selectedZoneId = zone.id;
    renderLedDesignView();
    return;
  }
  _led.selectedZoneId = null;
  _led.dragStart = cell;
  _led.dragCur = cell;
  drawGrid();
}

function onGridMouseMove(e) {
  if (!_led.dragStart) { return; }
  _led.dragCur = cellFromEvent(e);
  drawGrid();
}

function onGridMouseUp() {
  if (!_led.dragStart || !_led.dragCur) { _led.dragStart = null; return; }
  const startRow = Math.min(_led.dragStart.row, _led.dragCur.row);
  const startCol = Math.min(_led.dragStart.col, _led.dragCur.col);
  const rows = Math.abs(_led.dragCur.row - _led.dragStart.row) + 1;
  const cols = Math.abs(_led.dragCur.col - _led.dragStart.col) + 1;
  _led.dragStart = null;
  _led.dragCur = null;

  const cfg = getLedConfig();
  if (!rectOverlapsZone(startRow, startCol, rows, cols, cfg.zones)) {
    const [panelW, panelH] = document.getElementById('ledNewPanelSize').value.split('x').map(Number);
    cfg.zones.push({
      id: makeId('lz'),
      led: document.getElementById('ledNewPitch').value,
      startRow, startCol, rows, cols,
      panelW, panelH,
    });
    resetPortAssignments();
    recomputeTotalPx();
  }
  renderLedDesignView();
}

function renderLedDesignView() {
  document.getElementById('ledAreaInch').textContent = betaAreaInchLabel(getLedConfig().areaW, getLedConfig().areaH);
  sizeGridCanvas();
  drawGrid();
  renderZoneList();
  renderPortPanel();
  document.getElementById('ledTotalPx').textContent = recomputeTotalPx().toLocaleString();
}

function sizeGridCanvas() {
  const { cols, rows } = gridDims();
  _led.canvas.width = cols * CELL_PX;
  _led.canvas.height = rows * CELL_PX;
}

function drawGrid() {
  const ctx = _led.ctx;
  const { cols, rows } = gridDims();
  const cfg = getLedConfig();
  ctx.clearRect(0, 0, cols * CELL_PX, rows * CELL_PX);

  ctx.fillStyle = '#17181c';
  ctx.fillRect(0, 0, cols * CELL_PX, rows * CELL_PX);

  ctx.strokeStyle = '#2b2d33';
  ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c += 1) {
    ctx.beginPath(); ctx.moveTo(c * CELL_PX + 0.5, 0); ctx.lineTo(c * CELL_PX + 0.5, rows * CELL_PX); ctx.stroke();
  }
  for (let r = 0; r <= rows; r += 1) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL_PX + 0.5); ctx.lineTo(cols * CELL_PX, r * CELL_PX + 0.5); ctx.stroke();
  }

  cfg.zones.forEach((zone, i) => {
    const color = portColor(i);
    ctx.fillStyle = `${color}55`;
    ctx.fillRect(zone.startCol * CELL_PX, zone.startRow * CELL_PX, zone.cols * CELL_PX, zone.rows * CELL_PX);
    ctx.strokeStyle = color;
    ctx.lineWidth = zone.id === _led.selectedZoneId ? 3 : 1.5;
    ctx.strokeRect(zone.startCol * CELL_PX + 1, zone.startRow * CELL_PX + 1, zone.cols * CELL_PX - 2, zone.rows * CELL_PX - 2);
  });

  if (_led.dragStart && _led.dragCur) {
    const startRow = Math.min(_led.dragStart.row, _led.dragCur.row);
    const startCol = Math.min(_led.dragStart.col, _led.dragCur.col);
    const rows2 = Math.abs(_led.dragCur.row - _led.dragStart.row) + 1;
    const cols2 = Math.abs(_led.dragCur.col - _led.dragStart.col) + 1;
    ctx.fillStyle = 'rgba(110,107,244,0.25)';
    ctx.fillRect(startCol * CELL_PX, startRow * CELL_PX, cols2 * CELL_PX, rows2 * CELL_PX);
    ctx.strokeStyle = '#6e6bf4';
    ctx.lineWidth = 2;
    ctx.strokeRect(startCol * CELL_PX, startRow * CELL_PX, cols2 * CELL_PX, rows2 * CELL_PX);
  }
}

function renderZoneList() {
  const cfg = getLedConfig();
  document.getElementById('ledZoneCount').textContent = String(cfg.zones.length);
  const listEl = document.getElementById('ledZoneList');
  listEl.innerHTML = cfg.zones.length
    ? cfg.zones.map((zone, i) => {
      const px = betaPanels(zone).reduce((s, p) => s + panelPx(p), 0);
      const color = portColor(i);
      return `<div class="led-zone-row ${zone.id === _led.selectedZoneId ? 'sel' : ''}" data-zone-id="${zone.id}">
        <span class="zone-swatch" style="background:${color}"></span>
        <span class="zone-desc">${zone.led} · ${zone.panelW}×${zone.panelH} · ${zone.rows}×${zone.cols}칸</span>
        <span class="zone-px">${px.toLocaleString()}px</span>
        <button class="zone-del-btn" data-zone-id="${zone.id}">삭제</button>
      </div>`;
    }).join('')
    : '<div class="led-zone-empty">구역이 없습니다. 왼쪽 격자를 드래그해 추가하세요.</div>';

  listEl.querySelectorAll('.led-zone-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.zone-del-btn')) { return; }
      _led.selectedZoneId = row.dataset.zoneId;
      drawGrid();
      renderZoneList();
    });
  });
  listEl.querySelectorAll('.zone-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cfg2 = getLedConfig();
      cfg2.zones = cfg2.zones.filter(z => z.id !== btn.dataset.zoneId);
      if (_led.selectedZoneId === btn.dataset.zoneId) { _led.selectedZoneId = null; }
      resetPortAssignments();
      renderLedDesignView();
    });
  });
}

function renderPortPanel() {
  const cfg = getLedConfig();
  const isLan = _led.portTab === 'lan';
  const spec = isLan ? resolveLedPortSpec() : { portCount: PWR_PORT_COUNT, capPerPort: null, sourceLabel: '고정 18포트' };
  const ports = isLan ? cfg.lanPorts : cfg.pwrPorts;
  const panels = cfg.zones.flatMap(z => betaPanels(z));

  document.getElementById('ledPortSource').textContent =
    isLan ? `${spec.sourceLabel} · ${spec.portCount}포트 · 포트당 ${spec.capPerPort.toLocaleString()}px` : spec.sourceLabel;

  const listEl = document.getElementById('ledPortList');
  if (!ports || ports.length === 0) {
    listEl.innerHTML = '<div class="led-zone-empty">아직 할당되지 않았습니다. 자동 할당을 눌러주세요.</div>';
    return;
  }

  listEl.innerHTML = ports.map((keys, i) => {
    if (keys.length === 0) { return ''; }
    const px = portPx(panels, keys);
    const over = isLan && isOverCapacity(px, spec.capPerPort);
    const pct = isLan ? Math.min(100, Math.round(px / spec.capPerPort * 100)) : null;
    const color = portColor(i);
    return `<div class="led-port-row ${over ? 'over' : ''}">
      <span class="port-swatch" style="background:${color}"></span>
      <span class="port-name">P${i + 1}</span>
      <span class="port-meta">${keys.length}장${isLan ? ` · ${px.toLocaleString()}px${over ? ' ⚠ 초과' : ''}` : ''}</span>
      ${isLan ? `<div class="port-bar"><div class="port-bar-fill" style="width:${pct}%;background:${over ? '#f0576b' : color};"></div></div>` : ''}
    </div>`;
  }).join('') || '<div class="led-zone-empty">할당된 패널이 없습니다.</div>';
}
