// ── interactions ────────────────────────────────────
// 캔버스 팬/줌, 노드 드래그·선택·삭제, 팔레트에서 노드 추가.

let _dragNodeId = null;
let _dragOffset = { x: 0, y: 0 };
let _isPanning = false;
let _panStart = { x: 0, y: 0 };
let _panOrigin = { x: 0, y: 0 };
let _connectFrom = null; // { nodeId, portId }
let _dragMoved = false;
let _dragStartScreen = { x: 0, y: 0 };

function initInteractions(canvasEl, nodeLayerEl) {
  canvasEl.addEventListener('mousedown', onCanvasMouseDown);
  canvasEl.addEventListener('wheel', onWheel, { passive: false });
  nodeLayerEl.addEventListener('mousedown', onNodeLayerMouseDown);
  nodeLayerEl.addEventListener('click', onNodeLayerClick);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);

  document.querySelectorAll('.palette-btn').forEach(btn => {
    btn.addEventListener('click', () => addNodeFromPalette(btn.dataset.type));
  });
}

function onCanvasMouseDown(e) {
  const edgeId = hitTestEdge(e.clientX, e.clientY);
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
  _panStart = { x: e.clientX, y: e.clientY };
  _panOrigin = { x: State.ui.pan.x, y: State.ui.pan.y };
}

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  zoomAt(e.clientX, e.clientY, factor);
}

function onNodeLayerMouseDown(e) {
  const portDot = e.target.closest('.port-dot');
  if (portDot) {
    e.stopPropagation();
    if (portDot.dataset.portDir !== 'out') { return; } // 출력 포트에서만 연결 시작
    _connectFrom = { nodeId: portDot.dataset.nodeId, portId: portDot.dataset.portId };
    return;
  }

  const cardEl = e.target.closest('.node-card');
  if (!cardEl) { return; }
  e.stopPropagation();

  const nodeId = cardEl.dataset.nodeId;
  selectNode(nodeId);
  renderNodeCards();
  renderPropertiesPanel();

  const node = getNode(nodeId);
  const world = screenToWorld(e.clientX, e.clientY);
  _dragNodeId = nodeId;
  _dragOffset = { x: world.x - node.x, y: world.y - node.y };
  _dragMoved = false;
  _dragStartScreen = { x: e.clientX, y: e.clientY };
}

// led 노드 카드 본문을 "클릭"(드래그 아님)하면 LED 설계 세부 페이지를 연다.
function onNodeLayerClick(e) {
  if (_dragMoved) { return; }
  const bodyEl = e.target.closest('.node-card-body');
  if (!bodyEl) { return; }
  const cardEl = e.target.closest('.node-card');
  const node = getNode(cardEl.dataset.nodeId);
  if (node && node.type === 'led') { openLedDesignView(node.id); }
}

function onMouseMove(e) {
  if (_connectFrom) {
    const fromNode = getNode(_connectFrom.nodeId);
    if (fromNode) {
      const outPort = getPorts(fromNode).out.find(p => p.id === _connectFrom.portId);
      const canvasEl = document.getElementById('graphCanvas');
      const rect = canvasEl.getBoundingClientRect();
      setConnectPreview({
        fromWorld: getPortWorldPos(fromNode, 'out', _connectFrom.portId),
        toScreen: { x: e.clientX - rect.left, y: e.clientY - rect.top },
        kind: outPort ? outPort.kind : 'video',
      });
    }
    return;
  }
  if (_dragNodeId) {
    if (Math.abs(e.clientX - _dragStartScreen.x) > 4 || Math.abs(e.clientY - _dragStartScreen.y) > 4) {
      _dragMoved = true;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    moveNode(_dragNodeId, world.x - _dragOffset.x, world.y - _dragOffset.y);
    renderNodeCards();
    render();
    return;
  }
  if (_isPanning) {
    State.ui.pan.x = _panOrigin.x + (e.clientX - _panStart.x);
    State.ui.pan.y = _panOrigin.y + (e.clientY - _panStart.y);
    render();
  }
}

function onMouseUp(e) {
  if (_connectFrom) {
    const target = resolveDropTarget(e.clientX, e.clientY);
    if (target) {
      const fromNode = getNode(_connectFrom.nodeId);
      const toNode = getNode(target.nodeId);
      if (fromNode && fromNode.type === 'input' && toNode && toNode.type === 'console') {
        // 콘솔 입력은 도트 하나로 통합돼 있으므로, 실제로 어느 물리 포트에
        // 연결할지는 여기서 빈 포트를 찾아 자동/피커로 정한다.
        resolveConsoleInputConnection(fromNode, _connectFrom.portId, toNode, e.clientX, e.clientY);
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
  setTimeout(() => window.addEventListener('mousedown', _portPickerOutsideHandler), 0);
}

function closePortPicker() {
  const el = document.getElementById('portPicker');
  el.hidden = true;
  el.innerHTML = '';
  if (_portPickerOutsideHandler) {
    window.removeEventListener('mousedown', _portPickerOutsideHandler);
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
function addNodeFromPalette(type) {
  const canvasEl = document.getElementById('graphCanvas');
  const rect = canvasEl.getBoundingClientRect();
  const world = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);

  const gapX = CARD_WIDTH + 60;
  const gapY = 140;
  const col = NODE_ORDER.indexOf(type);
  const row = State.graph.nodes.filter(n => n.type === type).length;
  const originX = world.x - (NODE_ORDER.length * gapX) / 2;
  const originY = world.y - CARD_MIN_HEIGHT / 2;

  const node = addNode(type, originX + col * gapX, originY + row * gapY);
  selectNode(node.id);
  renderNodeCards();
  renderPropertiesPanel();
}
