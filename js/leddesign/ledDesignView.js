// ── ledDesignView ───────────────────────────────────
// LED디스플레이 노드의 세부 페이지: 구역(zone) 격자 편집(그리기→팝업 설정) +
// LAN/PWR 포트 수동 배정(탭 토글·롱프레스 드래그 페인트·되짚기 취소) + 자동 할당.
// 알고리즘은 specs.js/betaPanels.js/portAssignment.js(포팅됨)를 그대로 쓰고,
// 여기서는 DOM/캔버스 렌더링과 상호작용만 새로 구성한다.

const CELL_PX = 26; // 500mm 셀 하나의 화면 픽셀 크기
const LONG_PRESS_MS = 380;
const PWR_PORT_CAP = 300000; // 원본 betaAutoAssignPwr의 경험적 상수(script.js) — 수동 배정 시 초과 표시 기준으로도 재사용

const _led = {
  nodeId: null,
  canvas: null,
  ctx: null,
  mode: 'zone', // 'zone' | 'lan' | 'pwr'
  dragStart: null, // {row, col}
  dragCur: null,
  selectedZoneId: null,
  cfgTarget: null, // { mode:'new', rect } | { mode:'edit', zone }
  cfgPitch: '3mm',
  cfgW: 500,
  cfgH: 500,
  lastPitch: '3mm',
  lastPanelW: 500,
  lastPanelH: 500,
  activePort: 0,
  pointerDownPanel: null,
  pointerDownScreen: { x: 0, y: 0 },
  pointerMoved: false,
  isPainting: false,
  paintStack: [],
  longPressTimer: null,
};

function getLedNode() { return getNode(_led.nodeId); }
function getLedConfig() { return getLedNode().config.ledDesign; }

function allPanels() {
  return getLedConfig().zones.flatMap(z => betaPanels(z));
}

function recomputeTotalPx() {
  const total = allPanels().reduce((s, p) => s + panelPx(p), 0);
  getLedNode().config.totalRequiredPx = total;
  return total;
}

// 구역이 추가/삭제/변경되면 기존 포트 배정은 무효화(패널 key가 달라지므로) —
// 사용자가 자동 할당을 다시 누르거나 수동으로 다시 배정해야 한다.
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
  _led.activePort = 0;

  const cfg = getLedConfig();
  if (!cfg.lanPorts || cfg.lanPorts.length === 0) { resetPortAssignments(); }

  document.getElementById('graphView').hidden = true;
  document.getElementById('ledDesignView').hidden = false;

  if (!_led.canvas) { initLedDesignView(); }

  document.getElementById('ledAreaW').value = cfg.areaW || '';
  document.getElementById('ledAreaH').value = cfg.areaH || '';

  setLedMode('zone');
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

  document.querySelectorAll('.led-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setLedMode(btn.dataset.mode));
  });

  document.getElementById('ledCfgCancelBtn').addEventListener('click', closeZoneCfgPopup);
  document.getElementById('ledCfgApplyBtn').addEventListener('click', onZoneCfgApply);
  document.getElementById('ledCfgDeleteBtn').addEventListener('click', () => {
    if (_led.cfgTarget && _led.cfgTarget.mode === 'edit') { deleteZone(_led.cfgTarget.zone.id); }
  });
  document.querySelectorAll('#ledCfgPitchChips .led-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _led.cfgPitch = btn.dataset.pitch;
      document.querySelectorAll('#ledCfgPitchChips .led-chip').forEach(b => b.classList.toggle('on', b === btn));
    });
  });
  document.querySelectorAll('#ledCfgSizeChips .led-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _led.cfgW = Number(btn.dataset.w);
      _led.cfgH = Number(btn.dataset.h);
      document.querySelectorAll('#ledCfgSizeChips .led-chip').forEach(b => b.classList.toggle('on', b === btn));
    });
  });

  document.getElementById('ledAutoAssignBtn').addEventListener('click', () => {
    const cfg = getLedConfig();
    if (_led.mode === 'lan') {
      const spec = resolveLedPortSpec();
      cfg.lanPorts = autoAssignAllZones(cfg.zones, spec.portCount, spec.capPerPort);
    } else {
      cfg.pwrPorts = autoAssignAllZones(cfg.zones, PWR_PORT_COUNT, PWR_PORT_CAP);
    }
    renderPortPanel();
  });

  document.getElementById('ledResetAllBtn').addEventListener('click', () => {
    const cfg = getLedConfig();
    const key = _led.mode === 'lan' ? 'lanPorts' : 'pwrPorts';
    cfg[key] = Array.from({ length: portCountForMode() }, () => []);
    renderPortPanel();
  });
}

