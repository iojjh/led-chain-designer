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

  canvasEl.addEventListener('touchstart', e => { e.preventDefault(); onCanvasTouchStart(e); }, { passive: false });
  nodeLayerEl.addEventListener('touchstart', e => { e.preventDefault(); onNodeLayerTouchStart(e); }, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: false });
  window.addEventListener('touchcancel', onTouchEnd, { passive: false });

  document.querySelectorAll('.palette-btn').forEach(btn => {
    btn.addEventListener('click', () => addNodeFromPalette(btn.dataset.type));
  });
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
  selectNode(nodeId);
  renderNodeCards();
  renderPropertiesPanel();

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
      } else if (toNode && target.portId) {
        const edge = addEdge(_connectFrom.nodeId, _connectFrom.portId, toNode.id, target.portId);
        if (edge) { renderValidation(); renderPropertiesPanel(); }
      }
    }
    _connectFrom = null;
    clearConnectPreview();
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

function onKeyDown(e) {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') { return; }
  if (e.key !== 'Delete' && e.key !== 'Backspace') { return; }
  if (State.ui.selectedId) {
    removeNode(State.ui.selectedId);
    renderPropertiesPanel();
    renderValidation();
  } else if (State.ui.selectedEdgeId) {
    removeEdge(State.ui.selectedEdgeId);
    renderValidation();
    renderPropertiesPanel();
  }
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
  handlePointerUp(x, y);
  if (wasDraggingNode) { tryOpenLedDesignFromTap(targetEl); }
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

// 같은 타입(장비)은 항상 같은 세로 열(swimlane)에 쌓인다 — 타입별로 열이
// 고정돼 있어(NODE_ORDER 순서) 신호 경로가 왼쪽→오른쪽으로 읽히고, 같은
// 장비를 추가로 놓으면 먼저 놓인 것 바로 아래에 붙는다.
// 좌표는 항상 "이미 놓인 노드들의 실제 위치"를 기준으로 계산한다 — 현재
// 화면 중앙을 기준으로 매번 다시 계산하면, ensureNodeVisible이나 사용자가
// 그 사이에 팬/줌을 바꿨을 때 격자가 어긋나 새 카드가 기존 카드와 겹칠 수
// 있다(실제로 겹치는 버그의 원인이었음).
function addNodeFromPalette(type) {
  const canvasEl = document.getElementById('graphCanvas');
  const rect = canvasEl.getBoundingClientRect();

  const gapX = CARD_WIDTH + 60;
  const gapY = 140;
  const col = NODE_ORDER.indexOf(type);

  const sameType = State.graph.nodes.filter(n => n.type === type);
  let x, y;

  if (sameType.length > 0) {
    // 같은 타입의 마지막 노드 바로 아래(같은 열)에 이어 붙인다.
    const last = sameType[sameType.length - 1];
    x = last.x;
    y = last.y + gapY;
  } else if (State.graph.nodes.length > 0) {
    // 이 타입은 처음 추가하지만 다른 노드가 이미 있으면, 그 노드를 기준으로
    // 같은 행(row 0) 높이에서 이 타입의 열(NODE_ORDER 순서상 위치)로 맞춘다.
    const ref = State.graph.nodes[0];
    const refCol = NODE_ORDER.indexOf(ref.type);
    x = ref.x + (col - refCol) * gapX;
    y = ref.y;
  } else {
    // 캔버스가 완전히 비어 있을 때만 현재 화면 중앙을 기준으로 새로 시작한다.
    const world = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    x = world.x - (NODE_ORDER.length * gapX) / 2 + col * gapX;
    y = world.y - CARD_MIN_HEIGHT / 2;
  }

  const node = addNode(type, x, y);
  ensureNodeVisible(node, rect);
  selectNode(node.id);
  renderNodeCards();
  renderPropertiesPanel();
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
