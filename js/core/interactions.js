// ── interactions ────────────────────────────────────
// 캔버스 팬/줌, 노드 드래그·선택·삭제, 팔레트에서 노드 추가.
// 마우스와 터치(한 손가락 팬/드래그, 두 손가락 핀치줌)를 같은 로직으로 처리한다.
// clientXY()는 js/leddesign/ledDesignView.js에 이미 정의된 전역 헬퍼를 그대로 쓴다
// (마우스/터치 좌표 추출 규칙이 같은 도메인이라 여기서 다시 만들지 않음).

let _dragNodeId = null;
let _dragOffset = { x: 0, y: 0 };
let _isPanning = false;
let _panStart = { x: 0, y: 0 };
let _panOrigin = { x: 0, y: 0 };
let _connectFrom = null; // { nodeId, portId }
let _dragMoved = false;
let _dragStartScreen = { x: 0, y: 0 };
let _pinch = null; // { lastDist }

function initInteractions(canvasEl, nodeLayerEl) {
  canvasEl.addEventListener('mousedown', e => handleCanvasDown(e.clientX, e.clientY));
  canvasEl.addEventListener('wheel', onWheel, { passive: false });
  nodeLayerEl.addEventListener('mousedown', onNodeLayerMouseDown);
  nodeLayerEl.addEventListener('click', onNodeLayerClick);
  window.addEventListener('mousemove', e => handlePointerMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', e => handlePointerUp(e.clientX, e.clientY));
  window.addEventListener('keydown', onKeyDown);

  document.getElementById('edgeDeleteBtn').addEventListener('click', e => {
    e.stopPropagation();
    deleteSelectedEdge();
  });

  canvasEl.addEventListener('touchstart', e => { e.preventDefault(); onCanvasTouchStart(e); }, { passive: false });
  nodeLayerEl.addEventListener('touchstart', e => { e.preventDefault(); onNodeLayerTouchStart(e); }, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: false });
  window.addEventListener('touchcancel', onTouchEnd, { passive: false });

  // 레벨1(카테고리) 버튼: js/devices/devices.js에 프리셋이 있는 타입(콘솔/샌딩카드)은
  // 레벨2 장비 목록으로 드릴다운하고, 프리셋이 없지만 설정할 게 있는 타입(인풋소스)은
  // 바로 초안(draft) 설정창을 연다. 그 외(메인전원/분전함)는 지금까지처럼 바로 추가한다.
  document.querySelectorAll('#paletteLevelCategories .palette-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      // LED디스플레이만 추가 전에 설치면적/피치/패널크기를 미리 물어보는 팝업을
      // 거친다(선택 사항 — 건너뛰면 다른 타입과 동일하게 빈 상태로 추가된다).
      if (type === 'led') { closePaletteMenu(); openLedAddModal(); return; }
      if (listDevices(type).length > 0) { openPaletteDeviceList(type); return; }
      if (CONFIGURABLE_TYPES.has(type)) { closePaletteMenu(); openDraftPanel(type, 'categories'); return; }
      closePaletteMenu();
      addNodeFromPalette(type);
    });
  });
  initPaletteDeviceList();
  initLedAddModal();
  initPaletteMenu();
}

// ── "+ 장비 추가" 드롭다운 열기/닫기 ──────────────────
function initPaletteMenu() {
  const toggleBtn = document.getElementById('paletteToggleBtn');
  toggleBtn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = !document.getElementById('palette').classList.contains('open');
    // 토글 버튼으로 새로 열 때는 항상 처음부터 다시 시작한다 — 편집 중이던
    // 초안, 열려 있던 속성 패널(기존 노드 편집), LED 추가 창은 모두 버리고
    // 카테고리 목록으로.
    if (opening) {
      discardDraft();
      selectNode(null);
      renderNodeCards();
      renderPropertiesPanel();
      closeLedAddModal();
      showPaletteLevel('categories');
    }
    setPaletteMenuOpen(opening);
  });
  const outsideHandler = e => {
    const wrap = document.getElementById('paletteWrap');
    if (!wrap.contains(e.target)) { closePaletteMenu(); }
  };
  window.addEventListener('mousedown', outsideHandler);
  window.addEventListener('touchstart', outsideHandler, { passive: true });
}

function setPaletteMenuOpen(open) {
  document.getElementById('palette').classList.toggle('open', open);
  document.getElementById('paletteToggleBtn').classList.toggle('open', open);
}

function closePaletteMenu() {
  setPaletteMenuOpen(false);
}

// ── 팔레트 레벨2: 카테고리별 장비 프리셋 목록 ─────────
function showPaletteLevel(level) {
  const palette = document.getElementById('palette');
  palette.dataset.level = level;
  document.getElementById('paletteLevelCategories').hidden = level !== 'categories';
  document.getElementById('paletteLevelDevices').hidden = level !== 'devices';
}

