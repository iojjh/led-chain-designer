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
let _edgeLabelLayer = null;
let _edgeLabelEls = new Map(); // edgeId -> DOM 엘리먼트(syncEdgeLabels)
let _edgePaths = []; // [{edgeId, points:[{x,y},...] (스크린 좌표)}]
let _connectPreview = null; // { fromWorld:{x,y}, toScreen:{x,y}, kind }
let _anchorDisplay = new Map(); // `${edgeId}|from`/`|to` -> 화면에 실제 보여주는(목표로 서서히 수렴 중인) 월드 좌표
let _pendingEase = false; // 이번 프레임에 아직 목표에 덜 수렴한 앵커가 있었는지(render()가 다음 프레임을 예약할지 판단)
let _easeFrameScheduled = false;

function initCanvasRenderer(canvasEl, nodeLayerEl, edgeLabelLayerEl) {
  _canvas = canvasEl;
  _ctx = canvasEl.getContext('2d');
  _nodeLayer = nodeLayerEl;
  _edgeLabelLayer = edgeLabelLayerEl;
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!_canvas) { return; }
  const rect = _canvas.parentElement.getBoundingClientRect();
  // 뷰가 숨겨져 있는 동안(예: LED 설계 페이지가 열린 채로 창 크기가 바뀜)
  // 부모가 display:none이라 rect가 0×0으로 잡힌다 — 이때 캔버스를 0×0으로
  // 만들어 버리면 인라인 width/height:0px가 CSS(100%)를 눌러, 그래프 뷰로
  // 돌아와도 점 배경·엣지가 사라진 채로 남는다(다음 resize 전까지). 측정
  // 불가하면 크기를 건드리지 않고, 뷰가 다시 보일 때 재측정하게 둔다.
  if (rect.width === 0 || rect.height === 0) { return; }
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

function sampleBezier(p0, c0, c1, p1, steps) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) { points.push(bezierPoint(p0, c0, c1, p1, i / steps)); }
  return points;
}

// dir0/dir1은 각 끝점이 카드 밖으로 "빠져나가는" 방향의 단위벡터(우측=
// {1,0}, 하단={0,1} 등, sideAnchorPoint 참고) — 제어점을 그 방향으로
// 밀어내 카드 변에서 자연스럽게 이어지는 곡선을 만든다.
function baseControlPoints(p0, dir0, p1, dir1) {
  const dist = bezierControlDist(p0, p1);
  return {
    c0: { x: p0.x + dir0.x * dist, y: p0.y + dir0.y * dist },
    c1: { x: p1.x + dir1.x * dist, y: p1.y + dir1.y * dist },
  };
}

// 실제 그리기 + 히트테스트용 폴리라인 샘플링을 맡는다. 제어점(c0/c1)은
// 호출자가 이미 정한 값을 그대로 쓴다 — 장애물 회피 여부와 무관하게 공통.
function strokeEdgeCurve(ctx, p0, c0, c1, p1, color, width, dashed) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.bezierCurveTo(c0.x, c0.y, c1.x, c1.y, p1.x, p1.y);
  ctx.stroke();
  ctx.restore();
  return sampleBezier(p0, c0, c1, p1, 20);
}

// 장애물 회피가 필요 없는 경우(연결 드래그 프리뷰)를 위한 얕은 래퍼 —
// dir0/dir1 방향으로만 부푼 기본 곡선을 그대로 그린다.
function strokeEdgePath(ctx, p0, dir0, p1, dir1, color, width, dashed) {
  const { c0, c1 } = baseControlPoints(p0, dir0, p1, dir1);
  return strokeEdgeCurve(ctx, p0, c0, c1, p1, color, width, dashed);
}

