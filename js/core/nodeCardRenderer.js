// ── nodeCardRenderer ────────────────────────────────
// State.graph.nodes를 #nodeLayer 안의 카드 DOM과 동기화한다.

const CARD_WIDTH = 180;
const CARD_MIN_HEIGHT = 64;
const PORT_ROW_HEIGHT = 20;
const PORTS_TOP_DEFAULT = 40; // 헤더 한 줄(아이콘+라벨) 높이 — 본문이 안 길어지면 이 값 그대로
const PORTS_BOTTOM_PAD = CARD_MIN_HEIGHT - PORTS_TOP_DEFAULT; // 마지막 포트 아래 여백(기존 폭 유지)

let _nodeLayerEl = null;

// 노드별로 실제 렌더된 "헤더+본문" 높이 = 포트 영역이 시작되는 y 오프셋을
// 기억해둔다. 본문 요약(cardSummary)이 줄바꿈으로 여러 줄이 되면 카드마다 이
// 값이 달라지므로, DOM에 실제로 그려본 뒤(updateCardEl) 실측해 여기 저장한다
// — 카드 전체 높이(cardHeightFor)와 포트 좌표(getPortWorldPos) 양쪽이 이
// 캐시를 그대로 읽어야 포트 점과 실제로 그려지는 연결선이 어긋나지 않는다.
// 아직 측정된 적 없는 노드는 기본값(PORTS_TOP_DEFAULT)을 쓴다.
let _portsTopCache = new Map();

function initNodeCardRenderer(nodeLayerEl) {
  _nodeLayerEl = nodeLayerEl;
}

function portsTopFor(nodeId) {
  return _portsTopCache.get(nodeId) || PORTS_TOP_DEFAULT;
}

// 카드 CSS 레이아웃(.node-ports: 세로 gap 8px, 점 11px)에 맞춘 포트 월드 좌표.
// dir은 'in'(pwrIn 포함) 또는 'out'.
function getPortWorldPos(node, dir, portId) {
  const ports = getPorts(node);
  const list = ports[dir] || [];
  const idx = Math.max(0, list.findIndex(p => p.id === portId));
  const y = node.y + portsTopFor(node.id) + idx * 19 + 5.5;
  const x = dir === 'in' ? node.x : node.x + CARD_WIDTH;
  return { x, y };
}

function cardHeightFor(node) {
  const ports = getPorts(node);
  const rows = Math.max(ports.in.length, ports.out.length, 1);
  return portsTopFor(node.id) + PORTS_BOTTOM_PAD + Math.max(0, rows - 1) * PORT_ROW_HEIGHT;
}

function renderNodeCards() {
  if (!_nodeLayerEl) { return; }
  const seen = new Set();

  State.graph.nodes.forEach(node => {
    seen.add(node.id);
    let el = _nodeLayerEl.querySelector(`.node-card[data-node-id="${node.id}"]`);
    if (!el) { el = buildCardEl(node); _nodeLayerEl.appendChild(el); }
    updateCardEl(el, node);
  });

  _nodeLayerEl.querySelectorAll('.node-card').forEach(el => {
    if (!seen.has(el.dataset.nodeId)) { el.remove(); }
  });
  Array.from(_portsTopCache.keys()).forEach(id => {
    if (!seen.has(id)) { _portsTopCache.delete(id); }
  });

  updatePaletteStartHint();
}

// 캔버스가 완전히 비어있을 때만 LED디스플레이 팔레트 버튼을 은은하게 강조해
// "여기부터 시작하면 좋다"는 걸 암시한다 — 장비를 먼저 고른 뒤 LED가 그보다
// 훨씬 크거나 작아서 다시 손대는 걸 줄이자는 취지의 약한 넛지(강제 아님, 다른
// 버튼을 눌러도 그대로 진행된다). 드롭다운은 기본적으로 닫혀 있어 그 안의
// LED 버튼이 안 보이므로, "+ 장비 추가" 토글 버튼 자체에도 같은 펄스를 준다.
function updatePaletteStartHint() {
  const isEmpty = State.graph.nodes.length === 0;
  const ledBtn = document.querySelector('.palette-btn[data-type="led"]');
  if (ledBtn) { ledBtn.classList.toggle('palette-btn-suggested', isEmpty); }
  const toggleBtn = document.getElementById('paletteToggleBtn');
  if (toggleBtn) { toggleBtn.classList.toggle('palette-toggle-btn-suggested', isEmpty); }
}

