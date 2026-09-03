// ── onboarding ──────────────────────────────────────
// 처음 쓰는 사람이 "이게 뭘 하는 앱이고 뭘 눌러야 하는지"를 알 수 있게 하는
// 넛지 모음 — 빈 캔버스 안내 패널(A1), 예시 현장 불러오기(A2), 상시 도움말
// 버튼(A3), 연결 방법 힌트 스트립(B1), "카드는 꾹 눌러 이동" 1회 토스트(B2).
// 전부 강제가 아니라 상황이 맞을 때만 잠깐 뜨고, 조건이 풀리면 스스로 사라진다.

// 예시 현장(A2) — 인풋소스 → 콘솔 → 샌딩카드 → LED가 이어진 최소 체인.
// 완성형이 "어떻게 생겼는지"를 1클릭에 보여주는 용도라, 콘솔/샌딩카드는
// 장비 미지정(수동) 모드로 두고 포트 id도 수동 모드 기본값(in1/out1 등)을 쓴다.
const SAMPLE_GRAPH = {
  version: 1,
  nodes: [
    { id: 'sample-in', type: 'input', x: 60, y: 200, label: 'vMix', config: { sourceKind: 'vmix' } },
    {
      id: 'sample-con', type: 'console', x: 320, y: 200, label: '콘솔',
      config: {
        deviceId: null, outputKind: 'lan-ports', mode: null, cascade: 1,
        manualInputPorts: 2, manualOutputPorts: 2, dviLink: 'single', auxMode: 'switcher',
      },
    },
    {
      id: 'sample-snd', type: 'sending', x: 580, y: 180, label: '샌딩카드',
      config: { deviceId: null, portCount: 8, perPortMaxPx: 655360, inputMaxPx: null },
    },
    {
      id: 'sample-led', type: 'led', x: 840, y: 190, label: 'LED디스플레이',
      config: {
        ledDesign: {
          areaW: 6000, areaH: 3000, zones: [],
          lanPorts: [], lanOrder: [], lanGroupOrder: [],
          pwrPorts: [], pwrOrder: [], pwrPortCount: 18,
          spareAdj: { l1: 2, sl: 20, c1: 2, sp: 20 },
          zoneViewCompact: false,
          gridOriginRow: 0, gridOriginCol: 0, gridCols: 15, gridRows: 10,
          quickSetup: false, requiredLanPorts: 0,
        },
        totalRequiredPx: 0,
      },
    },
  ],
  edges: [
    { id: 'sample-e1', kind: 'video', from: { nodeId: 'sample-in', portId: 'out' }, to: { nodeId: 'sample-con', portId: 'in1' } },
    { id: 'sample-e2', kind: 'lan', from: { nodeId: 'sample-con', portId: 'out1' }, to: { nodeId: 'sample-snd', portId: 'in' } },
    { id: 'sample-e3', kind: 'lan', from: { nodeId: 'sample-snd', portId: 'out' }, to: { nodeId: 'sample-led', portId: 'in' } },
  ],
};

const ONBOARD_SEEN = {
  connectHint: 'onboard-connect-hint-dismissed',
  holdToMove: 'onboard-hold-to-move-seen',
};

function _onboardSeen(key) {
  try { return localStorage.getItem(key) === '1'; } catch (_) { return false; }
}
function _onboardMarkSeen(key) {
  try { localStorage.setItem(key, '1'); } catch (_) { /* 비공개 모드 등 — 그냥 매번 보여준다 */ }
}

// _helpAutoShown: 지금 열려 있는 게 "빈 캔버스라 자동으로 띄운" 것인지
//   (true면 첫 노드가 생기는 순간 알아서 닫는다).
// _helpDismissed: 사용자가 직접 ✕/토글로 닫았거나 예시를 불러왔음 — 캔버스가
//   다시 완전히 빌 때까진 자동으로 다시 안 띄운다.
let _helpAutoShown = false;
let _helpDismissed = false;
let _prevNodeCount = 0;

