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
      // 출력 커넥터 실 구성(벤더 문서 Output/Rear Panel 표 + 사용자 확인,
      // 2026-08-26): 물리 커넥터는 총 8개(4그룹 × 메인+백업)지만 백업은 케이블
      // 이중화용 미러라 별개 목적지로 못 쓴다 — 그룹당 메인 1개, DVI1~DVI4만
      // 선택 가능한 포트로 모델링한다. splicer 모드는 이 4개를 모두 동시에
      // 하나의 모자이크 화면 출력에 쓴다.
      //
      // switcher 모드(신규 노드 기본값)는 PGM 2개(DVI1/DVI2) + AUX 1개(DVI3) —
      // 평소엔 단일 DVI로 DVI1·DVI2가 각각 독립 연결 가능하지만, 듀얼링크를
      // 켜면 그 둘의 대역폭이 DVI1 하나로 합쳐져 더 높은 해상도를 낼 수 있는
      // 대신 DVI2가 비활성화된다("dual-link 모드에선 DVI1만 남고 DVI2는
      // 비활성"이라는 벤더 문서 문구와 일치). 어느 쪽을 쓸지는 사용자가 직접
      // 고르지 않고, 콘솔에 샌딩카드가 정확히 하나만 연결돼 있을 때 그 카드가
      // 실제로 내보내는 해상도가 DVI 1개 상한(perOutputMaxPx)을 넘는지 보고
      // validationEngine.js의 resolveJ6DualLink가 자동으로 정한다
      // (node.config.dviLink: 'single'|'dual', 기본 'single').
      modes: {
        splicer: {
          totalMaxPx: 9200000, maxMosaicWidthPx: 15360,
          outputPorts: [
            { id: 'dvi1', label: 'DVI1' },
            { id: 'dvi2', label: 'DVI2' },
            { id: 'dvi3', label: 'DVI3' },
            { id: 'dvi4', label: 'DVI4' },
          ],
        },
        switcher: {
          totalMaxPx: 4600000, approx: true, // 벤더 문서 근사치("4KK")
          // aux: true인 포트만 프롬프터 노드(nodeTypes.js)에 직결할 수 있다
          // (graphOps.js의 isPairAllowed) — DVI3은 AUX 커넥터이므로 표시.
          outputPortsByDviLink: {
            single: [
              { id: 'dvi1', label: 'DVI1' },
              { id: 'dvi2', label: 'DVI2' },
              { id: 'dvi3', label: 'DVI3 (AUX)', aux: true },
            ],
            dual: [
              // 합쳐진 DVI1의 실제 상한 수치는 벤더 문서에 없어 단정하지 않고
              // null(검증 보류)로 둔다 — 애초에 단일 DVI 상한을 넘어서 듀얼링크가
              // 선택된 것이므로, 같은 상한으로 재검증하면 항상 초과로 잘못
              // 표시된다(validationEngine.js에서도 이 케이스는 커넥터 1개당
              // 상한 검증을 보류한다).
              { id: 'dvi1', label: 'DVI1', maxPx: null },
              { id: 'dvi3', label: 'DVI3 (AUX)', aux: true },
            ],
          },
        },
      },
      // DVI 출력 커넥터 1개가 실제로 낼 수 있는 상한. 스펙 문서 "Connector
      // performance" 표(DVI/HDMI1.3 공통 지원 해상도)에 명시된 최댓값
      // 1920×1200@50/60Hz — 이 값은 입출력 공용 DVI 트랜시버 등급이라 출력
      // 커넥터에도 그대로 적용된다(2026-08-26 문서 재확인으로 확정, 기존엔
      // 근사치였음).
      perOutputMaxPx: 1920 * 1200,
      // DVI/HDMI1.3(=J6 출력 커넥터군) 공통 지원 해상도·Hz 표(벤더 문서
      // "Connector performance", 2026-08-26) — maxHzForPx가 여기서 필요
      // 픽셀수를 감당하는 가장 높은 Hz를 찾는다.
      outputResolutionTable: [
        { w: 800, h: 600, hz: [50, 60, 75, 85] },
        { w: 1024, h: 768, hz: [48, 50, 60, 75, 85] },
        { w: 1152, h: 864, hz: [75] },
        { w: 1280, h: 720, hz: [48, 50, 60] },
        { w: 1280, h: 768, hz: [48, 50, 60, 75] },
        { w: 1280, h: 800, hz: [50, 60] },
        { w: 1280, h: 960, hz: [50, 60, 85] },
        { w: 1280, h: 1024, hz: [48, 50, 60, 75, 85] },
        { w: 1360, h: 768, hz: [60] },
        { w: 1364, h: 1024, hz: [48, 50, 85] },
        { w: 1366, h: 768, hz: [50, 60] },
        { w: 1366, h: 800, hz: [50, 60] },
        { w: 1400, h: 1050, hz: [48, 50, 60, 75] },
        { w: 1440, h: 900, hz: [60, 75, 85] },
        { w: 1600, h: 900, hz: [48, 50, 60] },
        { w: 1600, h: 1200, hz: [48, 50, 60] },
        { w: 1680, h: 1050, hz: [60] },
        { w: 1792, h: 1280, hz: [60] },
        { w: 1920, h: 1080, hz: [30, 48, 50, 60] },
        { w: 1920, h: 1200, hz: [50, 60] },
      ],
      defaultMode: 'switcher',
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
      // 실제 출력 채널 4개(벤더 매뉴얼 Output 표 + 기본 화면 예시, 2026-08-26
      // 재확인): PROGRAM 2채널(1/2) + AUX 2채널(3/4), 채널마다 물리 HDMI
      // 커넥터가 A/B 한 쌍씩(총 8개) 있지만 매뉴얼 원문이 "2×2 indicates
      // 2 groups of output and 2 duplicate output ports in each group"라고
      // 명시 — A/B는 같은 채널의 신호를 그대로 복제하는 케이블 이중화용이지
      // 서로 다른 목적지로 나눠 쓰는 슬롯이 아니다. 그래서 연결 가능 여부·점유
      // 판정은 채널 4개(id: pgm1/pgm2/aux1/aux2) 단위로 하되, 실제 배선 시
      // 어느 물리 잭에 꽂아야 하는지 알 수 있도록 라벨은 A 커넥터 이름
      // ("HDMI 1a" 등, 사용자 요청)으로 표기한다 — "PGM1" 같은 추상 채널명
      // 대신 후면 패널에 적힌 그대로. AUX 채널만 "(AUX)"를 붙인다.
      // "모자이크"는 A·B끼리가 아니라 채널 1+채널 2(또는 3+4)를 좌우로
      // 이어붙이는 콘솔 쪽 기능이다(기본 화면 예시: "1A 1B 2A 2B →
      // 7680×2160 LR Mosaic" — 7680=3840×2, 즉 두 채널의 폭을 합친 값).
      // 이 앱에서는 채널 1·2를 각각 다른 샌딩카드에 연결하는 것 자체가 이미
      // 자유롭게 가능하므로 별도 "모자이크 켜기" 설정을 두지 않고, 샌딩카드
      // 하나로 채널 하나의 상한을 넘는 해상도를 감당하려 할 때만
      // validationEngine.js가 "2번째 채널+샌딩카드로 나눠 모자이크로 연결"
      // 안내를 얹는다.
      outputs: {
        ports: [
          { id: 'pgm1', label: 'HDMI 1a' },
          { id: 'pgm2', label: 'HDMI 2a' },
          { id: 'aux1', label: 'HDMI 3a (AUX)', aux: true },
          { id: 'aux2', label: 'HDMI 4a (AUX)', aux: true },
        ],
        // 채널 1개(A/B 아무 쪽이든)가 "커스텀 해상도(대역폭 최적화)"로 낼 수
        // 있는 절대 상한 — 가로 최대 4352px × 세로 최대 2176px(매뉴얼
        // Output 표 AUX 행). 정확한 Hz별 상한은 outputResolutionTable 참고.
        perOutputMaxPx: 4352 * 2176,
      },
      // PROGRAM/AUX 채널 1개(단일 출력 기준)가 지원하는 고정 해상도 14종과
      // 각각의 Hz(매뉴얼 Output 표 그대로, 2026-08-26). 같은 해상도가 Hz만
      // 다르게 여러 번 나와 표를 합쳤다 — maxHzForPx가 이 표에서 "필요 픽셀수를
      // 감당하는 가장 높은 Hz"를 찾는다(사용자 지정 방식: Hz별 최대 해상도의
      // 픽셀수를 상한으로 보고 비교).
      outputResolutionTable: [
        { w: 1920, h: 1080, hz: [50, 60, 59.94] },
        { w: 4096, h: 2160, hz: [30, 50, 60] },
        { w: 3840, h: 2160, hz: [30, 50, 60] },
        { w: 1920, h: 2160, hz: [60] },
        { w: 3840, h: 1080, hz: [60] },
        { w: 3840, h: 1280, hz: [60] },
        { w: 3840, h: 2400, hz: [60] },
        { w: 1920, h: 1200, hz: [60] },
      ],
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

