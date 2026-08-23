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
  _bodyEl.addEventListener('click', e => {
    if (!e.target.closest('#propsOpenLedDesignBtn')) { return; }
    openLedDesignView(State.ui.selectedId);
  });
  panelEl.querySelector('#propsDeleteBtn').addEventListener('click', onDeleteClick);
  panelEl.querySelector('#propsResetBtn').addEventListener('click', onResetClick);
  panelEl.querySelector('#propsApplyBtn').addEventListener('click', onApplyClick);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// power/distro는 편집 가능한 필드가 없으므로 확인·초기화 버튼은 숨긴다.
// 삭제 버튼은 노드가 선택돼 있으면 항상 보인다(추가한 노드는 뭐든 지울 수 있어야 함).
// led는 "단순"(구역 0개 또는 전체 격자를 덮는 구역 1개) 레이아웃일 때만 이
// 패널에서 면적/피치/패널크기를 직접 고칠 수 있다 — isSimpleLedLayout 참고.
const CONFIGURABLE_TYPES = new Set(['input', 'console', 'sending', 'led']);

// 선택은 그대로 둔 채(캔버스 카드 하이라이트 유지) 패널만 숨긴다 — 이미 다른
// 팝업(예: LED 빠른 설정)에서 같은 값을 입력받아 패널을 다시 띄우면 중복인 경우용.
function closePropertiesPanel() {
  if (_panelEl) { _panelEl.hidden = true; }
}

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
    case 'led': return ledFields(node);
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
      if (device.perOutputMaxPx) { summary += `<br>커넥터 1개당 상한 ${device.perOutputMaxPx.toLocaleString()}px`; }
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
    </label>
    <label class="props-field">입력 픽셀 상한(비워두면 검증 안 함)
      <input type="number" min="1" data-field="inputMaxPx" value="${c.inputMaxPx || ''}">
    </label>` : '';

  const inputCapLine = device
    ? `입력(콘솔→카드) 상한 ${device.inputMaxPx.toLocaleString()}px`
    : (c.inputMaxPx ? `입력(콘솔→카드) 상한 ${Number(c.inputMaxPx).toLocaleString()}px` : '입력 상한 미설정 — 그쪽 용량은 검증하지 않음');

  const summary = device
    ? `출력 ${device.portCount}포트 · 포트당 8bit ${device.perPortMaxPx8bit.toLocaleString()}px / 10·12bit ${device.perPortMaxPx10bit.toLocaleString()}px<br>${inputCapLine}`
    : `수동 모드 — 포트당 상한 기본값 ${c.perPortMaxPx.toLocaleString()}px<br>${inputCapLine}`;

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

// 구역이 하나도 없거나(미설정), 정확히 하나의 구역이 전체 격자를 그대로
// 덮고 있으면(LED 추가 팝업의 "빠른 설정"이 만드는 모양) "단순" 레이아웃으로
// 보고 이 패널에서 면적/피치/패널크기를 직접 고쳐 구역을 다시 만들 수 있게
// 한다. 구역이 여럿이거나 격자 일부만 차지하면(자유 설계) 값 하나로 되돌릴
// 수 없으므로 구역 편집 캔버스로 안내한다.
function isSimpleLedLayout(cfg) {
  if (cfg.zones.length === 0) { return true; }
  if (cfg.zones.length > 1) { return false; }
  const z = cfg.zones[0];
  return z.startRow === 0 && z.startCol === 0 && z.rows * 500 === cfg.areaH && z.cols * 500 === cfg.areaW;
}

function ledFields(node) {
  const cfg = node.config.ledDesign;
  if (!isSimpleLedLayout(cfg)) {
    return `
      <div class="props-hint">여러 구역이나 비정형 설치면적으로 설계된 상태입니다. 세부 수정은 구역 편집 캔버스에서 진행하세요.</div>
      <button type="button" id="propsOpenLedDesignBtn" class="props-btn props-btn-primary">구역 편집 열기</button>
    `;
  }

  const zone = cfg.zones[0] || null;
  const areaWm = cfg.areaW ? cfg.areaW / 1000 : '';
  const areaHm = cfg.areaH ? cfg.areaH / 1000 : '';
  const pitch = zone ? zone.led : '3mm';
  const panelSizeValue = zone ? `${zone.panelW}x${zone.panelH}` : '500x1000';
  const res = zone ? resolutionForArea(cfg.areaW, cfg.areaH, pitch) : null;
  const preview = zone
    ? `${res.w.toLocaleString()}×${res.h.toLocaleString()}px · ${betaPanels(zone).length}장 · ${(node.config.totalRequiredPx || 0).toLocaleString()}px`
    : '면적을 입력하면 이 자리에 예상 해상도가 표시됩니다.';

  // 속성 패널은 260px 고정 폭이라(input/console/sending과 동일하게) 2열 그리드가
  // 아니라 세로로 한 줄씩 쌓는다 — LED 추가 팝업은 폭이 넓어 2열 그리드를 쓴다.
  return `
    <label class="props-field">가로(m)<input type="number" min="0" step="0.5" data-field="ledAreaWm" value="${areaWm}"></label>
    <label class="props-field">세로(m)<input type="number" min="0" step="0.5" data-field="ledAreaHm" value="${areaHm}"></label>
    <label class="props-field">LED 피치
      <select data-field="ledPitch">
        <option value="2mm" ${pitch === '2mm' ? 'selected' : ''}>2mm</option>
        <option value="3mm" ${pitch === '3mm' ? 'selected' : ''}>3mm</option>
        <option value="4mm" ${pitch === '4mm' ? 'selected' : ''}>4mm</option>
      </select>
    </label>
    <label class="props-field">패널 크기
      <select data-field="ledPanelSize">
        <option value="500x500" ${panelSizeValue === '500x500' ? 'selected' : ''}>500×500</option>
        <option value="500x1000" ${panelSizeValue === '500x1000' ? 'selected' : ''}>500×1000(세로)</option>
        <option value="1000x500" ${panelSizeValue === '1000x500' ? 'selected' : ''}>1000×500(가로)</option>
      </select>
    </label>
    <div class="props-hint">${preview}</div>
  `;
}

// deviceId/mode/outputKind/manualInputPorts/sourceKind는 어떤 하위 필드가
// 보이는지(파생 필드) 또는 포트 구성 자체를 바꾸므로 패널을 다시 그려야 한다.
// 나머지 단순 값 필드는 상태만 갱신하고 패널 HTML은 그대로 둔다 — 연속 입력
// 시 다른 필드가 리셋되는 레이스를 피한다.
const STRUCTURAL_FIELDS = new Set(['deviceId', 'mode', 'outputKind', 'manualInputPorts', 'sourceKind',
  'ledAreaWm', 'ledAreaHm', 'ledPitch', 'ledPanelSize']);
const NUMERIC_FIELDS = ['portCount', 'perPortMaxPx', 'inputMaxPx', 'manualInputPorts'];
const LED_QUICK_FIELDS = new Set(['ledAreaWm', 'ledAreaHm', 'ledPitch', 'ledPanelSize']);

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
  } else if (field === 'inputMaxPx') {
    // 비워두면 null(검증 보류) — 다른 숫자 필드처럼 0으로 떨어지면 "상한 0px"로
    // 오인돼 어떤 연결이든 바로 초과 판정이 나버린다.
    node.config[field] = el.value === '' ? null : (Number(el.value) || null);
  } else if (NUMERIC_FIELDS.includes(field)) {
    node.config[field] = Number(el.value) || 0;
    if (field === 'manualInputPorts' && node.type === 'console') { pruneOrphanConsoleEdges(node); }
  } else if (LED_QUICK_FIELDS.has(field)) {
    applyLedQuickFields(node);
  } else {
    node.config[field] = el.value;
  }
}

// LED 빠른 설정 4개 필드(면적 2개+피치+패널크기)는 값 하나가 바뀌어도 현재 폼에
// 보이는 나머지 값을 함께 읽어 구역 하나를 통째로 다시 만든다 — 피치만 바꿨는데
// 면적 없이 반영되는 등 앞뒤가 안 맞는 상태를 피하기 위함(ledAreaSetup.js의
// planFullAreaLed를 LED 추가 팝업과 동일하게 재사용).
function applyLedQuickFields(node) {
  const cfg = node.config.ledDesign;
  const areaW = Math.round((Number(_bodyEl.querySelector('[data-field="ledAreaWm"]').value) || 0) * 1000);
  const areaH = Math.round((Number(_bodyEl.querySelector('[data-field="ledAreaHm"]').value) || 0) * 1000);
  if (!areaW || !areaH) {
    cfg.areaW = 0; cfg.areaH = 0; cfg.zones = [];
    node.config.totalRequiredPx = 0;
    return;
  }
  const pitch = _bodyEl.querySelector('[data-field="ledPitch"]').value;
  const [panelW, panelH] = _bodyEl.querySelector('[data-field="ledPanelSize"]').value.split('x').map(Number);
  const plan = planFullAreaLed({ areaW, areaH, panelW, panelH, pitch });
  cfg.areaW = plan.areaW;
  cfg.areaH = plan.areaH;
  cfg.zones = [plan.zone];
  node.config.totalRequiredPx = plan.totalPx;
}

function onFieldChange(e) {
  const field = e.target.dataset.field;
  if (!field) { return; }
  const node = getNode(State.ui.selectedId);
  if (!node) { return; }

  applyFieldValue(node, field, e.target);

  renderValidation();
  if (LED_QUICK_FIELDS.has(field)) {
    // 가로/세로 둘 다 채워져 구역이 실제로 만들어졌을 때만 패널을 다시 그린다.
    // 두 필드 다 STRUCTURAL_FIELDS라 하나 바뀔 때마다 무조건 다시 그리면,
    // 아직 한쪽이 비어 있는 중간 입력 상태에서 applyLedQuickFields가 area를
    // 0으로 되돌린 뒤 그 값(0 → 빈 문자열)으로 다시 그려버려 방금 입력한
    // 값까지 함께 지워진다 — 그러면 두 필드를 순서대로 못 채운다(가로 입력
    // → 즉시 지워짐 → 세로도 마찬가지). 구역이 실제로 생겼을 때만(=두 값
    // 다 유효했을 때만) 다시 그려서 미리보기를 갱신한다.
    if (node.config.ledDesign.zones.length > 0) { renderPropertiesPanel(); }
  } else if (STRUCTURAL_FIELDS.has(field)) {
    renderPropertiesPanel();
  }
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
