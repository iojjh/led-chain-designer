const { checkConsoleOutput, checkSendingOutput, FALLBACK_PER_PORT_MAX_PX } = require('../js/validation/capacityRules.js');
const { getDevice } = require('../js/devices/devices.js');

const j6 = getDevice('console', 'novastar-j6');
const ec90 = getDevice('console', 'magnimage-ec90');
const sendingMctrl4k = getDevice('sending', 'novastar-mctrl4k');

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
