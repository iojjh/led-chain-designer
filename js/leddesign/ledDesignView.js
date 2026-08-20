// ── ledDesignView ───────────────────────────────────
// LED디스플레이 노드의 세부 페이지: 구역(zone) 격자 편집 + LAN/PWR 포트 수동 배정.
// 조작감·시각 효과는 led-calculator의 혼합 시뮬레이터 β 편집 캔버스
// (script.js:2793-3919, betaDrawEdit/betaAttachEditEv 등)를 그대로 이식했다:
// rAF 기반 드래그 사각형 스무딩, mouseup 시점 탭/드래그 판정, 터치 이벤트, 라운드
// 렌더링, 캔버스 내 구역 정보 텍스트, 선택 하이라이트, 잔여 셀 라벨, 신규 구역
// 생성 애니메이션. 격자 크기는 창/화면에 맞춰 항상 한눈에 들어오도록 자동 조정.
// LAN/PWR 포트 배정 캔버스는 (제거된) §11 랜선 시뮬레이터(script.backup.js
// 1557-2400줄, buildSim/drawPortPaths/_calcLan/attachEv 등)의 편의기능도
// 이식했다: 배선 경로 베지어 곡선+화살표, 셀 내 연결순서·포트 라벨, 케이블
// 소요량 계산(여유분 직접 편집), 키보드 방향키 정밀 배정, 터치/마우스 롱프레스
// 딜레이 분리, 진동 피드백, 전체초기화 확인 다이얼로그.
// 알고리즘은 specs.js/betaPanels.js/portAssignment.js(포팅됨)를 그대로 쓰고,
// 여기서는 DOM/캔버스 렌더링과 상호작용만 새로 구성한다.

const LONG_PRESS_MOUSE_MS = 380;
const LONG_PRESS_TOUCH_MS = 600; // 터치는 오탭 방지를 위해 마우스보다 길게(원본 LP_TOUCH)
const PWR_PORT_CAP = 300000; // 원본 betaAutoAssignPwr의 경험적 상수(script.js) — 수동 배정 시 초과 표시 기준으로도 재사용
const ZONE_ANIM_MS = 380;
const LAN_SHORT_BUNDLE = 20; // 숏랜 묶음 단위(원본 §11 그대로)
const PWR_SHORT_BUNDLE = 10; // 숏 파워 묶음 단위(원본 §11 그대로)

const _led = {
  nodeId: null,
  canvas: null,
  ctx: null,
  mode: 'zone', // 'zone' | 'lan' | 'pwr'
  cellPx: 55,
  dragStart: null, // {row, col}
  dragCur: null,
  dragLerp: null, // {r0,c0,r1,c1} — 목표 사각형을 향해 매 프레임 보간되는 미리보기 좌표
  wasDrag: false,
  selectedZoneId: null,
  cfgZone: null, // 편집 팝업 대상 구역(신규 생성은 팝업 없이 즉시 생성)
  cfgPitch: '3mm',
  cfgW: 500,
  cfgH: 500,
  newPitch: '3mm', // 신규 구역 생성 시 미리 선택해두는 피치/패널 크기(툴바 칩)
  newPanelW: 500,
  newPanelH: 500,
  animProg: null, // {ids:Set, t} — 신규 구역 생성 애니메이션 진행도
  activePort: 0,
  focusPanelKey: null, // 키보드 방향키 포커스 패널(원본 fCell)
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
  cfg.lanPorts = Array.from({ length: ledPortLayout().ports.length }, () => []);
  cfg.pwrPorts = Array.from({ length: PWR_PORT_COUNT }, () => []);
}

// LED 노드 상류의 LAN 포트 그룹(샌딩카드별)은 ledPortGroups.js(순수 함수,
// validationEngine.js와 공유)의 resolveLedPortGroups/resolveLedPortLayout을 쓴다.
function ledPortLayout() {
  return resolveLedPortLayout(State.graph, _led.nodeId);
}

