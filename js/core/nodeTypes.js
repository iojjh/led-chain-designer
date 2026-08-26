// ── nodeTypes ───────────────────────────────────────
// 7개 노드 타입의 표시 정보(아이콘/라벨)와 기본 config, 포트 정의.
// 콘솔의 입력은 캔버스에서 도트 하나로 통합해 보여준다 — 실제 몇 번 커넥터로
// 연결됐는지는 엣지의 portId(예: 'dp')에 저장되고 devices.js의
// getConsoleInputPorts로 조회한다(연결 인터랙션은 interactions.js, 포트 목록
// 표시는 propertiesPanel.js). nodeCardRenderer의 getPortWorldPos는 이 단일
// 도트 목록에서 실제 portId를 찾지 못하면 index 0으로 clamp되므로, 여러 인풋
// 소스가 서로 다른 물리 포트로 연결돼도 시각적으로는 모두 이 한 점에 모인다.

if (typeof module !== 'undefined' && typeof PWR_PORT_COUNT === 'undefined') {
  global.PWR_PORT_COUNT = require('../leddesign/specs.js').PWR_PORT_COUNT;
}

const NODE_TYPES = {
  input:    { label: '인풋소스', icon: '💻', category: 'video' },
  console:  { label: '콘솔',     icon: '🖥️', category: 'video' },
  sending:  { label: '샌딩카드', icon: '📡', category: 'video' },
  led:      { label: 'LED디스플레이', icon: '🟩', category: 'video' },
  power:    { label: '메인전원',      icon: '🔌', category: 'power' },
  distro:   { label: '분전함',        icon: '⚡', category: 'power' },
  // 콘솔의 AUX 출력(모니터링용)을 샌딩카드/LED 없이 바로 받는 단순 종착점 —
  // PGM 경로(샌딩카드→LED)와 달리 설정할 게 없어 defaultConfig도 빈 객체다.
  // graphOps.js의 isPairAllowed가 AUX로 표시된 출력 포트에서만 연결을 허용한다.
  prompter: { label: '프롬프터', icon: '📺', category: 'video' },
};

const NODE_ORDER = ['input', 'console', 'sending', 'led', 'power', 'distro', 'prompter'];

// 인풋소스 종류 — 카드/속성패널 드롭다운에서 공유하는 표시 라벨 테이블.
const INPUT_KINDS = [
  { id: 'vmix', label: 'vMix' },
  { id: 'resolume', label: 'Resolume' },
  { id: 'ppt', label: 'PPT' },
  { id: 'relay', label: '중계' },
  { id: 'etc', label: '기타' },
];

function inputKindLabel(kindId) {
  const found = INPUT_KINDS.find(k => k.id === kindId);
  return found ? found.label : '인풋소스';
}

function defaultConfig(type) {
  switch (type) {
    case 'input':
      return { sourceKind: 'vmix' };
    case 'console':
      return {
        deviceId: null, outputKind: 'lan-ports', mode: null, cascade: 1,
        manualInputPorts: 2, manualOutputPorts: 2, dviLink: 'single', auxMode: 'switcher',
      };
    case 'sending':
      return { deviceId: null, portCount: 8, perPortMaxPx: 655360, inputMaxPx: null };
    case 'led':
      return {
        ledDesign: {
          areaW: 0, areaH: 0, zones: [],
          lanPorts: [], lanOrder: [],
          pwrPorts: [], pwrOrder: [], pwrPortCount: PWR_PORT_COUNT, // 포트 추가/제거 버튼으로 조절 — 저장/불러오기에도 유지됨
          spareAdj: { l1: 2, sl: 20, c1: 2, sp: 20 },
          zoneViewCompact: false, // "여백 정리"로 캔버스를 구역 크기만큼 줄인 상태 — 저장/불러오기에도 유지됨
          // 격자 크기/원점 — 더 이상 드래그 중 자동으로 안 늘어나고, 캔버스
          // 상하좌우의 확장 버튼을 눌러야만 바뀐다(ledDesignView.js 참고).
          // 저장/불러오기에도 유지됨.
          gridOriginRow: 0, gridOriginCol: 0, gridCols: 15, gridRows: 10,
          // LED 추가 팝업의 "빠른 설정"으로 만들어졌는지 — true면 노드가 생성되는
          // 그 순간 LAN/PWR 자동 할당이 한 번 돌아간다(interactions.js의
          // onLedAddConfirm). "자유 설계"는 사용자가 구역을 직접 그려 배치하므로
          // 자동 배정 대상이 아니다 — 그래서 기본값도 false. 샌딩카드에 나중에
          // 연결될 때는 quickSetup 여부와 무관하게 항상 포트 재배치(reflow)만
          // 일어난다(자동 배정을 다시 돌리지 않음 — ledDesignView.js 참고).
          quickSetup: false,
          // 이 LED가 실제로 필요로 하는 LAN 포트 수의 "최고 기록"치. 샌딩카드
          // 미연결 상태의 자동 배정이 기본 8포트로 다 못 담으면 이 값을 필요한
          // 만큼 늘려 포트 수 자체를 늘리고(ledPortGroups.js의 미연결 기본값
          // 그룹이 이 값을 읽음), 샌딩카드에 연결될 때도 그 순간의 배선 개수로
          // 갱신된다. validationEngine.js가 실제 연결된 샌딩카드의 포트 수와
          // 비교해 부족하면 이슈로 표시한다. 0이면 "아직 파악된 적 없음".
          requiredLanPorts: 0,
        },
        totalRequiredPx: 0,
      };
    case 'power':
    case 'distro':
      return {};
    default:
      return {};
  }
}

// 포트 정의: { in: [{id, kind}], out: [{id, kind}] }
// kind는 'video' | 'lan' | 'power' — 엣지 색상 등 표시용. 연결 가능 여부의
// 실제 판정은 graphOps.js의 타입 쌍(pair) 규칙이 담당한다(kind 단순 일치가 아님).
function getPorts(node) {
  switch (node.type) {
    case 'input':
      return { in: [], out: [{ id: 'out', kind: 'video' }] };
    case 'console': {
      const outputKind = (node.config && node.config.outputKind) || 'lan-ports';
      return {
        in: [{ id: 'in', kind: 'video' }], // 시각적으로 하나로 통합된 입력 도트
        out: [{ id: 'out', kind: outputKind === 'video-signal' ? 'video' : 'lan' }],
      };
    }
    case 'sending':
      return { in: [{ id: 'in', kind: 'video' }], out: [{ id: 'out', kind: 'lan' }] };
    case 'led':
      return { in: [{ id: 'in', kind: 'lan' }, { id: 'pwrIn', kind: 'power' }], out: [] };
    case 'power':
      return { in: [], out: [{ id: 'out', kind: 'power' }] };
    case 'distro':
      return { in: [{ id: 'in', kind: 'power' }], out: [{ id: 'out', kind: 'power' }] };
    case 'prompter':
      return { in: [{ id: 'in', kind: 'video' }], out: [] };
    default:
      return { in: [], out: [] };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { NODE_TYPES, NODE_ORDER, INPUT_KINDS, inputKindLabel, defaultConfig, getPorts };
}