function rectCenter(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function pointInRect(pt, rect, pad) {
  return pt.x >= rect.x - pad && pt.x <= rect.x + rect.w + pad
    && pt.y >= rect.y - pad && pt.y <= rect.y + rect.h + pad;
}

function polylineIntersectsRect(points, rect, pad) {
  return points.some(pt => pointInRect(pt, rect, pad));
}

// 직선 p0→p1을 기준으로 한 법선(perp) 위에서 obstacles 중 이 곡선이 실제로
// 뚫고 지나가는 카드가 있으면, 그 카드를 피할 수 있을 만큼 제어점을 옆으로
// 밀어(bulge) 곡선을 휘게 한다. 매번 처음(base) 제어점 기준으로 다시
// 계산해서 반복해도 계속 커지기만 하고 수렴하지 않는 걸 막고, 시도 횟수를
// 4회로 제한해 막힌 상태로 무한히 커지지 않게 한다 — 모든 배치에서 완전히
// 뚫고 못 지나가게 보장하진 못하지만(장애물이 선 양쪽을 동시에 막는 등),
// 실제로 카드를 관통하는 대부분의 경우는 1~2회 안에 해결된다.
function resolveObstacleAvoidingControlPoints(p0, dir0, p1, dir1, obstacleRects) {
  const base = baseControlPoints(p0, dir0, p1, dir1);
  if (!obstacleRects.length) { return base; }

  const lineLen = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const perp = { x: -(p1.y - p0.y) / lineLen, y: (p1.x - p0.x) / lineLen };

  let c0 = base.c0;
  let c1 = base.c1;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const points = sampleBezier(p0, c0, c1, p1, 16);
    const blocking = obstacleRects.filter(rect => polylineIntersectsRect(points, rect, 6));
    if (!blocking.length) { return { c0, c1 }; }

    const sideSum = blocking.reduce((sum, rect) => {
      const c = rectCenter(rect);
      const d = (c.x - p0.x) * perp.x + (c.y - p0.y) * perp.y;
      return sum + Math.sign(d || 1);
    }, 0);
    const dirSign = sideSum > 0 ? -1 : 1;
    const clearance = Math.max(...blocking.map(rect => Math.hypot(rect.w, rect.h) / 2));
    const bulge = dirSign * (clearance + 20 + attempt * 24);
    c0 = { x: base.c0.x + perp.x * bulge, y: base.c0.y + perp.y * bulge };
    c1 = { x: base.c1.x + perp.x * bulge, y: base.c1.y + perp.y * bulge };
  }
  return { c0, c1 };
}

// 인풋소스→콘솔, 콘솔→샌딩카드/LED 엣지는 실제 어느 물리 포트로 연결됐는지
// 알기 쉽도록 라인 중간에 라벨을 붙인다(입력은 DP/HDMI/DVI 등 커넥터, 출력은
// 콘솔의 출력 커넥터/그룹). 그 외 경로는 논리 포트가 하나뿐이라 굳이 라벨을
// 붙이지 않는다.
function edgeLabelFor(edge, fromNode, toNode) {
  if (fromNode.type === 'input' && toNode.type === 'console') {
    const port = getConsoleInputPorts(toNode).find(p => p.id === edge.to.portId);
    return port ? port.label : null;
  }
  if (fromNode.type === 'console') {
    const port = getConsoleOutputPorts(fromNode).find(p => p.id === edge.from.portId);
    if (!port) { return null; }
    // 듀얼링크로 합쳐진 DVI1(devices.js에서 dviLink:'dual'일 때만 남는 PGM
    // 포트, 메인·백업 둘 다)에서 나가는 선에는 "(듀얼링크)"를 덧붙여, 이
    // 연결이 DVI1+DVI2 대역폭을 합쳐 쓰고 있다는 걸 선만 보고도 알 수 있게
    // 한다. AUX(dvi3/dvi3b)는 듀얼링크와 무관해 대상이 아니다.
    const isDualMergedPort = fromNode.config.dviLink === 'dual'
      && (edge.from.portId === 'dvi1' || edge.from.portId === 'dvi1b');
    return isDualMergedPort ? `${port.label} (듀얼링크)` : port.label;
  }
  return null;
}