function openLedDesignView(nodeId) {
  _led.nodeId = nodeId;
  _led.selectedZoneId = null;
  _led.dragStart = null;
  _led.dragCur = null;
  _led.dragLerp = null;
  _led.activePort = 0;
  _led.focusPanelKey = null;

  const cfg = getLedConfig();
  if (!cfg.lanPorts || cfg.lanPorts.length === 0) { resetPortAssignments(); }

  document.getElementById('graphView').hidden = true;
  document.getElementById('ledDesignView').hidden = false;

  if (!_led.canvas) { initLedDesignView(); }

  document.getElementById('ledAreaW').value = cfg.areaW ? cfg.areaW / 1000 : '';
  document.getElementById('ledAreaH').value = cfg.areaH ? cfg.areaH / 1000 : '';

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
    getLedConfig().areaW = Math.round((Number(e.target.value) || 0) * 1000);
    renderLedDesignView();
  });
  document.getElementById('ledAreaH').addEventListener('change', e => {
    getLedConfig().areaH = Math.round((Number(e.target.value) || 0) * 1000);
    renderLedDesignView();
  });

  _led.canvas.addEventListener('mousedown', onGridMouseDown);
  window.addEventListener('mousemove', onGridMouseMove);
  window.addEventListener('mouseup', onGridMouseUp);
  _led.canvas.addEventListener('touchstart', e => { e.preventDefault(); onGridMouseDown(e); }, { passive: false });
  _led.canvas.addEventListener('touchmove', e => { e.preventDefault(); onGridMouseMove(e); }, { passive: false });
  _led.canvas.addEventListener('touchend', e => { e.preventDefault(); onGridMouseUp(e); }, { passive: false });
  _led.canvas.addEventListener('keydown', onPortKeyDown);

  document.querySelectorAll('.led-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setLedMode(btn.dataset.mode));
  });

  document.querySelectorAll('#ledNewPitchChips .led-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _led.newPitch = btn.dataset.pitch;
      document.querySelectorAll('#ledNewPitchChips .led-chip').forEach(b => b.classList.toggle('on', b === btn));
    });
  });
  document.querySelectorAll('#ledNewSizeChips .led-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _led.newPanelW = Number(btn.dataset.w);
      _led.newPanelH = Number(btn.dataset.h);
      document.querySelectorAll('#ledNewSizeChips .led-chip').forEach(b => b.classList.toggle('on', b === btn));
    });
  });

  document.getElementById('ledCfgCancelBtn').addEventListener('click', closeZoneCfgPopup);
  document.getElementById('ledCfgApplyBtn').addEventListener('click', onZoneCfgApply);
  document.getElementById('ledCfgDeleteBtn').addEventListener('click', () => {
    if (_led.cfgZone) { deleteZone(_led.cfgZone.id); }
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
      const layout = ledPortLayout();
      // 샌딩카드마다 포트당 상한이 다를 수 있으므로, 전체 배정 한 번에 걸쳐 가장
      // 작은 상한을 공통으로 써서 안전하게(어떤 포트에 배정되든 초과하지 않게) 채운다.
      const safeCap = Math.min(...layout.groups.map(g => g.capPerPort));
      cfg.lanPorts = autoAssignAllZones(cfg.zones, layout.ports.length, safeCap);
    } else {
      cfg.pwrPorts = autoAssignAllZones(cfg.zones, PWR_PORT_COUNT, PWR_PORT_CAP);
    }
    renderPortPanel();
  });

  document.getElementById('ledResetAllBtn').addEventListener('click', () => {
    const label = _led.mode === 'lan' ? 'LAN' : 'PWR';
    if (!window.confirm(`현재 ${label} 포트 배정을 전부 초기화할까요? 되돌릴 수 없습니다.`)) { return; }
    const cfg = getLedConfig();
    const key = _led.mode === 'lan' ? 'lanPorts' : 'pwrPorts';
    cfg[key] = Array.from({ length: portCountForMode() }, () => []);
    _led.focusPanelKey = null;
    renderPortPanel();
    drawGrid();
  });

  // 창 크기 변경(브라우저 리사이즈, 모바일 회전 등)에도 격자가 항상 화면에 맞게
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!_led.nodeId || document.getElementById('ledDesignView').hidden) { return; }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { sizeGridCanvas(); drawGrid(); }, 100);
  });
}

