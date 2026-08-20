// ── nodeTypes ───────────────────────────────────────
// 6개 노드 타입의 표시 정보(아이콘/라벨)와 기본 config, 포트 정의.
// 콘솔의 입력은 캔버스에서 도트 하나로 통합해 보여준다 — 실제 몇 번 커넥터로
// 연결됐는지는 엣지의 portId(예: 'dp')에 저장되고 devices.js의
// getConsoleInputPorts로 조회한다(연결 인터랙션은 interactions.js, 포트 목록
// 표시는 propertiesPanel.js). nodeCardRenderer의 getPortWorldPos는 이 단일
// 도트 목록에서 실제 portId를 찾지 못하면 index 0으로 clamp되므로, 여러 인풋
// 소스가 서로 다른 물리 포트로 연결돼도 시각적으로는 모두 이 한 점에 모인다.

const NODE_TYPES = {
  input:   { label: '인풋소스', icon: '💻', category: 'video' },
  console: { label: '콘솔',     icon: '🖥️', category: 'video' },
  sending: { label: '샌딩카드', icon: '📡', category: 'video' },
  led:     { label: 'LED디스플레이', icon: '🟩', category: 'video' },
  power:   { label: '메인전원',      icon: '🔌', category: 'power' },
  distro:  { label: '분전함',        icon: '⚡', category: 'power' },
};

const NODE_ORDER = ['input', 'console', 'sending', 'led', 'power', 'distro'];

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
      return { sourceKind: 'vmix', sourceLabel: '' };
    case 'console':
      return { deviceId: null, outputKind: 'lan-ports', mode: null, cascade: 1, manualInputPorts: 2 };
    case 'sending':
      return { deviceId: null, portCount: 8, perPortMaxPx: 655360, inputMaxPx: null };
    case 'led':
      return {
        ledDesign: {
          areaW: 0, areaH: 0, zones: [],
          lanPorts: [], lanOrder: [],
          pwrPorts: [], pwrOrder: [],
          spareAdj: { l1: 2, sl: 20 },
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
    default:
      return { in: [], out: [] };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { NODE_TYPES, NODE_ORDER, INPUT_KINDS, inputKindLabel, defaultConfig, getPorts };
}