// 엣지 라벨은 캔버스가 아니라 #edgeLabelLayer에 DOM으로 띄운다 — 캔버스는
// #nodeLayer(노드 카드, z-index 5)보다 아래 레이어라서, 선이 짧아 라벨이
// 근처 카드와 겹치면 캔버스에 그린 텍스트는 카드에 가려진다(사용자 제보).
// 이 레이어는 z-index를 카드보다 높여 항상 온전히 보이게 한다. labelInfos는
// 이번 프레임에 라벨이 있는 엣지만 담고 있고, 여기서 노드 카드처럼 기존
// 엘리먼트를 재사용하며 사라진 것만 제거한다.
function syncEdgeLabels(labelInfos) {
  if (!_edgeLabelLayer) { return; }
  const seen = new Set();
  labelInfos.forEach(({ edgeId, mid, text, color }) => {
    seen.add(edgeId);
    let el = _edgeLabelEls.get(edgeId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'edge-label';
      _edgeLabelLayer.appendChild(el);
      _edgeLabelEls.set(edgeId, el);
    }
    el.textContent = text;
    el.style.color = color;
    el.style.transform = `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)`;
  });
  _edgeLabelEls.forEach((el, edgeId) => {
    if (!seen.has(edgeId)) { el.remove(); _edgeLabelEls.delete(edgeId); }
  });
}

function nodeCenter(node) {
  return { x: node.x + CARD_WIDTH / 2, y: node.y + cardHeightFor(node) / 2 };
}

// 장애물 회피 판정은 곡선을 그리는 스크린 좌표계에서 해야 하므로(팬/줌이
// 걸린 상태에서 카드도 화면상에서 이동·축소되므로), 카드의 월드 사각형을
// 미리 화면 좌표로 바꿔둔다(resolveObstacleAvoidingControlPoints 참고).
function screenRectFromNode(node) {
  const topLeft = worldToScreen({ x: node.x, y: node.y });
  const bottomRight = worldToScreen({ x: node.x + CARD_WIDTH, y: node.y + cardHeightFor(node) });
  return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
}

const CARD_SIDES = ['right', 'left', 'bottom', 'top'];
// 한 변에 여러 엣지가 몰리면 정중앙 한 점에서 다 같이 튀어나와 겹쳐 보인다
// (spreadAnchorsOnSides) — 카드 모서리에 너무 바짝 붙지 않도록 양 끝에
// 이만큼 여백을 남기고 그 사이에 분산한다. 다만 변 전체 길이만큼 넓게
// 펼치면 카드가 클수록 연결부가 모서리 쪽까지 벌어져 지저분해 보이므로
// (사용자 요청 — "각 변 중앙쪽으로 좀 모여있으면 좋겠다"), 실제 퍼짐
// 폭은 SIDE_SPREAD_MAX로 한 번 더 눌러 변 중앙 근처에 모이게 한다.
const SIDE_SPREAD_MARGIN = 10;
const SIDE_SPREAD_MAX = 36;

// 카드 사각형의 한 변 위의 한 점(중앙에서 offset만큼 변을 따라 이동) + 그
// 변을 "빠져나가는" 방향의 단위벡터.
function sideAnchorPoint(node, side, offset) {
  const h = cardHeightFor(node);
  const c = nodeCenter(node);
  switch (side) {
    case 'right': return { x: node.x + CARD_WIDTH, y: c.y + offset, dir: { x: 1, y: 0 } };
    case 'left': return { x: node.x, y: c.y + offset, dir: { x: -1, y: 0 } };
    case 'bottom': return { x: c.x + offset, y: node.y + h, dir: { x: 0, y: 1 } };
    default: return { x: c.x + offset, y: node.y, dir: { x: 0, y: -1 } };
  }
}

function sideSpan(node, side) {
  const length = (side === 'left' || side === 'right') ? cardHeightFor(node) : CARD_WIDTH;
  return Math.min(SIDE_SPREAD_MAX, Math.max(0, length - SIDE_SPREAD_MARGIN * 2));
}

// 두 카드의 변 중앙점 4×4 조합을 모두 대보고 거리가 가장 짧은 한 쌍을
// 고른다 — "어느 변이 상대를 향해 있는지"를 방향으로 추정하던 기존 방식은
// 카드가 살짝만 대각선으로 어긋나도 최단이 아닌 변을 고르는 경우가 있었다.
// 4×4=16가지뿐이라 매 엣지마다 다 계산해도 비용이 미미하다. 정확한 앵커
// 좌표는(같은 변에 여러 엣지가 몰릴 수 있어) 여기서 정하지 않고 side 이름만
// 돌려준다 — renderEdges가 변별로 모아서 spreadAnchorsOnSides로 다시 계산한다.
function nearestSidePair(nodeA, nodeB) {
  let best = null;
  let bestDist = Infinity;
  CARD_SIDES.forEach(sa => {
    const a = sideAnchorPoint(nodeA, sa, 0);
    CARD_SIDES.forEach(sb => {
      const b = sideAnchorPoint(nodeB, sb, 0);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < bestDist) { bestDist = d; best = { sideA: sa, sideB: sb }; }
    });
  });
  return best;
}

