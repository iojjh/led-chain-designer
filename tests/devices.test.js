const {
  DEVICES, getDevice, listDevices, getConsoleInputPorts, getConsoleOutputPorts, getConsoleDisabledOutputPorts,
} = require('../js/devices/devices.js');

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

describe('getConsoleOutputPorts', () => {
  test('J6 splicer mode exposes its 4 real DVI output connectors (DVI1-DVI4)', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'splicer' } });
    expect(ports.map(p => p.id)).toEqual(['dvi1', 'dvi2', 'dvi3', 'dvi4']);
    expect(ports.map(p => p.label)).toEqual(['DVI1', 'DVI2', 'DVI3', 'DVI4']);
    expect(ports.every(p => p.maxPx === 1920 * 1200)).toBe(true);
  });

  test('J6 switcher mode (single DVI, default) exposes PGM DVI1/DVI2 + AUX DVI3', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher' } });
    expect(ports.map(p => p.id)).toEqual(['dvi1', 'dvi2', 'dvi3']);
    expect(ports.find(p => p.id === 'dvi3').label).toBe('DVI3 (AUX)');
    expect(ports.every(p => p.maxPx === 1920 * 1200)).toBe(true);
  });

  test('J6 switcher mode + dual-link drops DVI2, leaves DVI1 with an unconfirmed (null) cap', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher', dviLink: 'dual' } });
    expect(ports.map(p => p.id)).toEqual(['dvi1', 'dvi3']);
    expect(ports.find(p => p.id === 'dvi1').maxPx).toBeNull();
  });

  test('J6 with no mode set falls back to its defaultMode (now switcher, single DVI: 3 outputs)', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6' } });
    expect(ports).toHaveLength(3);
  });

  test('only J6\'s AUX connector (DVI3) is flagged aux — PGM connectors are not', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher' } });
    expect(ports.find(p => p.id === 'dvi1').aux).toBe(false);
    expect(ports.find(p => p.id === 'dvi2').aux).toBe(false);
    expect(ports.find(p => p.id === 'dvi3').aux).toBe(true);
  });

  test('EC90 exposes 4 logical output channels (PGM1/PGM2/AUX1/AUX2) — A/B are duplicate backups, not separate ports', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec90' } });
    expect(ports.map(p => p.id)).toEqual(['pgm1', 'pgm2', 'aux1', 'aux2']);
    expect(ports.every(p => p.maxPx === 4352 * 2176)).toBe(true);
  });

  test('EC90 labels use the real physical connector name (HDMI Na) and mark AUX channels only', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec90' } });
    expect(ports.find(p => p.id === 'pgm1').label).toBe('HDMI 1a');
    expect(ports.find(p => p.id === 'pgm1').aux).toBe(false);
    expect(ports.find(p => p.id === 'aux1').label).toBe('HDMI 3a (AUX)');
    expect(ports.find(p => p.id === 'aux1').aux).toBe(true);
  });

  test('manual mode defaults to 2 generic output ports matching outputKind', () => {
    const lan = getConsoleOutputPorts({ config: { outputKind: 'lan-ports' } });
    expect(lan.map(p => p.id)).toEqual(['out1', 'out2']);
    expect(lan.every(p => p.kind === 'lan')).toBe(true);

    const video = getConsoleOutputPorts({ config: { outputKind: 'video-signal' } });
    expect(video.every(p => p.kind === 'video')).toBe(true);
  });

  test('manual mode respects manualOutputPorts, clamped to [1, 8]', () => {
    expect(getConsoleOutputPorts({ config: { manualOutputPorts: 3 } })).toHaveLength(3);
    expect(getConsoleOutputPorts({ config: { manualOutputPorts: 0 } })).toHaveLength(1);
    expect(getConsoleOutputPorts({ config: { manualOutputPorts: 99 } })).toHaveLength(8);
  });
});

describe('getConsoleDisabledOutputPorts', () => {
  test('J6 switcher + dual-link reports DVI2 as explicitly unavailable', () => {
    const disabled = getConsoleDisabledOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher', dviLink: 'dual' } });
    expect(disabled.map(p => p.id)).toEqual(['dvi2']);
  });

  test('J6 switcher in single-DVI mode has nothing disabled', () => {
    expect(getConsoleDisabledOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher' } })).toEqual([]);
  });

  test('devices without a dviLink concept (EC90, manual mode) never report disabled ports', () => {
    expect(getConsoleDisabledOutputPorts({ config: { deviceId: 'magnimage-ec90' } })).toEqual([]);
    expect(getConsoleDisabledOutputPorts({ config: {} })).toEqual([]);
  });
});
