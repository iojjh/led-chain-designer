const {
  DEVICES, getDevice, listDevices, getConsoleInputPorts, getConsoleOutputPorts, getConsoleDisabledOutputPorts,
} = require('../js/devices/devices.js');

test('getDevice returns null for unknown category/id', () => {
  expect(getDevice('console', 'nope')).toBeNull();
  expect(getDevice('nope', 'nope')).toBeNull();
});

test('console presets are limited to J6, MIG-EC90 and MIG-EC100 only', () => {
  expect(Object.keys(DEVICES.console).sort()).toEqual(['magnimage-ec100', 'magnimage-ec90', 'novastar-j6']);
  expect(getDevice('console', 'novastar-mctrl4k')).toBeNull();
  expect(getDevice('console', 'novastar-mctrl660pro')).toBeNull();
});

test('J6, MIG-EC90 and MIG-EC100 are all video-signal consoles (cannot feed led directly)', () => {
  expect(getDevice('console', 'novastar-j6').outputKind).toBe('video-signal');
  expect(getDevice('console', 'magnimage-ec90').outputKind).toBe('video-signal');
  expect(getDevice('console', 'magnimage-ec100').outputKind).toBe('video-signal');
});

test('J6 splicer mode capacity matches the vendor spec', () => {
  const j6 = getDevice('console', 'novastar-j6');
  expect(j6.modes.splicer.totalMaxPx).toBe(9200000);
  expect(j6.modes.splicer.maxMosaicWidthPx).toBe(15360);
});