// 콘솔 노드가 실제로 갖는 출력 포트 목록(연결 가능 여부 판정 + 표시용) — 입력
// 포트와 대칭되는 규칙. 캔버스에는 출력 도트가 하나로 통합돼 있지만, 샌딩카드를
// 그 도트에 연결하면 interactions.js가 이 목록에서 비어있는 포트를 찾아 빈 게
// 하나면 자동으로, 여럿이면 #portPicker로 사용자가 고르게 한다. 장비 프리셋이
// 있으면 실제 출력 구성을 그대로 반영한다: J6처럼 모드별로 실제 커넥터 목록이
// 다른 장비(modes[mode].outputPorts)면 그 모드의 목록을, EC90처럼 물리 커넥터를
// 하나하나 나열해둔 장비(outputs.ports)면 그 목록을 그대로 쓴다. 수동 모드
// (장비 미지정)는 manualOutputPorts개의 범용 번호 포트를 만든다.
function getConsoleOutputPorts(node) {
  const cfg = (node && node.config) || {};
  const device = cfg.deviceId ? getDevice('console', cfg.deviceId) : null;
  if (device) {
    if (device.modes) {
      const mode = (cfg.mode && device.modes[cfg.mode]) ? cfg.mode : device.defaultMode;
      const modeSpec = device.modes[mode];
      // switcher 모드처럼 모드 하나 안에서도 듀얼링크 여부에 따라 실제
      // 커넥터 구성이 갈리는 장비는 outputPortsByDviLink에 두 목록을 각각
      // 갖고, dviLink 설정(기본 'single')으로 그중 하나를 고른다.
      const ports = modeSpec.outputPortsByDviLink
        ? modeSpec.outputPortsByDviLink[cfg.dviLink === 'dual' ? 'dual' : 'single']
        : modeSpec.outputPorts;
      return ports.map(p => (
        { id: p.id, label: p.label, kind: 'video', maxPx: p.maxPx !== undefined ? p.maxPx : device.perOutputMaxPx, aux: !!p.aux }
      ));
    }
    if (device.outputs && device.outputs.ports) {
      const kind = device.outputKind === 'video-signal' ? 'video' : 'lan';
      return device.outputs.ports.map(p => (
        { id: p.id, label: p.label, kind, maxPx: p.maxPx || device.outputs.perOutputMaxPx || null, aux: !!p.aux }
      ));
    }
    return [{ id: 'out1', label: '출력 1', kind: device.outputKind === 'video-signal' ? 'video' : 'lan', maxPx: null }];
  }
  const raw = cfg.manualOutputPorts === undefined || cfg.manualOutputPorts === null ? 2 : cfg.manualOutputPorts;
  const count = Math.max(1, Math.min(8, raw));
  const kind = cfg.outputKind === 'video-signal' ? 'video' : 'lan';
  return Array.from({ length: count }, (_, i) => (
    { id: `out${i + 1}`, label: `출력 ${i + 1}`, kind, maxPx: null }
  ));
}

