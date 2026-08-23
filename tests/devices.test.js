const { DEVICES, getDevice, listDevices, getConsoleInputPorts } = require('../js/devices/devices.js');

test('getDevice returns null for unknown category/id', () => {
  expect(getDevice('console', 'nope')).toBeNull();
  expect(getDevice('nope', 'nope')).toBeNull();
});

test('console presets are limited to J6 and MIG-EC90 only', () => {
  expect(Object.keys(DEVICES.console).sort()).toEqual(['magnimage-ec90', 'novastar-j6']);
  expect(getDevice('console', 'novastar-mctrl4k')).toBeNull();
  expect(getDevice('console', 'novastar-mctrl660pro')).toBeNull();
});

test('J6 and MIG-EC90 are video-signal consoles (cannot feed led directly)', () => {
  expect(getDevice('console', 'novastar-j6').outputKind).toBe('video-signal');
  expect(getDevice('console', 'magnimage-ec90').outputKind).toBe('video-signal');
});

test('J6 splicer mode capacity matches the vendor spec', () => {
  const j6 = getDevice('console', 'novastar-j6');
  expect(j6.modes.splicer.totalMaxPx).toBe(9200000);
  expect(j6.modes.splicer.maxMosaicWidthPx).toBe(15360);
});

test('MIG-EC90 exposes its 3 categorized input connector types, each with a physical count', () => {
  const ec90 = getDevice('console', 'magnimage-ec90');
  expect(ec90.inputs.map(i => i.id)).toEqual(['hdmi1', 'dp1', 'sdi1']);
  expect(ec90.inputs.map(i => i.count)).toEqual([4, 2, 2]);
});

test('MCTRL4K and MCTRL660PRO remain available as sending-card presets', () => {
  const sendingIds = listDevices('sending').map(d => d.id);
  expect(sendingIds).toEqual(expect.arrayContaining(['novastar-mctrl4k', 'novastar-mctrl660pro']));
});

test('sending preset port caps match the vendor spec', () => {
  const mctrl4k = getDevice('sending', 'novastar-mctrl4k');
  expect(mctrl4k.portCount).toBe(16);
  expect(mctrl4k.perPortMaxPx8bit).toBe(655360);

  const mctrl660pro = getDevice('sending', 'novastar-mctrl660pro');
  expect(mctrl660pro.portCount).toBe(6);
  expect(mctrl660pro.perPortMaxPx8bit).toBe(655360);
});

test('listDevices returns an array for every known category', () => {
  expect(listDevices('console').length).toBe(Object.keys(DEVICES.console).length);
  expect(listDevices('sending').length).toBe(Object.keys(DEVICES.sending).length);
});

describe('getConsoleInputPorts', () => {
  test('device preset (MIG-EC90) expands each connector type into individually addressable slots', () => {
    // HDMI×4 + DP×2 + SDI×2 = 8개의 실제로 연결 가능한 개별 포트.
    const ports = getConsoleInputPorts({ config: { deviceId: 'magnimage-ec90' } });
    expect(ports.map(p => p.id)).toEqual([
      'hdmi1-1', 'hdmi1-2', 'hdmi1-3', 'hdmi1-4',
      'dp1-1', 'dp1-2',
      'sdi1-1', 'sdi1-2',
    ]);
    expect(ports).toHaveLength(8);
    expect(ports.find(p => p.id === 'hdmi1-1').maxPx).toBe(3840 * 2160);
    expect(ports.find(p => p.id === 'hdmi1-1').label).toBe('HDMI2.0 #1');
  });

  test('J6 exposes its actual per-connector-type breakdown (DP1.1x1 + 3G-SDIx2 + HDMI1.3x1 + DVIx4 = 8), not one generic type', () => {
    const ports = getConsoleInputPorts({ config: { deviceId: 'novastar-j6' } });
    expect(ports).toHaveLength(8);
    expect(ports.map(p => p.id)).toEqual([
      'dp1', // count:1인 타입은 번호 접미사 없이 그대로(getConsoleInputPorts 규칙)
      'sdi1-1', 'sdi1-2',
      'hdmi13',
      'dvi1-1', 'dvi1-2', 'dvi1-3', 'dvi1-4',
    ]);
    expect(ports.find(p => p.id === 'dp1').maxPx).toBe(3840 * 2160);
    expect(ports.find(p => p.id === 'dvi1-1').maxPx).toBe(1920 * 1080);
  });

  test('an unknown/removed deviceId falls back to manual mode ports', () => {
    const ports = getConsoleInputPorts({ config: { deviceId: 'novastar-mctrl4k' } });
    expect(ports.map(p => p.id)).toEqual(['in1', 'in2']);
  });

  test('manual mode defaults to 2 generic ports', () => {
    const ports = getConsoleInputPorts({ config: {} });
    expect(ports.map(p => p.id)).toEqual(['in1', 'in2']);
    expect(ports.every(p => p.maxPx === null)).toBe(true);
  });

  test('manual mode respects manualInputPorts, clamped to [1, 8]', () => {
    expect(getConsoleInputPorts({ config: { manualInputPorts: 4 } })).toHaveLength(4);
    expect(getConsoleInputPorts({ config: { manualInputPorts: 0 } })).toHaveLength(1);
    expect(getConsoleInputPorts({ config: { manualInputPorts: 99 } })).toHaveLength(8);
  });
});
