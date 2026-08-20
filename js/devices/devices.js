// ── devices ─────────────────────────────────────────
// 실제 벤더 스펙 문서(led-calculator에 캐시된 PDF 4종)에서 추출한 장비 프리셋.
// NovaStar MCTRL4K/MCTRL660PRO는 콘솔이면서 동시에 샌딩카드 역할도 겸하는
// 실제 장비이므로(내장 GbE 포트 = 샌딩카드 포트) console/sending 양쪽에 등록한다.

const DEVICES = {
  console: {
    'novastar-mctrl4k': {
      id: 'novastar-mctrl4k', vendor: 'NovaStar', name: 'MCTRL4K',
      outputKind: 'lan-ports',
      inputs: [
        { id: 'dp', label: 'DP1.2', maxPx: 8800000 },
        { id: 'hdmi', label: 'HDMI2.0', maxPx: 8800000 },
        { id: 'dvi1', label: 'DL-DVI 1', maxPx: 8300000 },
        { id: 'dvi2', label: 'DL-DVI 2', maxPx: 8300000 },
      ],
      outputs: { portCount: 16, perPortMaxPx8bit: 650000, perPortMaxPx10bit: 320000 },
      cascade: { max: 10, via: 'USB' },
      sourcePdf: 'MCTRL4K.pdf',
    },
    'novastar-mctrl660pro': {
      id: 'novastar-mctrl660pro', vendor: 'NovaStar', name: 'MCTRL660PRO',
      outputKind: 'lan-ports',
      inputs: [
        { id: 'sdi', label: '3G-SDI', maxPx: null },
        { id: 'hdmi', label: 'HDMI1.4a', maxPx: null },
        { id: 'dvi', label: 'SL-DVI', maxPx: null },
      ],
      outputs: { portCount: 6, perPortMaxPx8bit: 650000, perPortMaxPx10bit: 325000 },
      cascade: { max: 8, via: 'USB' },
      sourcePdf: 'MCTRL660PRO.pdf',
    },
    'novastar-j6': {
      id: 'novastar-j6', vendor: 'NovaStar', name: 'J6 Seamless Switcher',
      outputKind: 'video-signal',
      inputs: [
        { id: 'in1', label: 'DVI/HDMI/SDI/DP (혼합, 최대 8개)', maxPx: null },
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
      inputs: [
        { id: 'hdmi1', label: 'HDMI2.0 (x4)', maxPx: 3840 * 2160 },
        { id: 'dp1', label: 'DP1.2 (x2)', maxPx: 3840 * 2160 },
        { id: 'sdi1', label: '12G-SDI (x2)', maxPx: 3840 * 2160 },
      ],
      outputs: { groups: ['PROGRAM', 'AUX'], perOutputMaxPx: 4352 * 2176 },
      note: 'HDMI 영상 출력 — LED디스플레이 직결 불가, 샌딩카드 노드를 반드시 거쳐야 함',
      sourcePdf: 'MIG-EC90_User_Manual_1.0.pdf',
    },
  },
  sending: {
    'novastar-mctrl4k': {
      id: 'novastar-mctrl4k', vendor: 'NovaStar', name: 'MCTRL4K (내장 샌딩 포트)',
      portCount: 16, perPortMaxPx8bit: 650000, perPortMaxPx10bit: 320000,
      sourcePdf: 'MCTRL4K.pdf',
    },
    'novastar-mctrl660pro': {
      id: 'novastar-mctrl660pro', vendor: 'NovaStar', name: 'MCTRL660PRO (내장 샌딩 포트)',
      portCount: 6, perPortMaxPx8bit: 650000, perPortMaxPx10bit: 325000,
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

if (typeof module !== 'undefined') {
  module.exports = { DEVICES, getDevice, listDevices };
}