// 지금은 연결할 수 없지만(getConsoleOutputPorts에 없음) 다른 설정(예: 단일
// DVI)이었다면 있었을 포트 목록 — "왜 이 포트가 안 보이는지" 속성 패널에
// 명시적으로 보여주기 위한 용도다(연결 가능 여부 판정에는 안 쓰인다). 지금은
// J6 듀얼링크로 DVI2가 사라지는 경우만 해당한다.
function getConsoleDisabledOutputPorts(node) {
  const cfg = (node && node.config) || {};
  const device = cfg.deviceId ? getDevice('console', cfg.deviceId) : null;
  if (!device || !device.modes || cfg.dviLink !== 'dual') { return []; }
  const mode = (cfg.mode && device.modes[cfg.mode]) ? cfg.mode : device.defaultMode;
  const modeSpec = device.modes[mode];
  if (!modeSpec.outputPortsByDviLink) { return []; }
  const activeIds = new Set(modeSpec.outputPortsByDviLink.dual.map(p => p.id));
  return modeSpec.outputPortsByDviLink.single.filter(p => !activeIds.has(p.id));
}

if (typeof module !== 'undefined') {
  module.exports = {
    DEVICES, getDevice, listDevices, getConsoleInputPorts, getConsoleOutputPorts, getConsoleDisabledOutputPorts,
  };
}
