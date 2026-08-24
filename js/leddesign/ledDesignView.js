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
const PWR_PORT_CAP = 500000; // 수동 배정 시 초과 표시 기준으로도 재사용
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
  editingZoneId: null, // 구역요약 목록에서 "편집"을 눌러 아코디언이 펼쳐진 구역(신규 생성은 즉시 반영이라 이 상태를 안 씀)

  cfgPitch: '3mm',
  cfgW: 500,
  cfgH: 500,
  newPitch: '3mm', // 신규 구역 생성 시 미리 선택해두는 피치/패널 크기(툴바 칩)
  newPanelW: 500,
  newPanelH: 1000,
  animProg: null, // {ids:Set, t} — 신규 구역 생성 애니메이션 진행도
  activePort: 0,
  sharedPortUsage: null, // resolveSharedPortUsage 결과 캐시(LAN 모드 렌더 시점마다 갱신) — 같은 샌딩카드를 공유하는 다른 LED디스플레이가 이미 쓰고 있는 포트 조회용
  focusPanelKey: null, // 키보드 방향키 포커스 패널(원본 fCell)
  pointerDownPanel: null,
  pointerDownScreen: { x: 0, y: 0 },
  pointerMoved: false,
  isPainting: false,
  paintStack: [],
  longPressTimer: null,

  // ── 구역 생성 방식: 'drag'(사각형 드래그, 기존) | 'cell'(칸 선택 자유 구역) ──
  // 자유 구역은 LAN/PWR 포트 배정과 같은 조작감(탭 토글·롱프레스 페인트·화살표키
  // 내비게이션)으로 격자 칸을 하나씩 골라 draftCells에 모은 뒤 확정한다.
  zoneCreateMode: 'drag',
  draftCells: [], // ordered cellKey("row,col") 배열 — 순서가 화살표키 되짚기 판정에 필요
  draftFocus: null, // {row,col}
  draftPointerDown: null, // {row,col}
  draftPointerDownZone: null, // 탭 시작 지점이 이미 확정된 구역이면 그 구역(편집 팝업용)
  draftPointerDownScreen: { x: 0, y: 0 },
  draftPointerMoved: false,
  draftIsPainting: false,
  draftPaintStack: [],
  draftLongPressTimer: null,

  fullscreen: false, // 모바일 전용 "캔버스 그리기" 풀스크린(90도 회전) 활성 여부
  fsAnchor: null, // 풀스크린 좌표 보정용 제스처 시작 앵커(canvasPointRotated 참고)
  frozenDims: null, // 드래그/페인트 제스처 진행 중 gridDims()를 고정해두는 스냅샷(아래 gridDims 참고)
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

// PWR 포트 수 — 포트 추가/제거 버튼으로 사용자가 늘리거나 줄인다(cfg에 저장돼
// 저장/불러오기에도 유지됨). 예전에 저장된 프로젝트처럼 값이 아직 없으면
// specs.js의 기본값(18)으로 fallback.
function pwrPortCount() {
  return getLedConfig().pwrPortCount || PWR_PORT_COUNT;
}

// 구역이 추가/삭제/변경되면 기존 포트 배정은 무효화(패널 key가 달라지므로) —
// 사용자가 자동 할당을 다시 누르거나 수동으로 다시 배정해야 한다.
function resetPortAssignments() {
  const cfg = getLedConfig();
  cfg.lanPorts = Array.from({ length: ledPortLayout().ports.length }, () => []);
  cfg.pwrPorts = Array.from({ length: pwrPortCount() }, () => []);
}

// LED 노드 상류의 LAN 포트 그룹(샌딩카드별)은 ledPortGroups.js(순수 함수,
// validationEngine.js와 공유)의 resolveLedPortGroups/resolveLedPortLayout을 쓴다.
function ledPortLayout() {
  return resolveLedPortLayout(State.graph, _led.nodeId);
}

// LAN 자동 할당 — "자동 할당" 버튼, 빠른 설정으로 LED 추가, 샌딩카드에 새로
// 연결될 때 모두 이 로직을 공유한다. _led(구역 설계 화면이 열려 있을 때만
// 유효한 휘발성 상태)에 기대지 않고 nodeId만으로 동작해 어디서든 호출할 수 있다.
function autoAssignLanForLedNode(ledNodeId) {
  const node = getNode(ledNodeId);
  if (!node) { return; }
  const cfg = node.config.ledDesign;
  const layout = resolveLedPortLayout(State.graph, ledNodeId);
  // 같은 샌딩카드를 공유하는 다른 LED디스플레이가 이미 쓰고 있는 포트는
  // 예약된 것으로 취급해 자동 배정에서 건너뛴다.
  const reserved = resolveSharedPortUsage(State.graph, ledNodeId)
    .map((u, i) => (u ? i : -1)).filter(i => i !== -1);

  if (layout.groups.length >= 2) {
    // 샌딩카드가 2대 이상이면 카드별 담당 픽셀량이 균등하도록(연속된 구간으로
    // 나눠 카드끼리 열이 섞이지 않게) 배정한다 — 순서대로 한 카드부터 꽉
    // 채우는 방식이 아니다(사용자 요청).
    cfg.lanPorts = autoAssignAllZonesBalanced(cfg.zones, layout.groups, reserved);
  } else {
    // 샌딩카드가 1대(또는 미연결 기본값 그룹)뿐이면 기존 방식 그대로 —
    // 구역을 순서대로 훑으며 그 카드 포트에 채운다.
    const safeCap = Math.min(...layout.groups.map(g => g.capPerPort));
    cfg.lanPorts = autoAssignAllZones(cfg.zones, layout.ports.length, safeCap, reserved);
  }
}