// ── 모드 전환 (구역 편집 / LAN 배선 / PWR 배선) ──────────
function setLedMode(mode) {
  _led.mode = mode;
  closeZoneCfgPopup();
  document.querySelectorAll('.led-mode-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  document.getElementById('ledModeHint').textContent = mode === 'zone'
    ? '그리드를 드래그해 새 구역을 만드세요 (500mm 칸 단위)'
    : '패널을 탭하면 켜짐/꺼짐, 길게 눌러 드래그하면 여러 패널에 칠해집니다. 칠하다 한 칸 되짚으면 취소돼요.';
  document.getElementById('ledZoneSection').hidden = mode !== 'zone';
  document.getElementById('ledPortSection').hidden = mode === 'zone';
  _led.canvas.style.cursor = mode === 'zone' ? 'crosshair' : 'pointer';
  renderLedDesignView();
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

function panelAtScreenPoint(e) {
  const rect = _led.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  return allPanels().find(p => {
    const px = p.x / 500 * CELL_PX; const py = p.y / 500 * CELL_PX;
    const pw = p.w / 500 * CELL_PX; const ph = p.h / 500 * CELL_PX;
    return x >= px && x < px + pw && y >= py && y < py + ph;
  }) || null;
}

// ── 캔버스 입력 디스패치 ──────────────────────────────
function onGridMouseDown(e) { if (_led.mode === 'zone') { onZoneMouseDown(e); } else { onPortMouseDown(e); } }
function onGridMouseMove(e) { if (_led.mode === 'zone') { onZoneMouseMove(e); } else { onPortMouseMove(e); } }
function onGridMouseUp(e) { if (_led.mode === 'zone') { onZoneMouseUp(e); } else { onPortMouseUp(e); } }

// ── 구역 편집: 그리기 → 팝업에서 피치/패널 크기 설정 ─────
function onZoneMouseDown(e) {
  const cell = cellFromEvent(e);
  const zone = zoneAtCell(cell.row, cell.col);
  if (zone) {
    _led.selectedZoneId = zone.id;
    drawGrid();
    renderZoneList();
    openZoneCfgPopup({ mode: 'edit', zone });
    return;
  }
  closeZoneCfgPopup();
  _led.selectedZoneId = null;
  _led.dragStart = cell;
  _led.dragCur = cell;
  drawGrid();
}

function onZoneMouseMove(e) {
  if (!_led.dragStart) { return; }
  _led.dragCur = cellFromEvent(e);
  drawGrid();
}

function onZoneMouseUp() {
  if (!_led.dragStart || !_led.dragCur) { _led.dragStart = null; return; }
  const startRow = Math.min(_led.dragStart.row, _led.dragCur.row);
  const startCol = Math.min(_led.dragStart.col, _led.dragCur.col);
  const rows = Math.abs(_led.dragCur.row - _led.dragStart.row) + 1;
  const cols = Math.abs(_led.dragCur.col - _led.dragStart.col) + 1;

  const cfg = getLedConfig();
  if (rectOverlapsZone(startRow, startCol, rows, cols, cfg.zones)) {
    _led.dragStart = null;
    _led.dragCur = null;
    drawGrid();
    return;
  }
  openZoneCfgPopup({ mode: 'new', rect: { startRow, startCol, rows, cols } });
}

// ── 구역 설정 팝업 ────────────────────────────────────
let _zoneCfgOutsideHandler = null;

function openZoneCfgPopup(target) {
  _led.cfgTarget = target;
  const pitch = target.mode === 'edit' ? target.zone.led : _led.lastPitch;
  const w = target.mode === 'edit' ? target.zone.panelW : _led.lastPanelW;
  const h = target.mode === 'edit' ? target.zone.panelH : _led.lastPanelH;
  _led.cfgPitch = pitch;
  _led.cfgW = w;
  _led.cfgH = h;

  document.querySelectorAll('#ledCfgPitchChips .led-chip').forEach(b => b.classList.toggle('on', b.dataset.pitch === pitch));
  document.querySelectorAll('#ledCfgSizeChips .led-chip').forEach(b =>
    b.classList.toggle('on', Number(b.dataset.w) === w && Number(b.dataset.h) === h));
  document.getElementById('ledCfgDeleteBtn').hidden = target.mode !== 'edit';

  const rect = target.mode === 'edit'
    ? { startRow: target.zone.startRow, startCol: target.zone.startCol, rows: target.zone.rows, cols: target.zone.cols }
    : target.rect;

  const popup = document.getElementById('ledZoneCfgPopup');
  const wrapEl = document.querySelector('.led-grid-wrap');
  const wrapRect = wrapEl.getBoundingClientRect();
  const canvasRect = _led.canvas.getBoundingClientRect();
  const left = canvasRect.left - wrapRect.left + (rect.startCol + rect.cols) * CELL_PX + 10;
  const top = canvasRect.top - wrapRect.top + rect.startRow * CELL_PX;
  popup.style.left = `${Math.max(8, Math.min(left, wrapRect.width - 250))}px`;
  popup.style.top = `${Math.max(8, Math.min(top, wrapRect.height - 190))}px`;
  popup.hidden = false;

  _zoneCfgOutsideHandler = ev => {
    if (!popup.contains(ev.target) && !_led.canvas.contains(ev.target)) { closeZoneCfgPopup(); }
  };
  setTimeout(() => window.addEventListener('mousedown', _zoneCfgOutsideHandler), 0);
}

function closeZoneCfgPopup() {
  document.getElementById('ledZoneCfgPopup').hidden = true;
  _led.cfgTarget = null;
  _led.dragStart = null;
  _led.dragCur = null;
  if (_zoneCfgOutsideHandler) {
    window.removeEventListener('mousedown', _zoneCfgOutsideHandler);
    _zoneCfgOutsideHandler = null;
  }
  if (_led.canvas) { drawGrid(); }
}

function onZoneCfgApply() {
  const target = _led.cfgTarget;
  if (!target) { return; }
  const cfg = getLedConfig();
  if (target.mode === 'new') {
    cfg.zones.push({
      id: makeId('lz'),
      led: _led.cfgPitch,
      startRow: target.rect.startRow, startCol: target.rect.startCol,
      rows: target.rect.rows, cols: target.rect.cols,
      panelW: _led.cfgW, panelH: _led.cfgH,
    });
  } else {
    target.zone.led = _led.cfgPitch;
    target.zone.panelW = _led.cfgW;
    target.zone.panelH = _led.cfgH;
  }
  _led.lastPitch = _led.cfgPitch;
  _led.lastPanelW = _led.cfgW;
  _led.lastPanelH = _led.cfgH;
  resetPortAssignments();
  closeZoneCfgPopup();
  renderLedDesignView();
}

function deleteZone(zoneId) {
  const cfg = getLedConfig();
  cfg.zones = cfg.zones.filter(z => z.id !== zoneId);
  if (_led.selectedZoneId === zoneId) { _led.selectedZoneId = null; }
  resetPortAssignments();
  closeZoneCfgPopup();
  renderLedDesignView();
}

// ── LAN/PWR 수동 포트 배정: 탭 토글 + 롱프레스 드래그 페인트 + 되짚기 취소 ──
function activePortsArray() {
  return _led.mode === 'lan' ? getLedConfig().lanPorts : getLedConfig().pwrPorts;
}

function portCountForMode() {
  return _led.mode === 'lan' ? resolveLedPortSpec().portCount : PWR_PORT_COUNT;
}

function capForMode() {
  return _led.mode === 'lan' ? resolveLedPortSpec().capPerPort : PWR_PORT_CAP;
}

// 그래프 상류 장비가 바뀌어 포트 수가 달라졌을 수 있으므로 배열 길이를 맞춘다
// (기존 배정은 앞쪽 포트부터 최대한 보존).
function ensurePortsSized() {
  const cfg = getLedConfig();
  const count = portCountForMode();
  const key = _led.mode === 'lan' ? 'lanPorts' : 'pwrPorts';
  if (!cfg[key] || cfg[key].length !== count) {
    const old = cfg[key] || [];
    cfg[key] = Array.from({ length: count }, (_v, i) => old[i] || []);
  }
}

function portIndexOfKey(key) {
  return activePortsArray().findIndex(arr => arr.includes(key));
}

function setPanelPort(key, portIdx) {
  const ports = activePortsArray();
  ports.forEach(arr => {
    const i = arr.indexOf(key);
    if (i !== -1) { arr.splice(i, 1); }
  });
  if (portIdx !== -1 && portIdx != null) { ports[portIdx].push(key); }
}

function togglePanel(panel) {
  const owner = portIndexOfKey(panel.key);
  setPanelPort(panel.key, owner === _led.activePort ? -1 : _led.activePort);
}

// 드래그로 지나간 칸을 활성 포트에 칠한다. 바로 이전 칸으로 되짚으면 그 칠을 취소한다.
function paintPanel(panel) {
  const stack = _led.paintStack;
  if (stack.length && stack[stack.length - 1].key === panel.key) { return; }
  if (stack.length >= 2 && stack[stack.length - 2].key === panel.key) {
    const last = stack.pop();
    setPanelPort(last.key, last.prevPort);
    return;
  }
  const prevPort = portIndexOfKey(panel.key);
  stack.push({ key: panel.key, prevPort });
  setPanelPort(panel.key, _led.activePort);
}

function onPortMouseDown(e) {
  const panel = panelAtScreenPoint(e);
  _led.pointerDownPanel = panel;
  _led.pointerDownScreen = { x: e.clientX, y: e.clientY };
  _led.pointerMoved = false;
  _led.isPainting = false;
  _led.paintStack = [];
  if (!panel) { return; }
  clearTimeout(_led.longPressTimer);
  _led.longPressTimer = setTimeout(() => {
    if (!_led.pointerDownPanel) { return; }
    const owner = portIndexOfKey(panel.key);
    if (owner !== -1) { _led.activePort = owner; renderPortStrip(); renderPortDetail(); }
    _led.isPainting = true;
    paintPanel(panel);
    drawGrid();
  }, LONG_PRESS_MS);
}

function onPortMouseMove(e) {
  if (!_led.pointerDownPanel) { return; }
  if (Math.abs(e.clientX - _led.pointerDownScreen.x) > 4 || Math.abs(e.clientY - _led.pointerDownScreen.y) > 4) {
    _led.pointerMoved = true;
  }
  if (!_led.isPainting) { return; }
  const panel = panelAtScreenPoint(e);
  if (!panel) { return; }
  paintPanel(panel);
  drawGrid();
}

function onPortMouseUp() {
  clearTimeout(_led.longPressTimer);
  if (!_led.isPainting && _led.pointerDownPanel && !_led.pointerMoved) {
    togglePanel(_led.pointerDownPanel);
  }
  const didChange = _led.isPainting || (_led.pointerDownPanel && !_led.pointerMoved);
  _led.pointerDownPanel = null;
  _led.isPainting = false;
  _led.paintStack = [];
  if (didChange) { renderPortPanel(); drawGrid(); }
}

// ── 렌더링 ────────────────────────────────────────────
function renderLedDesignView() {
  document.getElementById('ledAreaInch').textContent = betaAreaInchLabel(getLedConfig().areaW, getLedConfig().areaH);
  sizeGridCanvas();
  drawGrid();
  if (_led.mode === 'zone') { renderZoneList(); } else { renderPortPanel(); }
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

  if (_led.mode === 'zone') { drawZonesForEdit(ctx); } else { drawPanelsForPortMode(ctx); }
  if (_led.dragStart && _led.dragCur && _led.mode === 'zone') { drawDragRect(ctx); }
}

function drawZonesForEdit(ctx) {
  const cfg = getLedConfig();
  cfg.zones.forEach((zone, i) => {
    const color = portColor(i);
    ctx.fillStyle = `${color}33`;
    ctx.fillRect(zone.startCol * CELL_PX, zone.startRow * CELL_PX, zone.cols * CELL_PX, zone.rows * CELL_PX);

    ctx.strokeStyle = `${color}88`;
    ctx.lineWidth = 1;
    betaPanels(zone).forEach(p => {
      ctx.strokeRect(p.x / 500 * CELL_PX + 0.5, p.y / 500 * CELL_PX + 0.5, p.w / 500 * CELL_PX - 1, p.h / 500 * CELL_PX - 1);
    });

    ctx.strokeStyle = color;
    ctx.lineWidth = zone.id === _led.selectedZoneId ? 3 : 1.5;
    ctx.strokeRect(zone.startCol * CELL_PX + 1, zone.startRow * CELL_PX + 1, zone.cols * CELL_PX - 2, zone.rows * CELL_PX - 2);
  });
}

function drawPanelsForPortMode(ctx) {
  const cfg = getLedConfig();
  const ports = activePortsArray();
  cfg.zones.forEach(zone => {
    ctx.strokeStyle = '#3a3c44';
    ctx.lineWidth = 1;
    ctx.strokeRect(zone.startCol * CELL_PX + 0.5, zone.startRow * CELL_PX + 0.5, zone.cols * CELL_PX - 1, zone.rows * CELL_PX - 1);

    betaPanels(zone).forEach(p => {
      const portIdx = ports.findIndex(arr => arr.includes(p.key));
      const px = p.x / 500 * CELL_PX; const py = p.y / 500 * CELL_PX;
      const pw = p.w / 500 * CELL_PX; const ph = p.h / 500 * CELL_PX;
      if (portIdx !== -1) {
        const color = portColor(portIdx);
        ctx.fillStyle = portIdx === _led.activePort ? `${color}aa` : `${color}55`;
        ctx.fillRect(px, py, pw, ph);
      }
      ctx.strokeStyle = portIdx === _led.activePort ? '#ffffff' : '#4a4d55';
      ctx.lineWidth = portIdx === _led.activePort ? 2 : 1;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    });
  });
}

function drawDragRect(ctx) {
  const startRow = Math.min(_led.dragStart.row, _led.dragCur.row);
  const startCol = Math.min(_led.dragStart.col, _led.dragCur.col);
  const rowsN = Math.abs(_led.dragCur.row - _led.dragStart.row) + 1;
  const colsN = Math.abs(_led.dragCur.col - _led.dragStart.col) + 1;

  ctx.fillStyle = 'rgba(110,107,244,0.25)';
  ctx.fillRect(startCol * CELL_PX, startRow * CELL_PX, colsN * CELL_PX, rowsN * CELL_PX);
  ctx.strokeStyle = '#6e6bf4';
  ctx.lineWidth = 2;
  ctx.strokeRect(startCol * CELL_PX, startRow * CELL_PX, colsN * CELL_PX, rowsN * CELL_PX);

  if (!_led.cfgTarget) {
    ctx.fillStyle = '#e8e8ef';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${colsN * 500}×${rowsN * 500}mm`, startCol * CELL_PX + 4, startRow * CELL_PX + 14);
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
      const zone = cfg.zones.find(z => z.id === row.dataset.zoneId);
      _led.selectedZoneId = zone.id;
      drawGrid();
      renderZoneList();
      openZoneCfgPopup({ mode: 'edit', zone });
    });
  });
  listEl.querySelectorAll('.zone-del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteZone(btn.dataset.zoneId));
  });
}

function renderPortPanel() {
  ensurePortsSized();
  const isLan = _led.mode === 'lan';
  const spec = isLan ? resolveLedPortSpec() : { portCount: PWR_PORT_COUNT, capPerPort: PWR_PORT_CAP, sourceLabel: '고정 18포트' };
  document.getElementById('ledPortSource').textContent =
    `${spec.sourceLabel} · ${spec.portCount}포트 · 포트당 ${spec.capPerPort.toLocaleString()}px`;
  if (_led.activePort >= spec.portCount) { _led.activePort = 0; }
  renderPortStrip();
  renderPortDetail();
}

function renderPortStrip() {
  const ports = activePortsArray();
  const strip = document.getElementById('ledPortStrip');
  strip.innerHTML = ports.map((keys, i) => {
    const color = portColor(i);
    return `<button class="led-port-chip ${i === _led.activePort ? 'on' : ''}" data-port="${i}" style="--chip-color:${color}">
      P${i + 1}<span class="chip-count">${keys.length}</span>
    </button>`;
  }).join('');
  strip.querySelectorAll('.led-port-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _led.activePort = Number(btn.dataset.port);
      renderPortStrip();
      renderPortDetail();
      drawGrid();
    });
  });
}

function renderPortDetail() {
  const panels = allPanels();
  const ports = activePortsArray();
  const keys = ports[_led.activePort] || [];
  const px = portPx(panels, keys);
  const cap = capForMode();
  const over = isOverCapacity(px, cap);
  const pct = Math.min(100, Math.round(px / cap * 100));
  const color = portColor(_led.activePort);

  const detail = document.getElementById('ledPortDetail');
  detail.innerHTML = `
    <div class="led-port-detail-head">
      <span class="port-swatch" style="background:${color}"></span>
      <span class="port-name">P${_led.activePort + 1}</span>
      <span class="port-meta">${keys.length}장 · ${px.toLocaleString()}px${over ? ' ⚠ 초과' : ''}</span>
      <button id="ledPortResetBtn" class="port-reset-btn">초기화</button>
    </div>
    <div class="port-bar"><div class="port-bar-fill" style="width:${pct}%;background:${over ? 'var(--err)' : color};"></div></div>
  `;
  document.getElementById('ledPortResetBtn').addEventListener('click', () => {
    ports[_led.activePort] = [];
    renderPortPanel();
    drawGrid();
  });
}
