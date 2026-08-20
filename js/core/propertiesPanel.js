// ── propertiesPanel ─────────────────────────────────
// 선택된 노드의 설정(config)을 편집하는 우측 패널. select 변경 시에만
// 전체 리렌더(파생 필드 표시/숨김) — text/number input은 change(blur/Enter)
// 시점에 바로 반영되지만, 하단 "확인" 버튼으로 현재 폼 값을 한 번 더 강제
// 반영할 수 있고 "초기화"로 그 노드 타입의 기본값으로 되돌릴 수 있다.

let _panelEl = null;
let _titleEl = null;
let _bodyEl = null;

function initPropertiesPanel(panelEl) {
  _panelEl = panelEl;
  _titleEl = panelEl.querySelector('#propsTitle');
  _bodyEl = panelEl.querySelector('#propsBody');
  panelEl.querySelector('#propsClose').addEventListener('click', () => {
    selectNode(null);
    renderNodeCards();
    renderPropertiesPanel();
  });
  _bodyEl.addEventListener('change', onFieldChange);
  panelEl.querySelector('#propsDeleteBtn').addEventListener('click', onDeleteClick);
  panelEl.querySelector('#propsResetBtn').addEventListener('click', onResetClick);
  panelEl.querySelector('#propsApplyBtn').addEventListener('click', onApplyClick);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// led/power/distro는 편집 가능한 필드가 없으므로 확인·초기화 버튼은 숨긴다.
// 삭제 버튼은 노드가 선택돼 있으면 항상 보인다(추가한 노드는 뭐든 지울 수 있어야 함).
const CONFIGURABLE_TYPES = new Set(['input', 'console', 'sending']);

function renderPropertiesPanel() {
  if (!_panelEl) { return; }
  const nodeId = State.ui.selectedId;
  const node = nodeId ? getNode(nodeId) : null;
  if (!node) { _panelEl.hidden = true; return; }
  _panelEl.hidden = false;
  _titleEl.textContent = `${NODE_TYPES[node.type].icon} ${node.label}`;
  _bodyEl.innerHTML = buildFieldsHtml(node);

  const configurable = CONFIGURABLE_TYPES.has(node.type);
  _panelEl.querySelector('#propsResetBtn').hidden = !configurable;
  _panelEl.querySelector('#propsApplyBtn').hidden = !configurable;
}

function buildFieldsHtml(node) {
  switch (node.type) {
    case 'input': return inputFields(node);
    case 'console': return consoleFields(node);
    case 'sending': return sendingFields(node);
    case 'led': return `<div class="props-hint">LED 설계 편집은 노드 본문을 클릭해 여세요.</div>`;
    default: return `<div class="props-hint">추가 설정 없음</div>`;
  }
}

function inputFields(node) {
  const c = node.config;
  const kindOptions = INPUT_KINDS
    .map(k => `<option value="${k.id}" ${c.sourceKind === k.id ? 'selected' : ''}>${k.label}</option>`)
    .join('');
  const etcLabelField = c.sourceKind === 'etc' ? `
    <label class="props-field">세부 이름
      <input type="text" data-field="sourceLabel" placeholder="예: 카메라 3" value="${escapeHtml(c.sourceLabel || '')}">
    </label>` : '';

  return `
    <label class="props-field">이름
      <input type="text" data-field="label" value="${escapeHtml(node.label)}">
    </label>
    <label class="props-field">종류
      <select data-field="sourceKind">${kindOptions}</select>
    </label>
    ${etcLabelField}
  `;
}

function consoleFields(node) {
  const c = node.config;
  const device = c.deviceId ? getDevice('console', c.deviceId) : null;
  const options = listDevices('console')
    .map(d => `<option value="${d.id}" ${c.deviceId === d.id ? 'selected' : ''}>${d.vendor} ${d.name}</option>`)
    .join('');

  let summary;
  if (device) {
    if (device.outputKind === 'lan-ports') {
      summary = `출력 ${device.outputs.portCount}포트 · 포트당 8bit ${device.outputs.perPortMaxPx8bit.toLocaleString()}px / 10·12bit ${device.outputs.perPortMaxPx10bit.toLocaleString()}px`;
    } else if (device.modes) {
      summary = Object.entries(device.modes).map(([m, spec]) => `${m}: ${spec.totalMaxPx.toLocaleString()}px`).join(' · ');
    } else {
      summary = `출력당 최대 ${device.outputs.perOutputMaxPx.toLocaleString()}px`;
    }
    if (device.note) { summary += `<div class="props-warn">${escapeHtml(device.note)}</div>`; }
  } else {
    summary = '수동 모드 — 출력 방식을 직접 선택하세요.';
  }

  const outputKindField = !device ? `
    <label class="props-field">출력 방식
      <select data-field="outputKind">
        <option value="lan-ports" ${c.outputKind === 'lan-ports' ? 'selected' : ''}>lan-ports (LED 직결 가능)</option>
        <option value="video-signal" ${c.outputKind === 'video-signal' ? 'selected' : ''}>video-signal (샌딩카드 경유 필수)</option>
      </select>
    </label>` : '';

  const modeField = (device && device.modes) ? `
    <label class="props-field">모드
      <select data-field="mode">
        ${Object.keys(device.modes).map(m => `<option value="${m}" ${c.mode === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </label>` : '';

  const manualInputField = !device ? `
    <label class="props-field">입력 포트 수
      <input type="number" min="1" max="8" data-field="manualInputPorts" value="${c.manualInputPorts || 2}">
    </label>` : '';

  const inputPortsHtml = inputPortListHtml(node);

  return `
    <label class="props-field">장비 프리셋
      <select data-field="deviceId">
        <option value="">— 수동 입력 —</option>
        ${options}
      </select>
    </label>
    ${modeField}
    ${outputKindField}
    ${manualInputField}
    <div class="props-hint">${summary}</div>
    <div class="props-field-label">입력 포트 (${inputPortsHtml.connected}/${inputPortsHtml.total} 연결됨)</div>
    ${inputPortsHtml.html}
  `;
}

// 콘솔의 실제 입력 포트 목록 + 각 포트에 어떤 인풋소스가 꽂혀 있는지 표시.
// 캔버스에서는 입력 도트가 하나로 통합돼 있어서, 이 목록이 "무엇이 몇 번
// 포트에 꽂혔는지" 확인할 수 있는 유일한 곳이다.
function inputPortListHtml(node) {
  const ports = getConsoleInputPorts(node);
  const edgesIn = State.graph.edges.filter(e => e.to.nodeId === node.id);
  let connected = 0;
  const rows = ports.map(p => {
    const edge = edgesIn.find(e => e.to.portId === p.id);
    const fromNode = edge ? getNode(edge.from.nodeId) : null;
    if (fromNode) { connected += 1; }
    const capLabel = p.maxPx ? ` (최대 ${p.maxPx.toLocaleString()}px)` : '';
    return `<div class="props-port-row">
      <span class="props-port-name">${escapeHtml(p.label)}${capLabel}</span>
      <span class="props-port-status ${fromNode ? 'linked' : ''}">${fromNode ? escapeHtml(fromNode.label) : '비어있음'}</span>
    </div>`;
  }).join('');
  return { html: rows, total: ports.length, connected };
}

function sendingFields(node) {
  const c = node.config;
  const device = c.deviceId ? getDevice('sending', c.deviceId) : null;
  const options = listDevices('sending')
    .map(d => `<option value="${d.id}" ${c.deviceId === d.id ? 'selected' : ''}>${d.vendor} ${d.name}</option>`)
    .join('');

  const manualFields = !device ? `
    <label class="props-field">포트 수
      <input type="number" min="1" data-field="portCount" value="${c.portCount}">
    </label>
    <label class="props-field">포트당 픽셀 상한
      <input type="number" min="1" data-field="perPortMaxPx" value="${c.perPortMaxPx}">
    </label>` : '';

  const summary = device
    ? `출력 ${device.portCount}포트 · 포트당 8bit ${device.perPortMaxPx8bit.toLocaleString()}px / 10·12bit ${device.perPortMaxPx10bit.toLocaleString()}px`
    : `수동 모드 — 포트당 상한 기본값 ${c.perPortMaxPx.toLocaleString()}px`;

  return `
    <label class="props-field">장비 프리셋
      <select data-field="deviceId">
        <option value="">— 수동 입력 —</option>
        ${options}
      </select>
    </label>
    ${manualFields}
    <div class="props-hint">${summary}</div>
  `;
}

// deviceId/mode/outputKind/manualInputPorts/sourceKind는 어떤 하위 필드가
// 보이는지(파생 필드) 또는 포트 구성 자체를 바꾸므로 패널을 다시 그려야 한다.
// 나머지 단순 값 필드는 상태만 갱신하고 패널 HTML은 그대로 둔다 — 연속 입력
// 시 다른 필드가 리셋되는 레이스를 피한다.
const STRUCTURAL_FIELDS = new Set(['deviceId', 'mode', 'outputKind', 'manualInputPorts', 'sourceKind']);
const NUMERIC_FIELDS = ['portCount', 'perPortMaxPx', 'inputMaxPx', 'manualInputPorts'];

// deviceId가 바뀌면(장비 변경/수동 전환) 콘솔의 물리 포트 구성이 달라지므로
// 더 이상 존재하지 않는 포트를 가리키던 엣지를 정리한다.
function pruneOrphanConsoleEdges(node) {
  const validIds = new Set(getConsoleInputPorts(node).map(p => p.id));
  State.graph.edges = State.graph.edges.filter(ed =>
    !(ed.to.nodeId === node.id && !validIds.has(ed.to.portId))
  );
}

// 필드 하나의 DOM 값을 node에 반영. onFieldChange(라이브 적용)와 확인 버튼
// (전체 재적용) 양쪽에서 공유한다.
function applyFieldValue(node, field, el) {
  if (field === 'label') {
    node.label = el.value;
  } else if (field === 'deviceId') {
    const value = el.value || null;
    node.config.deviceId = value;
    if (node.type === 'console') {
      const device = value ? getDevice('console', value) : null;
      node.config.outputKind = device ? device.outputKind : (node.config.outputKind || 'lan-ports');
      node.config.mode = device && device.modes ? device.defaultMode : null;
      pruneOrphanConsoleEdges(node);
    }
  } else if (field === 'sourceKind') {
    // 라벨을 아직 사용자가 직접 바꾸지 않았다면(기본값 또는 이전 종류 라벨 그대로)
    // 새 종류에 맞춰 카드 이름도 함께 갱신 — 인풋소스가 여러 개일 때 구분이 쉬워짐.
    const wasAuto = node.label === '인풋소스' || INPUT_KINDS.some(k => k.label === node.label);
    node.config.sourceKind = el.value;
    if (wasAuto) { node.label = inputKindLabel(el.value); }
  } else if (NUMERIC_FIELDS.includes(field)) {
    node.config[field] = Number(el.value) || 0;
    if (field === 'manualInputPorts' && node.type === 'console') { pruneOrphanConsoleEdges(node); }
  } else {
    node.config[field] = el.value;
  }
}

function onFieldChange(e) {
  const field = e.target.dataset.field;
  if (!field) { return; }
  const node = getNode(State.ui.selectedId);
  if (!node) { return; }

  applyFieldValue(node, field, e.target);

  renderValidation();
  if (STRUCTURAL_FIELDS.has(field)) { renderPropertiesPanel(); }
}

// "확인" — 현재 폼에 보이는 모든 필드 값을 강제로 다시 반영한 뒤(대부분은 이미
// change 시점에 반영돼 있지만, 포커스가 남아있는 필드까지 확실히 커밋한다)
// 패널을 닫는다.
function onApplyClick() {
  const node = getNode(State.ui.selectedId);
  if (!node) { return; }
  _bodyEl.querySelectorAll('[data-field]').forEach(el => applyFieldValue(node, el.dataset.field, el));
  renderValidation();
  selectNode(null);
  renderNodeCards();
  renderPropertiesPanel();
}

// "초기화" — 그 노드 타입의 기본 config로 되돌린다(장비 프리셋도 해제됨).
function onResetClick() {
  const node = getNode(State.ui.selectedId);
  if (!node) { return; }
  node.config = defaultConfig(node.type);
  node.label = node.type === 'input' ? inputKindLabel(node.config.sourceKind) : NODE_TYPES[node.type].label;
  if (node.type === 'console') { pruneOrphanConsoleEdges(node); }
  renderValidation();
  renderPropertiesPanel();
}

// "삭제" — 캔버스에 추가한 노드를 제거한다(Delete/Backspace 키와 동일 동작).
function onDeleteClick() {
  if (!State.ui.selectedId) { return; }
  removeNode(State.ui.selectedId);
  renderPropertiesPanel();
  renderValidation();
}
