// ── propertiesPanel ─────────────────────────────────
// 선택된 노드의 설정(config)을 편집하는 우측 패널. select 변경 시에만
// 전체 리렌더(파생 필드 표시/숨김) — text/number input은 change(blur/Enter)
// 시점에 바로 반영되지만, 하단 "확인" 버튼으로 현재 폼 값을 한 번 더 강제
// 반영할 수 있고 "초기화"로 그 노드 타입의 기본값으로 되돌릴 수 있다.

let _panelEl = null;
let _titleEl = null;
let _bodyEl = null;

// 콘솔 입력/출력 포트 목록처럼 길어질 수 있는 섹션을 접어서 보여주고, 클릭하면
// 펼친다(사용자 요청 — 기본으로 다 펼쳐지면 포트 수가 많은 장비에서 지저분해
// 보임). 펼침 상태는 이 Set에 키(예: 'console-input-ports')로 기억해뒀다가
// 다음 렌더(필드 변경 등으로 패널이 통째로 다시 그려질 때)에도 유지한다.
let _expandedPortSections = new Set();

function portListSection(key, headerLabel, bodyHtml) {
  const expanded = _expandedPortSections.has(key);
  return `
    <div class="props-collapsible ${expanded ? '' : 'collapsed'}">
      <button type="button" class="props-collapsible-head" data-collapse-key="${key}">
        <span class="props-collapsible-chevron">▾</span>
        <span>${headerLabel}</span>
      </button>
      <div class="props-collapsible-body">${bodyHtml}</div>
    </div>
  `;
}

// ── 팔레트 "초안(draft)" 추가 흐름 ─────────────────────
// 인풋소스 / 콘솔·샌딩카드의 "수동 입력"은 이 패널에서 설정을 다 채운 뒤
// "확인"을 눌러야 비로소 캔버스에 노드가 생긴다 — 그 전까진 State.graph에
// 없는 임시 객체(_draftNode)를 이 패널이 그대로 그린다. 기존 노드를
// 캔버스에서 클릭해 편집하는 라이브 모드와는 별개 흐름이고, _draftNode가
// 있으면 그쪽을 우선한다.
let _draftNode = null;
let _draftReturnLevel = 'categories';

function currentEditTarget() {
  return _draftNode || getNode(State.ui.selectedId);
}

