// ── devices ─────────────────────────────────────────
// 실제 벤더 스펙 문서(led-calculator에 캐시된 PDF 4종)에서 추출한 장비 프리셋.
// 콘솔 프리셋 목록은 J6/EC90 두 종류만 유지한다(사용자 요청). NovaStar
// MCTRL4K/MCTRL660PRO는 샌딩카드 프리셋(내장 GbE 포트)으로만 남아 있다 —
// 콘솔 노드에서 이 둘을 쓰고 싶으면 수동 모드로 직접 구성하면 된다.

const DEVICES = {
  console: {
    'novastar-j6': {
      id: 'novastar-j6', vendor: 'NovaStar', name: 'J6 Seamless Switcher', shortName: 'J6',
      outputKind: 'video-signal',
      // 후면 패널 Input 표(INPUT-A~H) 기준 실제 커넥터별 개수 — "최대 8입력"은
      // 이 8개(1+2+1+4)의 합일 뿐, 아무 타입이나 섞어서 8개가 아니다. 인풋소스를
      // 실제로 어느 물리 커넥터에 꽂을 수 있는지(그래서 콘솔 연결 시 타입을
      // 골라야 하는지) 정확히 반영하려면 이렇게 타입별로 나눠야 한다.
      // - INPUT-A: DP1.1 × 1(최대 4K×2K@30Hz — 표준 해상도 표 최댓값 3840×2160@30Hz)
      // - INPUT-B, H: 3G-SDI × 2(최대 1920×1080@60Hz)
      // - INPUT-C: HDMI1.3 × 1(최대 1920×1080@60Hz)
      // - INPUT-D~G: DVI × 4(최대 1920×1080@60Hz)
      // (각 커넥터는 옵션 카드로 다른 타입으로 교체 가능하지만, 이 프리셋은
      // 기본 출하 구성을 기준으로 한다.)
      inputs: [
        { id: 'dp1', label: 'DP1.1', maxPx: 3840 * 2160, count: 1 },
        { id: 'sdi1', label: '3G-SDI', maxPx: 1920 * 1080, count: 2 },
        { id: 'hdmi13', label: 'HDMI1.3', maxPx: 1920 * 1080, count: 1 },
        { id: 'dvi1', label: 'DVI', maxPx: 1920 * 1080, count: 4 },
      ],
      modes: {
        splicer: { maxOutputs: 4, totalMaxPx: 9200000, maxMosaicWidthPx: 15360 },
        switcher: { maxOutputs: 2, totalMaxPx: 4600000, approx: true }, // 벤더 문서 근사치("4KK")
      },
      // DVI 출력 커넥터 "한 개"(=샌딩카드 한 대와의 연결 하나)가 실제로 낼 수
      // 있는 상한 — modes의 totalMaxPx는 최대 4개 커넥터를 동시에 쓸 때의
      // 합산치라, 샌딩카드를 한두 대만 연결한 경우엔 이 값이 아니라 이 값을
      // 실제로 넘지 않는지 별도로 봐야 한다. 스펙 문서에 "커넥터 1개" 수치가
      // 따로 명시되진 않아, J6 출력 커넥터군(DVI/HDMI1.3 클래스)의 공통 지원
      // 해상도 표에서 가장 큰 값(1920×1200@60Hz)으로 근사했다 — splicer/switcher
      // 양쪽 다 totalMaxPx÷maxOutputs가 정확히 2,300,000으로 이 값과 거의
      // 일치해(반올림 차이만) 신뢰할 만하다.
      perOutputMaxPx: 1920 * 1200,
      defaultMode: 'splicer',
      note: 'DVI 영상 출력 — LED디스플레이 직결 불가, 샌딩카드 노드를 반드시 거쳐야 함',
      sourcePdf: 'J6-Seamless-Switcher-Specifications-V2.2.0.pdf',
    },
    'magnimage-ec90': {
      id: 'magnimage-ec90', vendor: 'Magnimage', name: 'MIG-EC90 Event Console', shortName: 'EC90',
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
      id: 'novastar-mctrl4k', vendor: 'NovaStar', name: 'MCTRL4K (내장 샌딩 포트)', shortName: 'MCTRL4K',
      portCount: 16, perPortMaxPx8bit: 655360, perPortMaxPx10bit: 320000,
      // 콘솔로부터 실제로 받을 수 있는 영상 신호 픽셀 상한(DP1.2/HDMI2.0
      // 8bit 표준 최대 해상도 4096×2160@60Hz) — LAN 출력 용량(portCount ×
      // perPortMaxPx8bit)과는 별개 제약이다. 이 카드는 해상도를 바꾸지 않고
      // 그대로 통과시키므로, 입력이 이 상한을 넘으면 LAN 포트 여유와 무관하게
      // 애초에 신호를 받을 수 없다.
      inputMaxPx: 4096 * 2160,
      sourcePdf: 'MCTRL4K.pdf',
    },
    'novastar-mctrl660pro': {
      id: 'novastar-mctrl660pro', vendor: 'NovaStar', name: 'MCTRL660PRO (내장 샌딩 포트)', shortName: 'MCTRL660PRO',
      portCount: 6, perPortMaxPx8bit: 655360, perPortMaxPx10bit: 325000,
      // DVI/HDMI1.4a 8bit 표준 최대 해상도(1920×1200@60Hz) — 위 MCTRL4K와
      // 같은 이유.
      inputMaxPx: 1920 * 1200,
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
