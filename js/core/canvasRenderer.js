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
// 선이 가늘어(2px) 클릭/탭으로 정확히 맞히기 어렵다는 피드백에 따라 실제
// 보이는 두께보다 훨씬 넓게 잡는다(사용자 요청 — "선택되는 부분을 넓혀줘").
const EDGE_HIT_TOLERANCE = 14;

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

// 두 앵커 사이 거리를 기준으로 커브가 얼마나 부풀지 정한다. 기존엔 가로
// 거리만 봤지만(포트가 항상 좌/우 고정이라 그걸로 충분했음) 이제 앵커가
// 위/아래일 수도 있어 두 점 사이 전체 거리(hypot)로 일반화한다 — 같은 행에
// 나란히 놓인(가로 배치) 카드끼리는 세로 거리가 거의 0이라 결과가 기존
// 공식과 동일하다.
function bezierControlDist(p0, p1) {
  return Math.max(60, Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.5);
}

function bezierPoint(p0, c0, c1, p1, t) {
  const mt = 1 - t;
  const x = mt * mt * mt * p0.x + 3 * mt * mt * t * c0.x + 3 * mt * t * t * c1.x + t * t * t * p1.x;
  const y = mt * mt * mt * p0.y + 3 * mt * mt * t * c0.y + 3 * mt * t * t * c1.y + t * t * t * p1.y;
  return { x, y };
}

// dir0/dir1은 각 끝점이 카드 밖으로 "빠져나가는" 방향의 단위벡터(우측=
// {1,0}, 하단={0,1} 등, sideAnchor 참고) — 제어점을 그 방향으로 밀어내
// 카드 변에서 자연스럽게 이어지는 곡선을 만든다. 기존엔 항상 출력=오른쪽
// 방향, 입력=왼쪽 방향으로 고정이라 dir0={1,0}/dir1={-1,0}만 있었던 셈이다.
function strokeEdgePath(ctx, p0, dir0, p1, dir1, color, width, dashed) {
  const dist = bezierControlDist(p0, p1);
  const c0 = { x: p0.x + dir0.x * dist, y: p0.y + dir0.y * dist };
  const c1 = { x: p1.x + dir1.x * dist, y: p1.y + dir1.y * dist };
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

// 인풋소스→콘솔 엣지는 어떤 커넥터(DP/HDMI/DVI 등)로 연결됐는지 알기 쉽도록
// 라인 중간에 라벨을 붙인다. 다른 경로(콘솔 이후)는 논리 포트가 하나뿐이라
// 굳이 라벨을 붙이지 않는다.
function edgeLabelFor(edge, fromNode, toNode) {
  if (fromNode.type !== 'input' || toNode.type !== 'console') { return null; }
  const port = getConsoleInputPorts(toNode).find(p => p.id === edge.to.portId);
  return port ? port.label : null;
}

function drawEdgeLabel(ctx, midPoint, text, color) {
  ctx.save();
  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif';
  const paddingX = 6;
  const textWidth = ctx.measureText(text).width;
  const w = textWidth + paddingX * 2;
  const h = 16;
  const x = midPoint.x - w / 2;
  const y = midPoint.y - h / 2;
  ctx.fillStyle = '#101114';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const r = 8;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, midPoint.x, midPoint.y + 0.5);
  ctx.restore();
}

function nodeCenter(node) {
  return { x: node.x + CARD_WIDTH / 2, y: node.y + cardHeightFor(node) / 2 };
}

// 카드 사각형 네 변(상/하/좌/우) 중 (towardX,towardY) 방향에 가장 가까운
// 변의 중앙점 + 그 변을 "빠져나가는" 방향의 단위벡터를 돌려준다. 카드가
// 정사각형이 아니라 옆으로 넓으므로(CARD_WIDTH ≫ 카드 높이인 경우가 많음)
// 단순 각도 비교 대신 카드 절반 폭/높이로 정규화한 상대 위치를 비교한다 —
// 안 그러면 상대 노드가 살짝만 위아래로 벗어나도 옆면 대신 자꾸 위/아래를
// 고르게 된다. 가로로 나란히 놓인(같은 행) 카드끼리는 항상 좌/우가 나와
// 지금까지의 모양과 똑같다 — 세로로 겹치거나 붙어 있을 때만 상/하로 바뀐다.
function sideAnchor(node, towardX, towardY) {
  const h = cardHeightFor(node);
  const c = nodeCenter(node);
  const nx = (towardX - c.x) / (CARD_WIDTH / 2);
  const ny = (towardY - c.y) / (h / 2);
  if (Math.abs(nx) >= Math.abs(ny)) {
    return nx >= 0
      ? { x: node.x + CARD_WIDTH, y: c.y, dir: { x: 1, y: 0 } }
      : { x: node.x, y: c.y, dir: { x: -1, y: 0 } };
  }
  return ny >= 0
    ? { x: c.x, y: node.y + h, dir: { x: 0, y: 1 } }
    : { x: c.x, y: node.y, dir: { x: 0, y: -1 } };
}

