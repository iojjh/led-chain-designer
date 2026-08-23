// ── nodeCardRenderer ────────────────────────────────
// State.graph.nodes를 #nodeLayer 안의 카드 DOM과 동기화한다.

const CARD_WIDTH = 180;
const CARD_MIN_HEIGHT = 64;
const PORT_ROW_HEIGHT = 20;

let _nodeLayerEl = null;

function initNodeCardRenderer(nodeLayerEl) {
  _nodeLayerEl = nodeLayerEl;
}

// 카드 CSS 레이아웃(.node-ports: top 40px, 세로 gap 8px, 점 11px)에 맞춘 포트 월드 좌표.
// dir은 'in'(pwrIn 포함) 또는 'out'.
function getPortWorldPos(node, dir, portId) {
  const ports = getPorts(node);
  const list = ports[dir] || [];
  const idx = Math.max(0, list.findIndex(p => p.id === portId));
  const y = node.y + 40 + idx * 19 + 5.5;
  const x = dir === 'in' ? node.x : node.x + CARD_WIDTH;
  return { x, y };
}

function cardHeightFor(node) {
  const ports = getPorts(node);
  const rows = Math.max(ports.in.length, ports.out.length, 1);
  return CARD_MIN_HEIGHT + Math.max(0, rows - 1) * PORT_ROW_HEIGHT;
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
    <div class="node-ports node-ports-in"></div>
    <div class="node-ports node-ports-out"></div>
  `;
  return el;
}

function updateCardEl(el, node) {
  const meta = NODE_TYPES[node.type];
  const h = cardHeightFor(node);
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.style.width = `${CARD_WIDTH}px`;
  el.style.height = `${h}px`;
  el.classList.toggle('selected', State.ui.selectedId === node.id);
  el.classList.toggle('category-power', meta.category === 'power');
  el.classList.toggle('is-led', node.type === 'led');

  el.querySelector('.node-card-icon').textContent = meta.icon;
  el.querySelector('.node-card-label').textContent = node.label;
  el.querySelector('.node-card-body').textContent = cardSummary(node);
  renderValidationBadge(el, node);

  const ports = getPorts(node);
  renderPortDots(el.querySelector('.node-ports-in'), node, ports.in, 'in');
  renderPortDots(el.querySelector('.node-ports-out'), node, ports.out, 'out');

  if (node.type === 'console') { markConsoleInputFullness(el, node); }
}

// 콘솔 입력 도트는 하나로 통합돼 있으므로, 실제 물리 포트가 전부 찼는지를
// 그 도트에 표시해 "포트 수 초과 시 불가"를 드래그해보기 전에 알 수 있게 한다.
function markConsoleInputFullness(el, node) {
  const dot = el.querySelector('.node-ports-in .port-dot');
  if (!dot) { return; }
  const total = getConsoleInputPorts(node).length;
  const occupied = State.graph.edges.filter(e => e.to.nodeId === node.id).length;
  dot.classList.toggle('port-full', occupied >= total);
  dot.title = `입력 (${occupied}/${total} 연결됨)`;
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
    case 'input': {
      const kindLabel = inputKindLabel(node.config.sourceKind);
      const etc = node.config.sourceKind === 'etc' && node.config.sourceLabel ? ` (${node.config.sourceLabel})` : '';
      return `${kindLabel}${etc}`;
    }
    case 'console': {
      const d = node.config.deviceId ? getDevice('console', node.config.deviceId) : null;
      const total = getConsoleInputPorts(node).length;
      const occupied = State.graph.edges.filter(e => e.to.nodeId === node.id).length;
      const base = d ? d.shortName : '수동 설정';
      return `${base} · 입력 ${occupied}/${total}`;
    }
    case 'sending': {
      const d = node.config.deviceId ? getDevice('sending', node.config.deviceId) : null;
      return d ? `${d.shortName} · ${d.portCount}포트` : `${node.config.portCount}포트 (수동)`;
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
