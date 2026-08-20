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
}

function openSaveLoadModal() {
  document.getElementById('saveLoadModal').hidden = false;
  renderSaveList();
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
}
