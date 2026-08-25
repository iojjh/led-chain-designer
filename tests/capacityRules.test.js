const {
  checkConsoleOutput, checkSendingOutput, checkSendingInput, checkConsoleSingleOutput,
  checkLedLanPortCount, FALLBACK_PER_PORT_MAX_PX,
} = require('../js/validation/capacityRules.js');
const { getDevice } = require('../js/devices/devices.js');

const j6 = getDevice('console', 'novastar-j6');
const ec90 = getDevice('console', 'magnimage-ec90');
const sendingMctrl4k = getDevice('sending', 'novastar-mctrl4k');
const sendingMctrl660pro = getDevice('sending', 'novastar-mctrl660pro');

describe('checkConsoleOutput', () => {
  test('defers when no device is selected', () => {
    const res = checkConsoleOutput({}, null, 999999999);
    expect(res.ok).toBe(true);
    expect(res.limit).toBeNull();
  });

  test('lan-ports console: ok exactly at portCount * perPortMaxPx8bit boundary', () => {
    // 콘솔 프리셋 목록에는 더 이상 lan-ports 장비가 없지만(EC90/J6은 둘 다
    // video-signal), 수동 모드에서는 여전히 lan-ports를 선택할 수 있으므로
    // 이 코드 경로는 합성 fixture로 계속 검증한다.
    const synthetic = { name: '테스트콘솔', outputKind: 'lan-ports', outputs: { portCount: 10, perPortMaxPx8bit: 500000 } };
    const limit = synthetic.outputs.portCount * synthetic.outputs.perPortMaxPx8bit; // 5,000,000
    const res = checkConsoleOutput({}, synthetic, limit);
    expect(res.ok).toBe(true);
    expect(res.limit).toBe(limit);
  });

  test('lan-ports console: fails one pixel over the boundary', () => {
    const synthetic = { name: '테스트콘솔', outputKind: 'lan-ports', outputs: { portCount: 10, perPortMaxPx8bit: 500000 } };
    const limit = synthetic.outputs.portCount * synthetic.outputs.perPortMaxPx8bit;
    const res = checkConsoleOutput({}, synthetic, limit + 1);
    expect(res.ok).toBe(false);
  });

  test('video-signal console (J6): splicer mode uses the vendor totalMaxPx', () => {
    const res = checkConsoleOutput({ mode: 'splicer' }, j6, 9200000);
    expect(res.ok).toBe(true);
    expect(res.limit).toBe(9200000);

    const over = checkConsoleOutput({ mode: 'splicer' }, j6, 9200001);
    expect(over.ok).toBe(false);
  });

  test('video-signal console (J6): switcher mode has a smaller cap than splicer', () => {
    const res = checkConsoleOutput({ mode: 'switcher' }, j6, 5000000);
    expect(res.ok).toBe(false);
    expect(res.limit).toBe(4600000);
  });

  test('video-signal console without modes (MIG-EC90) uses perOutputMaxPx', () => {
    const limit = ec90.outputs.perOutputMaxPx;
    expect(checkConsoleOutput({}, ec90, limit).ok).toBe(true);
    expect(checkConsoleOutput({}, ec90, limit + 1).ok).toBe(false);
  });
});

describe('checkSendingOutput', () => {
  test('manual mode falls back to FALLBACK_PER_PORT_MAX_PX when perPortMaxPx is unset', () => {
    const res = checkSendingOutput({ portCount: 1 }, null, FALLBACK_PER_PORT_MAX_PX);
    expect(res.ok).toBe(true);
    expect(res.limit).toBe(FALLBACK_PER_PORT_MAX_PX);
  });

  test('device preset (MCTRL4K as sending) uses its own port count and per-port cap', () => {
    const limit = sendingMctrl4k.portCount * sendingMctrl4k.perPortMaxPx8bit;
    expect(checkSendingOutput({}, sendingMctrl4k, limit).ok).toBe(true);
    expect(checkSendingOutput({}, sendingMctrl4k, limit + 1).ok).toBe(false);
  });
});