function buildCardEl(node) {
  const el = document.createElement('div');
  el.className = 'node-card';
  el.dataset.nodeId = node.id;
  el.innerHTML = `
    <div class="node-card-head">
      <span class="node-card-icon"></span>
      <span class="node-card-label"></span>
      <span class="node-card-badge"></span>
    </div>
    <div class="node-card-body"></div>
    <div class="node-ports node-ports-out"></div>
  `;
  return el;
}

function updateCardEl(el, node) {
  const meta = NODE_TYPES[node.type];
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.style.width = `${CARD_WIDTH}px`;
  el.classList.toggle('selected', State.ui.selectedId === node.id);
  el.classList.toggle('category-power', meta.category === 'power');
  el.classList.toggle('is-led', node.type === 'led');

  el.querySelector('.node-card-icon').textContent = meta.icon;
  el.querySelector('.node-card-label').textContent = node.label;
  const bodyEl = el.querySelector('.node-card-body');
  bodyEl.textContent = cardSummary(node);
  renderValidationBadge(el, node);

  // 본문이 줄바꿈되면 헤더+본문 실제 높이가 노드마다 달라진다. 캔버스가 숨겨진
  // 상태(예: LED 설계 세부 페이지가 열려 있을 때)면 offsetHeight가 0으로
  // 나오므로, 그런 경우엔 이전에 측정해둔 캐시 값을 그대로 두고 건드리지 않는다.
  const headEl = el.querySelector('.node-card-head');
  const measured = headEl.offsetHeight + bodyEl.offsetHeight;
  if (measured > 0) { _portsTopCache.set(node.id, measured); }

  const h = cardHeightFor(node);
  el.style.height = `${h}px`;

  const portsTop = portsTopFor(node.id);
  const outEl = el.querySelector('.node-ports-out');
  outEl.style.top = `${portsTop}px`;

  const ports = getPorts(node);
  renderPortDots(outEl, node, ports.out, 'out');
}

const VALIDATED_TYPES = new Set(['input', 'console', 'sending', 'led']);

// hasIssue(진짜 초과)가 최우선, 다음이 provisional(LED 해상도 미확정이라 0px로
// 트리비얼하게 통과한 잠정 결과) — validationEngine.js의 nodeProvisional 참고.
function renderValidationBadge(el, node) {
  const badge = el.querySelector('.node-card-badge');
  if (!VALIDATED_TYPES.has(node.type)) {
    badge.textContent = '';
    badge.classList.remove('badge-ok', 'badge-err', 'badge-provisional');
    el.classList.remove('has-issue', 'is-provisional');
    badge.title = '';
    return;
  }
  const validation = State.ui.validation || { nodeIssues: new Map(), nodeProvisional: new Set() };
  const issues = validation.nodeIssues.get(node.id) || [];
  const hasIssue = issues.length > 0;
  const isProvisional = !hasIssue && (validation.nodeProvisional || new Set()).has(node.id);

  badge.textContent = hasIssue ? '!' : (isProvisional ? '?' : '✓');
  badge.classList.toggle('badge-err', hasIssue);
  badge.classList.toggle('badge-ok', !hasIssue && !isProvisional);
  badge.classList.toggle('badge-provisional', isProvisional);
  badge.title = hasIssue
    ? issues.map(i => i.message).join('\n')
    : (isProvisional ? 'LED 해상도 미확정 — 잠정 결과(구역을 설계하면 실제 값으로 재검증됩니다)' : '');
  el.classList.toggle('has-issue', hasIssue);
  el.classList.toggle('is-provisional', isProvisional);
}

