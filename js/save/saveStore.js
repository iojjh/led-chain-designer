// ── saveStore ───────────────────────────────────────
// localStorage 기반 이름별 저장 슬롯(led-calculator의 ledCalcSaves 패턴, 새 키
// 사용) + 저장/불러오기 모달 UI.

const SAVE_KEY = 'ledGraphSaves';

function listProjects() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function persistProjects(list) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(list));
}

function saveProject(name) {
  const list = listProjects();
  const snapshot = getProjectState(name, State);
  const idx = list.findIndex(p => p.name === name);
  if (idx >= 0) { list[idx] = snapshot; } else { list.push(snapshot); }
  persistProjects(list);
}

function loadProject(index) {
  const list = listProjects();
  const snapshot = list[index];
  if (!snapshot) { return false; }
  applyProjectState(State, snapshot);
  return true;
}

function deleteProject(index) {
  const list = listProjects();
  list.splice(index, 1);
  persistProjects(list);
}

// ── 모달 UI ─────────────────────────────────────────
// 여는 트리거는 캔버스 메뉴(interactions.js의 initCanvasMenu, #canvasMenuSaveLoadBtn)다.
function initSaveLoadUi() {
  document.getElementById('saveLoadClose').addEventListener('click', closeSaveLoadModal);
  document.getElementById('saveLoadModal').addEventListener('click', e => {
    if (e.target.id === 'saveLoadModal') { closeSaveLoadModal(); }
  });
  document.getElementById('saveNewBtn').addEventListener('click', () => {
    const input = document.getElementById('saveNameInput');
    const name = input.value.trim();
    if (!name) { return; }
    saveProject(name);
    input.value = '';
    renderSaveList();
  });
  document.getElementById('cloudRefreshBtn').addEventListener('click', renderCloudList);
  registerOverlayCloser('saveLoad', closeSaveLoadModal);
}

function openSaveLoadModal() {
  document.getElementById('saveLoadModal').hidden = false;
  pushHistoryOverlay('saveLoad');
  renderSaveList();
  renderCloudList();
}

function closeSaveLoadModal() {
  const el = document.getElementById('saveLoadModal');
  const wasOpen = !el.hidden;
  el.hidden = true;
  if (wasOpen) { popHistoryOverlayIfTop('saveLoad'); }
}

function renderSaveList() {
  const list = listProjects();
  const el = document.getElementById('saveList');
  el.innerHTML = list.length
    ? list.map((p, i) => `
      <div class="save-row">
        <div class="save-row-info">
          <b>${escapeHtml(p.name)}</b>
          <span>${escapeHtml(p.date)} · 노드 ${p.graph.nodes.length}개</span>
        </div>
        <button class="save-load-row-btn" data-idx="${i}">불러오기</button>
        <button class="cloud-share-row-btn" data-idx="${i}">공유</button>
        <button class="save-del-row-btn" data-idx="${i}">삭제</button>
      </div>`).join('')
    : '<div class="led-zone-empty">저장된 현장이 없습니다.</div>';

  el.querySelectorAll('.save-load-row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      loadProject(Number(btn.dataset.idx));
      State.ui.zoom = 1;
      panToLeftmostNode();
      renderNodeCards();
      renderPropertiesPanel();
      renderValidation();
      closeSaveLoadModal();
    });
  });
  el.querySelectorAll('.save-del-row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteProject(Number(btn.dataset.idx));
      renderSaveList();
    });
  });
  el.querySelectorAll('.cloud-share-row-btn').forEach(btn => {
    btn.addEventListener('click', () => onCloudShareClick(btn, Number(btn.dataset.idx)));
  });
}