function initPaletteDeviceList() {
  document.getElementById('paletteBackBtn').addEventListener('click', e => {
    e.stopPropagation();
    showPaletteLevel('categories');
  });
  document.getElementById('paletteDeviceList').addEventListener('click', e => {
    const btn = e.target.closest('.palette-btn[data-device-id]');
    if (!btn) { return; }
    const type = btn.dataset.type;
    const deviceId = btn.dataset.deviceId;
    if (deviceId) {
      closePaletteMenu();
      addNodeFromPaletteWithDevice(type, deviceId);
    } else {
      closePaletteMenu();
      openDraftPanel(type, 'devices');
    }
  });
}

// 프리셋이 있는 장비는 짧은 이름(shortName)만 보여준다. "수동 입력"도 같은
// 목록 안에 같은 모양 버튼으로 섞어 넣어 — 프리셋이든 수동이든 똑같이 눌러
// 고르는 선택지 하나일 뿐이라는 걸 강조한다(구분선이나 다른 스타일 없음).
function openPaletteDeviceList(type) {
  const deviceBtns = listDevices(type).map(d => `
    <button class="palette-btn" data-type="${type}" data-device-id="${d.id}">${escapeHtml(d.shortName)}</button>
  `).join('');
  document.getElementById('paletteDeviceList').innerHTML = `
    ${deviceBtns}
    <button class="palette-btn" data-type="${type}" data-device-id="">수동 입력</button>
  `;
  showPaletteLevel('devices');
}

function handleCanvasDown(x, y) {
  const edgeId = hitTestEdge(x, y);
  if (edgeId) {
    selectEdge(edgeId);
    renderNodeCards();
    renderPropertiesPanel();
    render();
    return;
  }
  selectNode(null);
  renderNodeCards();
  renderPropertiesPanel();
  render();
  _isPanning = true;
  _panStart = { x, y };
  _panOrigin = { x: State.ui.pan.x, y: State.ui.pan.y };
}

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  zoomAt(e.clientX, e.clientY, factor);
}

// 이 시점엔 드래그 준비만 하고 선택·설정창은 열지 않는다 — 노드를 드래그로
// 옮기려고 누른 순간 설정창부터 뜨는 걸 막기 위함(사용자 요청). 실제로
// 클릭(탭)인지 드래그인지는 마우스는 handlePointerUp, 터치는 onTouchEnd에서
// _dragMoved로 판정한 뒤에야 선택을 확정한다.
function handleNodeLayerDown(targetEl, x, y) {
  const portDot = targetEl.closest('.port-dot');
  if (portDot) {
    if (portDot.dataset.portDir !== 'out') { return; } // 출력 포트에서만 연결 시작
    _connectFrom = { nodeId: portDot.dataset.nodeId, portId: portDot.dataset.portId };
    return;
  }

  const cardEl = targetEl.closest('.node-card');
  if (!cardEl) { return; }

  const nodeId = cardEl.dataset.nodeId;
  const node = getNode(nodeId);
  const world = screenToWorld(x, y);
  _dragNodeId = nodeId;
  _dragOffset = { x: world.x - node.x, y: world.y - node.y };
  _dragMoved = false;
  _dragStartScreen = { x, y };
}

function onNodeLayerMouseDown(e) {
  e.stopPropagation();
  handleNodeLayerDown(e.target, e.clientX, e.clientY);
}

// led 노드 카드 본문을 "클릭"(드래그 아님)하면 LED 설계 세부 페이지를 연다.
// (마우스: 이 'click' 리스너. 터치: preventDefault로 합성 click이 안 일어나므로
// onTouchEnd에서 같은 조건을 직접 검사한다.)
function onNodeLayerClick(e) {
  if (_dragMoved) { return; }
  const bodyEl = e.target.closest('.node-card-body');
  if (!bodyEl) { return; }
  const cardEl = e.target.closest('.node-card');
  const node = getNode(cardEl.dataset.nodeId);
  if (node && node.type === 'led') { openLedDesignView(node.id); }
}

function tryOpenLedDesignFromTap(targetEl) {
  if (_dragMoved || !targetEl || !targetEl.closest) { return; }
  const bodyEl = targetEl.closest('.node-card-body');
  if (!bodyEl) { return; }
  const cardEl = targetEl.closest('.node-card');
  const node = cardEl && getNode(cardEl.dataset.nodeId);
  if (node && node.type === 'led') { openLedDesignView(node.id); }
}

