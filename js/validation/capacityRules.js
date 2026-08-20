// ── capacityRules ───────────────────────────────────
// 순수 함수: 그래프 각 연결 단계별 픽셀 용량 검사.
// 장비 조회(devices.js)는 호출자(validationEngine.js)가 미리 해서 device 객체를
// 인자로 넘긴다 — 이 파일은 devices.js에 의존하지 않는 순수 계산만 담당한다.
// 반환 shape: { ok, message, actual, limit } — limit이 null이면 "판정 불가"
// (장비 미지정 등 정보 부족)를 뜻하며 실패로 취급하지 않는다.

const FALLBACK_PER_PORT_MAX_PX = 655360; // 아무 장비도 지정되지 않았을 때만 쓰는 기본값(구 MAX_PX)

// 인풋소스는 해상도를 입력받지 않으므로(사용자 요청) 입력 쪽 픽셀 용량 검사는
// 하지 않는다 — 콘솔의 "몇 개까지 받을 수 있는지"는 물리 포트 개수만으로
// 구조적으로 강제된다(graphOps.js의 포트 점유 규칙 + interactions.js의 포트
// 피커에서 빈 포트가 없으면 연결 자체를 막음).

// 콘솔 하류(샌딩카드 또는 LED 직결) 총 요구 픽셀이 콘솔 출력 용량 이내인지 검사.
// lan-ports 콘솔: 포트수 × 포트당 상한(8bit 기준)을 전체 용량으로 간주한다
// (v1은 그래프 상에서 콘솔을 물리 포트 단위로 나누지 않으므로, "완벽히 분산했을 때
// 수용 가능한가"를 보는 근사 검사다).
function checkConsoleOutput(consoleConfig, device, downstreamRequiredPx) {
  if (!device) {
    return { ok: true, message: '장비 미지정 — 출력 용량 검증 보류', actual: downstreamRequiredPx, limit: null };
  }

  let limit;
  if (device.outputKind === 'lan-ports') {
    limit = device.outputs.portCount * device.outputs.perPortMaxPx8bit;
  } else {
    const modeSpec = device.modes ? device.modes[consoleConfig.mode || device.defaultMode] : null;
    limit = modeSpec ? modeSpec.totalMaxPx : device.outputs.perOutputMaxPx;
  }

  const ok = downstreamRequiredPx <= limit;
  return {
    ok,
    message: ok
      ? '콘솔 출력 용량 이내'
      : `필요 픽셀(${downstreamRequiredPx.toLocaleString()}px)이 ${device.name} 출력 용량(${limit.toLocaleString()}px)을 초과합니다`,
    actual: downstreamRequiredPx, limit,
  };
}

// 샌딩카드 하류(LED) 총 요구 픽셀이 샌딩카드 총 출력 용량 이내인지 검사.
function checkSendingOutput(sendingConfig, device, downstreamRequiredPx) {
  const portCount = device ? device.portCount : (sendingConfig.portCount || 0);
  const perPortMaxPx = device ? device.perPortMaxPx8bit : (sendingConfig.perPortMaxPx || FALLBACK_PER_PORT_MAX_PX);
  const limit = portCount * perPortMaxPx;
  const ok = downstreamRequiredPx <= limit;
  const name = device ? device.name : '샌딩카드(수동)';
  return {
    ok,
    message: ok
      ? '샌딩카드 용량 이내'
      : `필요 픽셀(${downstreamRequiredPx.toLocaleString()}px)이 ${name} 총 용량(${limit.toLocaleString()}px)을 초과합니다`,
    actual: downstreamRequiredPx, limit,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    checkConsoleOutput, checkSendingOutput,
    FALLBACK_PER_PORT_MAX_PX,
  };
}
