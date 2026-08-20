// ── nodeTypes ───────────────────────────────────────
// 6개 노드 타입의 표시 정보(아이콘/라벨)와 기본 config, 포트 정의.
// M1/M2 단계에서는 콘솔/샌딩카드도 단일 논리 포트만 갖는다.
// M3(장비 프리셋)에서 devices.js를 참조해 콘솔/샌딩카드의 실제 다중 포트로 확장한다.

const NODE_TYPES = {
  input:   { label: '입력',          icon: '💻', category: 'video' },
  console: { label: '콘솔/프로세서', icon: '🖥️', category: 'video' },
  sending: { label: '샌딩카드',      icon: '📡', category: 'video' },
  led:     { label: 'LED디스플레이', icon: '🟩', category: 'video' },
  power:   { label: '메인전원',      icon: '🔌', category: 'power' },
  distro:  { label: '분전함',        icon: '⚡', category: 'power' },
};

const NODE_ORDER = ['input', 'console', 'sending', 'led', 'power', 'distro'];

function defaultConfig(type) {
  switch (type) {
    case 'input':
      return { resolutionW: 1920, resolutionH: 1080, sourceLabel: '노트북' };
    case 'console':
      return { deviceId: null, outputKind: 'lan-ports', mode: null, cascade: 1 };
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
        in: [{ id: 'in', kind: 'video' }],
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
  module.exports = { NODE_TYPES, NODE_ORDER, defaultConfig, getPorts };
}