function handlePointerMove(x, y) {
  if (_connectFrom) {
    const fromNode = getNode(_connectFrom.nodeId);
    if (fromNode) {
      const outPort = getPorts(fromNode).out.find(p => p.id === _connectFrom.portId);
      const canvasEl = document.getElementById('graphCanvas');
      const rect = canvasEl.getBoundingClientRect();
      setConnectPreview({
        fromWorld: getPortWorldPos(fromNode, 'out', _connectFrom.portId),
        toScreen: { x: x - rect.left, y: y - rect.top },
        kind: outPort ? outPort.kind : 'video',
      });
    }
    return;
  }
  if (_dragNodeId) {
    if (Math.abs(x - _dragStartScreen.x) > 4 || Math.abs(y - _dragStartScreen.y) > 4) {
      _dragMoved = true;
    }
    const world = screenToWorld(x, y);
    moveNode(_dragNodeId, world.x - _dragOffset.x, world.y - _dragOffset.y);
    renderNodeCards();
    render();
    return;
  }
  if (_isPanning) {
    State.ui.pan.x = _panOrigin.x + (x - _panStart.x);
    State.ui.pan.y = _panOrigin.y + (y - _panStart.y);
    render();
  }
}

function handlePointerUp(x, y) {
  if (_connectFrom) {
    const target = resolveDropTarget(x, y);
    if (target) {
      const fromNode = getNode(_connectFrom.nodeId);
      const toNode = getNode(target.nodeId);
      if (fromNode && fromNode.type === 'input' && toNode && toNode.type === 'console') {
        // 콘솔 입력은 도트 하나로 통합돼 있으므로, 실제로 어느 물리 포트에
        // 연결할지는 여기서 빈 포트를 찾아 자동/피커로 정한다.
        resolveConsoleInputConnection(fromNode, _connectFrom.portId, toNode, x, y);
      } else if (fromNode && fromNode.type === 'console' && toNode && target.portId) {
        // 콘솔 출력도 입력과 대칭 — 도트 하나로 통합돼 있으므로 실제로 어느
        // 물리 출력 포트로 나갈지는 여기서 빈 포트를 찾아 자동/피커로 정한다.
        resolveConsoleOutputConnection(fromNode, toNode, target.portId, x, y);
      } else if (toNode && target.portId) {
        const edge = addEdge(_connectFrom.nodeId, _connectFrom.portId, toNode.id, target.portId);
        if (edge) {
          // 샌딩카드를 LED디스플레이에 새로 연결하면, 이미 그려져 있는 배선(포트
          // 하나에 묶인 패널들)은 그대로 두고 몇 번 포트냐만 새 레이아웃에 맞춰
          // 옮긴다 — 자동 배정을 통째로 다시 돌리지 않는다("빠른 설정"은 생성
          // 시점에 이미 자동 배정이 끝나 있고, "자유 설계"는 애초에 자동 배정
          // 대상이 아니므로 둘 다 이걸로 충분하다 — 사용자 요청).
          if (fromNode.type === 'sending' && toNode.type === 'led') {
            reflowLanPortsForLedNode(toNode.id);
          }
          renderValidation();
          renderPropertiesPanel();
        }
      }
    }
    _connectFrom = null;
    clearConnectPreview();
  }
  if (_dragNodeId && !_dragMoved) {
    // 클릭(드래그 아님)일 때만 선택+설정 패널을 연다 — 터치와 동일하게 마우스도
    // 드래그로 이동만 했을 때는 패널이 뜨지 않게 한다(사용자 요청).
    selectNode(_dragNodeId);
    renderNodeCards();
    renderPropertiesPanel();
  }
  _dragNodeId = null;
  _isPanning = false;
}

// 연결 드롭 지점을 정한다: 정확히 입력 포트 도트 위에 놓였으면 그 포트를 쓰고,
// 아니어도 어떤 노드 카드 영역 안에 놓였으면 그 카드로 연결한다("장비 영역에만
// 들어가 있으면 연결" 요청) — 어느 포트로 연결할지는 드래그 중인 선의 kind와
// 맞는 입력 포트를 자동으로 고른다(예: led는 in/pwrIn 중 kind가 맞는 쪽).
function resolveDropTarget(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) { return null; }

  const dot = el.closest('.port-dot');
  if (dot && dot.dataset.portDir !== 'out') {
    return { nodeId: dot.dataset.nodeId, portId: dot.dataset.portId };
  }

  const cardEl = el.closest('.node-card');
  if (!cardEl) { return null; }
  const toNode = getNode(cardEl.dataset.nodeId);
  if (!toNode || toNode.id === _connectFrom.nodeId) { return null; }

  const fromNode = getNode(_connectFrom.nodeId);
  const fromPort = fromNode && getPorts(fromNode).out.find(p => p.id === _connectFrom.portId);
  const inPorts = getPorts(toNode).in;
  if (!inPorts.length) { return null; }
  const matched = (fromPort && inPorts.find(p => p.kind === fromPort.kind)) || inPorts[0];
  return { nodeId: toNode.id, portId: matched.id };
}

