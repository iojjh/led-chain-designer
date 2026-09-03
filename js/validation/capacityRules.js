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
    // modes 없는 콘솔(EC90·EC100)은 outputs.totalMaxPx가 있으면 그걸 전체
    // 용량으로 쓴다 — EC100은 독립 MAIN 4채널이라 커넥터 1개 상한의 4배.
    // 없으면(EC90) 종전대로 커넥터 1개 상한(perOutputMaxPx)으로 폴백.
    limit = modeSpec
      ? modeSpec.totalMaxPx
      : (device.outputs.totalMaxPx || device.outputs.perOutputMaxPx);
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

// 샌딩카드 자체가 콘솔로부터 받을 수 있는 영상 신호 픽셀 상한 검사 —
// checkSendingOutput(LAN 출력 용량)과는 별개 제약이다. 샌딩카드는 들어온
// 영상을 그대로 통과시킬 뿐 해상도를 바꾸지 않으므로, 하류 LED가 요구하는
// 픽셀량이 곧 이 카드가 입력으로 받아야 하는 픽셀량과 같다. LAN 포트가
// 아무리 여유 있어도 입력 상한을 넘으면 애초에 그 신호를 받을 수 없다.
function checkSendingInput(sendingConfig, device, downstreamRequiredPx) {
  const limit = device ? device.inputMaxPx : sendingConfig.inputMaxPx;
  if (limit == null) {
    return { ok: true, message: '입력 상한 정보 없음 — 입력 용량 검증 보류', actual: downstreamRequiredPx, limit: null };
  }
  const ok = downstreamRequiredPx <= limit;
  const name = device ? device.name : '샌딩카드(수동)';
  return {
    ok,
    message: ok
      ? '샌딩카드 입력 용량 이내'
      : `필요 픽셀(${downstreamRequiredPx.toLocaleString()}px)이 ${name} 입력 상한(${limit.toLocaleString()}px)을 초과합니다`,
    actual: downstreamRequiredPx, limit,
  };
}

// 콘솔의 출력 커넥터 "한 개"(=엣지 하나, 하류 장비 한 대와의 연결)가 실제로
// 감당할 수 있는 상한 검사 — checkConsoleOutput(콘솔 전체 합산 용량)과는
// 별개 제약이다. 합산 요구량이 콘솔 전체 용량 안에 들어도, 특정 연결 하나가
// 물리적으로 커넥터 1개가 낼 수 있는 해상도를 넘어설 수 있다(예: 대형 콘솔
// 한 대에 소형 샌딩카드 한 대만 연결한 경우 — 전체 용량은 남아돌아도 그
// 커넥터 하나로는 그만한 해상도를 못 낼 수 있음).
function checkConsoleSingleOutput(device, singleDownstreamRequiredPx) {
  if (!device) {
    return { ok: true, message: '장비 미지정 — 출력 커넥터 상한 검증 보류', actual: singleDownstreamRequiredPx, limit: null };
  }
  let limit;
  if (device.outputKind === 'lan-ports') {
    limit = device.outputs.perPortMaxPx8bit;
  } else if (device.modes) {
    limit = device.perOutputMaxPx;
  } else {
    limit = device.outputs.perOutputMaxPx;
  }
  if (limit == null) {
    return { ok: true, message: '출력 커넥터 상한 정보 없음 — 검증 보류', actual: singleDownstreamRequiredPx, limit: null };
  }
  const ok = singleDownstreamRequiredPx <= limit;
  return {
    ok,
    message: ok
      ? '단일 출력 커넥터 용량 이내'
      : `이 연결의 필요 픽셀(${singleDownstreamRequiredPx.toLocaleString()}px)이 ${device.name}의 출력 커넥터 1개당 상한(${limit.toLocaleString()}px)을 초과합니다`,
    actual: singleDownstreamRequiredPx, limit,
  };
}

// LED디스플레이가 실제로 필요로 하는 LAN 포트 수(ledDesign.requiredLanPorts —
// 미연결 상태의 자동 배정이나, 샌딩카드에 연결되는 순간의 배선 개수로 갱신됨,
// nodeTypes.js/ledDesignView.js 참고)가 지금 연결된 샌딩카드(들)의 실제 포트
// 수 합계보다 많은지 검사. 픽셀 용량과는 별개로 "물리 포트 자체가 모자라
// 케이블을 다 못 꽂는" 경우를 잡는다. requiredLanPorts가 아직 0(파악된 적
// 없음)이면 판정을 보류한다.
function checkLedLanPortCount(ledDesign, availablePorts) {
  const required = ledDesign.requiredLanPorts || 0;
  if (!required) {
    return { ok: true, message: '필요 LAN 포트 수 미확인 — 검증 보류', actual: 0, limit: availablePorts };
  }
  const ok = required <= availablePorts;
  return {
    ok,
    message: ok
      ? 'LAN 포트 수 충분'
      : `이 LED디스플레이에 필요한 LAN 포트 수(${required})가 연결된 샌딩카드의 실제 포트 수(${availablePorts})보다 많습니다`,
    actual: required, limit: availablePorts,
  };
}

// 해상도별 지원 Hz 표(device.outputResolutionTable: [{w,h,hz:[...]}])에서,
// 주어진 픽셀수를 감당할 수 있는 가장 높은 Hz를 찾는다(사용자 지정 방식,
// 2026-08-26): Hz마다 그 Hz를 지원하는 표준 해상도 중 픽셀수가 가장 큰 것을
// 그 Hz의 "예산"으로 보고, 필요 픽셀수가 예산 이내인 Hz 중 최댓값을 채택한다.
// 표에 정확히 없는(커스텀) 해상도도 이 방식으로 판정한다 — 벤더 문서가 커스텀
// 해상도별 정확한 Hz를 안 주므로, 표준 해상도 픽셀수를 기준 삼는 근사다.
// 어떤 Hz로도 못 감당하면 null.
function maxHzForPx(resolutionTable, requiredPx) {
  const budgetByHz = new Map();
  resolutionTable.forEach(entry => {
    const px = entry.w * entry.h;
    entry.hz.forEach(hz => {
      budgetByHz.set(hz, Math.max(budgetByHz.get(hz) || 0, px));
    });
  });
  let best = null;
  budgetByHz.forEach((budgetPx, hz) => {
    if (requiredPx <= budgetPx && (best === null || hz > best)) { best = hz; }
  });
  return best;
}

if (typeof module !== 'undefined') {
  module.exports = {
    checkConsoleOutput, checkSendingOutput, checkSendingInput, checkConsoleSingleOutput,
    checkLedLanPortCount, maxHzForPx, FALLBACK_PER_PORT_MAX_PX,
  };
}