// ── 모드 전환 (구역 편집 / LAN 배선 / PWR 배선) ──────────
function setLedMode(mode) {
  _led.mode = mode;
  _led.focusPanelKey = null;
  closeZoneCfgPopup();
  document.querySelectorAll('.led-mode-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  document.getElementById('ledModeHint').textContent = mode === 'zone'
    ? '그리드를 드래그해 새 구역을 만드세요 (500mm 칸 단위)'
    : '패널을 탭하면 켜짐/꺼짐, 길게 눌러 드래그하면 여러 패널에 칠해집니다. 칠하다 한 칸 되짚으면 취소돼요.';
  document.getElementById('ledNewZoneToolbar').hidden = mode !== 'zone';
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

// 가로·세로 모두 뷰포트 안에 들어오도록(overflow 없이) 맞추되, 그 안에서 가능한
// 가장 큰 셀 크기를 쓴다 — 브라우저 창 크기나 모바일 화면에 따라 전체 격자가
// 항상 한눈에 들어오게.
function computeCellPx() {
  const { cols, rows } = gridDims();
  const wrapEl = document.querySelector('.led-grid-scroll');
  if (!wrapEl) { return 40; }
  const cs = getComputedStyle(wrapEl);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const availW = Math.max(40, wrapEl.clientWidth - padX);
  const availH = Math.max(40, wrapEl.clientHeight - padY);
  return Math.max(4, Math.min(availW / cols, availH / rows));
}

// 마우스/터치 이벤트를 동일하게 다루기 위한 좌표 추출
function clientXY(e) {
  if (e.touches && e.touches.length) { return { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
  if (e.changedTouches && e.changedTouches.length) { return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }; }
  return { x: e.clientX, y: e.clientY };
}

// 캔버스가 CSS로 늘어나 있어도(반응형 등) 실제 캔버스 픽셀 좌표로 정확히 보정
function canvasPoint(e) {
  const { x, y } = clientXY(e);
  const rect = _led.canvas.getBoundingClientRect();
  const scX = _led.canvas.width / (rect.width || _led.canvas.width);
  const scY = _led.canvas.height / (rect.height || _led.canvas.height);
  return { x: (x - rect.left) * scX, y: (y - rect.top) * scY };
}

function cellFromEvent(e) {
  const { x, y } = canvasPoint(e);
  const col = Math.floor(x / _led.cellPx);
  const row = Math.floor(y / _led.cellPx);
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
  const { x, y } = canvasPoint(e);
  return allPanels().find(p => {
    const px = p.x / 500 * _led.cellPx; const py = p.y / 500 * _led.cellPx;
    const pw = p.w / 500 * _led.cellPx; const ph = p.h / 500 * _led.cellPx;
    return x >= px && x < px + pw && y >= py && y < py + ph;
  }) || null;
}

// ── 캔버스 입력 디스패치 ──────────────────────────────
function onGridMouseDown(e) { if (_led.mode === 'zone') { onZoneMouseDown(e); } else { onPortMouseDown(e); } }
function onGridMouseMove(e) { if (_led.mode === 'zone') { onZoneMouseMove(e); } else { onPortMouseMove(e); } }
function onGridMouseUp(e) { if (_led.mode === 'zone') { onZoneMouseUp(e); } else { onPortMouseUp(e); } }

// ── 구역 편집: 드래그하면 툴바에서 미리 고른 피치·패널크기로 즉시 생성,
//    탭(이동 없는 클릭)하면 기존 구역을 선택하고 편집 팝업을 연다 ──────
function onZoneMouseDown(e) {
  closeZoneCfgPopup();
  const cell = cellFromEvent(e);
  _led.dragStart = cell;
  _led.dragCur = cell;
  _led.wasDrag = false;
  _led.dragLerp = { r0: cell.row, c0: cell.col, r1: cell.row + 1, c1: cell.col + 1 };
  requestAnimationFrame(zoneDragRafLoop);
}

function onZoneMouseMove(e) {
  if (!_led.dragStart) { return; }
  const cell = cellFromEvent(e);
  if (cell.row !== _led.dragCur.row || cell.col !== _led.dragCur.col) {
    _led.dragCur = cell;
    _led.wasDrag = true;
  }
}

// 드래그 미리보기 사각형을 목표 좌표로 매 프레임 25%씩 보간해 부드럽게 따라오게 한다.
function zoneDragRafLoop() {
  if (!_led.dragLerp || !_led.dragStart) { return; }
  const st = _led.dragStart; const cur = _led.dragCur;
  const tr0 = Math.min(st.row, cur.row); const tc0 = Math.min(st.col, cur.col);
  const tr1 = Math.max(st.row, cur.row) + 1; const tc1 = Math.max(st.col, cur.col) + 1;
  const L = 0.25; const l = _led.dragLerp;
  l.r0 += (tr0 - l.r0) * L; l.c0 += (tc0 - l.c0) * L;
  l.r1 += (tr1 - l.r1) * L; l.c1 += (tc1 - l.c1) * L;
  drawGrid();
  requestAnimationFrame(zoneDragRafLoop);
}

function onZoneMouseUp() {
  if (!_led.dragStart) { return; }
  const st = _led.dragStart; const cur = _led.dragCur;
  const startRow = Math.min(st.row, cur.row); const startCol = Math.min(st.col, cur.col);
  const rows = Math.abs(cur.row - st.row) + 1; const cols = Math.abs(cur.col - st.col) + 1;
  const wasDrag = _led.wasDrag;
  _led.dragStart = null; _led.dragCur = null; _led.dragLerp = null; _led.wasDrag = false;

  if (!wasDrag) {
    const zone = zoneAtCell(startRow, startCol);
    _led.selectedZoneId = zone ? zone.id : null;
    renderZoneList();
    drawGrid();
    if (zone) { openZoneCfgPopup(zone); }
    return;
  }

  const cfg = getLedConfig();
  if (rectOverlapsZone(startRow, startCol, rows, cols, cfg.zones)) {
    showToast('다른 구역과 겹칩니다.');
    drawGrid();
    return;
  }
  const newZone = {
    id: makeId('lz'),
    led: _led.newPitch,
    startRow, startCol, rows, cols,
    panelW: _led.newPanelW, panelH: _led.newPanelH,
  };
  cfg.zones.push(newZone);
  resetPortAssignments();
  renderLedDesignView();
  animateNewZone(newZone.id);
}

function animateNewZone(zoneId) {
  const t0 = performance.now();
  const ids = new Set([zoneId]);
  function frame(now) {
    const p = Math.min((now - t0) / ZONE_ANIM_MS, 1);
    _led.animProg = { ids, t: 1 - Math.pow(1 - p, 3) }; // ease-out cubic
    drawGrid();
    if (p < 1) { requestAnimationFrame(frame); } else { _led.animProg = null; drawGrid(); }
  }
  requestAnimationFrame(frame);
}

// ── 구역 편집 팝업 (기존 구역 전용 — 신규 생성은 툴바 사전 선택으로 즉시 반영) ──
let _zoneCfgOutsideHandler = null;

function openZoneCfgPopup(zone) {
  _led.cfgZone = zone;
  _led.cfgPitch = zone.led;
  _led.cfgW = zone.panelW;
  _led.cfgH = zone.panelH;

  document.querySelectorAll('#ledCfgPitchChips .led-chip').forEach(b => b.classList.toggle('on', b.dataset.pitch === zone.led));
  document.querySelectorAll('#ledCfgSizeChips .led-chip').forEach(b =>
    b.classList.toggle('on', Number(b.dataset.w) === zone.panelW && Number(b.dataset.h) === zone.panelH));

  const popup = document.getElementById('ledZoneCfgPopup');
  const wrapEl = document.querySelector('.led-grid-wrap');
  const wrapRect = wrapEl.getBoundingClientRect();
  const canvasRect = _led.canvas.getBoundingClientRect();
  const left = canvasRect.left - wrapRect.left + (zone.startCol + zone.cols) * _led.cellPx + 10;
  const top = canvasRect.top - wrapRect.top + zone.startRow * _led.cellPx;
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
  _led.cfgZone = null;
  if (_zoneCfgOutsideHandler) {
    window.removeEventListener('mousedown', _zoneCfgOutsideHandler);
    _zoneCfgOutsideHandler = null;
  }
  if (_led.canvas) { drawGrid(); }
}

function onZoneCfgApply() {
  const zone = _led.cfgZone;
  if (!zone) { return; }
  zone.led = _led.cfgPitch;
  zone.panelW = _led.cfgW;
  zone.panelH = _led.cfgH;
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
  return _led.mode === 'lan' ? ledPortLayout().ports.length : PWR_PORT_COUNT;
}

// 활성 포트가 실제로 속한 그룹(샌딩카드)의 상한 — LAN은 그룹마다 상한이 다를 수 있다.
function capForActivePort() {
  if (_led.mode !== 'lan') { return PWR_PORT_CAP; }
  const layout = ledPortLayout();
  const group = layout.ports[_led.activePort];
  return group ? group.capPerPort : MAX_PX;
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

// 탭 토글: 이미 활성 포트 소속이면 해제, 아니면 활성 포트로 배정. 배정/해제에
// 따라 키보드 포커스도 함께 옮겨서 탭 직후 방향키로 이어서 배선할 수 있게 한다.
function togglePanel(panel) {
  const owner = portIndexOfKey(panel.key);
  if (owner === _led.activePort) {
    setPanelPort(panel.key, -1);
    if (_led.focusPanelKey === panel.key) { _led.focusPanelKey = null; }
  } else {
    setPanelPort(panel.key, _led.activePort);
    _led.focusPanelKey = panel.key;
  }
}

// 드래그로 지나간 칸을 활성 포트에 칠한다. 바로 이전 칸으로 되짚으면 그 칠을 취소한다.
function paintPanel(panel) {
  const stack = _led.paintStack;
  if (stack.length && stack[stack.length - 1].key === panel.key) { return; }
  if (stack.length >= 2 && stack[stack.length - 2].key === panel.key) {
    const last = stack.pop();
    setPanelPort(last.key, last.prevPort);
    if (navigator.vibrate) { navigator.vibrate(25); }
    return;
  }
  const prevPort = portIndexOfKey(panel.key);
  stack.push({ key: panel.key, prevPort });
  setPanelPort(panel.key, _led.activePort);
  if (navigator.vibrate) { navigator.vibrate(15); }
}

function onPortMouseDown(e) {
  const panel = panelAtScreenPoint(e);
  _led.pointerDownPanel = panel;
  _led.pointerDownScreen = clientXY(e);
  _led.pointerMoved = false;
  _led.isPainting = false;
  _led.paintStack = [];
  if (!panel) { return; }
  clearTimeout(_led.longPressTimer);
  const isTouch = !!(e.touches && e.touches.length);
  _led.longPressTimer = setTimeout(() => {
    if (!_led.pointerDownPanel) { return; }
    const owner = portIndexOfKey(panel.key);
    if (owner !== -1) { _led.activePort = owner; renderPortStrip(); renderPortDetail(); }
    _led.isPainting = true;
    _led.focusPanelKey = null;
    setDragBadge(true);
    paintPanel(panel);
    drawGrid();
  }, isTouch ? LONG_PRESS_TOUCH_MS : LONG_PRESS_MOUSE_MS);
}

function onPortMouseMove(e) {
  if (!_led.pointerDownPanel) { return; }
  const { x, y } = clientXY(e);
  if (Math.abs(x - _led.pointerDownScreen.x) > 4 || Math.abs(y - _led.pointerDownScreen.y) > 4) {
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
  setDragBadge(false);
  if (!_led.isPainting && _led.pointerDownPanel && !_led.pointerMoved) {
    togglePanel(_led.pointerDownPanel);
  }
  const didChange = _led.isPainting || (_led.pointerDownPanel && !_led.pointerMoved);
  _led.pointerDownPanel = null;
  _led.isPainting = false;
  _led.paintStack = [];
  if (didChange) { renderPortPanel(); drawGrid(); _led.canvas.focus(); }
}

function setDragBadge(on) {
  const el = document.getElementById('ledDragBadge');
  if (el) { el.hidden = !on; }
}

// ── 키보드 방향키로 정밀 배정/이동 (원본 §11 fCell 방향키 내비게이션 이식) ──
// 패널들은 500mm 격자에 정렬돼 있으므로, 현재 포커스 패널 기준 해당 방향에
// 있는 가장 가까운 패널을 찾아 이동한다. 뒤로 되짚으면(직전 셀로 복귀) 자동 취소.
function onPortKeyDown(e) {
  if (_led.mode === 'zone') { return; }
  const dirMap = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const dir = dirMap[e.key];
  if (!dir) { return; }
  e.preventDefault();
  const panels = allPanels();
  if (!panels.length) { return; }

  if (!_led.focusPanelKey) {
    const first = panels[0];
    _led.focusPanelKey = first.key;
    setPanelPort(first.key, _led.activePort);
    renderPortPanel(); drawGrid();
    return;
  }

  const cur = panels.find(p => p.key === _led.focusPanelKey);
  if (!cur) { _led.focusPanelKey = null; return; }

  const hist = activePortsArray()[_led.activePort];
  if (hist.length >= 2) {
    const prevPanel = panels.find(p => p.key === hist[hist.length - 2]);
    if (prevPanel && isNeighborInDir(cur, prevPanel, dir)) {
      setPanelPort(cur.key, -1);
      _led.focusPanelKey = prevPanel.key;
      renderPortPanel(); drawGrid();
      return;
    }
  }

  const target = nearestPanelInDirection(cur, panels, dir);
  if (!target) {
    if (hist.length === 1 && hist[0] === cur.key) {
      setPanelPort(cur.key, -1);
      _led.focusPanelKey = null;
      renderPortPanel(); drawGrid();
    }
    return;
  }
  const owner = portIndexOfKey(target.key);
  if (owner !== -1 && owner !== _led.activePort) { return; }
  _led.focusPanelKey = target.key;
  setPanelPort(target.key, _led.activePort);
  renderPortPanel(); drawGrid();
}

function isNeighborInDir(from, to, dir) {
  const dx = Math.sign((to.x + to.w / 2) - (from.x + from.w / 2));
  const dy = Math.sign((to.y + to.h / 2) - (from.y + from.h / 2));
  return dx === dir[0] && dy === dir[1];
}

// from 기준 dir(방향 벡터) 쪽에 있는 패널 중 진행축에서 벗어난 정도가 작고
// 가장 가까운 것을 고른다 — 균일하지 않은 패널 크기(500×1000 등)에도 대응.
function nearestPanelInDirection(from, panels, dir) {
  const [dxs, dys] = dir;
  const fromCx = from.x + from.w / 2; const fromCy = from.y + from.h / 2;
  let best = null; let bestDist = Infinity;
  panels.forEach(p => {
    if (p.key === from.key) { return; }
    const cx = p.x + p.w / 2; const cy = p.y + p.h / 2;
    const dx = cx - fromCx; const dy = cy - fromCy;
    if (dxs !== 0 && Math.sign(dx) !== dxs) { return; }
    if (dys !== 0 && Math.sign(dy) !== dys) { return; }
    if (dxs !== 0 && Math.abs(dy) > Math.abs(dx) * 0.5) { return; }
    if (dys !== 0 && Math.abs(dx) > Math.abs(dy) * 0.5) { return; }
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) { bestDist = dist; best = p; }
  });
  return best;
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
  _led.cellPx = computeCellPx();
  _led.canvas.width = cols * _led.cellPx;
  _led.canvas.height = rows * _led.cellPx;
}

function drawGrid() {
  const ctx = _led.ctx;
  const { cols, rows } = gridDims();
  ctx.clearRect(0, 0, cols * _led.cellPx, rows * _led.cellPx);

  ctx.fillStyle = '#17181c';
  ctx.fillRect(0, 0, cols * _led.cellPx, rows * _led.cellPx);

  ctx.strokeStyle = '#2b2d33';
  ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c += 1) {
    ctx.beginPath(); ctx.moveTo(c * _led.cellPx + 0.5, 0); ctx.lineTo(c * _led.cellPx + 0.5, rows * _led.cellPx); ctx.stroke();
  }
  for (let r = 0; r <= rows; r += 1) {
    ctx.beginPath(); ctx.moveTo(0, r * _led.cellPx + 0.5); ctx.lineTo(cols * _led.cellPx, r * _led.cellPx + 0.5); ctx.stroke();
  }

  if (_led.mode === 'zone') {
    drawZonesForEdit(ctx);
    if (_led.dragLerp) { drawDragRect(ctx); }
  } else {
    drawPanelsForPortMode(ctx);
  }
}

function drawZonesForEdit(ctx) {
  const cfg = getLedConfig();
  cfg.zones.forEach((zone, i) => {
    const color = portColor(i);
    const zx = zone.startCol * _led.cellPx; const zy = zone.startRow * _led.cellPx;
    const zw = zone.cols * _led.cellPx; const zh = zone.rows * _led.cellPx;
    const cr = Math.min(8, zw * 0.14, zh * 0.14);
    const anim = _led.animProg;
    const isNew = anim && anim.ids.has(zone.id);

    if (isNew) {
      ctx.save();
      ctx.globalAlpha = anim.t;
      const s = 0.88 + 0.12 * anim.t;
      ctx.translate(zx + zw / 2, zy + zh / 2);
      ctx.scale(s, s);
      ctx.translate(-(zx + zw / 2), -(zy + zh / 2));
    }

    ctx.save();
    ctx.beginPath(); ctx.roundRect(zx, zy, zw, zh, cr); ctx.clip();
    ctx.fillStyle = `${color}2e`; ctx.fillRect(zx, zy, zw, zh);
    ctx.strokeStyle = `${color}88`; ctx.lineWidth = 1;
    betaPanels(zone).forEach(p => {
      ctx.strokeRect(p.x / 500 * _led.cellPx + 0.5, p.y / 500 * _led.cellPx + 0.5, p.w / 500 * _led.cellPx - 1, p.h / 500 * _led.cellPx - 1);
    });
    ctx.restore();

    ctx.beginPath(); ctx.roundRect(zx + 1, zy + 1, zw - 2, zh - 2, cr);
    ctx.strokeStyle = color; ctx.lineWidth = zone.id === _led.selectedZoneId ? 3 : 1.5; ctx.stroke();

    const fs = Math.max(11, Math.min(16, _led.cellPx * 0.22));
    const pad = Math.max(3, Math.round(fs * 0.5)) + Math.round(cr * 0.5);
    ctx.font = `700 ${fs}px sans-serif`;
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, fs * 0.3); ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.strokeText(`z${i + 1}`, zx + zw - pad, zy + pad);
    ctx.fillStyle = '#fff'; ctx.fillText(`z${i + 1}`, zx + zw - pad, zy + pad);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const midY = zy + zh / 2;
    ctx.strokeText(zone.led, zx + zw / 2, midY - fs * 0.7);
    ctx.fillText(zone.led, zx + zw / 2, midY - fs * 0.7);
    ctx.strokeText(`${zone.panelW}×${zone.panelH}mm`, zx + zw / 2, midY + fs * 0.7);
    ctx.fillText(`${zone.panelW}×${zone.panelH}mm`, zx + zw / 2, midY + fs * 0.7);

    // 잔여 행/열(반쪽 셀)은 항상 500×500mm 패널로 채워지므로 캔버스에 직접 안내
    const spanR = zone.panelH / 500; const spanC = zone.panelW / 500;
    const remR = zone.rows % spanR; const remC = zone.cols % spanC;
    const fsS = Math.max(9, Math.min(13, _led.cellPx * 0.18));
    ctx.font = `700 ${fsS}px sans-serif`;
    ctx.lineWidth = Math.max(2, fsS * 0.28); ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    if (remR) {
      const sy = zy + (remR * _led.cellPx) / 2;
      ctx.strokeText('500×500mm', zx + zw / 2, sy);
      ctx.fillStyle = '#fff'; ctx.fillText('500×500mm', zx + zw / 2, sy);
    }
    if (remC) {
      const sx = zx + (remC * _led.cellPx) / 2;
      const off = remR * _led.cellPx;
      const sy2 = zy + off + (zh - off) / 2;
      ctx.strokeText('500×500mm', sx, sy2);
      ctx.fillStyle = '#fff'; ctx.fillText('500×500mm', sx, sy2);
    }
    ctx.textBaseline = 'alphabetic';

    if (isNew) { ctx.restore(); }
  });

  if (_led.selectedZoneId) {
    const sel = cfg.zones.find(z => z.id === _led.selectedZoneId);
    if (sel) {
      const sx = sel.startCol * _led.cellPx; const sy = sel.startRow * _led.cellPx;
      const sw = sel.cols * _led.cellPx; const sh = sel.rows * _led.cellPx;
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.setLineDash([7, 3]);
      ctx.strokeRect(sx + 1.5, sy + 1.5, sw - 3, sh - 3);
      ctx.setLineDash([]);
    }
  }
}

function drawPanelsForPortMode(ctx) {
  const cfg = getLedConfig();
  const ports = activePortsArray();

  // 패스 1: 구역 외곽선 + 패널 배경/테두리
  cfg.zones.forEach(zone => {
    ctx.strokeStyle = '#3a3c44';
    ctx.lineWidth = 1;
    ctx.strokeRect(zone.startCol * _led.cellPx + 0.5, zone.startRow * _led.cellPx + 0.5, zone.cols * _led.cellPx - 1, zone.rows * _led.cellPx - 1);

    betaPanels(zone).forEach(p => {
      const portIdx = ports.findIndex(arr => arr.includes(p.key));
      const px = p.x / 500 * _led.cellPx; const py = p.y / 500 * _led.cellPx;
      const pw = p.w / 500 * _led.cellPx; const ph = p.h / 500 * _led.cellPx;
      if (portIdx !== -1) {
        const color = portColor(portIdx);
        ctx.fillStyle = portIdx === _led.activePort ? `${color}aa` : `${color}55`;
        ctx.fillRect(px, py, pw, ph);
      }
      ctx.strokeStyle = portIdx === _led.activePort ? '#ffffff' : '#4a4d55';
      ctx.lineWidth = portIdx === _led.activePort ? 2 : 1;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      if (p.key === _led.focusPanelKey) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
        ctx.strokeStyle = '#378ADD'; ctx.lineWidth = 2; ctx.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
      }
    });
  });

  // 패스 2: 포트별 배선 경로(배경 위, 라벨 아래)
  drawPortPaths(ctx);

  // 패스 3: 셀 내 연결 순서 번호 + 포트 라벨(경로 위에 그림)
  const stepOf = new Map();
  ports.forEach(keys => keys.forEach((k, idx) => stepOf.set(k, idx + 1)));
  cfg.zones.forEach(zone => {
    betaPanels(zone).forEach(p => {
      const portIdx = ports.findIndex(arr => arr.includes(p.key));
      if (portIdx === -1 || _led.cellPx < 20) { return; }
      const px = p.x / 500 * _led.cellPx; const py = p.y / 500 * _led.cellPx;
      const pw = p.w / 500 * _led.cellPx; const ph = p.h / 500 * _led.cellPx;
      const lit = portIdx === _led.activePort;
      const step = stepOf.get(p.key);
      const cx = px + pw / 2; const cy = py + ph / 2;

      if (step) {
        const fs = Math.min(12, _led.cellPx - 8);
        const r = Math.max(8, fs * 0.72);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = lit ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)';
        ctx.fill();
        ctx.font = `700 ${fs}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = lit ? portColor(portIdx) : 'rgba(80,80,80,0.6)';
        ctx.fillText(String(step), cx, cy);
      }
      if (_led.cellPx >= 32) {
        const label = 'P' + (portIdx + 1);
        ctx.font = '700 9px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.lineJoin = 'round'; ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(label, px + 4, py + 4);
        ctx.fillStyle = lit ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.88)';
        ctx.fillText(label, px + 4, py + 4);
      }
      ctx.textBaseline = 'alphabetic';
    });
  });
}

// 포트별 배선 경로를 배정 순서(배열 순서)를 따라 흰 테두리+색상 이중선으로,
// 마지막 구간엔 화살촉으로 그린다(원본 §11 drawPortPaths 이식). 같은 행에서
// 열만 건너뛰는 구간은 겹침 방지를 위해 살짝 부풀린 2차 베지어 곡선을 쓴다.
function drawPortPaths(ctx) {
  const { rows: totalRows } = gridDims();
  const panelByKey = new Map(allPanels().map(p => [p.key, p]));
  const ports = activePortsArray();

  ports.forEach((keys, pi) => {
    const pts = keys.map(k => {
      const p = panelByKey.get(k);
      if (!p) { return null; }
      return {
        x: (p.x + p.w / 2) / 500 * _led.cellPx,
        y: (p.y + p.h / 2) / 500 * _led.cellPx,
        row: p.y / 500,
      };
    }).filter(Boolean);
    if (pts.length < 2) { return; }

    const color = portColor(pi);
    const strokePath = (style, lw) => {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]; const b = pts[i];
        if (a.row === b.row && a.x !== b.x) {
          const isTop = a.row < totalRows / 2;
          const ctrlY = isTop ? a.y - _led.cellPx * 0.7 : a.y + _led.cellPx * 0.7;
          ctx.quadraticCurveTo((a.x + b.x) / 2, ctrlY, b.x, b.y);
        } else {
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.stroke();
    };

    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokePath('rgba(255,255,255,0.85)', 6);
    strokePath(color, 3);

    const a = pts[pts.length - 2]; const b = pts[pts.length - 1];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len >= 1) {
      const ux = dx / len; const uy = dy / len; const hw = 6; const hl = 12; const nx = -uy; const ny = ux;
      const bx = b.x - ux * 5; const by = b.y - uy * 5;
      const drawTip = fillStyle => {
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx - ux * hl + nx * hw, by - uy * hl + ny * hw);
        ctx.lineTo(bx - ux * hl - nx * hw, by - uy * hl - ny * hw);
        ctx.closePath(); ctx.fillStyle = fillStyle; ctx.fill();
      };
      drawTip('rgba(255,255,255,0.85)');
      drawTip(color);
    }
    ctx.restore();
  });
}

function drawDragRect(ctx) {
  const l = _led.dragLerp;
  const sx = l.c0 * _led.cellPx; const sy = l.r0 * _led.cellPx;
  const sw = (l.c1 - l.c0) * _led.cellPx; const sh = (l.r1 - l.r0) * _led.cellPx;
  const cr = Math.min(8, sw * 0.14, sh * 0.14);

  ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, cr);
  ctx.fillStyle = 'rgba(110,107,244,0.22)'; ctx.fill();
  ctx.beginPath(); ctx.roundRect(sx + 1, sy + 1, sw - 2, sh - 2, cr);
  ctx.strokeStyle = '#6e6bf4'; ctx.lineWidth = 2; ctx.stroke();

  const st = _led.dragStart; const cur = _led.dragCur;
  const c0 = Math.min(st.col, cur.col); const c1 = Math.max(st.col, cur.col);
  const r0 = Math.min(st.row, cur.row); const r1 = Math.max(st.row, cur.row);
  const wm = ((c1 - c0 + 1) * 0.5).toFixed(1).replace(/\.0$/, '');
  const hm = ((r1 - r0 + 1) * 0.5).toFixed(1).replace(/\.0$/, '');
  const fs = Math.max(11, Math.min(16, sw * 0.18));
  ctx.font = `700 ${fs}px sans-serif`;
  ctx.fillStyle = '#e8e8ef'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`${wm}m × ${hm}m`, sx + sw / 2, sy + sh / 2);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
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
      openZoneCfgPopup(zone);
    });
  });
  listEl.querySelectorAll('.zone-del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteZone(btn.dataset.zoneId));
  });
}

function renderPortPanel() {
  ensurePortsSized();
  const isLan = _led.mode === 'lan';
  const sourceEl = document.getElementById('ledPortSource');
  if (isLan) {
    const layout = ledPortLayout();
    sourceEl.textContent = layout.groups
      .map(g => `${g.label} ${g.portCount}포트·포트당 ${g.capPerPort.toLocaleString()}px`)
      .join('  +  ');
    if (_led.activePort >= layout.ports.length) { _led.activePort = 0; }
  } else {
    sourceEl.textContent = `고정 18포트 · 포트당 ${PWR_PORT_CAP.toLocaleString()}px`;
    if (_led.activePort >= PWR_PORT_COUNT) { _led.activePort = 0; }
  }
  renderPortStrip();
  renderPortDetail();
  renderCableSum();
}

// LAN 모드에서 샌딩카드가 2대 이상 연결돼 있으면 포트 칩을 카드별로 묶어서
// 보여준다("랜 배선 탭에서 포트를 샌딩카드별로 나눠서 표기" 요청 반영).
function renderPortStrip() {
  const ports = activePortsArray();
  const strip = document.getElementById('ledPortStrip');
  const isLan = _led.mode === 'lan';

  const chipHtml = (i, keys) => {
    const color = portColor(i);
    return `<button class="led-port-chip ${i === _led.activePort ? 'on' : ''}" data-port="${i}" style="--chip-color:${color}">
      P${i + 1}<span class="chip-count">${keys.length}</span>
    </button>`;
  };

  if (isLan) {
    const layout = ledPortLayout();
    let offset = 0;
    strip.innerHTML = layout.groups.map(g => {
      const chips = Array.from({ length: g.portCount }, (_v, i) => chipHtml(offset + i, ports[offset + i] || [])).join('');
      offset += g.portCount;
      return layout.groups.length > 1
        ? `<div class="led-port-group"><div class="led-port-group-lbl">${escapeHtml(g.label)}</div><div class="led-port-group-chips">${chips}</div></div>`
        : chips;
    }).join('');
  } else {
    strip.innerHTML = ports.map((keys, i) => chipHtml(i, keys)).join('');
  }

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
  const cap = capForActivePort();
  const over = isOverCapacity(px, cap);
  const pct = Math.min(100, Math.round(px / cap * 100));
  const color = portColor(_led.activePort);

  const isLan = _led.mode === 'lan';
  const layout = isLan ? ledPortLayout() : null;
  const groupLabel = isLan && layout.groups.length > 1 && layout.ports[_led.activePort]
    ? ` (${layout.ports[_led.activePort].label})` : '';

  const detail = document.getElementById('ledPortDetail');
  detail.innerHTML = `
    <div class="led-port-detail-head">
      <span class="port-swatch" style="background:${color}"></span>
      <span class="port-name">P${_led.activePort + 1}${escapeHtml(groupLabel)}</span>
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

// ── 케이블 소요량 계산 (원본 §11 _calcLan/calcPW/renderSum/setSpare 이식) ──
// LAN: 메인+백업 이중화(포트당 2개) — 원본 그대로. PWR: 이 앱은 §14 방식대로
// PWR도 LAN처럼 사용자가 직접 포트에 패널을 배정하는 구조라, "백업" 개념 없이
// 포트당 1개로 계산한다(원본 §11의 PWR은 배정 없이 열 구조로만 계산했음 — 이
// 앱의 수동배정 포트 모델에 맞춰 LAN과 같은 "필요+여유" 방식으로 일반화).
// 숏랜/숏파워는 포트 내 패널 daisy-chain 연결 수(장수-1의 합)로 동일하게 계산.
function renderCableSum() {
  const el = document.getElementById('ledCableSum');
  if (!el) { return; }
  const cfg = getLedConfig();
  const isLan = _led.mode === 'lan';
  const mainKey = isLan ? 'l1' : 'c1';
  const shortKey = isLan ? 'sl' : 'sp';
  const mainLbl = isLan ? '1번 랜' : '1번 파워';
  const shortLbl = isLan ? '숏랜' : '숏 파워';
  const bundleSize = isLan ? LAN_SHORT_BUNDLE : PWR_SHORT_BUNDLE;

  el.innerHTML = `
    <div class="led-cable-card">
      <div class="cable-lbl">${mainLbl}</div>
      <div class="cable-total" id="cableMainTotal"></div>
      ${isLan ? '<div class="cable-note" id="cableMainNote"></div>' : ''}
      <div class="cable-qty-row">필요 <b id="cableMainNet"></b> · 여유
        <input class="cable-spare-inp" id="cableMainSpare" type="number" min="0" value="${cfg.spareAdj[mainKey] || 0}">
      </div>
    </div>
    <div class="led-cable-card">
      <div class="cable-lbl">${shortLbl}</div>
      <div class="cable-total" id="cableShortTotal"></div>
      <div class="cable-bundle" id="cableShortBundle">×${bundleSize}</div>
      <div class="cable-qty-row">필요 <b id="cableShortNet"></b> · 여유
        <input class="cable-spare-inp" id="cableShortSpare" type="number" min="0" value="${cfg.spareAdj[shortKey] || 0}">
      </div>
    </div>
    <div class="cable-warn" id="cableWarn" hidden></div>
  `;

  document.getElementById('cableMainSpare').addEventListener('input', e => {
    cfg.spareAdj[mainKey] = clampSpareInput(e.target.value);
    updateCableSum();
  });
  document.getElementById('cableShortSpare').addEventListener('input', e => {
    cfg.spareAdj[shortKey] = clampSpareInput(e.target.value);
    updateCableSum();
  });

  updateCableSum();
}

function clampSpareInput(v) {
  const n = parseInt(v, 10);
  return (v === '' || Number.isNaN(n) || n < 0) ? 0 : n;
}

// 여유분 입력 시 합계 텍스트만 갱신(입력 포커스·커서 위치 유지, 원본 setSpare와 동일한 목적)
function updateCableSum() {
  const cfg = getLedConfig();
  const isLan = _led.mode === 'lan';
  const ports = activePortsArray();
  const mainKey = isLan ? 'l1' : 'c1';
  const shortKey = isLan ? 'sl' : 'sp';

  const used = ports.filter(arr => arr.length > 0).length;
  const mainNet = isLan ? used * 2 : used;
  const mainSpare = cfg.spareAdj[mainKey] || 0;
  const main = mainNet + mainSpare;

  let shortNet = 0;
  ports.forEach(arr => { if (arr.length > 0) { shortNet += arr.length - 1; } });
  const shortSpare = cfg.spareAdj[shortKey] || 0;
  const short = shortNet + shortSpare;
  const bundleSize = isLan ? LAN_SHORT_BUNDLE : PWR_SHORT_BUNDLE;
  const bundle = Math.ceil(short / bundleSize);

  const set = (id, text) => { const e = document.getElementById(id); if (e) { e.textContent = text; } };
  set('cableMainTotal', `${main} 개`);
  set('cableMainNet', String(mainNet));
  if (isLan) { set('cableMainNote', `메인 ${used} · 백업 ${used}`); }
  set('cableShortTotal', `${short} 개`);
  set('cableShortBundle', `${bundle}묶음 (×${bundleSize})`);
  set('cableShortNet', String(shortNet));

  const totalPanels = allPanels().length;
  const assigned = new Set(); ports.forEach(arr => arr.forEach(k => assigned.add(k)));
  const unassigned = totalPanels - assigned.size;
  const warnEl = document.getElementById('cableWarn');
  if (warnEl) {
    warnEl.hidden = unassigned <= 0;
    warnEl.textContent = `미할당 ${unassigned} / ${totalPanels} 패널`;
  }
}
