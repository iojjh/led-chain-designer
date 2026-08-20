const { checkInputToConsole, checkConsoleOutput, checkSendingOutput, FALLBACK_PER_PORT_MAX_PX } = require('../js/validation/capacityRules.js');
const { getDevice } = require('../js/devices/devices.js');

const mctrl4k = getDevice('console', 'novastar-mctrl4k');
const mctrl660pro = getDevice('console', 'novastar-mctrl660pro');
const j6 = getDevice('console', 'novastar-j6');
const ec90 = getDevice('console', 'magnimage-ec90');
const sendingMctrl4k = getDevice('sending', 'novastar-mctrl4k');

describe('checkInputToConsole', () => {
  test('defers when no device is selected', () => {
    const res = checkInputToConsole({ resolutionW: 1920, resolutionH: 1080 }, null);
    expect(res.ok).toBe(true);
    expect(res.limit).toBeNull();
  });

  test('defers when device has no per-connector cap data (MCTRL660PRO)', () => {
    const res = checkInputToConsole({ resolutionW: 1920, resolutionH: 1080 }, mctrl660pro);
    expect(res.ok).toBe(true);
    expect(res.limit).toBeNull();
  });

  test('passes when resolution fits the best available connector (MCTRL4K DP/HDMI 8,800,000px)', () => {
    const res = checkInputToConsole({ resolutionW: 3840, resolutionH: 2160 }, mctrl4k); // 8,294,400px
    expect(res.ok).toBe(true);
    expect(res.limit).toBe(8800000);
  });

  test('fails when resolution exceeds every input connector cap', () => {
    const res = checkInputToConsole({ resolutionW: 8000, resolutionH: 4000 }, mctrl4k); // 32,000,000px
    expect(res.ok).toBe(false);
    expect(res.limit).toBe(8800000);
  });
});

describe('checkConsoleOutput', () => {
  test('defers when no device is selected', () => {
    const res = checkConsoleOutput({}, null, 999999999);
    expect(res.ok).toBe(true);
    expect(res.limit).toBeNull();
  });

  test('lan-ports console: ok exactly at portCount * perPortMaxPx8bit boundary', () => {
    const limit = mctrl4k.outputs.portCount * mctrl4k.outputs.perPortMaxPx8bit; // 10,400,000
    const res = checkConsoleOutput({}, mctrl4k, limit);
    expect(res.ok).toBe(true);
    expect(res.limit).toBe(limit);
  });

  test('lan-ports console: fails one pixel over the boundary', () => {
    const limit = mctrl4k.outputs.portCount * mctrl4k.outputs.perPortMaxPx8bit;
    const res = checkConsoleOutput({}, mctrl4k, limit + 1);
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