// 인풋소스 → 콘솔 연결: 콘솔의 실제 물리 포트(devices.js) 중 빈 것을 찾는다.
// 빈 포트가 없으면 "포트 수 초과"로 연결을 거부하고, 하나만 남았으면 바로
// 연결하고, 여러 개 남았으면 사용자가 고르도록 피커를 띄운다.
function resolveConsoleInputConnection(fromNode, fromPortId, toNode, clientX, clientY) {
  const allPorts = getConsoleInputPorts(toNode);
  const occupied = new Set(State.graph.edges.filter(e => e.to.nodeId === toNode.id).map(e => e.to.portId));
  const free = allPorts.filter(p => !occupied.has(p.id));

  if (free.length === 0) {
    showToast(`입력 포트가 모두 사용 중입니다 (${allPorts.length}/${allPorts.length})`);
    return;
  }

  const connect = portId => {
    const edge = addEdge(fromNode.id, fromPortId, toNode.id, portId);
    if (edge) { renderValidation(); renderPropertiesPanel(); }
  };

  if (free.length === 1) {
    connect(free[0].id);
    return;
  }
  openPortPicker(clientX, clientY, free, connect);
}

// 콘솔 → 샌딩카드/LED/프롬프터 연결: 입력 쪽과 대칭 — 콘솔의 실제 물리 출력
// 포트(devices.js) 중 이 목적지에 실제로 연결 가능한 것(예: 프롬프터는 AUX
// 포트만 — graphOps.js의 isPairAllowed)만 추려 빈 것을 찾는다. 그런 포트가
// 아예 없거나 전부 찼으면 연결을 거부하고, 하나만 남았으면 바로 연결하고,
// 여러 개 남았으면 사용자가 고르도록 피커를 띄운다.
function resolveConsoleOutputConnection(fromNode, toNode, toPortId, clientX, clientY) {
  const allPorts = getConsoleOutputPorts(fromNode).filter(p => isPairAllowed(fromNode, p.id, toNode, toPortId));
  if (allPorts.length === 0) {
    showToast('이 목적지로 연결할 수 있는 출력 포트가 없습니다');
    return;
  }
  const occupied = new Set(State.graph.edges.filter(e => e.from.nodeId === fromNode.id).map(e => e.from.portId));
  const free = allPorts.filter(p => !occupied.has(p.id));

  if (free.length === 0) {
    showToast(`출력 포트가 모두 사용 중입니다 (${allPorts.length}/${allPorts.length})`);
    return;
  }

  const connect = portId => {
    const edge = addEdge(fromNode.id, portId, toNode.id, toPortId);
    if (edge) { renderValidation(); renderPropertiesPanel(); }
  };

  if (free.length === 1) {
    connect(free[0].id);
    return;
  }
  openPortPicker(clientX, clientY, free, connect);
}

function onKeyDown(e) {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') { return; }
  if (e.key !== 'Delete' && e.key !== 'Backspace') { return; }
  if (State.ui.selectedId) {
    removeNode(State.ui.selectedId);
    renderPropertiesPanel();
    renderValidation();
  } else if (State.ui.selectedEdgeId) {
    deleteSelectedEdge();
  }
}

// Delete/Backspace 키와 연결선 삭제 버튼(#edgeDeleteBtn) 둘 다 여기로 모인다.
function deleteSelectedEdge() {
  if (!State.ui.selectedEdgeId) { return; }
  removeEdge(State.ui.selectedEdgeId);
  renderValidation();
  renderPropertiesPanel();
}

// ── 터치: 팬/드래그는 마우스와 같은 핸들러를 재사용, 두 손가락은 핀치줌 ──
function touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function touchMid(touches) {
  return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
}

function startPinch(touches) {
  _isPanning = false;
  _dragNodeId = null;
  if (_connectFrom) { _connectFrom = null; clearConnectPreview(); }
  _pinch = { lastDist: touchDist(touches) };
}

function updatePinch(touches) {
  const dist = touchDist(touches);
  const mid = touchMid(touches);
  zoomAt(mid.x, mid.y, dist / _pinch.lastDist);
  _pinch.lastDist = dist;
}

function onCanvasTouchStart(e) {
  if (e.touches.length >= 2) { startPinch(e.touches); return; }
  const { x, y } = clientXY(e);
  handleCanvasDown(x, y);
}

