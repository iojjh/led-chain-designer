const { DEVICES, getDevice, listDevices } = require('../js/devices/devices.js');

test('getDevice returns null for unknown category/id', () => {
  expect(getDevice('console', 'nope')).toBeNull();
  expect(getDevice('nope', 'nope')).toBeNull();
});

test('getDevice returns the seeded MCTRL4K console preset', () => {
  const d = getDevice('console', 'novastar-mctrl4k');
  expect(d.outputKind).toBe('lan-ports');
  expect(d.outputs.portCount).toBe(16);
  expect(d.outputs.perPortMaxPx8bit).toBe(650000);
  expect(d.outputs.perPortMaxPx10bit).toBe(320000);
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

test('MCTRL4K and MCTRL660PRO are also registered as sending-card presets', () => {
  const sendingIds = listDevices('sending').map(d => d.id);
  expect(sendingIds).toEqual(expect.arrayContaining(['novastar-mctrl4k', 'novastar-mctrl660pro']));
});

test('sending preset port caps match the console preset output caps', () => {
  const consolePreset = getDevice('console', 'novastar-mctrl660pro');
  const sendingPreset = getDevice('sending', 'novastar-mctrl660pro');
  expect(sendingPreset.portCount).toBe(consolePreset.outputs.portCount);
  expect(sendingPreset.perPortMaxPx8bit).toBe(consolePreset.outputs.perPortMaxPx8bit);
});

test('listDevices returns an array for every known category', () => {
  expect(listDevices('console').length).toBe(Object.keys(DEVICES.console).length);
  expect(listDevices('sending').length).toBe(Object.keys(DEVICES.sending).length);
});
