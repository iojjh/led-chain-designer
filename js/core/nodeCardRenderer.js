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
}

const VALIDATED_TYPES = new Set(['input', 'console', 'sending', 'led']);

function renderValidationBadge(el, node) {
  const badge = el.querySelector('.node-card-badge');
  if (!VALIDATED_TYPES.has(node.type)) {
    badge.textContent = '';
    badge.classList.remove('badge-ok', 'badge-err');
    el.classList.remove('has-issue');
    badge.title = '';
    return;
  }
  const validation = State.ui.validation || { nodeIssues: new Map() };
  const issues = validation.nodeIssues.get(node.id) || [];
  const hasIssue = issues.length > 0;
  badge.textContent = hasIssue ? '!' : '✓';
  badge.classList.toggle('badge-err', hasIssue);
  badge.classList.toggle('badge-ok', !hasIssue);
  badge.title = issues.map(i => i.message).join('\n');
  el.classList.toggle('has-issue', hasIssue);
}

function cardSummary(node) {
  switch (node.type) {
    case 'input':
      return `${node.config.resolutionW}×${node.config.resolutionH}`;
    case 'console': {
      const d = node.config.deviceId ? getDevice('console', node.config.deviceId) : null;
      return d ? `${d.vendor} ${d.name}` : '수동 설정';
    }
    case 'sending': {
      const d = node.config.deviceId ? getDevice('sending', node.config.deviceId) : null;
      return d ? `${d.vendor} ${d.name} · ${d.portCount}포트` : `${node.config.portCount}포트 (수동)`;
    }
    case 'led': {
      const zoneCount = (node.config.ledDesign.zones || []).length;
      const px = node.config.totalRequiredPx || 0;
      return zoneCount ? `${zoneCount}구역 · ${px.toLocaleString()}px` : '구역 없음 (클릭해 설계)';
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
    dot.title = p.id;
    container.appendChild(dot);
  });
}