function onNodeLayerTouchStart(e) {
  if (e.touches.length >= 2) { startPinch(e.touches); return; }
  e.stopPropagation();
  const { x, y } = clientXY(e);
  handleNodeLayerDown(e.target, x, y);
}

function onTouchMove(e) {
  if (_pinch && e.touches.length >= 2) {
    e.preventDefault();
    updatePinch(e.touches);
    return;
  }
  if (!_connectFrom && !_dragNodeId && !_isPanning) { return; }
  e.preventDefault();
  const { x, y } = clientXY(e);
  handlePointerMove(x, y);
}

function onTouchEnd(e) {
  if (_pinch) {
    if (e.touches.length < 2) { _pinch = null; }
    return;
  }
  if (!_connectFrom && !_dragNodeId && !_isPanning) { return; }
  const { x, y } = clientXY(e);
  const targetEl = e.changedTouches && e.changedTouches.length ? e.changedTouches[0].target : e.target;
  const wasDraggingNode = !!_dragNodeId;
  const tappedNodeId = _dragNodeId;
  const wasTap = wasDraggingNode && !_dragMoved;
  handlePointerUp(x, y);
  if (wasDraggingNode) {
    tryOpenLedDesignFromTap(targetEl);
    // 손가락을 떼지 않고 움직였다면(드래그=이동) 설정창을 열지 않는다 —
    // 한 번 터치(탭)했을 때만 선택·설정창을 연다.
    if (wasTap) {
      selectNode(tappedNodeId);
      renderNodeCards();
      renderPropertiesPanel();
    }
  }
}

// ── 포트 피커 (빈 물리 포트가 여럿일 때 사용자가 고르는 작은 팝업) ──────
let _portPickerOutsideHandler = null;

function openPortPicker(clientX, clientY, ports, onPick) {
  closePortPicker(); // 이전에 열려 있던 피커의 outside-click 리스너가 남아있지 않도록 먼저 정리
  const el = document.getElementById('portPicker');
  el.innerHTML = ports.map(p =>
    `<button class="port-picker-btn" data-port-id="${p.id}">${escapeHtml(p.label)}</button>`
  ).join('');
  el.hidden = false;
  el.style.left = `${Math.min(clientX, window.innerWidth - 190)}px`;
  el.style.top = `${Math.min(clientY, window.innerHeight - (ports.length * 34 + 12))}px`;

  el.querySelectorAll('.port-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closePortPicker();
      onPick(btn.dataset.portId);
    });
  });

  _portPickerOutsideHandler = ev => {
    if (!el.contains(ev.target)) { closePortPicker(); }
  };
  setTimeout(() => {
    window.addEventListener('mousedown', _portPickerOutsideHandler);
    window.addEventListener('touchstart', _portPickerOutsideHandler);
  }, 0);
}

function closePortPicker() {
  const el = document.getElementById('portPicker');
  el.hidden = true;
  el.innerHTML = '';
  if (_portPickerOutsideHandler) {
    window.removeEventListener('mousedown', _portPickerOutsideHandler);
    window.removeEventListener('touchstart', _portPickerOutsideHandler);
    _portPickerOutsideHandler = null;
  }
}

// ── 간단한 토스트 알림 ──────────────────────────────
let _toastTimer = null;

function showToast(message) {
  const el = document.getElementById('appToast');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2200);
}

// PC(넓은 화면): 같은 타입(장비)은 항상 같은 세로 열(swimlane)에 쌓인다 —
// 타입별로 열이 고정돼 있어(NODE_ORDER 순서) 신호 경로가 왼쪽→오른쪽으로
// 읽히고, 같은 장비를 추가로 놓으면 먼저 놓인 것 바로 아래에 붙는다.
// 좌표는 항상 "이미 놓인 노드들의 실제 위치"를 기준으로 계산한다 — 현재
// 화면 중앙을 기준으로 매번 다시 계산하면, ensureNodeVisible이나 사용자가
// 그 사이에 팬/줌을 바꿨을 때 격자가 어긋나 새 카드가 기존 카드와 겹칠 수
// 있다(실제로 겹치는 버그의 원인이었음).
//
// 모바일(좁은 화면): 여러 열을 한 화면에 동시에 볼 수 없어서 PC 규칙을
// 90도 돌린 모양으로 쓴다 — 타입별로 행(가로줄)이 고정돼(NODE_ORDER 순서)
// 위→아래로 읽히고, 같은 장비를 추가로 놓으면 먼저 놓인 것 바로 오른쪽에
// 붙는다(사용자 요청). PC와 같은 이유로 좌표는 항상 "이미 놓인 노드들의
// 실제 위치"를 기준으로 계산한다.
function addNodeFromPalette(type) {
  finalizeAddedNode(createPositionedNode(type));
}

