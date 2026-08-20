// ── devices ─────────────────────────────────────────
// 실제 벤더 스펙 문서(led-calculator에 캐시된 PDF 4종)에서 추출한 장비 프리셋.
// 콘솔 프리셋 목록은 J6/EC90 두 종류만 유지한다(사용자 요청). NovaStar
// MCTRL4K/MCTRL660PRO는 샌딩카드 프리셋(내장 GbE 포트)으로만 남아 있다 —
// 콘솔 노드에서 이 둘을 쓰고 싶으면 수동 모드로 직접 구성하면 된다.

const DEVICES = {
  console: {
    'novastar-j6': {
      id: 'novastar-j6', vendor: 'NovaStar', name: 'J6 Seamless Switcher',
      outputKind: 'video-signal',
      // 벤더 스펙상 입력 커넥터 종류가 섞여 있어(DVI/HDMI/3G-SDI/DP1.1/HDMI1.4) 딱
      // 떨어지는 개별 타입별 개수를 문서에서 명시하지 않는다 — 다만 "최대 8입력"은
      // 명시돼 있으므로 범용 입력 하나를 count:8로 모델링한다.
      inputs: [
        { id: 'in1', label: '혼합 입력(DVI/HDMI/SDI/DP)', maxPx: null, count: 8 },
      ],
      modes: {
        splicer: { maxOutputs: 4, totalMaxPx: 9200000, maxMosaicWidthPx: 15360 },
        switcher: { maxOutputs: 2, totalMaxPx: 4600000, approx: true }, // 벤더 문서 근사치("4KK")
      },
      defaultMode: 'splicer',
      note: 'DVI 영상 출력 — LED디스플레이 직결 불가, 샌딩카드 노드를 반드시 거쳐야 함',
      sourcePdf: 'J6-Seamless-Switcher-Specifications-V2.2.0.pdf',
    },
    'magnimage-ec90': {
      id: 'magnimage-ec90', vendor: 'Magnimage', name: 'MIG-EC90 Event Console',
      outputKind: 'video-signal',
      // count: 같은 종류 커넥터가 실제로 몇 개 있는지(예: HDMI2.0 × 4개) —
      // getConsoleInputPorts가 이 수만큼 개별 연결 가능한 포트로 펼쳐준다.
      inputs: [
        { id: 'hdmi1', label: 'HDMI2.0', maxPx: 3840 * 2160, count: 4 },
        { id: 'dp1', label: 'DP1.2', maxPx: 3840 * 2160, count: 2 },
        { id: 'sdi1', label: '12G-SDI', maxPx: 3840 * 2160, count: 2 },
      ],
      outputs: { groups: ['PROGRAM', 'AUX'], perOutputMaxPx: 4352 * 2176 },
      note: 'HDMI 영상 출력 — LED디스플레이 직결 불가, 샌딩카드 노드를 반드시 거쳐야 함',
      sourcePdf: 'MIG-EC90_User_Manual_1.0.pdf',
    },
  },
  sending: {
    'novastar-mctrl4k': {
      id: 'novastar-mctrl4k', vendor: 'NovaStar', name: 'MCTRL4K (내장 샌딩 포트)',
      portCount: 16, perPortMaxPx8bit: 655360, perPortMaxPx10bit: 320000,
      sourcePdf: 'MCTRL4K.pdf',
    },
    'novastar-mctrl660pro': {
      id: 'novastar-mctrl660pro', vendor: 'NovaStar', name: 'MCTRL660PRO (내장 샌딩 포트)',
      portCount: 6, perPortMaxPx8bit: 655360, perPortMaxPx10bit: 325000,
      sourcePdf: 'MCTRL660PRO.pdf',
    },
  },
};

function getDevice(category, id) {
  return (DEVICES[category] && DEVICES[category][id]) || null;
}

function listDevices(category) {
  return Object.values(DEVICES[category] || {});
}

// 콘솔 노드가 실제로 갖는 입력 포트 목록(연결 가능 여부 판정 + 표시용).
// 캔버스에는 입력 도트가 하나로 통합돼 있지만, 인풋소스를 그 도트에 드래그해
// 연결하면 interactions.js가 이 목록에서 비어있는 포트를 찾아 선택하게 하거나
// (자동/피커) 전부 찼으면 연결을 거부한다. 장비 프리셋이 있으면 그 장비의 실제
// 입력 커넥터(DP/HDMI/DVI 등)를 그대로 포트로 쓰고, 같은 종류 커넥터가 여러 개면
// (device.inputs[].count) 그 수만큼 개별 슬롯(hdmi1-1, hdmi1-2, …)으로 펼친다 —
// "HDMI 포트가 4개면 인풋소스 4개가 동시에 HDMI로 연결될 수 있다"는 실제 배선과
// 일치시키기 위함. 수동 모드(장비 미지정)는 사용자가 지정한 개수(manualInputPorts)
// 만큼 이름 없는 범용 포트를 만든다.
function getConsoleInputPorts(node) {
  const cfg = (node && node.config) || {};
  const device = cfg.deviceId ? getDevice('console', cfg.deviceId) : null;
  if (device) {
    return device.inputs.flatMap(i => {
      const count = i.count || 1;
      if (count === 1) {
        return [{ id: i.id, label: i.label, kind: 'video', maxPx: i.maxPx }];
      }
      return Array.from({ length: count }, (_, slot) => (
        { id: `${i.id}-${slot + 1}`, label: `${i.label} #${slot + 1}`, kind: 'video', maxPx: i.maxPx }
      ));
    });
  }
  const raw = cfg.manualInputPorts === undefined || cfg.manualInputPorts === null ? 2 : cfg.manualInputPorts;
  const count = Math.max(1, Math.min(8, raw));
  return Array.from({ length: count }, (_, i) => (
    { id: `in${i + 1}`, label: `입력 ${i + 1}`, kind: 'video', maxPx: null }
  ));
}

if (typeof module !== 'undefined') {
  module.exports = { DEVICES, getDevice, listDevices, getConsoleInputPorts };
}