function cardSummary(node) {
  switch (node.type) {
    case 'input':
      return inputKindLabel(node.config.sourceKind);
    case 'console': {
      const d = node.config.deviceId ? getDevice('console', node.config.deviceId) : null;
      const total = getConsoleInputPorts(node).length;
      const occupied = State.graph.edges.filter(e => e.to.nodeId === node.id).length;
      const base = d ? d.shortName : '수동 설정';
      // 듀얼링크가 켜져 있으면(현재 J6만 해당, 자동 판정) 카드에서 바로 보이게
      // — 속성 패널을 열지 않아도 "DVI2가 왜 안 보이는지" 알 수 있어야 한다.
      const dualLabel = node.config.dviLink === 'dual' ? ' · 듀얼링크(DVI2 사용불가)' : '';
      // 콘솔→샌딩카드→LED가 실제로 연결돼 있으면 포트별로 내보내는 해상도·
      // 최대 Hz도 함께 보여준다(사용자 요청, 2026-08-26 — 샌딩카드 카드와
      // 대칭). 포트가 여럿이면 콤마로 이어 붙이고(긴 경우 카드 자체가
      // 말줄임표로 잘림), 속성 패널 출력 포트 목록에 전체가 있다.
      const outputInfo = resolveConsoleOutputInfo(State.graph, node);
      const outputLabel = outputInfo.length
        ? ' · ' + outputInfo.map(i => `${i.portLabel} ${i.w}×${i.h}${i.hz ? `·${i.hz}Hz` : ''}`).join(', ')
        : '';
      return `${base} · 입력 ${occupied}/${total}${dualLabel}${outputLabel}`;
    }
    case 'sending': {
      const d = node.config.deviceId ? getDevice('sending', node.config.deviceId) : null;
      const base = d ? `${d.shortName} · ${d.portCount}포트` : `${node.config.portCount}포트 (수동)`;
      // 연결된 LED의 해상도(2대 이상이 나눠 맡으면 가로로 균등 분할해 표시,
      // 사용자 요청)와, 상류 콘솔의 실제 출력 해상도 표에서 그 해상도가 낼 수
      // 있는 최대 주사율(validationEngine.js의 resolveSendingCardOutput).
      const out = resolveSendingCardOutput(State.graph, node);
      if (!out) { return base; }
      const hzLabel = out.hz ? ` · 최대 ${out.hz}Hz` : '';
      return `${base} · ${out.w}×${out.h}${hzLabel}`;
    }
    case 'led': {
      const cfg = node.config.ledDesign;
      const zones = cfg.zones || [];
      if (!zones.length) { return '구역 없음 (클릭해 설계)'; }
      const panelCount = zones.reduce((sum, z) => sum + betaPanels(z).length, 0);
      const px = node.config.totalRequiredPx || 0;
      // 구역이 여럿이라 비정형 배치여도, 전부 같은 피치면 그 구역들을 감싸는
      // 최소 직사각형 해상도를 보여준다(설치면적 입력값이 아니라 실제 그려진
      // 구역들의 바운딩 박스 기준 — 자유 설계는 면적을 미리 입력하지 않는다).
      const res = boundingResolutionForZones(zones);
      const resLabel = res && res.w && res.h ? `${res.w}×${res.h} · ` : '';
      return `${resLabel}${panelCount}장 · ${px.toLocaleString()}px`;
    }
    default:
      return '';
  }
}

function renderPortDots(container, node, portDefs, dir) {
  container.innerHTML = '';
  portDefs.forEach(p => {
    const dot = document.createElement('div');
    dot.className = `port-dot port-${dir} port-kind-${p.kind}`;
    dot.dataset.nodeId = node.id;
    dot.dataset.portId = p.id;
    dot.dataset.portDir = dir;
    dot.title = p.label || p.id;
    container.appendChild(dot);
  });
}