// 팔레트 레벨2에서 프리셋 있는 장비를 바로 골랐을 때 — 노드를 만들자마자
// deviceId를 적용해 완성된 상태로 놓는다. 프리셋이 이미 모든 설정을 정하므로
// 수동 입력과 달리 속성 패널을 열 필요가 없다(finalizeAddedNode의 openPanel=false).
function addNodeFromPaletteWithDevice(type, deviceId) {
  const node = createPositionedNode(type);
  applyDevicePreset(node, deviceId);
  finalizeAddedNode(node, false);
}

// 위치 계산(PC 격자/모바일 세로 한 줄)만 떼어낸 것 — LED 추가 팝업(openLedAddModal)이
// addNode 직후·finalizeAddedNode 이전에 config(ledDesign)를 채워 넣어야 해서
// addNodeFromPalette를 통째로 쓸 수 없기 때문에 두 조각으로 나눴다.
function createPositionedNode(type) {
  const canvasEl = document.getElementById('graphCanvas');
  const rect = canvasEl.getBoundingClientRect();
  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  const { x, y } = isMobile ? pickMobileSpot(type, rect) : pickSwimlaneSpot(type, rect);
  return addNode(type, x, y);
}

// openPanel=false면 카드는 선택(하이라이트)만 하고 속성 패널은 열지 않는다
// (선택 유지 채 패널만 닫는 closePropertiesPanel과 동일한 규칙).
function finalizeAddedNode(node, openPanel = true) {
  const canvasEl = document.getElementById('graphCanvas');
  const rect = canvasEl.getBoundingClientRect();
  ensureNodeVisible(node, rect);
  selectNode(node.id);
  renderNodeCards();
  if (openPanel) { renderPropertiesPanel(); } else { closePropertiesPanel(); }
}

function pickSwimlaneSpot(type, rect) {
  const gapX = CARD_WIDTH + 60;
  const gapY = 140;
  const col = NODE_ORDER.indexOf(type);

  const sameType = State.graph.nodes.filter(n => n.type === type);
  if (sameType.length > 0) {
    // 같은 타입의 마지막 노드 바로 아래(같은 열)에 이어 붙인다.
    const last = sameType[sameType.length - 1];
    return { x: last.x, y: last.y + gapY };
  }
  if (State.graph.nodes.length > 0) {
    // 이 타입은 처음 추가하지만 다른 노드가 이미 있으면, 그 노드를 기준으로
    // 같은 행(row 0) 높이에서 이 타입의 열(NODE_ORDER 순서상 위치)로 맞춘다.
    const ref = State.graph.nodes[0];
    const refCol = NODE_ORDER.indexOf(ref.type);
    return { x: ref.x + (col - refCol) * gapX, y: ref.y };
  }
  // 캔버스가 완전히 비어 있을 때만 현재 화면 중앙을 기준으로 새로 시작한다.
  const world = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return { x: world.x - (NODE_ORDER.length * gapX) / 2 + col * gapX, y: world.y - CARD_MIN_HEIGHT / 2 };
}

// pickSwimlaneSpot과 정확히 같은 구조를 x/y만 맞바꿔서 쓴다 — 타입별 "행"
// 위치는 NODE_ORDER 순서로 정해지고, 같은 타입을 추가로 놓으면 그 행
// 안에서 오른쪽으로 이어 붙는다.
function pickMobileSpot(type, rect) {
  const gapX = CARD_WIDTH + 60;
  const gapY = 140;
  const row = NODE_ORDER.indexOf(type);

  const sameType = State.graph.nodes.filter(n => n.type === type);
  if (sameType.length > 0) {
    // 같은 타입의 마지막 노드 바로 오른쪽(같은 행)에 이어 붙인다.
    const last = sameType[sameType.length - 1];
    return { x: last.x + gapX, y: last.y };
  }
  if (State.graph.nodes.length > 0) {
    // 이 타입은 처음 추가하지만 다른 노드가 이미 있으면, 맨 처음 놓인
    // 노드의 x(왼쪽 기준선)를 그대로 따르고 y만 이 타입의 행(NODE_ORDER
    // 순서상 위치)으로 맞춘다.
    const ref = State.graph.nodes[0];
    const refRow = NODE_ORDER.indexOf(ref.type);
    return { x: ref.x, y: ref.y + (row - refRow) * gapY };
  }
  // 캔버스가 완전히 비어 있을 때만 새로 시작한다 — 화면 중앙이 아니라
  // 위쪽에 둬서, 아래로 쌓일 때 노드 4개 정도는 스크롤 없이 한 화면에
  // 들어오게 한다(사용자 요청).
  const topOffset = 90;
  const world = screenToWorld(rect.left + rect.width / 2, rect.top + topOffset);
  return { x: world.x - CARD_WIDTH / 2, y: world.y };
}

