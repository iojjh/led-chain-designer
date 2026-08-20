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
    const dot = document.elementFromPoint(e.clientX, e.clientY);
    const targetDot = dot && dot.closest && dot.closest('.port-dot');
    if (targetDot && targetDot.dataset.portDir !== 'out') {
      const edge = addEdge(_connectFrom.nodeId, _connectFrom.portId, targetDot.dataset.nodeId, targetDot.dataset.portId);
      if (edge) { renderValidation(); }
    }
    _connectFrom = null;
    clearConnectPreview();
  }
  _dragNodeId = null;
  _isPanning = false;
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
  }
}

function addNodeFromPalette(type) {
  const canvasEl = document.getElementById('graphCanvas');
  const rect = canvasEl.getBoundingClientRect();
  const world = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  // 연속으로 추가할 때 카드가 겹치지 않도록 3열 그리드로 순서대로 배치
  const index = State.graph.nodes.length;
  const col = index % 3;
  const row = Math.floor(index / 3);
  const gapX = CARD_WIDTH + 40;
  const gapY = 140;
  const node = addNode(
    type,
    world.x - CARD_WIDTH / 2 + (col - 1) * gapX,
    world.y - CARD_MIN_HEIGHT / 2 + row * gapY
  );
  selectNode(node.id);
  renderNodeCards();
  renderPropertiesPanel();
}