describe('checkSendingInput', () => {
  test('defers when neither the device nor manual config has an inputMaxPx', () => {
    const res = checkSendingInput({}, null, 999999999);
    expect(res.ok).toBe(true);
    expect(res.limit).toBeNull();
  });

  test('manual mode uses the user-entered inputMaxPx', () => {
    const res = checkSendingInput({ inputMaxPx: 1000000 }, null, 1000001);
    expect(res.ok).toBe(false);
    expect(res.limit).toBe(1000000);
  });

  test('MCTRL660PRO device preset: input cap is its own DVI/HDMI max (1920x1200), independent of its larger LAN output capacity', () => {
    const limit = sendingMctrl660pro.inputMaxPx;
    expect(limit).toBe(1920 * 1200);
    expect(checkSendingInput({}, sendingMctrl660pro, limit).ok).toBe(true);
    expect(checkSendingInput({}, sendingMctrl660pro, limit + 1).ok).toBe(false);

    // 이 카드의 LAN 출력 용량(6포트 × 포트당 상한)은 입력 상한보다 훨씬 크므로,
    // LAN 쪽은 통과해도(checkSendingOutput) 입력 쪽에서 걸릴 수 있다 — 이게
    // 이 검사를 새로 추가한 이유(대화에서 발견한 실제 병목).
    const overInputButUnderLan = limit + 1;
    expect(checkSendingOutput({}, sendingMctrl660pro, overInputButUnderLan).ok).toBe(true);
    expect(checkSendingInput({}, sendingMctrl660pro, overInputButUnderLan).ok).toBe(false);
  });
});

describe('checkConsoleSingleOutput', () => {
  test('defers when no device is selected', () => {
    const res = checkConsoleSingleOutput(null, 999999999);
    expect(res.ok).toBe(true);
    expect(res.limit).toBeNull();
  });

  test('J6 (video-signal, has modes): per-connector cap is much smaller than the splicer-mode aggregate cap', () => {
    const limit = j6.perOutputMaxPx;
    expect(limit).toBe(1920 * 1200);
    expect(checkConsoleSingleOutput(j6, limit).ok).toBe(true);
    expect(checkConsoleSingleOutput(j6, limit + 1).ok).toBe(false);

    // 실제 대화에서 나온 시나리오: J6 하나에 660PRO 한 대만 연결하면, 콘솔
    // 전체 합산 용량(9.2M) 검사는 통과해도 커넥터 1개 상한(2,304,000)에서 걸린다.
    const aBigButStillUnderAggregate = 5000000;
    expect(checkConsoleOutput({ mode: 'splicer' }, j6, aBigButStillUnderAggregate).ok).toBe(true);
    expect(checkConsoleSingleOutput(j6, aBigButStillUnderAggregate).ok).toBe(false);
  });

  test('EC90 (video-signal, no modes): reuses outputs.perOutputMaxPx', () => {
    const limit = ec90.outputs.perOutputMaxPx;
    expect(checkConsoleSingleOutput(ec90, limit).ok).toBe(true);
    expect(checkConsoleSingleOutput(ec90, limit + 1).ok).toBe(false);
  });

  test('lan-ports console: reuses outputs.perPortMaxPx8bit as the single-connector cap', () => {
    const synthetic = { name: '테스트콘솔', outputKind: 'lan-ports', outputs: { portCount: 10, perPortMaxPx8bit: 500000 } };
    expect(checkConsoleSingleOutput(synthetic, 500000).ok).toBe(true);
    expect(checkConsoleSingleOutput(synthetic, 500001).ok).toBe(false);
  });
});

describe('checkLedLanPortCount', () => {
  test('defers when requiredLanPorts has never been determined (0)', () => {
    const res = checkLedLanPortCount({ requiredLanPorts: 0 }, 16);
    expect(res.ok).toBe(true);
    expect(res.limit).toBe(16);
  });

  test('ok when the connected sending card(s) have enough ports', () => {
    expect(checkLedLanPortCount({ requiredLanPorts: 10 }, 16).ok).toBe(true);
    expect(checkLedLanPortCount({ requiredLanPorts: 16 }, 16).ok).toBe(true); // 경계값
  });

  test('fails when required ports exceed what is actually connected', () => {
    const res = checkLedLanPortCount({ requiredLanPorts: 10 }, sendingMctrl660pro.portCount);
    expect(res.ok).toBe(false);
    expect(res.actual).toBe(10);
    expect(res.limit).toBe(sendingMctrl660pro.portCount);
  });
});