// 저장된 현장을 불러오면 저장 당시 좌표가 그대로 들어오는데, 그게 지금
// 사용자의 화면 크기·팬 위치와 안 맞으면 캔버스 밖에 놓일 수 있다 — 팔레트로
// 장비를 하나씩 추가할 때와 똑같은 배치 규칙(pickSwimlaneSpot/pickMobileSpot +
// ensureNodeVisible)을 저장된 순서대로 다시 적용해, 지금 보이는 화면을
// 기준으로 새로 쌓이게 한다. 위치 계산만이 아니라 ensureNodeVisible까지 매
// 노드마다 반복해야 실제로 "추가하면 바로 보인다"가 재현된다 — 격자 전체
// 폭(타입 6개면 gapX*6)이 화면보다 넓을 수 있어서, 위치만 화면 중앙 기준으로
// 계산하는 것만으론 양 끝 열이 화면 밖에 남는다.
// 좌표만 다시 계산할 뿐 노드 객체와 그걸 참조하는 edges는 그대로 유지된다.
function relayoutGraphForViewport() {
  const canvasEl = document.getElementById('graphCanvas');
  const rect = canvasEl.getBoundingClientRect();
  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  const nodes = State.graph.nodes;
  State.graph.nodes = [];
  nodes.forEach(node => {
    const spot = isMobile ? pickMobileSpot(node.type, rect) : pickSwimlaneSpot(node.type, rect);
    node.x = spot.x;
    node.y = spot.y;
    State.graph.nodes.push(node);
    ensureNodeVisible(node, rect);
  });
  render();
}

// 열 배치(swimlane)가 화면 폭을 넘어가면(특히 좁은 모바일 화면) 새로 추가된
// 노드가 화면 밖에 놓일 수 있다 — 그 카드가 현재 보이는 캔버스 영역 안에
// 들어오도록 pan을 옮겨 "추가하면 바로 보인다"를 화면 크기와 무관하게 보장한다.
function ensureNodeVisible(node, rect) {
  const margin = 16;
  const topLeft = worldToScreen({ x: node.x, y: node.y });
  const bottomRight = worldToScreen({ x: node.x + CARD_WIDTH, y: node.y + cardHeightFor(node) });

  let dx = 0;
  let dy = 0;
  if (topLeft.x < margin) { dx = margin - topLeft.x; }
  else if (bottomRight.x > rect.width - margin) { dx = (rect.width - margin) - bottomRight.x; }
  if (topLeft.y < margin) { dy = margin - topLeft.y; }
  else if (bottomRight.y > rect.height - margin) { dy = (rect.height - margin) - bottomRight.y; }

  if (dx !== 0 || dy !== 0) {
    State.ui.pan.x += dx;
    State.ui.pan.y += dy;
    render();
  }
}

// ── LED디스플레이 추가 팝업 ───────────────────────────
// 첫 선택은 "빠른 설정"(단일 사각형 — 설치면적/피치/패널크기를 입력하면 그
// 정보를 그대로 덮는 구역 하나를 ledAreaSetup.js의 planFullAreaLed로 만든다)
// 또는 "자유 설계"(여러 구역·비정형 설치면적 — 빈 노드로 추가하고 곧장 구역
// 편집 캔버스를 열어 직접 그리게 한다) 중 하나다. 후자를 "나중에" 대신
// 대등한 첫 선택지로 둔 이유는 자유 배치도 정식 경로이지 미룬 게 아니라서.
const _ledAdd = { mode: 'rect' };
let _ledAddInited = false;

function initLedAddModal() {
  if (_ledAddInited) { return; }
  _ledAddInited = true;

  document.getElementById('ledAddCloseBtn').addEventListener('click', closeLedAddModal);
  document.getElementById('ledAddBackBtn').addEventListener('click', () => {
    closeLedAddModal();
    showPaletteLevel('categories');
    setPaletteMenuOpen(true);
  });
  document.getElementById('ledAddConfirmBtn').addEventListener('click', onLedAddConfirm);

  document.getElementById('ledAddAreaW').addEventListener('input', updateLedAddPreview);
  document.getElementById('ledAddAreaH').addEventListener('input', updateLedAddPreview);
  document.getElementById('ledAddPitch').addEventListener('change', updateLedAddPreview);
  document.getElementById('ledAddPanelSize').addEventListener('change', updateLedAddPreview);

  document.querySelectorAll('#ledAddModeTabs .led-add-mode-tab').forEach(btn => {
    btn.addEventListener('click', () => setLedAddMode(btn.dataset.mode));
  });
}