// 같은 (노드, 변)을 쓰는 엣지들을 한데 모아, 상대 노드의 위치(그 변과 나란한
// 축)순으로 정렬한 뒤 변을 따라 균등 분산한다 — 정중앙 한 점에서 다 같이
// 튀어나오던 것을 부채꼴로 펼쳐 서로 겹치지 않게 한다. 상대적 순서로
// 정렬하기 때문에 같은 노드에서 나가는 선들끼리는 자기들끼리도 잘 안
// 엇갈린다(위쪽 상대는 위쪽 슬롯, 아래쪽 상대는 아래쪽 슬롯).
function spreadAnchorsOnSides(entries) {
  const groups = new Map(); // `${nodeId}|${side}` -> entries[]
  entries.forEach(entry => {
    const key = `${entry.node.id}|${entry.side}`;
    if (!groups.has(key)) { groups.set(key, []); }
    groups.get(key).push(entry);
  });

  const offsetByEntry = new Map();
  groups.forEach((group, key) => {
    const [, side] = key.split('|');
    const node = group[0].node;
    const axis = (side === 'left' || side === 'right') ? 'y' : 'x';
    const sorted = group.slice().sort((a, b) => nodeCenter(a.otherNode)[axis] - nodeCenter(b.otherNode)[axis]);
    const span = sideSpan(node, side);
    const n = sorted.length;
    sorted.forEach((entry, i) => {
      const offset = n === 1 ? 0 : (i / (n - 1) - 0.5) * span;
      offsetByEntry.set(entry, offset);
    });
  });
  return offsetByEntry;
}

