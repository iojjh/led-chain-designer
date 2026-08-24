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
function initSaveLoadUi() {
  document.getElementById('saveLoadBtn').addEventListener('click', openSaveLoadModal);
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
}

function openSaveLoadModal() {
  document.getElementById('saveLoadModal').hidden = false;
  renderSaveList();
  renderCloudList();
}

function closeSaveLoadModal() {
  document.getElementById('saveLoadModal').hidden = true;
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

async function onCloudDeleteClick(btn, preset) {
  if (!preset) { return; }
  if (!window.confirm(`"${preset.name || '(이름 없음)'}"을(를) 커뮤니티에서 삭제할까요?`)) { return; }
  btn.disabled = true;
  btn.textContent = '삭제 중…';
  try {
    await deleteCloudPreset(preset.data);
    showToast('커뮤니티에서 삭제했습니다');
    btn.closest('.save-row').remove(); // 게시된 CSV 캐시 반영엔 지연이 있어, 목록 재조회 대신 그 자리에서 바로 지움
  } catch (e) {
    showToast('삭제 실패: ' + e.message);
    btn.disabled = false;
    btn.textContent = '삭제';
  }
}
