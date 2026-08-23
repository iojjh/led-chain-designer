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

describe('sending card own input cap + console per-connector cap (real scenario found in conversation: J6 + a single MCTRL660PRO)', () => {
  // 660PRO 입력 상한(1920×1200=2,304,000px)보다는 크지만, 660PRO의 LAN 총
  // 용량(6×655,360≈3,932,160px)과 J6 splicer 합산 용량(9,200,000px) 둘 다에는
  // 여유 있게 들어가는 요구량 — 기존 두 검사(checkConsoleOutput/checkSendingOutput)
  // 만으로는 절대 안 걸리고, 이번에 추가한 두 검사에서만 걸려야 한다.
  const overInputOnlyPx = 2500000;

  function graphWithOneCard() {
    return {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'splicer' }, 0),
        node('s1', 'sending', { deviceId: 'novastar-mctrl660pro' }, 100),
        ledNode('led1', overInputOnlyPx),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'out' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
  }

  test('sending card is flagged for exceeding its own input cap, even though it is well within its LAN output cap', () => {
    const result = runValidation(graphWithOneCard());
    expect(result.nodeIssues.has('s1')).toBe(true);
    const messages = result.nodeIssues.get('s1').map(i => i.message);
    expect(messages.some(m => m.includes('입력 상한'))).toBe(true);
    expect(messages.some(m => m.includes('용량 이내') || m.includes('총 용량'))).toBe(false); // LAN 출력 쪽 문구는 없어야 함(그쪽은 통과)
  });

  test('console is flagged for exceeding the single-connector cap, even though the aggregate splicer capacity has plenty of room', () => {
    const result = runValidation(graphWithOneCard());
    expect(result.nodeIssues.has('c1')).toBe(true);
    const messages = result.nodeIssues.get('c1').map(i => i.message);
    expect(messages.some(m => m.includes('커넥터 1개당 상한'))).toBe(true);
  });

  test('a smaller requirement that fits within the 660PRO input cap raises no issues at all', () => {
    const graph = graphWithOneCard();
    graph.nodes.find(n => n.id === 'led1').config.totalRequiredPx = 1920 * 1200;
    const result = runValidation(graph);
    expect(result.nodeIssues.has('s1')).toBe(false);
    expect(result.nodeIssues.has('c1')).toBe(false);
  });
});

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

describe('provisional badge: LED with no zones yet makes upstream "ok" results tentative', () => {
  test('LED node itself with no zones is always provisional', () => {
    const graph = { nodes: [ledNode('led1', 0)], edges: [] };
    const result = runValidation(graph);
    expect(result.nodeProvisional.has('led1')).toBe(true);
  });

  test('LED node with zones is not provisional', () => {
    const zone = { id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 1, cols: 1, panelW: 500, panelH: 500 };
    const graph = {
      nodes: [ledNode('led1', 128 * 128, { areaW: 500, areaH: 500, zones: [zone], lanPorts: [], pwrPorts: [] })],
      edges: [],
    };
    const result = runValidation(graph);
    expect(result.nodeProvisional.has('led1')).toBe(false);
  });

  test('sending card feeding a zone-less LED is flagged provisional even though the check trivially passes', () => {
    const graph = {
      nodes: [
        node('s1', 'sending', { deviceId: 'novastar-mctrl4k' }, 0),
        ledNode('led1', 0),
      ],
      edges: [
        { id: 'e1', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const result = runValidation(graph);
    expect(result.nodeIssues.has('s1')).toBe(false); // 0px는 항상 통과
    expect(result.nodeProvisional.has('s1')).toBe(true); // 하지만 잠정 결과
  });

  test('console feeding a sending card that feeds a zone-less LED propagates the provisional flag two hops up', () => {
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'splicer' }, 0),
        node('s1', 'sending', { deviceId: 'novastar-mctrl4k' }, 100),
        ledNode('led1', 0),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'out' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const result = runValidation(graph);
    expect(result.nodeProvisional.has('c1')).toBe(true);
    expect(result.nodeProvisional.has('s1')).toBe(true);
  });

  test('a genuine capacity failure is not masked by the provisional flag', () => {
    // LED에 구역이 있어 진짜 초과 판정이 나는 경우, provisional에는 없어야 한다.
    const zone = { id: 'z1', led: '2mm', startRow: 0, startCol: 0, rows: 20, cols: 20, panelW: 500, panelH: 500 };
    const hugeLed = ledNode('ledBig', 999999999, { areaW: 10000, areaH: 10000, zones: [zone], lanPorts: [], pwrPorts: [] });
    const graph = {
      nodes: [
        node('s1', 'sending', { deviceId: 'novastar-mctrl4k' }, 0),
        hugeLed,
      ],
      edges: [
        { id: 'e1', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'ledBig', portId: 'in' } },
      ],
    };
    const result = runValidation(graph);
    expect(result.nodeIssues.has('s1')).toBe(true);
    expect(result.nodeProvisional.has('s1')).toBe(false);
    expect(result.nodeProvisional.has('ledBig')).toBe(false);
  });
});