// ── 커뮤니티 프리셋(구글 설문지/시트 기반, cloudShare.js) ────
async function onCloudShareClick(btn, idx) {
  const p = listProjects()[idx];
  if (!p) { return; }
  if (!window.confirm(`"${p.name}"을(를) 커뮤니티에 공유할까요?`)) { return; }
  btn.disabled = true;
  btn.textContent = '공유 중…';
  try {
    await shareGraphToCloud(p.name, p.graph);
    showToast('커뮤니티에 공유했습니다');
  } catch (e) {
    showToast('공유 실패: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = '공유';
}

async function renderCloudList() {
  const el = document.getElementById('cloudList');
  el.innerHTML = '<div class="led-zone-empty">불러오는 중…</div>';
  try {
    const presets = await fetchCloudPresets();
    el.innerHTML = presets.length
      ? presets.map((p, i) => `
        <div class="save-row">
          <div class="save-row-info">
            <b>${escapeHtml(p.name || '(이름 없음)')}</b>
            <span>${escapeHtml(p.date)}</span>
          </div>
          <button class="save-load-row-btn" data-idx="${i}">불러오기</button>
          <button class="save-del-row-btn cloud-del-row-btn" data-idx="${i}">삭제</button>
        </div>`).join('')
      : '<div class="led-zone-empty">공유된 현장이 없습니다.</div>';
    el.querySelectorAll('.save-load-row-btn').forEach(btn => {
      btn.addEventListener('click', () => onCloudLoadClick(btn, presets[Number(btn.dataset.idx)]));
    });
    el.querySelectorAll('.cloud-del-row-btn').forEach(btn => {
      btn.addEventListener('click', () => onCloudDeleteClick(btn, presets[Number(btn.dataset.idx)]));
    });
  } catch (e) {
    el.innerHTML = `<div class="led-zone-empty">목록을 불러오지 못했습니다: ${escapeHtml(e.message)}</div>`;
  }
}

async function onCloudLoadClick(btn, preset) {
  if (!preset) { return; }
  btn.disabled = true;
  btn.textContent = '불러오는 중…';
  try {
    State.graph = await loadCloudPresetGraph(preset.data);
    State.ui.selectedId = null;
    State.ui.selectedEdgeId = null;
    State.ui.zoom = 1;
    panToLeftmostNode();
    renderNodeCards();
    renderPropertiesPanel();
    renderValidation();
    closeSaveLoadModal();
    showToast(`"${preset.name}" 불러왔습니다`);
  } catch (e) {
    showToast('불러오기 실패: ' + e.message);
    btn.disabled = false;
    btn.textContent = '불러오기';
  }
}

function onCloudDeleteClick(btn, preset) {
  if (!preset) { return; }
  if (!window.confirm(`"${preset.name || '(이름 없음)'}"을(를) 커뮤니티에서 삭제할까요?`)) { return; }
  // 실제 삭제 요청(Apps Script 왕복)은 수 초 걸릴 수 있어, 사용자를 기다리게 하지
  // 않고 화면에서 바로 지운 뒤 요청은 백그라운드로 보낸다 — deleteCloudPreset이
  // keepalive:true라 이 시점에 앱을 꺼도 요청은 살아남는다.
  btn.closest('.save-row').remove();
  showToast('커뮤니티에서 삭제했습니다');
  deleteCloudPreset(preset.data).catch(e => {
    showToast('삭제 요청 실패: ' + e.message);
  });
}

// ── 일정에서 LED 추가 (게시된 구글 시트 CSV, scheduleFeed.js + scheduleParse.js) ────
// 팔레트 "🗓 일정에서 추가"(interactions.js) → 이 모달. 밴드 일정이 자동으로
// 쌓이는 시트에서 목록을 읽어(읽기 전용), "가져오기" 시 피치·면적에 맞는
// LED디스플레이 노드를 만든다. 커뮤니티 프리셋 모달과 같은 구조라 여기 둔다.
function initScheduleUi() {
  document.getElementById('scheduleClose').addEventListener('click', closeScheduleModal);
  document.getElementById('scheduleModal').addEventListener('click', e => {
    if (e.target.id === 'scheduleModal') { closeScheduleModal(); }
  });
  document.getElementById('scheduleRefreshBtn').addEventListener('click', renderScheduleList);
  registerOverlayCloser('schedule', closeScheduleModal);
}

function openScheduleModal() {
  document.getElementById('scheduleModal').hidden = false;
  pushHistoryOverlay('schedule');
  renderScheduleList();
}

function closeScheduleModal() {
  const el = document.getElementById('scheduleModal');
  const wasOpen = !el.hidden;
  el.hidden = true;
  if (wasOpen) { popHistoryOverlayIfTop('schedule'); }
}

async function renderScheduleList() {
  const el = document.getElementById('scheduleList');
  // 비설정("아직 프록시 URL 안 넣음")과 "빈 피드"를 구분 — fetch 전에 먼저 본다.
  if (!SCHEDULE_ICS_PROXY_URL) {
    el.innerHTML = '<div class="led-zone-empty">일정 피드가 아직 설정되지 않았습니다. (일정-피드-설정.md 참고)</div>';
    return;
  }
  el.innerHTML = '<div class="led-zone-empty">불러오는 중…</div>';
  try {
    const entries = await fetchScheduleEntries();
    el.innerHTML = entries.length
      ? entries.map((e, i) => `
        <div class="save-row">
          <div class="save-row-info">
            <b>${escapeHtml(e.title || '(제목 없음)')}</b>
            <span>${escapeHtml(e.date)}</span>
            ${e.body ? `<span class="sched-row-body">${escapeHtml(e.body)}</span>` : ''}
          </div>
          <button class="save-load-row-btn" data-idx="${i}">가져오기</button>
        </div>`).join('')
      : '<div class="led-zone-empty">등록된 일정이 없습니다.</div>';
    el.querySelectorAll('.save-load-row-btn').forEach(btn => {
      btn.addEventListener('click', () => onScheduleImportClick(entries[Number(btn.dataset.idx)]));
    });
  } catch (e) {
    el.innerHTML = `<div class="led-zone-empty">일정을 불러오지 못했습니다: ${escapeHtml(e.message)}</div>`;
  }
}

function onScheduleImportClick(entry) {
  if (!entry) { return; }
  let sections;
  try {
    sections = parseScheduleText((entry.title || '') + '\n' + (entry.body || ''));
  } catch (e) {
    showToast(e.message.split('\n')[0]); // 토스트(#appToast)는 한 줄만
    return;
  }
  const summary = sections
    .map(s => `${s.label ? s.label + ' ' : ''}${s.areaWm}×${s.areaHm}m ${s.pitch}`)
    .join(' / ');
  if (!window.confirm(`LED ${sections.length}개를 추가할까요?\n${summary}`)) { return; }
  applyScheduleEntry(sections);
}

// interactions.js onLedAddConfirm의 "빠른 설정"(rect) 분기를 섹션마다 반복한다.
// 섹션끼리는 연결하지 않는다(요구사항). createPositionedNode가 같은 타입 노드를
// 자동으로 아래(모바일은 오른쪽)에 쌓으므로 별도 위치 오프셋은 두지 않는다.
function applyScheduleEntry(sections) {
  const created = [];
  sections.forEach(sec => {
    const areaW = Math.round(sec.areaWm * 1000); // 미터 → mm (planFullAreaLed가 500mm 격자로 스냅)
    const areaH = Math.round(sec.areaHm * 1000);
    const { panelW, panelH } = panelSizeForPitch(sec.pitch);
    const plan = planFullAreaLed({ areaW, areaH, panelW, panelH, pitch: sec.pitch });

    const node = createPositionedNode('led');
    node.config.ledDesign.areaW = plan.areaW;
    node.config.ledDesign.areaH = plan.areaH;
    node.config.ledDesign.zones = [plan.zone];
    node.config.totalRequiredPx = plan.totalPx;
    node.config.ledDesign.zoneViewCompact = true;
    node.config.ledDesign.quickSetup = true;
    if (sec.label) { node.label = 'LED ' + sec.label; }

    autoAssignLanForLedNode(node.id);
    autoAssignPwrForLedNode(node.id);
    created.push(node);
  });
  if (!created.length) { return; }

  closeScheduleModal();
  finalizeAddedNode(created[created.length - 1], false); // 마지막 노드 선택, 속성 패널은 안 엶
  renderValidation();
  showToast(created.length === 1 ? 'LED 1개를 추가했습니다' : `LED ${created.length}개를 추가했습니다`);
}