test('MIG-EC100 MAIN output capacity reflects the vendor spec (per-connector vs 4-channel total)', () => {
  const ec100 = getDevice('console', 'magnimage-ec100');
  // 커넥터 1개 @60Hz 실효 상한 = 7680×1200 = 3840×2400 = 9,216,000px
  expect(ec100.outputs.perOutputMaxPx).toBe(7680 * 1200);
  // 독립 MAIN 4채널 → 전체 용량은 커넥터 1개 상한의 4배
  expect(ec100.outputs.totalMaxPx).toBe(4 * 7680 * 1200);
  // 기하학적 변 상한(기록용)
  expect(ec100.outputs.perOutputMaxWidth).toBe(7680);
  expect(ec100.outputs.perOutputMaxHeight).toBe(3840);
  expect(ec100.outputs.maxMosaicWidthPx).toBe(30720);
  expect(ec100.outputs.maxMosaicHeightPx).toBe(15360);
  // MAIN 포트 목록의 커넥터별 maxPx도 같은 값
  const mainPorts = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec100' } }).filter(p => p.id.startsWith('main'));
  expect(mainPorts.every(p => p.maxPx === 7680 * 1200)).toBe(true);
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

  test('EC100 exposes its 12 input slots in real physical order (1-4 & 9-12 HDMI/DP, 5 & 7 SDI, 6 & 8 HDMI1.4)', () => {
    const ports = getConsoleInputPorts({ config: { deviceId: 'magnimage-ec100' } });
    expect(ports.map(p => p.id)).toEqual([
      'in1', 'in2', 'in3', 'in4', 'in5', 'in6', 'in7', 'in8', 'in9', 'in10', 'in11', 'in12',
    ]);
    expect(ports.find(p => p.id === 'in1').label).toBe('입력 1 (HDMI2.0/DP1.2)');
    expect(ports.find(p => p.id === 'in5').label).toBe('입력 5 (12G-SDI)');
    expect(ports.find(p => p.id === 'in6').label).toBe('입력 6 (HDMI1.4)');
    expect(ports.find(p => p.id === 'in7').label).toBe('입력 7 (12G-SDI)');
    expect(ports.find(p => p.id === 'in8').label).toBe('입력 8 (HDMI1.4)');
    expect(ports.find(p => p.id === 'in9').label).toBe('입력 9 (HDMI2.0/DP1.2)');
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
  test('J6 splicer mode exposes 8 real DVI output connectors (DVI1-4, each with a main + backup)', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'splicer' } });
    expect(ports.map(p => p.id)).toEqual(['dvi1', 'dvi1b', 'dvi2', 'dvi2b', 'dvi3', 'dvi3b', 'dvi4', 'dvi4b']);
    expect(ports.every(p => p.maxPx === 1920 * 1200)).toBe(true);
  });

  test('J6 switcher mode (single DVI, default) exposes PGM DVI1/DVI2 (+backups) + AUX DVI3 (+backup)', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher' } });
    expect(ports.map(p => p.id)).toEqual(['dvi1', 'dvi1b', 'dvi2', 'dvi2b', 'dvi3', 'dvi3b']);
    expect(ports.find(p => p.id === 'dvi3').label).toBe('DVI3 (AUX)');
    expect(ports.find(p => p.id === 'dvi3b').aux).toBe(true);
    expect(ports.every(p => p.maxPx === 1920 * 1200)).toBe(true);
  });

  test('J6 switcher mode + dual-link drops DVI2 (both main+backup), leaves DVI1 (both) with an unconfirmed (null) cap', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher', dviLink: 'dual' } });
    expect(ports.map(p => p.id)).toEqual(['dvi1', 'dvi1b', 'dvi3', 'dvi3b']);
    expect(ports.find(p => p.id === 'dvi1').maxPx).toBeNull();
    expect(ports.find(p => p.id === 'dvi1b').maxPx).toBeNull();
  });

  test('J6 with no mode set falls back to its defaultMode (now switcher, single DVI: 6 outputs)', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6' } });
    expect(ports).toHaveLength(6);
  });

  test('only J6\'s AUX connectors (DVI3 main+backup) are flagged aux — PGM connectors are not', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher' } });
    expect(ports.find(p => p.id === 'dvi1').aux).toBe(false);
    expect(ports.find(p => p.id === 'dvi1b').aux).toBe(false);
    expect(ports.find(p => p.id === 'dvi2').aux).toBe(false);
    expect(ports.find(p => p.id === 'dvi2b').aux).toBe(false);
    expect(ports.find(p => p.id === 'dvi3').aux).toBe(true);
    expect(ports.find(p => p.id === 'dvi3b').aux).toBe(true);
  });

  test('EC90 exposes 8 output connectors (4 logical channels × main+backup) — A/B are independently connectable mirrors, not merged', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec90' } });
    expect(ports.map(p => p.id)).toEqual(['pgm1', 'pgm1b', 'pgm2', 'pgm2b', 'aux1', 'aux1b', 'aux2', 'aux2b']);
    expect(ports.every(p => p.maxPx === 4352 * 2176)).toBe(true);
  });

  test('EC90 labels use the real physical connector name (HDMI Na/Nb) and mark AUX channels only', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec90' } });
    expect(ports.find(p => p.id === 'pgm1').label).toBe('HDMI 1a');
    expect(ports.find(p => p.id === 'pgm1').aux).toBe(false);
    expect(ports.find(p => p.id === 'pgm1b').label).toBe('HDMI 1b');
    expect(ports.find(p => p.id === 'pgm1b').aux).toBe(false);
    expect(ports.find(p => p.id === 'aux1').label).toBe('HDMI 3a (AUX)');
    expect(ports.find(p => p.id === 'aux1').aux).toBe(true);
    expect(ports.find(p => p.id === 'aux1b').label).toBe('HDMI 3b (AUX)');
    expect(ports.find(p => p.id === 'aux1b').aux).toBe(true);
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

  test('EC100 always exposes 8 MAIN connectors (4 channels × main+backup) regardless of auxMode', () => {
    const switcher = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec100', auxMode: 'switcher' } });
    expect(switcher.filter(p => p.id.startsWith('main')).map(p => p.id)).toEqual(
      ['main1', 'main1b', 'main2', 'main2b', 'main3', 'main3b', 'main4', 'main4b']
    );
    expect(switcher.filter(p => p.id.startsWith('main')).every(p => !p.aux)).toBe(true);
  });

  test('EC100 output labels use the real connector names — MAIN as "HDMI Na"/"HDMI Nb", AUX plainly as "AUXn" (no a/b, no (AUX) suffix)', () => {
    const switcher = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec100' } });
    expect(switcher.map(p => p.label)).toEqual([
      'HDMI 1a', 'HDMI 1b', 'HDMI 2a', 'HDMI 2b', 'HDMI 3a', 'HDMI 3b', 'HDMI 4a', 'HDMI 4b',
      'AUX1', 'AUX2', 'AUX3', 'AUX4',
    ]);

    const mosaic = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec100', auxMode: 'mosaic' } });
    expect(mosaic.filter(p => p.id.startsWith('aux')).map(p => p.label)).toEqual(['AUX1', 'AUX2', 'AUX3', 'AUX4']);
  });

  // 스위처 모드의 AUX1/AUX2(, AUX3/AUX4)는 벤더 매뉴얼상 "copy each other" —
  // 항상 같은 신호의 미러라 EC90/EC100 MAIN의 메인·백업(a/b)과 같은 성격이다.
  // 그래서 하나로 합친 채널(예전의 aux12)이 아니라 mosaic 모드와 똑같이 4개
  // 전부 독립적으로 연결 가능한 포트이되, mirror 필드로 "같은 신호"임을
  // 표시해 graphOps.js의 mirrorPortConflict가 오용을 막는다.
  test('EC100 switcher AUX mode: 4 independently connectable ports, paired via mirror (aux1~aux2, aux3~aux4)', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec100' } });
    expect(ports.map(p => p.id)).toEqual(
      ['main1', 'main1b', 'main2', 'main2b', 'main3', 'main3b', 'main4', 'main4b', 'aux1', 'aux2', 'aux3', 'aux4']
    );
    expect(ports.find(p => p.id === 'aux1').aux).toBe(true);
    expect(ports.find(p => p.id === 'aux1').mirror).toBe(ports.find(p => p.id === 'aux2').mirror);
    expect(ports.find(p => p.id === 'aux3').mirror).toBe(ports.find(p => p.id === 'aux4').mirror);
    expect(ports.find(p => p.id === 'aux1').mirror).not.toBe(ports.find(p => p.id === 'aux3').mirror);
  });

  test('EC100 mosaic AUX mode ports have no mirror (genuinely independent, per manual)', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec100', auxMode: 'mosaic' } });
    expect(ports.filter(p => p.id.startsWith('aux')).every(p => !p.mirror)).toBe(true);
  });

  test('EC100 mosaic AUX mode exposes 4 independent AUX channels instead', () => {
    const ports = getConsoleOutputPorts({ config: { deviceId: 'magnimage-ec100', auxMode: 'mosaic' } });
    expect(ports.filter(p => p.id.startsWith('aux')).map(p => p.id)).toEqual(['aux1', 'aux2', 'aux3', 'aux4']);
  });
});

describe('getConsoleDisabledOutputPorts', () => {
  test('J6 switcher + dual-link reports DVI2 (both main+backup) as explicitly unavailable', () => {
    const disabled = getConsoleDisabledOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher', dviLink: 'dual' } });
    expect(disabled.map(p => p.id)).toEqual(['dvi2', 'dvi2b']);
  });

  test('J6 switcher in single-DVI mode has nothing disabled', () => {
    expect(getConsoleDisabledOutputPorts({ config: { deviceId: 'novastar-j6', mode: 'switcher' } })).toEqual([]);
  });

  test('devices without a dviLink concept (EC90, manual mode) never report disabled ports', () => {
    expect(getConsoleDisabledOutputPorts({ config: { deviceId: 'magnimage-ec90' } })).toEqual([]);
    expect(getConsoleDisabledOutputPorts({ config: {} })).toEqual([]);
  });
});