function openLedDesignView(nodeId) {
  _led.nodeId = nodeId;
  _led.selectedZoneId = null;
  _led.dragStart = null;
  _led.dragCur = null;
  _led.dragLerp = null;
  _led.activePort = 0;
  _led.focusPanelKey = null;
  _led.fullscreen = false;
  document.getElementById('ledDesignView').classList.remove('led-canvas-fullscreen');
  clearDraft();

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
  if (_led.fullscreen) { closeLedCanvasFullscreen(); }
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
  _led.canvas.addEventListener('keydown', onGridKeyDown);

  document.getElementById('ledOpenCanvasBtn').addEventListener('click', openLedCanvasFullscreen);
  document.getElementById('ledCanvasCloseBtn').addEventListener('click', closeLedCanvasFullscreen);

  document.querySelectorAll('.led-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setLedMode(btn.dataset.mode));
  });

  document.querySelectorAll('#ledZoneCreateModeToggle .led-chip').forEach(btn => {
    btn.addEventListener('click', () => setZoneCreateMode(btn.dataset.createMode));
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

  document.getElementById('ledZoneDraftCancelBtn').addEventListener('click', cancelDraftZone);
  document.getElementById('ledZoneDraftConfirmBtn').addEventListener('click', confirmDraftZone);

  document.getElementById('ledZoneResetAllBtn').addEventListener('click', resetAllZones);
  document.getElementById('ledZoneCompactBtn').addEventListener('click', finishZoneDesign);

  document.getElementById('ledAutoAssignBtn').addEventListener('click', () => {
    const cfg = getLedConfig();
    if (_led.mode === 'lan') {
      autoAssignLanForLedNode(_led.nodeId);
    } else {
      cfg.pwrPorts = autoAssignPwrZones(cfg.zones, pwrPortCount());
    }
    renderPortPanel();
    drawGrid();
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

  // PWR 포트 수동 추가/제거 — LAN은 포트 수가 상류 장비 스펙에서 정해지므로
  // (ledPortLayout) 이 조작이 없고, PWR만 고정 포트 수(기본 18) 자체를
  // 사용자가 늘리거나 줄일 수 있다.
  document.getElementById('ledPwrPortAddBtn').addEventListener('click', () => {
    const cfg = getLedConfig();
    cfg.pwrPortCount = pwrPortCount() + 1;
    ensurePortsSized();
    renderPortPanel();
    drawGrid();
  });

  document.getElementById('ledPwrPortRemoveBtn').addEventListener('click', () => {
    const cfg = getLedConfig();
    const count = pwrPortCount();
    if (count <= 1) { showToast('포트가 최소 1개는 있어야 합니다.'); return; }
    const lastPanels = cfg.pwrPorts[count - 1] || [];
    if (lastPanels.length > 0
      && !window.confirm(`P${count}에 배정된 패널 ${lastPanels.length}장이 있습니다. 포트를 제거하면 그 배정도 함께 사라집니다. 계속할까요?`)) {
      return;
    }
    cfg.pwrPortCount = count - 1;
    ensurePortsSized();
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

// ── 모바일 전용 "캔버스 그리기" 풀스크린 ──────────────────
// 좁은 화면에서는 격자를 손가락으로 다루기엔 너무 작아지므로(캔버스를 바로
// 안 보여주고 이 버튼만 노출 — style.css 참고), 탭하면 실제 기기를 돌리지
// 않아도 가로 화면처럼 널찍하게 쓸 수 있도록 .led-grid-wrap 전체를 CSS로
// 90도 돌려 풀스크린으로 띄운다. canvasPoint()가 이 회전을 역산해서 터치
// 좌표를 보정하므로, _led.fullscreen 플래그만 켜고 끄면 된다.
function openLedCanvasFullscreen() {
  _led.fullscreen = true;
  document.getElementById('ledDesignView').classList.add('led-canvas-fullscreen');
  sizeGridCanvas();
  drawGrid();
  _led.canvas.focus();
}

function closeLedCanvasFullscreen() {
  _led.fullscreen = false;
  _led.fsAnchor = null;
  document.getElementById('ledDesignView').classList.remove('led-canvas-fullscreen');
  sizeGridCanvas();
  drawGrid();
}

// ── 모드 전환 (구역 편집 / LAN 배선 / PWR 배선) ──────────
function setLedMode(mode) {
  _led.mode = mode;
  _led.focusPanelKey = null;
  stopEditingZone();
  clearDraft();
  document.querySelectorAll('.led-mode-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  document.getElementById('ledNewZoneToolbar').hidden = mode !== 'zone';
  document.getElementById('ledZoneSection').hidden = mode !== 'zone';
  document.getElementById('ledPortSection').hidden = mode === 'zone';
  _led.canvas.style.cursor = mode === 'zone' && _led.zoneCreateMode === 'drag' ? 'crosshair' : 'pointer';
  updateZoneModeHint();
  updateZoneDraftBar();
  renderLedDesignView();
}

// 구역 생성 방식 전환: 'drag'(사각형 드래그) | 'cell'(칸 선택 자유 구역).
// 패널 크기 칩은 'drag'에서만 의미가 있다(자유 구역은 항상 500×500 단위).
function setZoneCreateMode(mode) {
  _led.zoneCreateMode = mode;
  clearDraft();
  stopEditingZone();
  document.querySelectorAll('#ledZoneCreateModeToggle .led-chip').forEach(b => b.classList.toggle('on', b.dataset.createMode === mode));
  document.getElementById('ledNewSizeRow').hidden = mode !== 'drag';
  _led.canvas.style.cursor = mode === 'drag' ? 'crosshair' : 'pointer';
  updateZoneModeHint();
  updateZoneDraftBar();
  sizeGridCanvas();
  drawGrid();
}

function updateZoneModeHint() {
  const hintEl = document.getElementById('ledModeHint');
  if (_led.mode !== 'zone') {
    hintEl.textContent = '패널을 탭하면 켜짐/꺼짐, 길게 눌러 드래그하면 여러 패널에 칠해집니다. 칠하다 한 칸 되짚으면 취소돼요.';
  } else if (_led.zoneCreateMode === 'drag') {
    hintEl.textContent = '그리드를 드래그해 새 구역을 만드세요 (500mm 칸 단위)';
  } else {
    hintEl.textContent = '칸을 탭하면 선택/해제, 길게 눌러 드래그하면 여러 칸이 선택됩니다. 화살표키로도 이어서 고를 수 있어요 — 다 고르면 "구역 확정".';
  }
}

// 격자는 "설치면적을 먼저 입력해야 그 안에서 그릴 수 있다"는 제약을 없애고,
// 이미 그려진 구역들의 바운딩 박스를 자동으로 따라간다(+여유 칸, 상하좌우 모두) —
// 비정형 배치(L자 등)를 그릴 때 구역 하나 추가할 때마다 캔버스가 알아서 넓어져서,
// 미리 최소 포함 사각형을 계산해 넣고 남는 빈 칸을 감수할 필요가 없다.
// 헤더의 가로/세로(m) 입력은 여전히 유효하다 — LED 추가 팝업의 "빠른 설정"이
// 만든 구역(정확히 그 면적을 덮음)은 그대로 표시되고, 수동으로 더 큰 값을
// 미리 입력해 캔버스를 넉넉히 잡아두는 것도 가능하다(자동 확장의 하한일 뿐).
//
// 뷰 원점(originRow/originCol): 격자를 항상 세계좌표 (0,0)부터 그리던 이전
// 방식은 아래/오른쪽 여백(매 렌더 bbox.max+MARGIN으로 다시 계산)과 위/왼쪽
// 여백(경계를 넘어야만 반응하는 데이터 이동)이 구조적으로 달라 위/왼쪽만
// "닿아야 늘어나는" 것처럼 보이는 비대칭이 있었다. 이제 그리기 시작점 자체를
// bbox.min - MARGIN으로 매번 다시 계산해서(아래/오른쪽과 완전히 같은 방식으로)
// 네 방향 모두 미리 여백이 보이게 한다. 구역/칸 좌표는 더 이상 0 이상으로
// 강제하지 않는다 — 음수도 그냥 유효한 세계좌표일 뿐, 뷰가 따라간다.
const LED_GRID_MARGIN = 2; // 구역/칸 추가 후 다음 구역을 이어 그릴 여유 칸
const LED_GRID_MIN_COLS = 15; // 자유 설계 시작 직후 기본 캔버스 크기(가로)
const LED_GRID_MIN_ROWS = 10; // 세로

// 드래그/페인트 제스처가 진행되는 동안은(_led.frozenDims 참고) 이 함수가
// 항상 제스처 시작 시점의 스냅샷을 그대로 돌려준다 — 실시간으로 bbox를
// 따라가며 매 프레임 캔버스 크기·원점을 다시 계산하면, 그때마다 캔버스
// DOM 요소 자체의 화면 위치가 밀리는 것은 물론(정렬 기준이 어느 쪽이든
// 캔버스 크기가 바뀌면 반드시 화면 위치도 같이 바뀐다), 이미 그려둔
// 내용도 원점이 바뀔 때마다 캔버스 내부 픽셀 좌표가 다시 매겨져 화면에서
// 밀리듯 움직인다 — 캔버스가 화면에서 안 움직이게 CSS로 아무리 고정해도
// "내용 자체가 안에서 움직이는" 문제는 못 잡는다. 제스처 동안은 뷰를
// 통째로 고정해두고(cellFromEvent의 pad만큼은 여전히 경계 밖으로 넘어가는
// 걸 허용), 제스처가 끝나 커밋될 때 딱 한 번만 새 크기·원점으로 다시
// 맞춘다(afterDraftChange/renderLedDesignView가 부르는 sizeGridCanvas).
function gridDims() {
  if (_led.frozenDims) { return _led.frozenDims; }
  const cfg = getLedConfig();

  // "설계 완료"를 누르면 생성된 구역만 감싸는 최소 크기로 줄어든다(여백·하한
  // 다 무시). finishZoneDesign이 이때 구역 좌표를 0으로 당겨오지만, 뷰 원점
  // 자체도 bbox.min을 그대로 쓰므로 설령 당겨오기 전이라도 여백 없이 딱 맞게
  // 보인다. cfg에 저장되므로(_led의 휘발성 상태가 아니라) 페이지를 나갔다
  // 돌아와도 유지된다.
  if (cfg.zoneViewCompact) {
    const bbox = boundingBoxOfZones(cfg.zones);
    if (bbox) {
      return {
        originRow: bbox.minRow, originCol: bbox.minCol,
        cols: Math.max(1, bbox.maxCol - bbox.minCol), rows: Math.max(1, bbox.maxRow - bbox.minRow),
      };
    }
  }

  const declaredCols = Math.round((cfg.areaW || 0) / 500);
  const declaredRows = Math.round((cfg.areaH || 0) / 500);
  const draftZone = _led.draftCells.length ? [{ cells: _led.draftCells.map(parseCellKey) }] : [];
  // 사각형 드래그로 새 구역을 만드는 중에도(아직 mouseup으로 커밋 전) 미리보기
  // 사각형을 bbox에 포함시켜야, 드래그 도중 경계 밖으로 나가는 순간 캔버스가
  // 바로 따라 넓어진다 — 이게 없으면 cellFromEvent의 클램프가 "현재" 격자
  // 크기로 좌표를 묶어버려 한 번의 드래그로는 경계를 절대 못 넘는 문제가 있었다.
  const dragRectZone = (_led.zoneCreateMode === 'drag' && _led.dragStart && _led.dragCur)
    ? [{
      startRow: Math.min(_led.dragStart.row, _led.dragCur.row),
      startCol: Math.min(_led.dragStart.col, _led.dragCur.col),
      rows: Math.abs(_led.dragCur.row - _led.dragStart.row) + 1,
      cols: Math.abs(_led.dragCur.col - _led.dragStart.col) + 1,
    }]
    : [];
  const bbox = boundingBoxOfZones(cfg.zones.concat(draftZone).concat(dragRectZone));

  // 원점(위/왼쪽 경계)은 자기 쪽 경계(min)에만 반응해서 움직인다 — 반대쪽
  // (예: 오른쪽 끝)이 기본 격자를 넘어도 원점(왼쪽)은 영향받지 않는다.
  // 이전엔 "내용 전체가 기본 격자 안에 다 들어오는지"를 min/max 양쪽 다
  // 같이 보고 원점·크기를 한 번에 두 갈래로 나눠 계산했는데, 그러면 원점과
  // 무관한 반대쪽 경계가 기본 격자를 넘는 순간 원점이 갑자기 "bbox.min - 여백"
  // 으로 재계산되면서, 시작점이 0에서 먼 곳이었으면 원점이 한 번에 수십 칸씩
  // 튀는 문제가 있었다("자동확장이 매끄럽지 않다"는 제보의 원인).
  // min(0, bbox.min - 여백) 형태로 두면, 내용이 원점에서 여백만큼보다 더
  // 안쪽에 있을 땐 0에 그대로 있다가, 내용이 경계(0)에 닿는 순간부터 이미
  // 여백만큼 미리 넓어져 있다 — "칸을 끝까지 터치해서 채워도 자동확장이
  // 안 된다"는 문제(경계 밖으로 실제로 넘어가야만, 즉 있지도 않은 칸을
  // 어떻게든 짚어야만 넓어지던 것)를 없앤다. 반대쪽(max)은 이 계산에 전혀
  // 안 들어가므로 위 "원점이 튀는" 버그도 다시 생기지 않는다.
  const originRow = bbox ? Math.min(0, bbox.minRow - LED_GRID_MARGIN) : 0;
  const originCol = bbox ? Math.min(0, bbox.minCol - LED_GRID_MARGIN) : 0;
  // 세로(행)는 위쪽만 여유 칸을 미리 두고 자동으로 따라가게 하고, 아래쪽은
  // 실제 구역이 필요로 하는 만큼만 정확히 맞춘다(사용자 요청) — 아래로
  // 드래그/페인트해도 미리 여백을 붙여 늘어나지 않고, 진짜 그 줄까지 구역이
  // 생겨야만 그만큼만 늘어난다. 가로(열)는 기존처럼 양쪽 다 여유를 둔다.
  const farRow = bbox ? bbox.maxRow : 0;
  const farCol = bbox ? bbox.maxCol + LED_GRID_MARGIN : 0;

  // declaredCols/Rows도 farCol/farRow와 같은 세계좌표계다(빠른 설정 구역은
  // 항상 (0,0)에서 시작하므로 "세계 열 declaredCols까지") — origin이 밀려있으면
  // 그만큼 빼줘야 실제로 필요한 칸 수(originCol부터 declaredCols까지)가 나온다.
  const cols = Math.max(1, declaredCols - originCol, farCol - originCol, LED_GRID_MIN_COLS);
  const rows = Math.max(1, declaredRows - originRow, farRow - originRow, LED_GRID_MIN_ROWS);
  return { originRow, originCol, cols, rows };
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
  if (_led.fullscreen) { return canvasPointRotated(x, y); }
  const rect = _led.canvas.getBoundingClientRect();
  const scX = _led.canvas.width / (rect.width || _led.canvas.width);
  const scY = _led.canvas.height / (rect.height || _led.canvas.height);
  return { x: (x - rect.left) * scX, y: (y - rect.top) * scY };
}

// 풀스크린(캔버스 그리기) 상태에서는 .led-grid-wrap 전체가 style.css의
// `rotate(90deg) translateY(-100%)`로 돌아가 있다 — getBoundingClientRect는
// 회전 이후(화면에 실제 보이는) 값을 주므로 그대로 쓰면 가로/세로 축이
// 뒤바뀐다. 캔버스 자신의 getBoundingClientRect()(회전 반영이라 항상
// 정확)와 clientWidth/Height(변형 영향 없음, 회전 전 크기)로 그 역변환을
// 계산한다 — 회전 때문에 rect.width는 캔버스의 회전 전 "높이"와,
// rect.height는 회전 전 "너비"와 같다(90도 회전은 두 축을 맞바꾼다).
// 회전각을 바꾸면 이 식도 같이 바꿔야 한다. 이 함수 자체는 항상 "지금
// 이 순간"의 절대 위치를 구할 뿐이고, 드래그 중 원점이 실시간으로
// 밀리는 문제에 대한 보정은 이 함수를 단 한 번만 호출해 앵커로 삼는
// cellFromEventRotated 쪽에서 처리한다.
function canvasPointRotated(clientX, clientY) {
  const rect = _led.canvas.getBoundingClientRect();
  const cw = _led.canvas.clientWidth || _led.canvas.width;
  const ch = _led.canvas.clientHeight || _led.canvas.height;
  const scX = _led.canvas.width / cw;
  const scY = _led.canvas.height / ch;
  const x = (clientY - rect.top) * scX;
  const y = (ch - (clientX - rect.left)) * scY;
  return { x, y };
}

// 픽셀 좌표를 세계좌표 칸으로 바꾼다 — 뷰 원점(originRow/originCol)을 다시
// 더해줘야 캔버스가 어느 세계좌표에서 시작하든 정확한 칸을 가리킨다. 클램프는
// 화면 밖으로 마우스가 크게 벗어났을 때(윈도우 레벨 mousemove) 엉뚱하게 먼
// 칸으로 튀는 것만 막는 안전장치이지, 경계에 딱 맞춰서는 안 된다 — 딱 맞추면
// 경계 칸을 골라도 "이미 기본 격자 안"이라 확장이 안 트리거되고, 그 바깥은
// 애초에 좌표가 나올 수 없어 마우스/터치로는 절대 기본 15×10 밖으로 못
// 나가는 교착 상태가 된다(키보드 화살표 내비게이션은 이 클램프를 안 거쳐서
// 멀쩡히 확장되니 데스크톱에서는 가려져 있던 버그). LED_GRID_MARGIN만큼
// 여유를 둬 경계 너머로 한 칸씩 이어서 드래그하면 매 이벤트마다 gridDims가
// 따라 넓어지며 계속 나아갈 수 있게 한다.
// row(세로)는 위쪽(원점 방향)으로만 여유를 둬 이어서 확장할 수 있게 하고,
// 아래쪽은 gridDims가 잡아준 현재 경계에서 멈춘다(사용자 요청 — 세로 자동
// 확장은 위로만 작동). col(가로)은 기존처럼 양쪽 다 여유를 둔다.
function cellFromEvent(e) {
  if (_led.fullscreen) { return cellFromEventRotated(e); }
  const { x, y } = canvasPoint(e);
  const { originRow, originCol, cols, rows } = gridDims();
  const col = Math.floor(x / _led.cellPx) + originCol;
  const row = Math.floor(y / _led.cellPx) + originRow;
  const pad = LED_GRID_MARGIN;
  return {
    row: Math.min(Math.max(row, originRow - pad), originRow + rows - 1),
    col: Math.min(Math.max(col, originCol - pad), originCol + cols - 1 + pad),
  };
}

// 풀스크린(회전) 상태에서는 "픽셀 좌표 + 그 시점의 원점"을 그대로 조합하는
// 위 방식을 못 쓴다 — canvasPointRotated의 x/y는 제스처 시작 시점 기준으로
// 고정된 값인데, 격자가 드래그 도중 실시간으로 넓어지면 원점(originRow/Col)
// 자체가 매 이벤트마다 달라져서, "고정된 픽셀 오프셋 + 그때그때 다른 원점"을
// 더하면 원점이 밀린 만큼 매번 이중으로 반영돼 격자가 실제 이동량보다 훨씬
// 크게 폭주했다. 대신 제스처 시작 시점의 "월드 행/열"을 한 번만 정확히
// 구해 앵커로 저장해두고, 그 뒤로는 화면 좌표 델타만으로(원점과 무관하게)
// 앵커에서 몇 칸 이동했는지 직접 계산한다 — 원점이 어떻게 바뀌든 델타 자체는
// 영향받지 않는다.
function cellFromEventRotated(e) {
  const { x: clientX, y: clientY } = clientXY(e);
  if (!_led.fsAnchor) {
    const { x, y } = canvasPointRotated(clientX, clientY);
    const { originRow, originCol } = gridDims();
    _led.fsAnchor = {
      clientX, clientY,
      row: Math.floor(y / _led.cellPx) + originRow,
      col: Math.floor(x / _led.cellPx) + originCol,
    };
  }
  const a = _led.fsAnchor;
  const row = a.row - Math.round((clientX - a.clientX) / _led.cellPx);
  const col = a.col + Math.round((clientY - a.clientY) / _led.cellPx);
  const { originRow, originCol, cols, rows } = gridDims();
  const pad = LED_GRID_MARGIN;
  return {
    row: Math.min(Math.max(row, originRow - pad), originRow + rows - 1),
    col: Math.min(Math.max(col, originCol - pad), originCol + cols - 1 + pad),
  };
}

// zone.cells가 있으면(칸 선택으로 만든 자유 구역) 정확히 그 칸들만, 없으면
// (사각형 드래그로 만든 구역) 사각형 범위로 판정한다.
function zoneContainsCell(zone, row, col) {
  if (zone.cells) { return zone.cells.some(c => c.row === row && c.col === col); }
  return row >= zone.startRow && row < zone.startRow + zone.rows &&
    col >= zone.startCol && col < zone.startCol + zone.cols;
}

function zoneAtCell(row, col) {
  return getLedConfig().zones.find(z => zoneContainsCell(z, row, col)) || null;
}

function rectOverlapsZone(startRow, startCol, rows, cols, zones) {
  for (let r = startRow; r < startRow + rows; r += 1) {
    for (let c = startCol; c < startCol + cols; c += 1) {
      if (zones.some(z => zoneContainsCell(z, r, c))) { return true; }
    }
  }
  return false;
}

// 구역/초안 좌표 전체를 (dRow,dCol)만큼 옮긴다. 이제 좌표는 음수여도 되고
// 뷰 원점(gridDims)이 그걸 그대로 따라가므로, 인터랙션 중에는 이 함수를 쓸
// 일이 없다 — "설계 완료"(finishZoneDesign)가 저장 데이터를 보기 좋게
// (0,0)부터 시작하도록 정리할 때만 쓴다.
function shiftAllContent(dRow, dCol) {
  if (!dRow && !dCol) { return; }
  getLedConfig().zones.forEach(z => {
    if (z.cells) { z.cells.forEach(c => { c.row += dRow; c.col += dCol; }); }
    else { z.startRow += dRow; z.startCol += dCol; }
  });
  _led.draftCells = _led.draftCells.map(key => {
    const c = parseCellKey(key);
    return cellKey(c.row + dRow, c.col + dCol);
  });
  if (_led.draftFocus) { _led.draftFocus = { row: _led.draftFocus.row + dRow, col: _led.draftFocus.col + dCol }; }
}

function panelAtScreenPoint(e) {
  const { x, y } = canvasPoint(e);
  const { originRow, originCol } = gridDims();
  return allPanels().find(p => {
    const px = (p.x / 500 - originCol) * _led.cellPx; const py = (p.y / 500 - originRow) * _led.cellPx;
    const pw = p.w / 500 * _led.cellPx; const ph = p.h / 500 * _led.cellPx;
    return x >= px && x < px + pw && y >= py && y < py + ph;
  }) || null;
}

// ── 캔버스 입력 디스패치 ──────────────────────────────
function onGridMouseDown(e) {
  _led.fsAnchor = null; // 새 제스처 시작 — canvasPointRotated가 이번 시작점을 새로 앵커로 잡게 한다
  if (_led.mode !== 'zone') { onPortMouseDown(e); return; }
  if (_led.zoneCreateMode === 'cell') { onZoneCellMouseDown(e); } else { onZoneMouseDown(e); }
}
function onGridMouseMove(e) {
  if (_led.mode !== 'zone') { onPortMouseMove(e); return; }
  if (_led.zoneCreateMode === 'cell') { onZoneCellMouseMove(e); } else { onZoneMouseMove(e); }
}
function onGridMouseUp(e) {
  if (_led.mode !== 'zone') { onPortMouseUp(e); return; }
  if (_led.zoneCreateMode === 'cell') { onZoneCellMouseUp(e); } else { onZoneMouseUp(e); }
}
function onGridKeyDown(e) {
  if (_led.mode === 'zone') {
    if (_led.zoneCreateMode === 'cell') { onZoneCellKeyDown(e); }
    return;
  }
  onPortKeyDown(e);
}

// ── 구역 편집: 드래그하면 툴바에서 미리 고른 피치·패널크기로 즉시 생성,
//    탭(이동 없는 클릭)하면 기존 구역을 선택한다(편집은 구역요약 목록의
//    "편집" 버튼으로 따로 들어간다) ──────
function onZoneMouseDown(e) {
  stopEditingZone();
  exitCompactView();
  _led.frozenDims = gridDims(); // 제스처 끝날 때까지 뷰를 통째로 고정(위 gridDims 주석 참고)
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
// 뷰가 고정돼 있으므로(_led.frozenDims) 여기서 캔버스를 다시 사이즈할 필요가 없다 —
// cellFromEvent의 pad만큼 경계 밖 칸도 여전히 찍을 수 있고, 그 결과(더 큰 사각형)는
// 커밋 후 renderLedDesignView가 한 번에 반영한다.
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
  _led.frozenDims = null; // 제스처 종료 — 다음 gridDims() 호출부터 다시 실제 내용 기준으로 계산

  if (!wasDrag) {
    selectZone(zoneAtCell(startRow, startCol));
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

// ── 구역 편집: 칸 선택(자유) — LAN/PWR 포트 배정과 같은 조작감(탭 토글·롱프레스
// 페인트·화살표키 내비게이션)으로 격자 칸을 하나씩 골라 draftCells에 모은 뒤
// "구역 확정"으로 finalize한다. 사각형 제약이 없어 L자 등 비정형 구역을 한 번에
// 만들 수 있다 — 항상 500×500mm 단위 패널로만 채운다(패널 자동 페어링 없음).
function cellKey(row, col) { return `${row},${col}`; }
function parseCellKey(key) { const [row, col] = key.split(',').map(Number); return { row, col }; }

function isCellInDraft(row, col) { return _led.draftCells.includes(cellKey(row, col)); }

// 이미 확정된 구역에 속한 칸은 자유 구역 초안에 다시 포함시킬 수 없다.
function isCellSelectable(row, col) { return !zoneAtCell(row, col); }

function addDraftCell(row, col) {
  if (isCellInDraft(row, col) || !isCellSelectable(row, col)) { return; }
  _led.draftCells.push(cellKey(row, col));
}

function removeDraftCellAt(row, col) {
  const i = _led.draftCells.indexOf(cellKey(row, col));
  if (i !== -1) { _led.draftCells.splice(i, 1); }
}

function toggleDraftCell(row, col) {
  if (isCellInDraft(row, col)) { removeDraftCellAt(row, col); } else { addDraftCell(row, col); }
}

// 롱프레스 드래그로 지나간 칸을 초안에 더한다. 바로 이전 칸으로 되짚으면 취소한다
// (paintPanel과 동일한 페인트 스택 트릭).
function paintDraftCell(row, col) {
  const key = cellKey(row, col);
  const stack = _led.draftPaintStack;
  if (stack.length && stack[stack.length - 1] === key) { return; }
  if (stack.length >= 2 && stack[stack.length - 2] === key) {
    const last = parseCellKey(stack.pop());
    removeDraftCellAt(last.row, last.col);
    if (navigator.vibrate) { navigator.vibrate(25); }
    return;
  }
  if (isCellInDraft(row, col) || !isCellSelectable(row, col)) { return; }
  stack.push(key);
  addDraftCell(row, col);
  if (navigator.vibrate) { navigator.vibrate(15); }
}

// 격자 좌상단부터 훑어 아직 어떤 구역에도 속하지 않은 첫 칸(키보드 내비게이션
// 시작점)을 찾는다.
function firstSelectableCell() {
  const { originRow, originCol, cols, rows } = gridDims();
  for (let r = originRow; r < originRow + rows; r += 1) {
    for (let c = originCol; c < originCol + cols; c += 1) {
      if (isCellSelectable(r, c)) { return { row: r, col: c }; }
    }
  }
  return null;
}

function clearDraft() {
  _led.draftCells = [];
  _led.draftFocus = null;
  _led.draftPointerDown = null;
  _led.draftPointerDownZone = null;
  _led.draftPointerMoved = false;
  _led.draftIsPainting = false;
  _led.draftPaintStack = [];
  clearTimeout(_led.draftLongPressTimer);
}

function updateZoneDraftBar() {
  const bar = document.getElementById('ledZoneDraftBar');
  const show = _led.mode === 'zone' && _led.zoneCreateMode === 'cell';
  bar.hidden = !show;
  if (!show) { return; }
  document.getElementById('ledZoneDraftCount').textContent = `${_led.draftCells.length}칸 선택됨`;
  document.getElementById('ledZoneDraftConfirmBtn').disabled = _led.draftCells.length === 0;
}

// 초안 변경 후 공통 후처리: 격자가 커졌을 수 있으니 캔버스를 다시 사이즈하고
// 그린다("칸 선택 시 캔버스 끝에 닿으면 실시간 확장"). 탭 토글, 화살표키
// 이동, 취소처럼 한 번에 한 칸만 바뀌는 경우에 쓴다 — sizeGridCanvas가
// computeCellPx로 셀 크기까지 화면에 맞게 다시 계산해도 다음 변화가 바로
// 이어지지 않으니 안전하다.
function afterDraftChange() {
  sizeGridCanvas();
  drawGrid();
  updateZoneDraftBar();
}

// 롱프레스 페인트 드래그 중에는 뷰가 고정돼 있으므로(_led.frozenDims,
// gridDims() 주석 참고) 캔버스를 다시 사이즈할 필요 없이 그리기만 하면
// 된다 — 페인트가 끝나면(mouseup) afterDraftChange가 그때 가서 실제
// 내용에 맞게 한 번만 다시 사이즈한다.
function afterDraftPaint() {
  drawGrid();
  updateZoneDraftBar();
}

function confirmDraftZone() {
  if (!_led.draftCells.length) { return; }
  const newZone = {
    id: makeId('lz'),
    led: _led.newPitch,
    panelW: 500, panelH: 500,
    cells: _led.draftCells.map(parseCellKey),
  };
  getLedConfig().zones.push(newZone);
  clearDraft();
  resetPortAssignments();
  renderLedDesignView();
  updateZoneDraftBar();
  animateNewZone(newZone.id);
}

function cancelDraftZone() {
  clearDraft();
  afterDraftChange();
}

function onZoneCellMouseDown(e) {
  stopEditingZone();
  exitCompactView();
  const cell = cellFromEvent(e);
  const zone = zoneAtCell(cell.row, cell.col);
  _led.draftPointerDown = cell;
  _led.draftPointerDownZone = zone;
  _led.draftPointerDownScreen = clientXY(e);
  _led.draftPointerMoved = false;
  _led.draftIsPainting = false;
  _led.draftPaintStack = [];
  if (zone) { return; } // 기존 구역 탭은 mouseup에서 선택으로 처리(페인트 대상 아님)

  clearTimeout(_led.draftLongPressTimer);
  const isTouch = !!(e.touches && e.touches.length);
  _led.draftLongPressTimer = setTimeout(() => {
    if (!_led.draftPointerDown) { return; }
    _led.draftIsPainting = true;
    setDragBadge(true);
    _led.frozenDims = gridDims(); // 페인트 끝날 때까지 뷰를 통째로 고정
    paintDraftCell(cell.row, cell.col);
    _led.draftFocus = cell; // 마우스/터치로 고른 칸에서 화살표키 이동이 이어지도록
    afterDraftPaint();
  }, isTouch ? LONG_PRESS_TOUCH_MS : LONG_PRESS_MOUSE_MS);
}

function onZoneCellMouseMove(e) {
  if (!_led.draftPointerDown) { return; }
  const { x, y } = clientXY(e);
  if (Math.abs(x - _led.draftPointerDownScreen.x) > 4 || Math.abs(y - _led.draftPointerDownScreen.y) > 4) {
    _led.draftPointerMoved = true;
  }
  if (!_led.draftIsPainting) { return; }
  const cell = cellFromEvent(e);
  paintDraftCell(cell.row, cell.col);
  _led.draftFocus = cell; // 페인트 드래그가 지나간 마지막 칸이 다음 화살표키 이동의 기준점
  afterDraftPaint();
}

function onZoneCellMouseUp() {
  clearTimeout(_led.draftLongPressTimer);
  setDragBadge(false);
  _led.frozenDims = null; // 제스처 종료 — afterDraftChange가 실제 내용 기준으로 다시 사이즈한다
  const pointerDown = _led.draftPointerDown;
  const zone = _led.draftPointerDownZone;
  const wasPainting = _led.draftIsPainting;
  const moved = _led.draftPointerMoved;
  _led.draftPointerDown = null;
  _led.draftPointerDownZone = null;
  _led.draftIsPainting = false;
  _led.draftPaintStack = [];
  if (!pointerDown) { return; }

  if (zone) {
    if (!moved) { selectZone(zone); }
    return;
  }

  if (!wasPainting && !moved) {
    toggleDraftCell(pointerDown.row, pointerDown.col);
    _led.draftFocus = pointerDown; // 탭으로 고른(또는 해제한) 칸에서 화살표키 이동이 이어지도록
  }
  afterDraftChange();
}

// ── 구역 편집: 칸 선택(자유) — 화살표키 내비게이션(원본 §11 fCell 방향키 이식,
// 여기서는 포트 여러 개가 아니라 draftCells 하나만 다루도록 단순화) ──────
function onZoneCellKeyDown(e) {
  const dirMap = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const dir = dirMap[e.key];
  if (!dir) { return; }
  e.preventDefault();
  exitCompactView();

  if (!_led.draftFocus) {
    const start = firstSelectableCell();
    if (!start) { return; }
    _led.draftFocus = start;
    addDraftCell(start.row, start.col);
    afterDraftChange();
    return;
  }

  const cur = _led.draftFocus;
  // 음수 좌표로 나가도 그만이다 — 뷰 원점(gridDims)이 다음 렌더에서 알아서
  // 그 방향으로 따라간다(더 이상 좌표 자체를 밀 필요가 없다).
  const target = { row: cur.row + dir[1], col: cur.col + dir[0] };

  // 바로 직전 칸으로 되짚으면 취소하고 포커스를 그 칸으로 되돌린다.
  if (_led.draftCells.length >= 2) {
    const prev = parseCellKey(_led.draftCells[_led.draftCells.length - 2]);
    if (prev.row === target.row && prev.col === target.col) {
      removeDraftCellAt(cur.row, cur.col);
      _led.draftFocus = prev;
      afterDraftChange();
      return;
    }
  }

  if (!isCellSelectable(target.row, target.col)) { return; } // 기존 구역 칸은 통과 불가
  _led.draftFocus = target;
  addDraftCell(target.row, target.col);
  afterDraftChange();
}

// ── 구역 선택/편집 — 플로팅 팝업 대신 구역요약 목록의 해당 행이 아코디언으로
// 펼쳐지며 편집한다. 탭/클릭은 "선택"만 하고(캔버스든 목록이든 동일), 목록 행의
// "편집" 버튼을 눌러야 실제로 펼쳐진다 — 실수로 스치듯 탭했다고 바로 편집 폼이
// 뜨는 걸 피하기 위함.
function selectZone(zone) {
  _led.selectedZoneId = zone ? zone.id : null;
  if (_led.editingZoneId !== _led.selectedZoneId) { _led.editingZoneId = null; }
  renderZoneList();
  drawGrid();
}

function startEditingZone(zoneId) {
  const zone = getLedConfig().zones.find(z => z.id === zoneId);
  if (!zone) { return; }
  _led.selectedZoneId = zoneId;
  _led.editingZoneId = zoneId;
  _led.cfgPitch = zone.led;
  _led.cfgW = zone.panelW;
  _led.cfgH = zone.panelH;
  renderZoneList();
  drawGrid();
}

function stopEditingZone() {
  if (!_led.editingZoneId) { return; }
  _led.editingZoneId = null;
  renderZoneList();
}

function applyZoneEdit(zoneId) {
  const zone = getLedConfig().zones.find(z => z.id === zoneId);
  if (!zone) { return; }
  zone.led = _led.cfgPitch;
  if (!zone.cells) { // 자유 구역은 패널크기가 항상 500×500 고정 — 덮어쓰지 않는다
    zone.panelW = _led.cfgW;
    zone.panelH = _led.cfgH;
  }
  resetPortAssignments();
  _led.editingZoneId = null;
  renderLedDesignView();
}

function deleteZone(zoneId) {
  const cfg = getLedConfig();
  cfg.zones = cfg.zones.filter(z => z.id !== zoneId);
  if (_led.selectedZoneId === zoneId) { _led.selectedZoneId = null; }
  if (_led.editingZoneId === zoneId) { _led.editingZoneId = null; }
  resetPortAssignments();
  exitCompactView();
  renderLedDesignView();
}

// "설계 완료"로 줄어든 캔버스는 다시 뭔가를 그리거나 고치기 시작하면(칸 선택/
// 드래그/구역 삭제/편집 적용 등) 원래의 자동 확장 규칙으로 돌아간다 — 계속
// 편집하는데 캔버스가 좁게 고정돼 있으면 불편하기 때문. zoneViewCompact 자체는
// cfg(저장 데이터)에 있으므로, 여기서 끄는 것도 반드시 저장에 반영된다.
function exitCompactView() {
  const cfg = getLedConfig();
  if (!cfg.zoneViewCompact) { return; }
  cfg.zoneViewCompact = false;
  renderOverallResolution(cfg); // 편집 재개 시 "전체 해상도" 배지도 바로 숨긴다(다음 확정 때까진 잠정치라)
}

// 구역 편집 캔버스 전체 초기화 — 구역·포트 배정·초안을 전부 지우고 처음
// 상태(기본 15×10 격자)로 되돌린다. LAN/PWR 포트 배정은 건드리지 않되(그건
// ledResetAllBtn이 모드별로 따로 처리), 구역이 사라지면 어차피 포트도 다시
// 비워야 하므로 resetPortAssignments도 함께 부른다.
function resetAllZones() {
  if (!window.confirm('모든 구역을 전부 초기화할까요? 되돌릴 수 없습니다.')) { return; }
  const cfg = getLedConfig();
  cfg.zones = [];
  cfg.areaW = 0;
  cfg.areaH = 0;
  cfg.zoneViewCompact = false;
  clearDraft();
  stopEditingZone();
  _led.selectedZoneId = null;
  resetPortAssignments();
  renderLedDesignView();
}

// "설계 완료" — 캔버스를 구역만 감싸는 크기로 줄인다. gridDims()가 뷰 원점을
// bbox.min으로 직접 계산하므로 여백 제거 자체엔 좌표 이동이 필요 없지만,
// 저장되는 구역 좌표가 (0,0)부터 시작하는 게 더 보기 좋고 다루기 쉬우므로
// shiftAllContent로 정리해둔다(순전히 정돈 목적, 렌더링엔 영향 없음).
// zoneViewCompact를 cfg(저장 데이터)에 남겨서, 페이지를 나갔다 돌아와도 —
// 심지어 저장/불러오기를 해도 — 줄어든 상태가 그대로 유지된다.
function finishZoneDesign() {
  const cfg = getLedConfig();
  const bbox = boundingBoxOfZones(cfg.zones);
  if (!bbox) { return; } // 구역이 없으면 줄일 대상이 없음
  shiftAllContent(-bbox.minRow, -bbox.minCol);
  cfg.zoneViewCompact = true;
  sizeGridCanvas();
  drawGrid();
  renderZoneList();
}

// ── LAN/PWR 수동 포트 배정: 탭 토글 + 롱프레스 드래그 페인트 + 되짚기 취소 ──
function activePortsArray() {
  return _led.mode === 'lan' ? getLedConfig().lanPorts : getLedConfig().pwrPorts;
}

function portCountForMode() {
  return _led.mode === 'lan' ? ledPortLayout().ports.length : pwrPortCount();
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

// 아직 아무 패널도 없는 첫 포트(원본 §11 nextEmpty 이식). 롱프레스로 새 배선을
// 시작할 때 빈 칸을 누르면 "다음 포트"로 자동 넘어가게 하는 데 쓴다 — 이미 채운
// 포트를 매번 수동으로 선택하지 않아도 P1→P2→P3처럼 이어서 배정할 수 있다.
function nextEmptyPort() {
  const ports = activePortsArray();
  for (let i = 0; i < ports.length; i += 1) {
    if (ports[i].length === 0 && !sharedUsageOf(i)) { return i; }
  }
  return _led.activePort;
}

function setPanelPort(key, portIdx) {
  if (portIdx !== -1 && portIdx != null && sharedUsageOf(portIdx)) {
    showToast('다른 LED디스플레이가 이미 사용 중인 포트입니다.');
    return;
  }
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
    // 이미 배정된 패널을 꾹 누르면 그 소속 포트로 전환, 빈 패널을 꾹 누르면
    // 다음(아직 하나도 안 채운) 포트로 자동 전환 — 매번 포트 칩을 직접 눌러
    // 고르지 않아도 P1→P2→P3처럼 이어서 배정할 수 있다(원본 §11 동일 동작).
    const owner = portIndexOfKey(panel.key);
    _led.activePort = owner !== -1 ? owner : nextEmptyPort();
    renderPortStrip();
    renderPortDetail();
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
  const { originRow, originCol, cols, rows } = gridDims();
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
    drawZonesForEdit(ctx, originRow, originCol);
    if (_led.zoneCreateMode === 'cell') { drawDraftCells(ctx, originRow, originCol); }
    else if (_led.dragLerp) { drawDragRect(ctx, originRow, originCol); }
  } else {
    drawPanelsForPortMode(ctx, originRow, originCol);
  }
}

// 칸 선택(자유) 모드에서 지금 고르고 있는 draftCells를 강조 표시한다 —
// 확정 전까지는 아직 구역이 아니므로 drawZonesForEdit과는 별도로 그린다.
function drawDraftCells(ctx, originRow, originCol) {
  _led.draftCells.forEach(key => {
    const { row, col } = parseCellKey(key);
    const x = (col - originCol) * _led.cellPx; const y = (row - originRow) * _led.cellPx;
    ctx.fillStyle = 'rgba(110,107,244,0.35)';
    ctx.fillRect(x, y, _led.cellPx, _led.cellPx);
    const isFocus = _led.draftFocus && _led.draftFocus.row === row && _led.draftFocus.col === col;
    ctx.strokeStyle = isFocus ? '#ffffff' : '#6e6bf4';
    ctx.lineWidth = isFocus ? 3 : 2;
    ctx.strokeRect(x + 1, y + 1, _led.cellPx - 2, _led.cellPx - 2);
  });
}

// 칸 선택(자유)으로 만든 구역(zone.cells)은 사각형이 아닐 수 있어 하나의
// roundRect+클립으로 그릴 수 없다 — 칸마다 개별적으로 채우고 테두리를 그린다.
// 라벨(zN)은 바운딩 박스 안쪽 중앙에 한 번만 표시(각 칸 크기가 라벨을 담기엔
// 작을 수 있으므로).
function drawFreeformZone(ctx, zone, i, isSelected, originRow, originCol) {
  const color = portColor(i);
  const bounds = zoneBounds(zone);
  const anim = _led.animProg;
  const isNew = anim && anim.ids.has(zone.id);

  if (isNew) { ctx.save(); ctx.globalAlpha = anim.t; }

  zone.cells.forEach(({ row, col }) => {
    const x = (col - originCol) * _led.cellPx; const y = (row - originRow) * _led.cellPx;
    ctx.fillStyle = `${color}2e`;
    ctx.fillRect(x, y, _led.cellPx, _led.cellPx);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 1.5;
    ctx.strokeRect(x + (isSelected ? 1.5 : 0.75), y + (isSelected ? 1.5 : 0.75), _led.cellPx - (isSelected ? 3 : 1.5), _led.cellPx - (isSelected ? 3 : 1.5));
  });

  const bx = (bounds.minCol - originCol) * _led.cellPx; const by = (bounds.minRow - originRow) * _led.cellPx;
  const bw = (bounds.maxCol - bounds.minCol) * _led.cellPx; const bh = (bounds.maxRow - bounds.minRow) * _led.cellPx;
  const fs = Math.max(11, Math.min(16, _led.cellPx * 0.22));
  ctx.font = `700 ${fs}px sans-serif`;
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, fs * 0.3); ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cx = bx + bw / 2; const cy = by + bh / 2;
  ctx.strokeText(`z${i + 1} · ${zone.led}`, cx, cy);
  ctx.fillStyle = '#fff'; ctx.fillText(`z${i + 1} · ${zone.led}`, cx, cy);
  ctx.textBaseline = 'alphabetic';

  if (isNew) { ctx.restore(); }
}

function drawZonesForEdit(ctx, originRow, originCol) {
  const cfg = getLedConfig();
  cfg.zones.forEach((zone, i) => {
    if (zone.cells) { drawFreeformZone(ctx, zone, i, zone.id === _led.selectedZoneId, originRow, originCol); return; }

    const color = portColor(i);
    const zx = (zone.startCol - originCol) * _led.cellPx; const zy = (zone.startRow - originRow) * _led.cellPx;
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
      ctx.strokeRect((p.x / 500 - originCol) * _led.cellPx + 0.5, (p.y / 500 - originRow) * _led.cellPx + 0.5, p.w / 500 * _led.cellPx - 1, p.h / 500 * _led.cellPx - 1);
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
    if (sel && !sel.cells) { // 자유 구역은 drawFreeformZone이 칸별로 이미 선택 강조를 그림
      const sx = (sel.startCol - originCol) * _led.cellPx; const sy = (sel.startRow - originRow) * _led.cellPx;
      const sw = sel.cols * _led.cellPx; const sh = sel.rows * _led.cellPx;
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.setLineDash([7, 3]);
      ctx.strokeRect(sx + 1.5, sy + 1.5, sw - 3, sh - 3);
      ctx.setLineDash([]);
    }
  }
}

function drawPanelsForPortMode(ctx, originRow, originCol) {
  const cfg = getLedConfig();
  const ports = activePortsArray();

  // 패스 1: 구역 외곽선(사각형 구역만 — 자유 구역은 패널 하나=칸 하나라 아래
  // 패널 테두리가 이미 칸 경계를 다 보여줘서 별도 외곽선이 필요 없다) + 패널 배경/테두리
  cfg.zones.forEach(zone => {
    if (!zone.cells) {
      ctx.strokeStyle = '#3a3c44';
      ctx.lineWidth = 1;
      ctx.strokeRect((zone.startCol - originCol) * _led.cellPx + 0.5, (zone.startRow - originRow) * _led.cellPx + 0.5, zone.cols * _led.cellPx - 1, zone.rows * _led.cellPx - 1);
    }

    betaPanels(zone).forEach(p => {
      const portIdx = ports.findIndex(arr => arr.includes(p.key));
      const px = (p.x / 500 - originCol) * _led.cellPx; const py = (p.y / 500 - originRow) * _led.cellPx;
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
  drawPortPaths(ctx, originRow, originCol);

  // 패스 3: 셀 내 연결 순서 번호 + 포트 라벨(경로 위에 그림)
  const stepOf = new Map();
  ports.forEach(keys => keys.forEach((k, idx) => stepOf.set(k, idx + 1)));
  cfg.zones.forEach(zone => {
    betaPanels(zone).forEach(p => {
      const portIdx = ports.findIndex(arr => arr.includes(p.key));
      if (portIdx === -1 || _led.cellPx < 20) { return; }
      const px = (p.x / 500 - originCol) * _led.cellPx; const py = (p.y / 500 - originRow) * _led.cellPx;
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
// 같은 행(row) 안에서 열만 이동하는 구간은 겹침 방지를 위해 2차 베지어로
// 부풀려 그린다(drawPortPaths). 곡선 제어점 계산을 여기 한 곳에만 둬서
// 경로를 실제로 그리는 코드와 화살촉 방향 계산이 서로 다른 곡선을 가정하는
// 일이 없게 한다.
function curveControlPoint(a, b, totalRows) {
  const isTop = a.row < totalRows / 2;
  const ctrlY = isTop ? a.y - _led.cellPx * 0.7 : a.y + _led.cellPx * 0.7;
  return { x: (a.x + b.x) / 2, y: ctrlY };
}

function drawPortPaths(ctx, originRow, originCol) {
  const { rows: totalRows } = gridDims();
  const panelByKey = new Map(allPanels().map(p => [p.key, p]));
  const ports = activePortsArray();

  ports.forEach((keys, pi) => {
    const pts = keys.map(k => {
      const p = panelByKey.get(k);
      if (!p) { return null; }
      return {
        x: ((p.x + p.w / 2) / 500 - originCol) * _led.cellPx,
        y: ((p.y + p.h / 2) / 500 - originRow) * _led.cellPx,
        row: p.y / 500 - originRow, // 뷰 기준 행 — curveControlPoint의 isTop이 totalRows(뷰 높이)와 비교하므로
      };
    }).filter(Boolean);
    if (pts.length < 2) { return; }

    const color = portColor(pi);
    const strokePath = (style, lw) => {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]; const b = pts[i];
        if (a.row === b.row && a.x !== b.x) {
          const c = curveControlPoint(a, b, totalRows);
          ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
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

    // 화살촉 방향은 마지막 구간의 "실제 도착 접선"을 써야 한다 — 마지막 구간이
    // 같은 행 곡선이면 시작점→끝점 직선이 아니라 제어점→끝점 방향이 진짜 접선
    // 이다(2차 베지어의 t=1 미분 = 2*(끝점－제어점)). 이걸 안 쓰면 곡선은 휘어
    // 도착하는데 화살촉만 직선 방향을 가리켜 "가로 이동에서 화살표가 이상해
    // 보이는" 원인이 된다.
    const a = pts[pts.length - 2]; const b = pts[pts.length - 1];
    let dx = b.x - a.x; let dy = b.y - a.y;
    if (a.row === b.row && a.x !== b.x) {
      const c = curveControlPoint(a, b, totalRows);
      dx = b.x - c.x; dy = b.y - c.y;
    }
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

function drawDragRect(ctx, originRow, originCol) {
  const l = _led.dragLerp;
  const sx = (l.c0 - originCol) * _led.cellPx; const sy = (l.r0 - originRow) * _led.cellPx;
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

// 구역 하나 = 요약 줄(zone-row-main, 항상 보임) + 편집 아코디언(led-zone-row-edit,
// _led.editingZoneId일 때만). 팝업을 없애고 목록 행 자체가 펼쳐지는 방식으로
// 바꿔서 "선택 → 편집 버튼 → 그 행이 펼쳐짐"이 한 곳에서 끊김 없이 이어진다.
function zoneRowHtml(zone, i) {
  const panels = betaPanels(zone);
  const px = panels.reduce((s, p) => s + panelPx(p), 0);
  const color = portColor(i);
  // 격자 칸수 대신 그 구역을 감싸는 최소 직사각형의 해상도를 보여준다 — "몇 칸"보다
  // 실제로 몇 픽셀짜리인지가 더 바로 쓸 수 있는 정보라서(사각형·자유 구역 모두 동일 계산).
  const res = boundingResolutionForZones([zone]);
  const resLabel = res ? `${res.w}×${res.h}px` : '';
  const isSelected = zone.id === _led.selectedZoneId;
  const isEditing = zone.id === _led.editingZoneId;

  return `<div class="led-zone-row ${isSelected ? 'sel' : ''}" data-zone-id="${zone.id}">
    <div class="zone-row-main">
      <span class="zone-swatch" style="background:${color}"></span>
      <div class="zone-row-text">
        <span class="zone-label">z${i + 1} · ${zone.led}</span>
        <span class="zone-detail">${zone.panelW}×${zone.panelH}mm · ${panels.length}장 · ${resLabel} · ${px.toLocaleString()}px</span>
      </div>
      <div class="zone-row-btns">
        <button type="button" class="zone-btn zone-edit-btn">편집</button>
        <button type="button" class="zone-btn zone-del-btn">삭제</button>
      </div>
    </div>
    ${isEditing ? zoneEditHtml(zone) : ''}
  </div>`;
}

function zoneEditHtml(zone) {
  const pitchChips = ['2mm', '3mm', '4mm'].map(p =>
    `<button type="button" class="led-chip ${p === _led.cfgPitch ? 'on' : ''}" data-pitch="${p}">${p}</button>`).join('');
  const sizeOptions = [[500, 500, '500×500'], [500, 1000, '500×1000(세로)'], [1000, 500, '1000×500(가로)']];
  const sizeChips = sizeOptions.map(([w, h, label]) =>
    `<button type="button" class="led-chip ${w === _led.cfgW && h === _led.cfgH ? 'on' : ''}" data-size-w="${w}" data-size-h="${h}">${label}</button>`).join('');
  // 칸 선택(자유) 구역은 항상 500×500 단위라 패널크기를 고칠 수 없다 — 그 행을 아예 뺀다.
  const sizeRow = zone.cells ? '' : `<div class="led-cfg-row">
      <span class="led-cfg-label">패널 크기</span>
      <div class="led-chip-group">${sizeChips}</div>
    </div>`;

  return `<div class="led-zone-row-edit">
    <div class="led-cfg-row">
      <span class="led-cfg-label">LED 피치</span>
      <div class="led-chip-group">${pitchChips}</div>
    </div>
    ${sizeRow}
    <div class="led-cfg-actions">
      <button type="button" class="props-btn zone-edit-cancel">취소</button>
      <button type="button" class="props-btn props-btn-primary zone-edit-apply">적용</button>
    </div>
  </div>`;
}

// "설계 완료" 후에만 전체(모든 구역 합산) 해상도를 보여준다 — 편집 중에는
// 아직 최종 배치가 아니라서 굳이 계속 노출하지 않고, 완료를 눌러야 나온다.
function renderOverallResolution(cfg) {
  const el = document.getElementById('ledOverallRes');
  if (!cfg.zoneViewCompact || !cfg.zones.length) { el.hidden = true; return; }
  const res = boundingResolutionForZones(cfg.zones);
  if (!res) { el.hidden = true; return; }
  const totalPanels = cfg.zones.reduce((s, z) => s + betaPanels(z).length, 0);
  el.hidden = false;
  el.textContent = `전체 해상도 ${res.w.toLocaleString()}×${res.h.toLocaleString()}px · ${totalPanels}장`;
}

function renderZoneList() {
  const cfg = getLedConfig();
  document.getElementById('ledZoneCount').textContent = String(cfg.zones.length);
  renderOverallResolution(cfg);
  const listEl = document.getElementById('ledZoneList');
  listEl.innerHTML = cfg.zones.length
    ? cfg.zones.map((zone, i) => zoneRowHtml(zone, i)).join('')
    : '<div class="led-zone-empty">구역이 없습니다. 왼쪽 격자를 드래그하거나 칸을 선택해 추가하세요.</div>';

  listEl.querySelectorAll('.led-zone-row').forEach(row => {
    const zoneId = row.dataset.zoneId;
    row.querySelector('.zone-row-main').addEventListener('click', () => {
      selectZone(cfg.zones.find(z => z.id === zoneId));
    });
    row.querySelector('.zone-edit-btn').addEventListener('click', e => {
      e.stopPropagation();
      startEditingZone(zoneId);
    });
    row.querySelector('.zone-del-btn').addEventListener('click', e => {
      e.stopPropagation();
      deleteZone(zoneId);
    });

    const editEl = row.querySelector('.led-zone-row-edit');
    if (!editEl) { return; }
    editEl.querySelectorAll('[data-pitch]').forEach(btn => {
      btn.addEventListener('click', () => {
        _led.cfgPitch = btn.dataset.pitch;
        editEl.querySelectorAll('[data-pitch]').forEach(b => b.classList.toggle('on', b === btn));
      });
    });
    editEl.querySelectorAll('[data-size-w]').forEach(btn => {
      btn.addEventListener('click', () => {
        _led.cfgW = Number(btn.dataset.sizeW);
        _led.cfgH = Number(btn.dataset.sizeH);
        editEl.querySelectorAll('[data-size-w]').forEach(b => b.classList.toggle('on', b === btn));
      });
    });
    editEl.querySelector('.zone-edit-cancel').addEventListener('click', () => stopEditingZone());
    editEl.querySelector('.zone-edit-apply').addEventListener('click', () => applyZoneEdit(zoneId));
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
    _led.sharedPortUsage = resolveSharedPortUsage(State.graph, _led.nodeId);
  } else {
    sourceEl.textContent = `${pwrPortCount()}포트 · 포트당 ${PWR_PORT_CAP.toLocaleString()}px`;
    if (_led.activePort >= pwrPortCount()) { _led.activePort = 0; }
    _led.sharedPortUsage = null;
  }
  document.getElementById('ledPwrPortControls').hidden = isLan;
  renderPortStrip();
  renderPortDetail();
  renderCableSum();
}

// 이 포트가 같은 샌딩카드를 공유하는 다른 LED디스플레이에서 이미 쓰이고
// 있는지 — 있으면 그 사용 정보({ledNodeId,label,panelKeys}), 아니면 null.
function sharedUsageOf(portIdx) {
  return (_led.sharedPortUsage && _led.sharedPortUsage[portIdx]) || null;
}

// LAN 모드에서 샌딩카드가 2대 이상 연결돼 있으면 포트 칩을 카드별로 묶어서
// 보여준다("랜 배선 탭에서 포트를 샌딩카드별로 나눠서 표기" 요청 반영).
function renderPortStrip() {
  const ports = activePortsArray();
  const strip = document.getElementById('ledPortStrip');
  const isLan = _led.mode === 'lan';

  const chipHtml = (i, keys) => {
    const color = portColor(i);
    const shared = sharedUsageOf(i);
    const lockedCls = shared ? 'locked' : '';
    const title = shared ? `title="다른 LED디스플레이(${escapeHtml(shared.label)})가 사용 중 · ${shared.panelKeys.length}장"` : '';
    const count = shared ? shared.panelKeys.length : keys.length;
    return `<button class="led-port-chip ${i === _led.activePort ? 'on' : ''} ${lockedCls}" data-port="${i}" style="--chip-color:${color}" ${title}>
      P${i + 1}<span class="chip-count">${count}</span>${shared ? '<span class="chip-shared-mark">🔗</span>' : ''}
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
  const shared = isLan ? sharedUsageOf(_led.activePort) : null;

  // 다른 LED디스플레이가 이미 쓰고 있는(공유된) 포트는 이 장비 쪽에서 배정/
  // 초기화할 게 없으므로(항상 0장) 대신 그 사용 현황만 읽기 전용으로 보여준다.
  if (shared) {
    detail.innerHTML = `
      <div class="led-port-detail-head">
        <span class="port-swatch" style="background:${color}"></span>
        <span class="port-name">P${_led.activePort + 1}${escapeHtml(groupLabel)}</span>
        <span class="port-meta port-meta-shared">🔗 ${escapeHtml(shared.label)}에서 사용 중 · ${shared.panelKeys.length}장</span>
      </div>
      <div class="port-shared-note">이 포트는 같은 샌딩카드를 공유하는 다른 LED디스플레이가 이미 배정해 두었습니다. 이 장비에서는 배정할 수 없습니다.</div>
    `;
    return;
  }

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
