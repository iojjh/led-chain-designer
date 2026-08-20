// ── propertiesPanel ─────────────────────────────────
// 선택된 노드의 설정(config)을 편집하는 우측 패널. select 변경 시에만
// 전체 리렌더(파생 필드 표시/숨김) — text/number input은 change(blur/Enter)
// 시점에만 반영해 타이핑 중 포커스가 끊기지 않게 한다.

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
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function renderPropertiesPanel() {
  if (!_panelEl) { return; }
  const nodeId = State.ui.selectedId;
  const node = nodeId ? getNode(nodeId) : null;
  if (!node) { _panelEl.hidden = true; return; }
  _panelEl.hidden = false;
  _titleEl.textContent = `${NODE_TYPES[node.type].icon} ${node.label}`;
  _bodyEl.innerHTML = buildFieldsHtml(node);
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
  return `
    <label class="props-field">이름
      <input type="text" data-field="label" value="${escapeHtml(node.label)}">
    </label>
    <label class="props-field">가로 해상도(px)
      <input type="number" min="1" data-field="resolutionW" value="${c.resolutionW}">
    </label>
    <label class="props-field">세로 해상도(px)
      <input type="number" min="1" data-field="resolutionH" value="${c.resolutionH}">
    </label>
    <div class="props-hint">총 ${(c.resolutionW * c.resolutionH).toLocaleString()}px</div>
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
    summary = device.outputKind === 'lan-ports'
      ? `출력 ${device.outputs.portCount}포트 · 포트당 8bit ${device.outputs.perPortMaxPx8bit.toLocaleString()}px / 10·12bit ${device.outputs.perPortMaxPx10bit.toLocaleString()}px`
      : Object.entries(device.modes).map(([m, spec]) => `${m}: ${spec.totalMaxPx.toLocaleString()}px`).join(' · ');
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

  return `
    <label class="props-field">장비 프리셋
      <select data-field="deviceId">
        <option value="">— 수동 입력 —</option>
        ${options}
      </select>
    </label>
    ${modeField}
    ${outputKindField}
    <div class="props-hint">${summary}</div>
  `;
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

// deviceId/mode/outputKind는 어떤 하위 필드가 보이는지(파생 필드) 바꾸므로
// 패널을 다시 그려야 한다. 나머지 단순 값 필드는 상태만 갱신하고 패널
// HTML은 그대로 둔다 — 연속 입력 시 다른 필드가 리셋되는 레이스를 피한다.
const STRUCTURAL_FIELDS = new Set(['deviceId', 'mode', 'outputKind']);

function onFieldChange(e) {
  const field = e.target.dataset.field;
  if (!field) { return; }
  const node = getNode(State.ui.selectedId);
  if (!node) { return; }

  if (field === 'label') {
    node.label = e.target.value;
  } else if (field === 'deviceId') {
    const value = e.target.value || null;
    node.config.deviceId = value;
    if (node.type === 'console') {
      const device = value ? getDevice('console', value) : null;
      node.config.outputKind = device ? device.outputKind : (node.config.outputKind || 'lan-ports');
      node.config.mode = device && device.modes ? device.defaultMode : null;
    }
  } else if (['resolutionW', 'resolutionH', 'portCount', 'perPortMaxPx', 'inputMaxPx'].includes(field)) {
    node.config[field] = Number(e.target.value) || 0;
  } else {
    node.config[field] = e.target.value;
  }

  renderValidation();
  if (STRUCTURAL_FIELDS.has(field)) { renderPropertiesPanel(); }
}