function initPropertiesPanel(panelEl) {
  _panelEl = panelEl;
  _titleEl = panelEl.querySelector('#propsTitle');
  _bodyEl = panelEl.querySelector('#propsBody');
  panelEl.querySelector('#propsBackBtn').addEventListener('click', backFromDraftPanel);
  panelEl.querySelector('#propsClose').addEventListener('click', () => {
    if (_draftNode) { cancelDraftPanel(); return; }
    selectNode(null);
    renderNodeCards();
    renderPropertiesPanel();
  });
  _bodyEl.addEventListener('change', onFieldChange);
  _bodyEl.addEventListener('click', e => {
    const collapseToggle = e.target.closest('[data-collapse-key]');
    if (collapseToggle) {
      const key = collapseToggle.dataset.collapseKey;
      if (_expandedPortSections.has(key)) { _expandedPortSections.delete(key); } else { _expandedPortSections.add(key); }
      renderPropertiesPanel();
      return;
    }
    if (!e.target.closest('#propsOpenLedDesignBtn')) { return; }
    openLedDesignView(State.ui.selectedId);
  });
  panelEl.querySelector('#propsDeleteBtn').addEventListener('click', onDeleteClick);
  panelEl.querySelector('#propsResetBtn').addEventListener('click', onResetClick);
  panelEl.querySelector('#propsApplyBtn').addEventListener('click', onApplyClick);
  registerOverlayCloser('props', closePropertiesPanel);
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
// 팝업(예: LED 빠른 설정, 팔레트에서 장비 프리셋을 바로 골랐을 때)에서 같은
// 값을 입력받아 패널을 다시 띄우면 중복인 경우용.
function closePropertiesPanel() {
  // 이번에 대기 중이던 "강제로 열기" 요청도 함께 취소한다 — 안 그러면 이
  // 직후에 selectNode(null)이 아니라(선택은 유지한 채) 패널만 닫는
  // 호출(finalizeAddedNode(node, false) 등)에서, 나중에 전혀 무관한 다른
  // 액션(예: 다른 두 노드 연결)이 renderPropertiesPanel()을 부를 때 이
  // 닫아둔 패널이 그 대기 플래그 때문에 도로 열려버리는 문제가 있었다
  // (사용자 확인, 2026-08-28).
  State.ui.pendingPanelOpen = false;
  if (_panelEl && _panelEl.classList.contains('open')) {
    _panelEl.classList.remove('open');
    popHistoryOverlayIfTop('props');
  }
}

function renderPropertiesPanel() {
  if (!_panelEl) { return; }
  const selectedNode = State.ui.selectedId ? getNode(State.ui.selectedId) : null;
  // 초안을 설정하는 중에 캔버스에서 다른 실제 노드를 클릭하면 초안은 조용히 버려진다.
  if (_draftNode && selectedNode) { discardDraft(); }

  // 뒤로가기로 이 패널만 닫히게 하려면(사용자 요청) 닫혀 있다가 이번에 새로
  // 열리는 전환에서만 history를 쌓아야 한다 — 아래 세 분기 모두 열기 전에
  // 먼저 읽어둔 이 값으로 판단한다.
  const wasOpen = _panelEl.classList.contains('open');
  // selectNode가 방금 이 선택을 명시적으로 만들었을 때만 true — 한 번 읽으면
  // 바로 소비(false로 되돌림)해서, 이 렌더 호출 하나에만 유효하게 한다.
  const forceOpen = State.ui.pendingPanelOpen;
  State.ui.pendingPanelOpen = false;

  if (_draftNode) {
    _panelEl.classList.add('open');
    pushHistoryOverlayIfNewlyOpened('props', wasOpen);
    _panelEl.querySelector('#propsBackBtn').hidden = false;
    _panelEl.querySelector('#propsDeleteBtn').hidden = true;
    _panelEl.querySelector('#propsResetBtn').hidden = false;
    _panelEl.querySelector('#propsApplyBtn').hidden = false;
    _titleEl.textContent = `${NODE_TYPES[_draftNode.type].icon} ${_draftNode.label}`;
    _bodyEl.innerHTML = buildFieldsHtml(_draftNode);
    return;
  }

  if (!selectedNode) {
    if (wasOpen) { _panelEl.classList.remove('open'); popHistoryOverlayIfTop('props'); }
    return;
  }

  // 이미 닫혀 있고(사용자가 "선택은 유지, 패널만 숨김"으로 명시적으로 닫아둔
  // 상태) 이번 호출도 방금 새로 선택한 게 아니라 다른 작업(노드 연결 등)의
  // 부수 효과로 불린 것뿐이면, 닫힌 패널을 도로 열지 않는다 — 실제로 열릴
  // 때 다시 그리므로 지금 내용을 갱신할 필요도 없다(사용자 확인, 2026-08-28).
  if (!wasOpen && !forceOpen) { return; }

  _panelEl.classList.add('open');
  pushHistoryOverlayIfNewlyOpened('props', wasOpen);
  _panelEl.querySelector('#propsBackBtn').hidden = true;
  _panelEl.querySelector('#propsDeleteBtn').hidden = false;
  _titleEl.textContent = `${NODE_TYPES[selectedNode.type].icon} ${selectedNode.label}`;
  _bodyEl.innerHTML = buildFieldsHtml(selectedNode);

  const configurable = CONFIGURABLE_TYPES.has(selectedNode.type);
  _panelEl.querySelector('#propsResetBtn').hidden = !configurable;
  _panelEl.querySelector('#propsApplyBtn').hidden = !configurable;
}

// 팔레트에서 인풋소스 카테고리를 고르거나 콘솔·샌딩카드에서 "수동 입력"을
// 골랐을 때 시작된다 — returnLevel은 "← 뒤로"를 눌렀을 때 되돌아갈 팔레트
// 레벨('categories' 또는 'devices', interactions.js 참고).
function openDraftPanel(type, returnLevel) {
  const config = defaultConfig(type);
  const label = type === 'input' ? inputKindLabel(config.sourceKind) : NODE_TYPES[type].label;
  _draftNode = { id: null, type, label, config };
  _draftReturnLevel = returnLevel;
  selectNode(null);
  renderNodeCards();
  renderPropertiesPanel();
}

function discardDraft() {
  _draftNode = null;
}

// "✕" — 초안을 버리고 그냥 닫는다(팔레트는 다시 열지 않음).
function cancelDraftPanel() {
  discardDraft();
  closePropertiesPanel();
}

// "← 뒤로" — 초안을 버리고 팔레트를 원래 있던 레벨로 되돌려 연다.
function backFromDraftPanel() {
  const returnLevel = _draftReturnLevel;
  discardDraft();
  closePropertiesPanel();
  showPaletteLevel(returnLevel);
  setPaletteMenuOpen(true);
}

// "확인" — 초안을 그제서야 실제 캔버스 노드로 커밋한다.
function commitDraftPanel() {
  if (!_draftNode) { return; }
  _bodyEl.querySelectorAll('[data-field]').forEach(el => applyFieldValue(_draftNode, el.dataset.field, el));
  const node = createPositionedNode(_draftNode.type);
  node.config = _draftNode.config;
  node.label = _draftNode.label;
  discardDraft();
  finalizeAddedNode(node, false);
  renderValidation();
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

  return `
    <label class="props-field">이름
      <input type="text" data-field="label" value="${escapeHtml(node.label)}">
    </label>
    <label class="props-field">종류
      <select data-field="sourceKind">${kindOptions}</select>
    </label>
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
      // 듀얼링크는 사용자가 고르는 게 아니라 연결된 샌딩카드의 요구 해상도를
      // 보고 자동으로 정해지므로(resolveJ6DualLink), 지금 그게 켜져 있다는
      // 사실 자체를 알려준다 — 안 그러면 DVI2가 왜 출력 포트 목록에서
      // 사라졌는지 알기 어렵다.
      if (c.dviLink === 'dual') {
        summary += '<br><b>듀얼링크 활성화됨</b> — DVI2가 DVI1에 합쳐져 비활성 (연결된 샌딩카드 해상도가 커넥터 1개 상한을 넘어 자동 전환됨)';
      }
    } else if (device.outputGroups) {
      // EC100은 콘솔 전체가 아니라 AUX만 별도 모드가 있다(MAIN은 항상 4채널
      // 고정) — 아래 auxModeField에서 직접 고른다.
      const mainMaxPx = device.outputGroups[0].fixed[0].maxPx;
      summary = `MAIN 4채널(채널당 최대 ${mainMaxPx.toLocaleString()}px) · AUX 4채널(${c.auxMode === 'mosaic' ? '모자이크 — 4개 모두 독립' : '스위처 — 1/2, 3/4끼리 같은 신호(미러)'})`;
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

  const auxModeField = (device && device.outputGroups) ? `
    <label class="props-field">AUX 모드
      <select data-field="auxMode">
        <option value="switcher" ${(c.auxMode || 'switcher') === 'switcher' ? 'selected' : ''}>switcher (4채널, 1/2·3/4끼리 같은 신호)</option>
        <option value="mosaic" ${c.auxMode === 'mosaic' ? 'selected' : ''}>mosaic (4채널 독립)</option>
      </select>
    </label>` : '';

  const manualInputField = !device ? `
    <label class="props-field">입력 포트 수
      <input type="number" min="1" max="8" data-field="manualInputPorts" value="${c.manualInputPorts || 2}">
    </label>` : '';

  const manualOutputField = !device ? `
    <label class="props-field">출력 포트 수
      <input type="number" min="1" max="8" data-field="manualOutputPorts" value="${c.manualOutputPorts || 2}">
    </label>` : '';

  const inputPortsHtml = inputPortListHtml(node);
  const outputPortsHtml = outputPortListHtml(node);

  return `
    <label class="props-field">장비 프리셋
      <select data-field="deviceId">
        <option value="">— 수동 입력 —</option>
        ${options}
      </select>
    </label>
    ${modeField}
    ${outputKindField}
    ${auxModeField}
    ${manualInputField}
    ${manualOutputField}
    <div class="props-hint">${summary}</div>
    ${portListSection('console-input-ports', `입력 포트 (${inputPortsHtml.connected}/${inputPortsHtml.total} 연결됨)`, inputPortsHtml.html)}
    ${portListSection('console-output-ports', `출력 포트 (${outputPortsHtml.connected}/${outputPortsHtml.total} 연결됨)`, outputPortsHtml.html)}
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

// 콘솔의 실제 출력 포트 목록 + 각 포트가 어느 샌딩카드/LED로 나가는지 표시.
// 입력 포트 목록(inputPortListHtml)과 대칭 — 캔버스에서는 출력 도트도 하나로
// 통합돼 있어서, 이 목록이 "몇 번 출력이 어디로 나가는지" 확인할 수 있는
// 유일한 곳이다.
function outputPortListHtml(node) {
  const ports = getConsoleOutputPorts(node);
  const edgesOut = State.graph.edges.filter(e => e.from.nodeId === node.id);
  // 포트별로 실제 내보내는 해상도·Hz(사용자 요청, 2026-08-26) — 샌딩카드
  // 카드에 표시되는 것과 같은 계산(resolveConsoleOutputInfo가
  // resolveSendingCardOutput을 재사용).
  const outputInfoByPort = new Map(resolveConsoleOutputInfo(State.graph, node).map(i => [i.portId, i]));
  let connected = 0;
  const rows = ports.map(p => {
    const edge = edgesOut.find(e => e.from.portId === p.id);
    const toNode = edge ? getNode(edge.to.nodeId) : null;
    if (toNode) { connected += 1; }
    const capLabel = p.maxPx ? ` (최대 ${p.maxPx.toLocaleString()}px)` : '';
    const info = outputInfoByPort.get(p.id);
    const resLabel = info ? ` — ${info.w}×${info.h}${info.hz ? ` · 최대 ${info.hz}Hz` : ''}` : '';
    return `<div class="props-port-row">
      <span class="props-port-name">${escapeHtml(p.label)}${capLabel}</span>
      <span class="props-port-status ${toNode ? 'linked' : ''}">${toNode ? escapeHtml(toNode.label) + resLabel : '비어있음'}</span>
    </div>`;
  }).join('');
  // 지금 설정(예: J6 듀얼링크)에서 못 쓰게 된 포트도 그냥 목록에서 빼버리면
  // "DVI2가 왜 없지?"라는 의문만 남는다 — 사용불가 상태로 명시해서 보여준다.
  const disabledRows = getConsoleDisabledOutputPorts(node).map(p => `<div class="props-port-row props-port-disabled">
      <span class="props-port-name">${escapeHtml(p.label)}</span>
      <span class="props-port-status">사용불가 (듀얼링크로 DVI1에 병합됨)</span>
    </div>`).join('');
  // 포트 2개 이상이 같은 LED로 모자이크 합류하면 카드와 대칭으로 합계 해상도도
  // 한 줄 보여준다(사용자 요청, 2026-08-27).
  const combinedRows = resolveConsoleCombinedOutputs(State.graph, node).map(c => `<div class="props-port-row">
      <span class="props-port-name">합계</span>
      <span class="props-port-status">${c.w}×${c.h}</span>
    </div>`).join('');
  return { html: rows + disabledRows + combinedRows, total: ports.length, connected };
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

// deviceId/mode/outputKind/manualInputPorts/manualOutputPorts/sourceKind는 어떤
// 하위 필드가 보이는지(파생 필드) 또는 포트 구성 자체를 바꾸므로 패널을 다시
// 그려야 한다. 나머지 단순 값 필드는 상태만 갱신하고 패널 HTML은 그대로 둔다 —
// 연속 입력 시 다른 필드가 리셋되는 레이스를 피한다.
const STRUCTURAL_FIELDS = new Set(['deviceId', 'mode', 'outputKind', 'auxMode', 'manualInputPorts', 'manualOutputPorts', 'sourceKind',
  'ledAreaWm', 'ledAreaHm', 'ledPitch', 'ledPanelSize']);
const NUMERIC_FIELDS = ['portCount', 'perPortMaxPx', 'inputMaxPx', 'manualInputPorts', 'manualOutputPorts'];
const LED_QUICK_FIELDS = new Set(['ledAreaWm', 'ledAreaHm', 'ledPitch', 'ledPanelSize']);

// deviceId/mode가 바뀌면(장비 변경/수동 전환, 또는 J6 splicer↔switcher처럼
// 모드별 출력 포트 수 자체가 달라지는 경우) 콘솔의 물리 포트 구성이 달라지므로
// 더 이상 존재하지 않는 포트를 가리키던 엣지(입력·출력 양쪽)를 정리한다.
function pruneOrphanConsoleEdges(node) {
  const validInIds = new Set(getConsoleInputPorts(node).map(p => p.id));
  const validOutIds = new Set(getConsoleOutputPorts(node).map(p => p.id));
  State.graph.edges = State.graph.edges.filter(ed => {
    if (ed.to.nodeId === node.id && !validInIds.has(ed.to.portId)) { return false; }
    if (ed.from.nodeId === node.id && !validOutIds.has(ed.from.portId)) { return false; }
    return true;
  });
}

// mode(J6 splicer↔switcher)/auxMode(EC100 switcher↔mosaic) 전환은 포트 id가
// 그대로 유지돼도 그 포트의 "의미"가 통째로 바뀔 수 있다 — 예를 들어 EC100
// mosaic에서 독립적으로 쓰던 aux1/aux2가 switcher로 바꾸면 미러 쌍(항상 같은
// 신호)이 된다(devices.js의 mirror 필드). id 존재 여부만 보는
// pruneOrphanConsoleEdges로는 이런 "의미만 바뀐" 경우를 못 잡아서(포트가
// 사라진 게 아니므로), 이미 연결된 두 샌딩카드가 한 LED를 나눠 담당하는데
// 갑자기 미러 쌍이 되는 등 조용히 잘못된 조합이 남을 수 있다 — 부분적으로
// 골라 정리하는 대신 이 콘솔에 물린 연결선을 전부 지워 사용자가 새 모드
// 기준으로 처음부터 다시 잇게 한다(사용자 확인, 2026-08-26).
function resetConsoleEdges(node) {
  const before = State.graph.edges.length;
  State.graph.edges = State.graph.edges.filter(ed => ed.to.nodeId !== node.id && ed.from.nodeId !== node.id);
  // 값을 바꾼 순간(라이브 적용, 확인 버튼 없이) 바로 다 지워지므로, 왜
  // 연결선이 사라졌는지 알 수 있게 알려준다 — 실제로 뭔가 지워졌을 때만.
  if (State.graph.edges.length < before) {
    showToast('모드를 바꿔 이 콘솔의 연결선이 모두 초기화되었습니다');
  }
}

// deviceId를 노드에 적용하고 그에 딸린 파생 필드(콘솔의 outputKind/mode)를
// 함께 갱신한다. 속성 패널의 "장비 프리셋" select 변경과, 팔레트 드롭다운에서
// 장비를 바로 골라 추가하는 경우(interactions.js) 양쪽이 공유한다.
function applyDevicePreset(node, deviceId) {
  const value = deviceId || null;
  node.config.deviceId = value;
  if (node.type === 'console') {
    const device = value ? getDevice('console', value) : null;
    node.config.outputKind = device ? device.outputKind : (node.config.outputKind || 'lan-ports');
    node.config.mode = device && device.modes ? device.defaultMode : null;
    // 듀얼링크 여부는 사용자가 고르는 값이 아니라 연결 상태를 보고 자동으로
    // 정해진다(validationEngine.js의 resolveJ6DualLink) — 장비를 새로 고르면
    // 일단 기본값(단일 DVI)에서 다시 시작한다.
    node.config.dviLink = 'single';
    pruneOrphanConsoleEdges(node);
  }
}

// 필드 하나의 DOM 값을 node에 반영. onFieldChange(라이브 적용)와 확인 버튼
// (전체 재적용) 양쪽에서 공유한다.
function applyFieldValue(node, field, el) {
  if (field === 'label') {
    node.label = el.value;
  } else if (field === 'deviceId') {
    applyDevicePreset(node, el.value);
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
    if ((field === 'manualInputPorts' || field === 'manualOutputPorts') && node.type === 'console') {
      pruneOrphanConsoleEdges(node);
    }
  } else if (LED_QUICK_FIELDS.has(field)) {
    applyLedQuickFields(node);
  } else {
    node.config[field] = el.value;
    // J6 splicer↔switcher, EC100 switcher↔mosaic 전환은 포트 구성 자체가
    // 달라지거나(포트가 사라짐) 같은 id라도 의미가 바뀔 수 있어(resetConsoleEdges
    // 참고), 이 콘솔에 물린 연결선을 전부 지운다.
    if ((field === 'mode' || field === 'auxMode') && node.type === 'console') { resetConsoleEdges(node); }
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
  // planFullAreaLed는 호출할 때마다 새 zone id를 발급한다(LED 추가 팝업처럼
  // 구역이 원래 없던 경우엔 맞는 동작). 하지만 여기서는 이미 단순 구역(자유
  // 구역이 아닌, 빠른 설정으로 만든 구역 하나) 하나가 있는 상태에서 값이
  // 실제로는 안 바뀌었어도(예: "확인" 버튼 재클릭) 매번 호출될 수 있는데,
  // betaPanels()의 패널 key가 zone.id를 포함해서 새 id로 통째로 교체하면
  // 이미 LAN/PWR에 배정해둔 포트의 key가 전부 고아가 되어(포트 목록엔 개수가
  // 그대로 보이지만 캔버스엔 색이 하나도 안 칠해짐) 버린다 — 기존 zone id를
  // 그대로 재사용해 이 문제를 막는다.
  if (cfg.zones.length === 1 && !cfg.zones[0].cells) { plan.zone.id = cfg.zones[0].id; }
  cfg.areaW = plan.areaW;
  cfg.areaH = plan.areaH;
  cfg.zones = [plan.zone];
  node.config.totalRequiredPx = plan.totalPx;
}

function onFieldChange(e) {
  const field = e.target.dataset.field;
  if (!field) { return; }
  const node = currentEditTarget();
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

// "확인" — 초안 모드면 그제서야 캔버스에 커밋(commitDraftPanel)하고, 기존
// 노드 편집 모드면 현재 폼에 보이는 모든 필드 값을 강제로 다시 반영한 뒤
// (대부분은 이미 change 시점에 반영돼 있지만, 포커스가 남아있는 필드까지
// 확실히 커밋한다) 패널을 닫는다.
function onApplyClick() {
  if (_draftNode) { commitDraftPanel(); return; }
  const node = getNode(State.ui.selectedId);
  if (!node) { return; }
  _bodyEl.querySelectorAll('[data-field]').forEach(el => applyFieldValue(node, el.dataset.field, el));
  renderValidation();
  selectNode(null);
  renderNodeCards();
  renderPropertiesPanel();
}

// "초기화" — 그 노드 타입의 기본 config로 되돌린다(장비 프리셋도 해제됨).
// 초안 모드면 초안 객체를, 아니면 선택된 실제 노드를 되돌린다.
function onResetClick() {
  const node = currentEditTarget();
  if (!node) { return; }
  node.config = defaultConfig(node.type);
  node.label = node.type === 'input' ? inputKindLabel(node.config.sourceKind) : NODE_TYPES[node.type].label;
  if (node.type === 'console') { pruneOrphanConsoleEdges(node); }
  renderValidation();
  renderPropertiesPanel();
}

// "삭제" — 캔버스에 추가한 노드를 제거한다(Delete/Backspace 키와 동일 동작).
// 초안은 아직 캔버스에 없으므로(버튼도 숨겨져 있다) 여기 오지 않는다.
function onDeleteClick() {
  if (_draftNode || !State.ui.selectedId) { return; }
  // 삭제 대상이 샌딩카드면 지우기 전에 물려 있던 LED를 미리 알아둬야(엣지가
  // 지워진 뒤엔 못 찾음) 삭제 후 남은 카드끼리 재분배할 수 있다(interactions.js
  // 의 키보드 삭제 경로와 동일한 이유 — 연결 시점 균등분배와 대칭).
  const node = getNode(State.ui.selectedId);
  const affectedLedIds = node && node.type === 'sending'
    ? downstreamOf(State.graph, node.id).filter(n => n.type === 'led').map(n => n.id)
    : [];
  removeNode(State.ui.selectedId);
  affectedLedIds.forEach(rebalanceLanAfterSendingDisconnect);
  renderPropertiesPanel();
  renderValidation();
}
