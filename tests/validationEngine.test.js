const { runValidation } = require('../js/validation/validationEngine.js');

function node(id, type, config, y) {
  return { id, type, x: 0, y: y || 0, label: type, config: config || {} };
}

function ledNode(id, totalRequiredPx, ledDesign) {
  return node(id, 'led', {
    totalRequiredPx,
    ledDesign: ledDesign || { areaW: 0, areaH: 0, zones: [], lanPorts: [], pwrPorts: [] },
  });
}

describe('multiple sending cards feeding one LED (targetAllowsMultiple)', () => {
  test('before port assignment reflects the split, each card is conservatively checked against the full LED total', () => {
    // MCTRL4K: 16포트 × 655,360 = 10,485,760px 용량. LED 전체 요구량이 그 이하라면
    // (아직 lanPorts가 실제 그룹 레이아웃과 안 맞는 상태) 초과로 뜨지 않아야 한다.
    const graph = {
      nodes: [
        node('s1', 'sending', { deviceId: 'novastar-mctrl4k' }, 0),
        node('s2', 'sending', { deviceId: 'novastar-mctrl4k' }, 100),
        ledNode('led1', 5000000),
      ],
      edges: [
        { id: 'e1', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's2', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const result = runValidation(graph);
    expect(result.nodeIssues.has('s1')).toBe(false);
    expect(result.nodeIssues.has('s2')).toBe(false);
  });

  test('once panels are actually split across the two cards ports, each card is judged only on its own share', () => {
    const zone = {
      id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 2, panelW: 500, panelH: 500,
    };
    // betaPanels(zone)의 키 형식: `${zoneId}:${row}:${col}` (전체 패널 케이스) — 2칸짜리 zone(500x500 패널)이라
    // 각 열이 하나의 전체 패널이 된다.
    const panelKeys = ['z1:0:0', 'z1:0:1'];
    const lanPorts = Array.from({ length: 32 }, () => []); // 16(s1) + 16(s2)
    lanPorts[0] = [panelKeys[0]]; // s1 소속 포트(0~15)에 배정
    lanPorts[16] = [panelKeys[1]]; // s2 소속 포트(16~31)에 배정

    const totalRequiredPx = 128 * 128 * 2; // 3mm 500x500 패널 px(SPECS['3mm'].px500) × 2장
    const graph = {
      nodes: [
        node('s1', 'sending', { deviceId: 'novastar-mctrl4k' }, 0),
        node('s2', 'sending', { deviceId: 'novastar-mctrl4k' }, 100),
        ledNode('led1', totalRequiredPx, { areaW: 1000, areaH: 500, zones: [zone], lanPorts, pwrPorts: [] }),
      ],
      edges: [
        { id: 'e1', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's2', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const result = runValidation(graph);
    // 각 카드는 패널 1장(128*128=16,384px)만 담당 — MCTRL4K 총 용량(16*655,360)에 한참 못 미치므로 문제 없음.
    expect(result.nodeIssues.has('s1')).toBe(false);
    expect(result.nodeIssues.has('s2')).toBe(false);
  });
});
