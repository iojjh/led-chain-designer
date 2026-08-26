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
      // 2026-08-26): 물리 커넥터는 총 8개(4그룹 × 메인+백업). 벤더 문서는
      // 백업을 케이블 이중화 목적으로 설명하지만, EC90/EC100과 마찬가지로
      // 같은 신호의 미러라 "같은 화면을 두 군데로 동시에" 내보내는 용도로도
      // 그대로 쓸 수 있어(사용자 확인) 메인(dvi1~dvi4)과 백업(dvi1b~dvi4b)을
      // 각각 독립 연결 가능한 포트로 둔다 — 벤더 문서엔 백업 커넥터의 공식
      // 이름이 없어 라벨은 "DVI1 (백업)"처럼 설명적으로 붙인다. splicer
      // 모드는 이 8개를 모두 동시에 하나의 모자이크 화면 출력에 쓴다.
      //
      // switcher 모드(신규 노드 기본값)는 PGM 2조(DVI1/DVI2, 각각 메인+백업)
      // + AUX 1조(DVI3, 메인+백업) — 평소엔 단일 DVI로 DVI1·DVI2가 각각
      // 독립 연결 가능하지만, 듀얼링크를 켜면 그 둘의 대역폭이 DVI1(메인+
      // 백업) 하나로 합쳐져 더 높은 해상도를 낼 수 있는 대신 DVI2(메인+백업)가
      // 비활성화된다("dual-link 모드에선 DVI1만 남고 DVI2는 비활성"이라는
      // 벤더 문서 문구와 일치). 어느 쪽을 쓸지는 사용자가 직접 고르지 않고,
      // 콘솔에 샌딩카드가 정확히 하나만 연결돼 있을 때 그 카드가 실제로
      // 내보내는 해상도가 DVI 1개 상한(perOutputMaxPx)을 넘는지 보고
      // validationEngine.js의 resolveJ6DualLink가 자동으로 정한다
      // (node.config.dviLink: 'single'|'dual', 기본 'single').
      modes: {
        splicer: {
          totalMaxPx: 9200000, maxMosaicWidthPx: 15360,
          outputPorts: [
            { id: 'dvi1', label: 'DVI1', mirror: 'dvi1' },
            { id: 'dvi1b', label: 'DVI1 (백업)', mirror: 'dvi1' },
            { id: 'dvi2', label: 'DVI2', mirror: 'dvi2' },
            { id: 'dvi2b', label: 'DVI2 (백업)', mirror: 'dvi2' },
            { id: 'dvi3', label: 'DVI3', mirror: 'dvi3' },
            { id: 'dvi3b', label: 'DVI3 (백업)', mirror: 'dvi3' },
            { id: 'dvi4', label: 'DVI4', mirror: 'dvi4' },
            { id: 'dvi4b', label: 'DVI4 (백업)', mirror: 'dvi4' },
          ],
        },
        switcher: {
          totalMaxPx: 4600000, approx: true, // 벤더 문서 근사치("4KK")
          // aux: true인 포트만 프롬프터 노드(nodeTypes.js)에 직결할 수 있다
          // (graphOps.js의 isPairAllowed) — DVI3은 AUX 커넥터이므로 표시.
          // mirror: 같은 값을 가진 포트끼리는 같은 신호의 미러(메인/백업)라는
          // 뜻 — graphOps.js의 mirrorPortConflict가 "한 LED를 나눠 담당하는
          // 샌딩카드 두 대가 같은 미러 쌍에서 나온 동일 신호를 받는" 잘못된
          // 배선을 막는 데 쓴다(서로 다른 화면을 내야 하는데 미러는 항상
          // 같은 신호이므로 — 사용자 확인, 2026-08-26).
          outputPortsByDviLink: {
            single: [
              { id: 'dvi1', label: 'DVI1', mirror: 'dvi1' },
              { id: 'dvi1b', label: 'DVI1 (백업)', mirror: 'dvi1' },
              { id: 'dvi2', label: 'DVI2', mirror: 'dvi2' },
              { id: 'dvi2b', label: 'DVI2 (백업)', mirror: 'dvi2' },
              { id: 'dvi3', label: 'DVI3 (AUX)', aux: true, mirror: 'dvi3' },
              { id: 'dvi3b', label: 'DVI3 (백업, AUX)', aux: true, mirror: 'dvi3' },
            ],
            dual: [
              // 합쳐진 DVI1의 실제 상한 수치는 벤더 문서에 없어 단정하지 않고
              // null(검증 보류)로 둔다 — 애초에 단일 DVI 상한을 넘어서 듀얼링크가
              // 선택된 것이므로, 같은 상한으로 재검증하면 항상 초과로 잘못
              // 표시된다(validationEngine.js에서도 이 케이스는 커넥터 1개당
              // 상한 검증을 보류한다).
              { id: 'dvi1', label: 'DVI1', maxPx: null, mirror: 'dvi1' },
              { id: 'dvi1b', label: 'DVI1 (백업)', maxPx: null, mirror: 'dvi1' },
              { id: 'dvi3', label: 'DVI3 (AUX)', aux: true, mirror: 'dvi3' },
              { id: 'dvi3b', label: 'DVI3 (백업, AUX)', aux: true, mirror: 'dvi3' },
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
      // 커넥터가 A/B 한 쌍씩(총 8개) 있다. 매뉴얼 원문은 "2×2 indicates
      // 2 groups of output and 2 duplicate output ports in each group"라고
      // 설명하지만(케이블 이중화 목적), 같은 신호를 그대로 복제하는 것이므로
      // A·B 각각에 서로 다른 케이블을 꽂아 "같은 화면을 두 군데로 동시에
      // 내보내는" 용도로도 그대로 쓸 수 있다(사용자 확인, 2026-08-26) — 그래서
      // A(id 그대로: pgm1/pgm2/aux1/aux2)와 B(id에 'b' 접미사: pgm1b 등)를
      // 각각 독립적으로 연결 가능한 포트로 둔다. 둘 다 같은 신호의 미러라
      // maxPx·kind는 동일하고 라벨의 "1a"/"1b"만 실제 후면 패널 커넥터 이름과
      // 맞춘다. AUX 채널만 "(AUX)"를 붙인다.
      // "모자이크"는 A·B끼리가 아니라 채널 1+채널 2(또는 3+4)를 좌우로
      // 이어붙이는 콘솔 쪽 기능이다(기본 화면 예시: "1A 1B 2A 2B →
      // 7680×2160 LR Mosaic" — 7680=3840×2, 즉 두 채널의 폭을 합친 값).
      // 이 앱에서는 채널 1·2를 각각 다른 샌딩카드에 연결하는 것 자체가 이미
      // 자유롭게 가능하므로 별도 "모자이크 켜기" 설정을 두지 않고, 샌딩카드
      // 하나로 채널 하나의 상한을 넘는 해상도를 감당하려 할 때만
      // validationEngine.js가 "2번째 채널+샌딩카드로 나눠 모자이크로 연결"
      // 안내를 얹는다.
      outputs: {
        // mirror: 같은 값이면 같은 신호의 미러(메인/백업)라는 뜻 —
        // graphOps.js의 mirrorPortConflict가 이걸로 "한 LED를 나눠 담당하는
        // 샌딩카드 두 대가 같은 미러 쌍에서 나온 동일 신호를 받는" 잘못된
        // 배선(서로 다른 화면을 내야 하는데 미러는 항상 같은 신호이므로)을
        // 막는다.
        ports: [
          { id: 'pgm1', label: 'HDMI 1a', mirror: 'pgm1' },
          { id: 'pgm1b', label: 'HDMI 1b', mirror: 'pgm1' },
          { id: 'pgm2', label: 'HDMI 2a', mirror: 'pgm2' },
          { id: 'pgm2b', label: 'HDMI 2b', mirror: 'pgm2' },
          { id: 'aux1', label: 'HDMI 3a (AUX)', aux: true, mirror: 'aux1' },
          { id: 'aux1b', label: 'HDMI 3b (AUX)', aux: true, mirror: 'aux1' },
          { id: 'aux2', label: 'HDMI 4a (AUX)', aux: true, mirror: 'aux2' },
          { id: 'aux2b', label: 'HDMI 4b (AUX)', aux: true, mirror: 'aux2' },
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
    'magnimage-ec100': {
      id: 'magnimage-ec100', vendor: 'Magnimage', name: 'MIG-EC100 Event Controller', shortName: 'EC100',
      outputKind: 'video-signal',
      // 입력 12개는 커넥터 타입별로 번호가 이어지지 않고 실제 후면 패널
      // 순서대로 섞여 있다(벤더 매뉴얼 기본 화면/Input Ports List 스크린샷,
      // 2026-08-26): 1~4·9~12는 HDMI2.0/DP1.2 겸용, 5·7은 12G-SDI, 6·8은
      // HDMI1.4 — "입력 5"라고 하면 실제로 SDI 슬롯이라는 뜻이 되도록 물리
      // 슬롯 번호 그대로 나열한다(device.inputs의 타입별 count 방식으로는
      // 이 섞인 순서를 못 담아 inputSlots을 따로 씀 — getConsoleInputPorts
      // 참고).
      inputSlots: [
        { id: 'in1', label: '입력 1 (HDMI2.0/DP1.2)', maxPx: 7680 * 3840 },
        { id: 'in2', label: '입력 2 (HDMI2.0/DP1.2)', maxPx: 7680 * 3840 },
        { id: 'in3', label: '입력 3 (HDMI2.0/DP1.2)', maxPx: 7680 * 3840 },
        { id: 'in4', label: '입력 4 (HDMI2.0/DP1.2)', maxPx: 7680 * 3840 },
        { id: 'in5', label: '입력 5 (12G-SDI)', maxPx: 3840 * 2160 },
        { id: 'in6', label: '입력 6 (HDMI1.4)', maxPx: 4094 * 3840 },
        { id: 'in7', label: '입력 7 (12G-SDI)', maxPx: 3840 * 2160 },
        { id: 'in8', label: '입력 8 (HDMI1.4)', maxPx: 4094 * 3840 },
        { id: 'in9', label: '입력 9 (HDMI2.0/DP1.2)', maxPx: 7680 * 3840 },
        { id: 'in10', label: '입력 10 (HDMI2.0/DP1.2)', maxPx: 7680 * 3840 },
        { id: 'in11', label: '입력 11 (HDMI2.0/DP1.2)', maxPx: 7680 * 3840 },
        { id: 'in12', label: '입력 12 (HDMI2.0/DP1.2)', maxPx: 7680 * 3840 },
      ],
      // 출력은 서로 독립적인 두 그룹으로 나뉜다(EC100은 J6/EC90과 달리 콘솔
      // 전체를 하나의 "모드"로 전환하는 게 아니라, MAIN은 항상 고정, AUX만
      // 별도 모드가 있다) — getConsoleOutputPorts가 이 outputGroups 형태를
      // 읽어 group마다 fixed 목록 또는 configKey로 고른 byValue 목록을 이어
      // 붙인다.
      // - MAIN: 항상 4채널(main1~4), 물리 커넥터 이름 그대로 "1a"~"4a"로
      //   표기한다(사용자 요청) — 각 채널마다 실제로는 HDMI 메인(a)+백업(b)
      //   커넥터 한 쌍(총 8개, "PGM HDMI 4조")과 대응하는 10G OPT 커넥터가
      //   있다. EC90과 마찬가지로 b는 a와 같은 신호의 미러라 "같은 화면을
      //   두 군데로 동시에" 내보내는 용도로 독립 연결 가능한 포트로 둔다
      //   (id는 'b' 접미사: main1b 등, 사용자 확인 2026-08-26). OPT는 이
      //   앱이 다루는 HDMI/DVI 계열 커넥터가 아니라 별도 모델링하지 않는다.
      //   (참고: main1·main2는 해상도를 공유해야 하고 main3·main4도
      //   마찬가지라는 하드웨어 제약이 있지만, 이 앱은 채널 간 해상도 일치
      //   여부를 검증하지 않는다 — 연결 가능 여부만 다룬다.)
      // - AUX: "AUX HDMI 4개"로, A/B 페어링 없이 커넥터 이름 그대로
      //   AUX1~AUX4(사용자 요청 — PGM처럼 굳이 "a"를 붙이지 않음). 다만
      //   config.auxMode(기본 'switcher')에 따라 실제 채널 구성 자체는
      //   갈린다: switcher 모드는 AUX1↔AUX2가 한 쌍, AUX3↔AUX4가 다른 한
      //   쌍으로 묶여 서로 "복제"한다(매뉴얼: "AUX Switcher Mode: Supports
      //   2 independent ... AUX outputs. AUX1/AUX2 can copy each other").
      //   "복제"는 EC90/J6의 메인/백업 A·B와 같은 성격 — 두 커넥터가 항상
      //   같은 신호를 내보내므로, 각각 다른 목적지에 연결해 "같은 화면을
      //   두 군데로 동시에" 내보낼 수 있다(사용자 확인, 2026-08-26). 그래서
      //   aux1/aux2를 하나로 합친 채널(예전의 aux12)이 아니라 각각 독립
      //   연결 가능한 포트로 두되, mirror 필드로 "같은 신호"임을 표시해
      //   graphOps.js의 mirrorPortConflict가 오용(한 LED를 나눠 담당하는
      //   샌딩카드 두 대에 이 둘을 각각 연결 — 서로 달라야 할 화면이 똑같이
      //   나옴)을 막게 한다. mosaic 모드는 4개(aux1~aux4)가 전부 진짜
      //   독립적(서로 다른 화면 가능)이라 mirror가 없다(매뉴얼: "AUX Mosaic
      //   Mode: Supports 4 independent ... outputs").
      outputGroups: [
        {
          fixed: [
            { id: 'main1', label: 'HDMI 1a', maxPx: 7680 * 3840, mirror: 'main1' },
            { id: 'main1b', label: 'HDMI 1b', maxPx: 7680 * 3840, mirror: 'main1' },
            { id: 'main2', label: 'HDMI 2a', maxPx: 7680 * 3840, mirror: 'main2' },
            { id: 'main2b', label: 'HDMI 2b', maxPx: 7680 * 3840, mirror: 'main2' },
            { id: 'main3', label: 'HDMI 3a', maxPx: 7680 * 3840, mirror: 'main3' },
            { id: 'main3b', label: 'HDMI 3b', maxPx: 7680 * 3840, mirror: 'main3' },
            { id: 'main4', label: 'HDMI 4a', maxPx: 7680 * 3840, mirror: 'main4' },
            { id: 'main4b', label: 'HDMI 4b', maxPx: 7680 * 3840, mirror: 'main4' },
          ],
        },
        {
          configKey: 'auxMode', default: 'switcher',
          byValue: {
            switcher: [
              { id: 'aux1', label: 'AUX1', aux: true, maxPx: 1920 * 1080, mirror: 'aux1' },
              { id: 'aux2', label: 'AUX2', aux: true, maxPx: 1920 * 1080, mirror: 'aux1' },
              { id: 'aux3', label: 'AUX3', aux: true, maxPx: 1920 * 1080, mirror: 'aux3' },
              { id: 'aux4', label: 'AUX4', aux: true, maxPx: 1920 * 1080, mirror: 'aux3' },
            ],
            mosaic: [
              { id: 'aux1', label: 'AUX1', aux: true, maxPx: 1920 * 1080 },
              { id: 'aux2', label: 'AUX2', aux: true, maxPx: 1920 * 1080 },
              { id: 'aux3', label: 'AUX3', aux: true, maxPx: 1920 * 1080 },
              { id: 'aux4', label: 'AUX4', aux: true, maxPx: 1920 * 1080 },
            ],
          },
        },
      ],
      // capacityRules.js의 checkConsoleOutput/checkConsoleSingleOutput은
      // (device.modes가 없는 장비 한정) 이 flat 값을 총 용량·커넥터 1개당
      // 상한 양쪽에 그대로 쓴다 — EC90과 같은 근사(실제로는 채널이 여럿이라
      // 총 용량이 더 크지만, 이 앱은 아직 그 정밀도까지 검증하지 않는다).
      outputs: { perOutputMaxPx: 7680 * 3840 },
      // MAIN 출력의 고정 해상도 2종(벤더 매뉴얼 Output 표, 2026-08-26) — 이
      // 콘솔은 J6/EC90과 달리 H/V/FPS를 각각 자유롭게 입력하는 진짜 커스텀
      // 타이밍(23~241Hz 범위)을 지원해 표로 딱 떨어지지 않지만, 정확한 대역폭
      // 공식이 문서에 없어 문서에 명시된 두 해상도만 표로 남긴다 — 그 외
      // 해상도의 Hz 판정은 이 표만으로는 보수적으로 나올 수 있다.
      outputResolutionTable: [
        { w: 3840, h: 2400, hz: [60] },
        { w: 7680, h: 1200, hz: [60] },
      ],
      note: 'HDMI/OPT 영상 출력 — LED디스플레이 직결 불가, 샌딩카드 노드를 반드시 거쳐야 함',
      sourcePdf: 'MIG-EC100 Event Controller User Manual V1.1.pdf',
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
// 입력 커넥터 구성을 그대로 포트로 쓴다: 커넥터 타입별로 번호가 이어지는
// 장비(device.inputs[].count — 예: HDMI×4가 전부 붙어 있음)는 그 수만큼 개별
// 슬롯(hdmi1-1, hdmi1-2, …)으로 펼치고, EC100처럼 물리 슬롯 번호에 커넥터
// 타입이 섞여 배치된 장비(device.inputSlots — 실제 후면 패널 번호 순서 그대로)는
// 그 목록을 그대로 쓴다. 어느 쪽이든 "HDMI 포트가 4개면 인풋소스 4개가 동시에
// HDMI로 연결될 수 있다"는 실제 배선과 일치시키기 위함. 수동 모드(장비 미지정)는
// 사용자가 지정한 개수(manualInputPorts)만큼 이름 없는 범용 포트를 만든다.
function getConsoleInputPorts(node) {
  const cfg = (node && node.config) || {};
  const device = cfg.deviceId ? getDevice('console', cfg.deviceId) : null;
  if (device) {
    if (device.inputSlots) {
      return device.inputSlots.map(p => ({ id: p.id, label: p.label, kind: 'video', maxPx: p.maxPx }));
    }
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
// 있으면 실제 출력 구성을 그대로 반영한다: J6처럼 콘솔 전체가 모드 하나로
// 전환되는 장비(modes[mode].outputPorts)면 그 모드의 목록을, EC100처럼 출력이
// 서로 독립적인 그룹으로 나뉘는 장비(outputGroups — 그룹마다 고정 목록이거나
// config 값에 따라 갈리는 목록)면 그룹들을 이어붙인 목록을, EC90처럼 물리
// 커넥터를 하나하나 나열해둔 장비(outputs.ports)면 그 목록을 그대로 쓴다.
// 수동 모드(장비 미지정)는 manualOutputPorts개의 범용 번호 포트를 만든다.
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
        { id: p.id, label: p.label, kind: 'video', maxPx: p.maxPx !== undefined ? p.maxPx : device.perOutputMaxPx, aux: !!p.aux, mirror: p.mirror || null }
      ));
    }
    if (device.outputGroups) {
      return device.outputGroups.flatMap(group => {
        const list = group.fixed || group.byValue[cfg[group.configKey] || group.default];
        return list.map(p => (
          { id: p.id, label: p.label, kind: 'video', maxPx: p.maxPx !== undefined ? p.maxPx : device.perOutputMaxPx, aux: !!p.aux, mirror: p.mirror || null }
        ));
      });
    }
    if (device.outputs && device.outputs.ports) {
      const kind = device.outputKind === 'video-signal' ? 'video' : 'lan';
      return device.outputs.ports.map(p => (
        { id: p.id, label: p.label, kind, maxPx: p.maxPx || device.outputs.perOutputMaxPx || null, aux: !!p.aux, mirror: p.mirror || null }
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