function renderEdges(ctx) {
  if (!ctx) { return; }
  _edgePaths = [];
  const labelInfos = [];

  // Pass 1: 엣지마다 어느 변(상/하/좌/우)에서 나가고 들어갈지만 먼저 정한다
  // (정확한 좌표는 아직 — 같은 변에 여러 엣지가 몰릴 수 있어 Pass 2에서
  // 한꺼번에 분산시켜야 한다).
  const edgeSides = [];
  State.graph.edges.forEach(edge => {
    const fromNode = getNode(edge.from.nodeId);
    const toNode = getNode(edge.to.nodeId);
    if (!fromNode || !toNode) { return; }
    const { sideA, sideB } = nearestSidePair(fromNode, toNode);
    edgeSides.push({ edge, fromNode, toNode, fromSide: sideA, toSide: sideB });
  });

  // Pass 2: (노드, 변) 조합별로 몰린 엣지들을 그 변을 따라 균등 분산한다 —
  // 같은 노드에서 여러 선이 나갈 때 한 점에서 겹쳐 나오지 않게 한다.
  const spreadEntries = [];
  edgeSides.forEach(info => {
    spreadEntries.push({ node: info.fromNode, side: info.fromSide, otherNode: info.toNode, info, end: 'from' });
    spreadEntries.push({ node: info.toNode, side: info.toSide, otherNode: info.fromNode, info, end: 'to' });
  });
  const offsetByEntry = spreadAnchorsOnSides(spreadEntries);
  const fromOffset = new Map();
  const toOffset = new Map();
  spreadEntries.forEach(entry => {
    const offset = offsetByEntry.get(entry) || 0;
    (entry.end === 'from' ? fromOffset : toOffset).set(entry.info.edge.id, offset);
  });

  // Pass 3: 이번 프레임의 모든 카드를 화면 사각형으로 미리 바꿔둔다 — 각
  // 엣지의 장애물 목록(자기 자신의 두 끝 노드를 뺀 나머지 카드)을 여기서 뽑는다.
  const nodeRects = new Map();
  State.graph.nodes.forEach(n => nodeRects.set(n.id, screenRectFromNode(n)));

  _pendingEase = false;
  const seenAnchorKeys = new Set();

  edgeSides.forEach(({ edge, fromNode, toNode, fromSide, toSide }) => {
    const selected = State.ui.selectedEdgeId === edge.id;
    const hasIssue = !!(State.ui.validation && State.ui.validation.edgeIssues.has(edge.id));
    const color = selected ? EDGE_SELECTED_COLOR : hasIssue ? '#f0576b' : (EDGE_COLORS[edge.kind] || EDGE_COLORS.video);

    // 목표 앵커(장비 이동·분산 재계산 등으로 매 프레임 바뀔 수 있는 "정답"
    // 좌표)를 먼저 구하고, 실제로 그리는 좌표는 easeAnchor로 그 목표를
    // 향해 서서히 수렴시킨다 — 노드 드래그처럼 시작/끝 위치가 이동할 때
    // 뚝뚝 끊기지 않고 부드럽게 따라가 보이게 하기 위함(사용자 요청).
    const fromKey = `${edge.id}|from`;
    const toKey = `${edge.id}|to`;
    seenAnchorKeys.add(fromKey);
    seenAnchorKeys.add(toKey);
    const fromTarget = sideAnchorPoint(fromNode, fromSide, fromOffset.get(edge.id) || 0);
    const toTarget = sideAnchorPoint(toNode, toSide, toOffset.get(edge.id) || 0);
    const fromAnchor = easeAnchor(fromKey, fromTarget);
    const toAnchor = easeAnchor(toKey, toTarget);
    const p0 = worldToScreen({ x: fromAnchor.x, y: fromAnchor.y });
    const p1 = worldToScreen({ x: toAnchor.x, y: toAnchor.y });

    const obstacles = [];
    nodeRects.forEach((rect, nodeId) => {
      if (nodeId !== fromNode.id && nodeId !== toNode.id) { obstacles.push(rect); }
    });
    const { c0, c1 } = resolveObstacleAvoidingControlPoints(p0, fromAnchor.dir, p1, toAnchor.dir, obstacles);
    const points = strokeEdgeCurve(ctx, p0, c0, c1, p1, color, selected ? 3 : 2, false);
    _edgePaths.push({ edgeId: edge.id, points });

    const label = edgeLabelFor(edge, fromNode, toNode);
    if (label) { labelInfos.push({ edgeId: edge.id, mid: points[10], text: label, color: hasIssue ? '#f0576b' : color }); }
  });
  syncEdgeLabels(labelInfos);

  _anchorDisplay.forEach((v, key) => { if (!seenAnchorKeys.has(key)) { _anchorDisplay.delete(key); } });
  if (_pendingEase) { scheduleEaseFrame(); }

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

// 엣지 앵커 하나(key)를 목표(target) 쪽으로 서서히 옮긴다 — 처음 보는
// key면(새 엣지) 애니메이션 없이 바로 목표에서 시작한다. 아직 목표에
// 충분히 못 미친 경우 _pendingEase를 켜서 render()가 다음 프레임도
// 예약하게 한다(입력 이벤트가 더 없어도 수렴할 때까지 계속 그려야
// 하므로 — 안 그러면 마우스를 멈춘 순간 애니메이션이 중간에 멈춰버린다).
function easeAnchor(key, target) {
  const EASE_FACTOR = 0.12;
  const EPSILON = 0.4;
  let cur = _anchorDisplay.get(key);
  if (!cur) {
    cur = { x: target.x, y: target.y };
    _anchorDisplay.set(key, cur);
    return { x: cur.x, y: cur.y, dir: target.dir };
  }
  const dx = target.x - cur.x;
  const dy = target.y - cur.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
    cur.x = target.x;
    cur.y = target.y;
  } else {
    cur.x += dx * EASE_FACTOR;
    cur.y += dy * EASE_FACTOR;
    _pendingEase = true;
  }
  return { x: cur.x, y: cur.y, dir: target.dir };
}

function scheduleEaseFrame() {
  if (_easeFrameScheduled) { return; }
  _easeFrameScheduled = true;
  requestAnimationFrame(() => {
    _easeFrameScheduled = false;
    render();
  });
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