function renderEdges(ctx) {
  if (!ctx) { return; }
  _edgePaths = [];
  State.graph.edges.forEach(edge => {
    const fromNode = getNode(edge.from.nodeId);
    const toNode = getNode(edge.to.nodeId);
    if (!fromNode || !toNode) { return; }
    // 엣지마다 상대 노드 방향을 따로 계산한다 — 포트 하나에 여러 엣지가
    // 동시에 붙는 경우(예: 샌딩카드 여러 대 → LED 하나, 캔버스에는 점
    // 하나로 통합 표시되는 그 포트)에도 각 연결선이 자기 상대 노드 쪽으로
    // 각자 알맞은 변을 골라 들어오게 하기 위함.
    const toCenter = nodeCenter(toNode);
    const fromCenter = nodeCenter(fromNode);
    const fromAnchor = sideAnchor(fromNode, toCenter.x, toCenter.y);
    const toAnchor = sideAnchor(toNode, fromCenter.x, fromCenter.y);
    const p0 = worldToScreen({ x: fromAnchor.x, y: fromAnchor.y });
    const p1 = worldToScreen({ x: toAnchor.x, y: toAnchor.y });
    const selected = State.ui.selectedEdgeId === edge.id;
    const hasIssue = !!(State.ui.validation && State.ui.validation.edgeIssues.has(edge.id));
    const color = selected ? EDGE_SELECTED_COLOR : hasIssue ? '#f0576b' : (EDGE_COLORS[edge.kind] || EDGE_COLORS.video);
    const points = strokeEdgePath(ctx, p0, fromAnchor.dir, p1, toAnchor.dir, color, selected ? 3 : 2, false);
    _edgePaths.push({ edgeId: edge.id, points });

    const label = edgeLabelFor(edge, fromNode, toNode);
    if (label) { drawEdgeLabel(ctx, points[10], label, hasIssue ? '#f0576b' : color); }
  });

  if (_connectPreview) {
    // 드래그로 새 연결을 만드는 중인 프리뷰는 지금까지처럼 고정 방향(출력=
    // 오른쪽에서 나가 왼쪽으로 들어가는 모양)을 그대로 쓴다 — 아직 상대
    // 노드가 정해지지 않아 "어느 변이 적절한지" 판단할 기준(상대 위치)이
    // 없고, 커서를 따라다니는 동안 방향이 계속 바뀌면 오히려 산만하다.
    const p0 = worldToScreen(_connectPreview.fromWorld);
    const p1 = _connectPreview.toScreen;
    const color = EDGE_COLORS[_connectPreview.kind] || EDGE_COLORS.video;
    strokeEdgePath(ctx, p0, { x: 1, y: 0 }, p1, { x: -1, y: 0 }, color, 2, true);
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
    if (_ctx) {
      // _canvas.width/height는 이미 devicePixelRatio가 곱해진 물리 픽셀 크기인데,
      // _ctx엔 resizeCanvas()가 건 dpr 스케일 트랜스폼이 계속 적용돼 있어 그냥
      // clearRect(0,0,_canvas.width,_canvas.height)를 부르면 dpr이 두 번 곱해진다.
      // dpr>=1(일반적인 고해상도 디스플레이)에선 그저 캔버스 밖까지 과하게 지우는
      // 것뿐이라 자동 클리핑돼 티가 안 났지만, dpr<1(예: 윈도우 디스플레이 배율
      // 90%)에서는 반대로 실제 캔버스보다 좁게 지워져 가장자리(특히 우측·하단)에
      // 이전 프레임의 엣지 선이 지워지지 않고 잔상처럼 계속 쌓였다(사용자 제보).
      // 트랜스폼을 잠깐 단위행렬로 되돌려 물리 픽셀 크기 그대로 지운다.
      _ctx.save();
      _ctx.setTransform(1, 0, 0, 1, 0, 0);
      _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
      _ctx.restore();
    }
  }
  renderEdges(_ctx);
  updateEdgeDeleteBtn();
}

// 선택된 엣지가 있으면 그 중간 지점(라벨과 같은 위치)에 삭제 버튼을 띄운다.
// pan/zoom이 바뀔 때마다(=render() 호출마다) 다시 계산해야 선을 계속 따라간다.
function updateEdgeDeleteBtn() {
  const btn = document.getElementById('edgeDeleteBtn');
  if (!btn) { return; }
  const path = State.ui.selectedEdgeId && _edgePaths.find(p => p.edgeId === State.ui.selectedEdgeId);
  if (!path) { btn.hidden = true; return; }
  const mid = path.points[10];
  btn.hidden = false;
  btn.style.transform = `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)`;
}
