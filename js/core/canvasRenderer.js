// ── canvasRenderer ──────────────────────────────────
// #graphCanvas: 점선 그리드는 CSS 배경(style.css)으로 그리고, 팬/줌에 맞춰
// background-position/size만 갱신한다(매 프레임 캔버스에 점을 다시 그리지 않음).
// 2D 컨텍스트는 엣지(베지어 커넥터) + 연결 드래그 프리뷰 전용.
// #nodeLayer: 노드 카드 DOM의 부모. transform: translate() scale()로 팬/줌 반영.

const GRID_SIZE = 24;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2;
const EDGE_COLORS = { video: '#4d8ff0', lan: '#3ecf8e', power: '#e7b549' };
const EDGE_SELECTED_COLOR = '#6e6bf4';
const EDGE_HIT_TOLERANCE = 7;

let _canvas = null;
let _ctx = null;
let _nodeLayer = null;
let _edgePaths = []; // [{edgeId, points:[{x,y},...] (스크린 좌표)}]
let _connectPreview = null; // { fromWorld:{x,y}, toScreen:{x,y}, kind }

function initCanvasRenderer(canvasEl, nodeLayerEl) {
  _canvas = canvasEl;
  _ctx = canvasEl.getContext('2d');
  _nodeLayer = nodeLayerEl;
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!_canvas) { return; }
  const rect = _canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  _canvas.width = Math.round(rect.width * dpr);
  _canvas.height = Math.round(rect.height * dpr);
  _canvas.style.width = `${rect.width}px`;
  _canvas.style.height = `${rect.height}px`;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

// 화면(스크린) 좌표 → 월드 좌표 변환. 인터랙션(팬/노드 드래그)에서 사용.
function screenToWorld(clientX, clientY) {
  const rect = _canvas.getBoundingClientRect();
  const { pan, zoom } = State.ui;
  return {
    x: (clientX - rect.left - pan.x) / zoom,
    y: (clientY - rect.top - pan.y) / zoom,
  };
}

function zoomAt(clientX, clientY, factor) {
  const rect = _canvas.getBoundingClientRect();
  const before = screenToWorld(clientX, clientY);
  State.ui.zoom = clampZoom(State.ui.zoom * factor);
  // 커서 아래 월드 좌표가 그대로 유지되도록 pan을 보정
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  State.ui.pan.x = cx - before.x * State.ui.zoom;
  State.ui.pan.y = cy - before.y * State.ui.zoom;
  render();
}

function worldToScreen(worldPos) {
  const { pan, zoom } = State.ui;
  return { x: worldPos.x * zoom + pan.x, y: worldPos.y * zoom + pan.y };
}

function bezierControlDx(p0, p1) {
  return Math.max(60, Math.abs(p1.x - p0.x) * 0.5);
}

function bezierPoint(p0, c0, c1, p1, t) {
  const mt = 1 - t;
  const x = mt * mt * mt * p0.x + 3 * mt * mt * t * c0.x + 3 * mt * t * t * c1.x + t * t * t * p1.x;
  const y = mt * mt * mt * p0.y + 3 * mt * mt * t * c0.y + 3 * mt * t * t * c1.y + t * t * t * p1.y;
  return { x, y };
}

function strokeEdgePath(ctx, p0, p1, color, width, dashed) {
  const dx = bezierControlDx(p0, p1);
  const c0 = { x: p0.x + dx, y: p0.y };
  const c1 = { x: p1.x - dx, y: p1.y };
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.bezierCurveTo(c0.x, c0.y, c1.x, c1.y, p1.x, p1.y);
  ctx.stroke();
  ctx.restore();
  const points = [];
  for (let i = 0; i <= 20; i += 1) { points.push(bezierPoint(p0, c0, c1, p1, i / 20)); }
  return points;
}

function renderEdges(ctx) {
  if (!ctx) { return; }
  _edgePaths = [];
  State.graph.edges.forEach(edge => {
    const fromNode = getNode(edge.from.nodeId);
    const toNode = getNode(edge.to.nodeId);
    if (!fromNode || !toNode) { return; }
    const p0 = worldToScreen(getPortWorldPos(fromNode, 'out', edge.from.portId));
    const p1 = worldToScreen(getPortWorldPos(toNode, 'in', edge.to.portId));
    const selected = State.ui.selectedEdgeId === edge.id;
    const hasIssue = !!(State.ui.validation && State.ui.validation.edgeIssues.has(edge.id));
    const color = selected ? EDGE_SELECTED_COLOR : hasIssue ? '#f0576b' : (EDGE_COLORS[edge.kind] || EDGE_COLORS.video);
    const points = strokeEdgePath(ctx, p0, p1, color, selected ? 3 : 2, false);
    _edgePaths.push({ edgeId: edge.id, points });
  });

  if (_connectPreview) {
    const p0 = worldToScreen(_connectPreview.fromWorld);
    const p1 = _connectPreview.toScreen;
    const color = EDGE_COLORS[_connectPreview.kind] || EDGE_COLORS.video;
    strokeEdgePath(ctx, p0, p1, color, 2, true);
  }
}

function setConnectPreview(preview) {
  _connectPreview = preview;
  render();
}

function clearConnectPreview() {
  _connectPreview = null;
  render();
}

// 클릭 지점(clientX/Y)이 그려진 엣지 경로 근처인지 검사 — 가장 가까운 엣지 id 반환.
function hitTestEdge(clientX, clientY) {
  const rect = _canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best = null;
  let bestDist = EDGE_HIT_TOLERANCE;
  _edgePaths.forEach(({ edgeId, points }) => {
    for (let i = 0; i < points.length - 1; i += 1) {
      const d = distToSegment({ x, y }, points[i], points[i + 1]);
      if (d < bestDist) { bestDist = d; best = edgeId; }
    }
  });
  return best;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function render() {
  if (!_nodeLayer) { return; }
  const { pan, zoom } = State.ui;
  _nodeLayer.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  if (_canvas) {
    _canvas.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
    _canvas.style.backgroundSize = `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`;
    if (_ctx) { _ctx.clearRect(0, 0, _canvas.width, _canvas.height); }
  }
  renderEdges(_ctx);
}