function setLedAddMode(mode) {
  _ledAdd.mode = mode;
  document.querySelectorAll('#ledAddModeTabs .led-add-mode-tab').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  document.getElementById('ledAddRectFields').hidden = mode !== 'rect';
  document.getElementById('ledAddFreeNote').hidden = mode !== 'free';
  updateLedAddPreview();
}

function openLedAddModal() {
  document.getElementById('ledAddAreaW').value = '';
  document.getElementById('ledAddAreaH').value = '';
  document.getElementById('ledAddPitch').value = '3mm';
  document.getElementById('ledAddPanelSize').value = '500x1000';
  setLedAddMode('rect');
  document.getElementById('ledAddModal').classList.add('open');
}

function closeLedAddModal() {
  document.getElementById('ledAddModal').classList.remove('open');
}

function readLedAddAreaMm() {
  const w = Math.round((Number(document.getElementById('ledAddAreaW').value) || 0) * 1000);
  const h = Math.round((Number(document.getElementById('ledAddAreaH').value) || 0) * 1000);
  return { areaW: w, areaH: h };
}

function readLedAddPanelSize() {
  const [panelW, panelH] = document.getElementById('ledAddPanelSize').value.split('x').map(Number);
  return { panelW, panelH };
}

function updateLedAddPreview() {
  const confirmBtn = document.getElementById('ledAddConfirmBtn');
  if (_ledAdd.mode === 'free') { confirmBtn.disabled = false; return; }

  const previewEl = document.getElementById('ledAddPreview');
  const { areaW, areaH } = readLedAddAreaMm();
  if (!areaW || !areaH) {
    previewEl.textContent = '';
    confirmBtn.disabled = true;
    return;
  }
  const { panelW, panelH } = readLedAddPanelSize();
  const pitch = document.getElementById('ledAddPitch').value;
  const plan = planFullAreaLed({ areaW, areaH, panelW, panelH, pitch });
  confirmBtn.disabled = false;
  previewEl.textContent = `${plan.resolution.w.toLocaleString()}×${plan.resolution.h.toLocaleString()}px · ${plan.panelCount}장 · ${plan.totalPx.toLocaleString()}px`
    + (plan.areaW !== areaW || plan.areaH !== areaH ? ` (500mm 격자 반올림: ${plan.areaW / 1000}×${plan.areaH / 1000}m)` : '');
}

function onLedAddConfirm() {
  if (_ledAdd.mode === 'free') {
    const node = createPositionedNode('led');
    closeLedAddModal();
    finalizeAddedNode(node);
    renderValidation();
    openLedDesignView(node.id);
    return;
  }

  const { areaW, areaH } = readLedAddAreaMm();
  if (!areaW || !areaH) { return; } // 확인 버튼은 면적 미입력 시 disabled라 평소엔 도달하지 않음
  const { panelW, panelH } = readLedAddPanelSize();
  const pitch = document.getElementById('ledAddPitch').value;
  const plan = planFullAreaLed({ areaW, areaH, panelW, panelH, pitch });

  const node = createPositionedNode('led');
  node.config.ledDesign.areaW = plan.areaW;
  node.config.ledDesign.areaH = plan.areaH;
  node.config.ledDesign.zones = [plan.zone];
  node.config.totalRequiredPx = plan.totalPx;

  // 빠른 설정은 구역이 하나뿐이고 형태가 이미 확정이라 나중에 이어그릴 여백이
  // 필요 없다 — 구역 설계 캔버스를 열자마자 "여백 정리" 상태(여백 없는 축소
  // 뷰)로 시작하고, LAN·PWR 배선도 그 자리에서 바로 자동 배정해둔다(자유 설계는
  // 사용자가 직접 구역을 그려야 하므로 이 자동화 대상이 아니다). quickSetup을
  // 켜두면 이 LED가 나중에 샌딩카드에 새로 연결될 때도 같은 자동 배정이
  // 다시 돌아간다(handlePointerUp 참고).
  node.config.ledDesign.zoneViewCompact = true;
  node.config.ledDesign.quickSetup = true;
  autoAssignLanForLedNode(node.id);
  autoAssignPwrForLedNode(node.id);

  closeLedAddModal();
  // 방금 뜬 빠른 설정 팝업에서 이미 같은 값(면적/피치/패널크기)을 다 입력받았으므로,
  // 속성 패널을 또 띄우면 방금 입력한 걸 그대로 중복해서 보여주는 셈이다 — 캔버스
  // 선택 표시(하이라이트)는 유지하되 패널은 열지 않는다.
  finalizeAddedNode(node, false);
  renderValidation();
}