function initOnboarding() {
  const helpBtn = document.getElementById('helpBtn');
  const panel = document.getElementById('graphHelpPanel');
  if (helpBtn) {
    helpBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !panel.classList.contains('open');
      _setHelpPanelOpen(open);
      _helpAutoShown = false; // 이제부터는 사용자가 직접 제어
      _helpDismissed = !open;
    });
  }
  if (panel) {
    panel.querySelector('.graph-help-close').addEventListener('click', () => {
      _setHelpPanelOpen(false);
      _helpAutoShown = false;
      _helpDismissed = true;
    });
    const sampleBtn = panel.querySelector('#graphHelpSampleBtn');
    if (sampleBtn) { sampleBtn.addEventListener('click', loadSampleGraph); }
  }
  const hintClose = document.querySelector('#connectHint .connect-hint-close');
  if (hintClose) {
    hintClose.addEventListener('click', () => {
      _onboardMarkSeen(ONBOARD_SEEN.connectHint);
      document.getElementById('connectHint').hidden = true;
    });
  }
  refreshOnboarding();
}

function _setHelpPanelOpen(open) {
  const panel = document.getElementById('graphHelpPanel');
  if (!panel) { return; }
  panel.classList.toggle('open', open);
}

// 그래프가 바뀔 때마다(renderNodeCards 끝에서) 불린다 — 지금 상태에 맞게
// 안내 요소들을 켜고 끈다.
function refreshOnboarding() {
  const nodeCount = State.graph.nodes.length;
  const edgeCount = State.graph.edges.length;
  const panel = document.getElementById('graphHelpPanel');

  // A1: 캔버스가 방금 완전히 비었으면(N→0) "직접 닫음"을 풀어 처음처럼 안내를
  // 다시 자동으로 띄운다. 첫 노드가 생기는 순간(0→N) 자동으로 띄운 안내는
  // 알아서 닫는다(사용자가 ? 버튼으로 직접 연 경우는 _helpAutoShown=false라 유지).
  if (panel) {
    if (nodeCount === 0 && _prevNodeCount > 0) { _helpDismissed = false; }
    if (nodeCount > 0 && _helpAutoShown) {
      panel.classList.remove('open');
      _helpAutoShown = false;
    }
    if (nodeCount === 0 && !_helpDismissed && !panel.classList.contains('open')) {
      panel.classList.add('open');
      _helpAutoShown = true;
    }
  }
  _prevNodeCount = nodeCount;

  // B1: 노드가 2개 이상인데 아직 아무것도 연결 안 했으면 "점을 끌어 연결"
  // 힌트 스트립을 띄운다. 연결이 하나라도 생기거나 사용자가 닫으면 사라진다.
  const hint = document.getElementById('connectHint');
  if (hint) {
    const ledView = document.getElementById('ledDesignView');
    const onGraph = !ledView || ledView.hidden;
    const show = nodeCount >= 2 && edgeCount === 0 && onGraph
      && !_onboardSeen(ONBOARD_SEEN.connectHint);
    hint.hidden = !show;
  }
}

// A2: 예시 현장 불러오기 — 저장 슬롯을 불러올 때(saveStore.js)와 같은 후처리.
function loadSampleGraph() {
  if (State.graph.nodes.length && !window.confirm('현재 캔버스를 지우고 예시 현장을 불러올까요?')) { return; }
  State.graph = JSON.parse(JSON.stringify(SAMPLE_GRAPH));
  State.ui.selectedId = null;
  State.ui.selectedEdgeId = null;
  State.ui.zoom = 1;
  _setHelpPanelOpen(false);
  _helpAutoShown = false;
  _helpDismissed = true;
  if (typeof panToLeftmostNode === 'function') { panToLeftmostNode(); }
  renderNodeCards();
  renderPropertiesPanel();
  renderValidation();
  showToast('예시 현장을 불러왔습니다 — LED 카드를 눌러 세부 설계를 열어보세요');
}

// B2: 카드를 빠르게 끌어 옮기려다 실패한(롱프레스 전에 움직여 취소된) 첫
// 순간에만 "꾹 눌러야 옮겨진다"고 한 번 알려준다. interactions.js가 호출한다.
function maybeHoldToMoveHint() {
  if (_onboardSeen(ONBOARD_SEEN.holdToMove)) { return; }
  _onboardMarkSeen(ONBOARD_SEEN.holdToMove);
  showToast('💡 카드는 살짝 길게 눌렀다가 끌어야 옮겨집니다');
}
