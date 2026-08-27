const {
  runValidation, resolveJ6DualLink, applyAutoJ6DualLink, resolveSendingCardOutput, resolveConsoleOutputInfo,
  resolveConsoleCombinedOutputs,
} = require('../js/validation/validationEngine.js');
const { resolutionForArea } = require('../js/leddesign/ledAreaSetup.js');

function node(id, type, config, y) {
  return { id, type, x: 0, y: y || 0, label: type, config: config || {} };
}

function ledNode(id, totalRequiredPx, ledDesign) {
  return node(id, 'led', {
    totalRequiredPx,
    ledDesign: ledDesign || { areaW: 0, areaH: 0, zones: [], lanPorts: [], pwrPorts: [] },
  });
}

// betaPanels.test.js와 같은 모양 — 3mm 피치, 4×4(2000×2000mm) 구역 → 512×512px.
function zoneLedDesign(overrides) {
  const zone = {
    id: 'z1', led: '3mm', startRow: 0, startCol: 0,
    rows: 4, cols: 4, panelW: 1000, panelH: 1000,
    ...overrides,
  };
  return { areaW: 2000, areaH: 2000, zones: [zone], lanPorts: [], pwrPorts: [] };
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

describe('EC90 single-channel overflow gets a mosaic hint (warning only — no auto-reconfiguration)', () => {
  test('one sending card asking for more than one PGM channel can deliver gets a mosaic suggestion', () => {
    const overCapPx = 4352 * 2176 + 1; // 채널 1개(PGM1) 상한을 1px 초과
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'magnimage-ec90' }, 0),
        node('s1', 'sending', { deviceId: 'novastar-mctrl4k' }, 100),
        ledNode('led1', overCapPx),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'pgm1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const result = runValidation(graph);
    expect(result.nodeIssues.has('c1')).toBe(true);
    const messages = result.nodeIssues.get('c1').map(i => i.message);
    expect(messages.some(m => m.includes('모자이크 모드'))).toBe(true);
  });

  test('a non-EC90 console (J6) gets no mosaic hint when it overflows a single connector', () => {
    const overCapPx = 1920 * 1200 + 1;
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'splicer' }, 0),
        node('s1', 'sending', { deviceId: 'novastar-mctrl4k' }, 100),
        ledNode('led1', overCapPx),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const result = runValidation(graph);
    const messages = result.nodeIssues.get('c1').map(i => i.message);
    expect(messages.some(m => m.includes('모자이크 모드'))).toBe(false);
  });
});

describe('resolveJ6DualLink (J6 switcher mode: single DVI vs dual-link, decided automatically)', () => {
  const underCapPx = 1920 * 1080; // < perOutputMaxPx(1920*1200)
  const overCapPx = 2500000; // > perOutputMaxPx(1920*1200 = 2,304,000)

  function graphWithConsole(consoleConfig, sendingEdges) {
    const nodes = [node('c1', 'console', consoleConfig, 0)];
    const edges = [];
    sendingEdges.forEach(({ sendingId, portId, requiredPx }) => {
      nodes.push(node(sendingId, 'sending', {}, 100));
      nodes.push(ledNode(`${sendingId}-led`, requiredPx));
      edges.push({ id: `e-${sendingId}-in`, kind: 'video', from: { nodeId: 'c1', portId }, to: { nodeId: sendingId, portId: 'in' } });
      edges.push({ id: `e-${sendingId}-out`, kind: 'lan', from: { nodeId: sendingId, portId: 'out' }, to: { nodeId: `${sendingId}-led`, portId: 'in' } });
    });
    return { nodes, edges };
  }

  test('a single sending card within the single-DVI cap stays single', () => {
    const graph = graphWithConsole({ deviceId: 'novastar-j6', mode: 'switcher' }, [
      { sendingId: 's1', portId: 'dvi1', requiredPx: underCapPx },
    ]);
    expect(resolveJ6DualLink(graph, graph.nodes[0])).toBe('single');
  });

  test('a single sending card exceeding the single-DVI cap needs dual-link', () => {
    const graph = graphWithConsole({ deviceId: 'novastar-j6', mode: 'switcher' }, [
      { sendingId: 's1', portId: 'dvi1', requiredPx: overCapPx },
    ]);
    expect(resolveJ6DualLink(graph, graph.nodes[0])).toBe('dual');
  });

  test('no sending card connected stays single (nothing to decide from)', () => {
    const graph = graphWithConsole({ deviceId: 'novastar-j6', mode: 'switcher' }, []);
    expect(resolveJ6DualLink(graph, graph.nodes[0])).toBe('single');
  });

  test('two sending cards connected (independent DVI1/DVI2 use) stays single even if one alone would exceed the cap', () => {
    const graph = graphWithConsole({ deviceId: 'novastar-j6', mode: 'switcher' }, [
      { sendingId: 's1', portId: 'dvi1', requiredPx: overCapPx },
      { sendingId: 's2', portId: 'dvi2', requiredPx: underCapPx },
    ]);
    expect(resolveJ6DualLink(graph, graph.nodes[0])).toBe('single');
  });

  test('splicer mode never engages dual-link (only modeled for switcher)', () => {
    const graph = graphWithConsole({ deviceId: 'novastar-j6', mode: 'splicer' }, [
      { sendingId: 's1', portId: 'dvi1', requiredPx: overCapPx },
    ]);
    expect(resolveJ6DualLink(graph, graph.nodes[0])).toBe('single');
  });

  test('a non-J6 console never engages dual-link', () => {
    const graph = graphWithConsole({ deviceId: 'magnimage-ec90' }, [
      { sendingId: 's1', portId: '1a', requiredPx: overCapPx },
    ]);
    expect(resolveJ6DualLink(graph, graph.nodes[0])).toBe('single');
  });
});

describe('applyAutoJ6DualLink (mutates config.dviLink and prunes edges DVI2 no longer supports)', () => {
  test('switching to dual-link prunes an existing edge parked on DVI2', () => {
    const overCapPx = 2500000;
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'switcher' }, 0),
        node('s1', 'sending', {}, 100),
        ledNode('led1', overCapPx),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi2' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    applyAutoJ6DualLink(graph);
    expect(graph.nodes[0].config.dviLink).toBe('dual');
    expect(graph.edges.some(e => e.id === 'e1')).toBe(false); // dvi2 더 이상 유효 포트가 아니라 정리됨
    expect(graph.edges.some(e => e.id === 'e2')).toBe(true); // 무관한 엣지는 그대로
  });

  test('the same connection parked on DVI1 survives the switch to dual-link', () => {
    const overCapPx = 2500000;
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'switcher' }, 0),
        node('s1', 'sending', {}, 100),
        ledNode('led1', overCapPx),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    applyAutoJ6DualLink(graph);
    expect(graph.nodes[0].config.dviLink).toBe('dual');
    expect(graph.edges.some(e => e.id === 'e1')).toBe(true);
  });
});

describe('resolveSendingCardOutput (resolution + max achievable Hz shown on the sending card node)', () => {
  function graphWithOneCard(consoleConfig) {
    return {
      nodes: [
        node('c1', 'console', consoleConfig, 0),
        node('s1', 'sending', {}, 100),
        ledNode('led1', 0, zoneLedDesign()),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
  }

  test('single sending card gets the LED\'s full resolution, and the console\'s table decides max Hz', () => {
    const graph = graphWithOneCard({ deviceId: 'novastar-j6', mode: 'splicer' });
    const res = resolveSendingCardOutput(graph, graph.nodes[1]);
    // 3mm 피치 4×4(2000×2000mm) 구역 = 512×512px(betaPanels.test.js와 동일 계산)
    expect(res).toEqual({ w: 512, h: 512, hz: 85 }); // 262,144px는 J6 표의 85Hz 예산(1,396,736px) 이내
  });

  test('two sending cards sharing one LED each get half the width (simple even split, per user request)', () => {
    const graph = graphWithOneCard({ deviceId: 'novastar-j6', mode: 'splicer' });
    graph.nodes.push(node('s2', 'sending', {}, 150));
    graph.edges.push(
      { id: 'e3', kind: 'video', from: { nodeId: 'c1', portId: 'dvi2' }, to: { nodeId: 's2', portId: 'in' } },
      { id: 'e4', kind: 'lan', from: { nodeId: 's2', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
    );
    const res1 = resolveSendingCardOutput(graph, graph.nodes.find(n => n.id === 's1'));
    const res2 = resolveSendingCardOutput(graph, graph.nodes.find(n => n.id === 's2'));
    expect(res1.w).toBe(256); // 512 / 2장
    expect(res2.w).toBe(256);
    expect(res1.h).toBe(512);
  });

  test('custom (uneven) LAN port wiring overrides the even N등분 approximation with the actual assigned bbox', () => {
    // 4000×2000mm(8×4칸, 500×500 패널) 구역 — s1은 맨 왼쪽 한 열(500×2000mm)만,
    // s2는 나머지 일곱 열(3500×2000mm)을 맡도록 수동 배선했다고 가정.
    const zone = {
      id: 'z1', led: '3mm', startRow: 0, startCol: 0, rows: 4, cols: 8, panelW: 500, panelH: 500,
    };
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'splicer' }, 0),
        node('s1', 'sending', {}, 100),
        node('s2', 'sending', {}, 150),
        ledNode('led1', 0, { areaW: 4000, areaH: 2000, zones: [zone], pwrPorts: [], lanPorts: [
          ['z1:0:0', 'z1:1:0', 'z1:2:0', 'z1:3:0'], [], [], [], [], [], [], [], // s1의 8개 포트 — 맨 왼쪽 열만 포트0에
          ['z1:0:1', 'z1:1:1', 'z1:2:1', 'z1:3:1', 'z1:0:2', 'z1:1:2', 'z1:2:2', 'z1:3:2',
            'z1:0:3', 'z1:1:3', 'z1:2:3', 'z1:3:3', 'z1:0:4', 'z1:1:4', 'z1:2:4', 'z1:3:4',
            'z1:0:5', 'z1:1:5', 'z1:2:5', 'z1:3:5', 'z1:0:6', 'z1:1:6', 'z1:2:6', 'z1:3:6',
            'z1:0:7', 'z1:1:7', 'z1:2:7', 'z1:3:7'], [], [], [], [], [], [], [], // s2의 8개 포트 — 나머지 일곱 열 전부 포트0에
        ] }),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
        { id: 'e3', kind: 'video', from: { nodeId: 'c1', portId: 'dvi2' }, to: { nodeId: 's2', portId: 'in' } },
        { id: 'e4', kind: 'lan', from: { nodeId: 's2', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const res1 = resolveSendingCardOutput(graph, graph.nodes.find(n => n.id === 's1'));
    const res2 = resolveSendingCardOutput(graph, graph.nodes.find(n => n.id === 's2'));
    // N등분이었다면 각각 2000×2000mm(반반)이었을 것 — 대신 실제 배정된 몫대로 나뉜다.
    expect(res1).toMatchObject(resolutionForArea(500, 2000, '3mm'));
    expect(res2).toMatchObject(resolutionForArea(3500, 2000, '3mm'));
  });

  test('no upstream console (or no device preset) still reports resolution, but Hz is unknown (null)', () => {
    const graph = {
      nodes: [node('s1', 'sending', {}, 100), ledNode('led1', 0, zoneLedDesign())],
      edges: [{ id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } }],
    };
    const res = resolveSendingCardOutput(graph, graph.nodes[0]);
    expect(res).toEqual({ w: 512, h: 512, hz: null });
  });

  test('a sending card not connected to any (zoned) LED returns null', () => {
    const graph = { nodes: [node('s1', 'sending', {}, 100)], edges: [] };
    expect(resolveSendingCardOutput(graph, graph.nodes[0])).toBeNull();
  });
});

describe('resolveConsoleOutputInfo (per-port resolution + Hz shown on the console node itself)', () => {
  test('reports one entry per output port that actually leads to a resolvable sending card', () => {
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'splicer' }, 0),
        node('s1', 'sending', {}, 100),
        ledNode('led1', 0, zoneLedDesign()),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const info = resolveConsoleOutputInfo(graph, graph.nodes[0]);
    expect(info).toEqual([{ portId: 'dvi1', portLabel: 'DVI1', w: 512, h: 512, hz: 85 }]);
  });

  test('one entry per connected sending card when the console drives two channels', () => {
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'splicer' }, 0),
        node('s1', 'sending', {}, 100),
        node('s2', 'sending', {}, 150),
        ledNode('led1', 0, zoneLedDesign()),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
        { id: 'e3', kind: 'video', from: { nodeId: 'c1', portId: 'dvi2' }, to: { nodeId: 's2', portId: 'in' } },
        { id: 'e4', kind: 'lan', from: { nodeId: 's2', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const info = resolveConsoleOutputInfo(graph, graph.nodes[0]);
    expect(info.map(i => i.portId).sort()).toEqual(['dvi1', 'dvi2']);
    // 표시 해상도는 포트별 몫(256×512)이다 — 한때(2026-08-26) 최종 LED 전체
    // 해상도(512×512)를 보여준 적이 있었지만, 포트별 실제 몫과 달라 헷갈린다는
    // 사용자 요청(2026-08-27)으로 되돌렸다. Hz는 그대로 각 포트가 실제로
    // 내보내는 몫값 기준이라 resolveSendingCardOutput(그 포트에 물린 샌딩카드
    // 자신의 몫 계산)의 w/h/hz와 그대로 일치해야 한다.
    const s1Out = resolveSendingCardOutput(graph, graph.nodes[1]);
    expect(s1Out.w).toBe(256);
    expect(info.every(i => i.w === 256 && i.h === 512)).toBe(true);
    expect(info.find(i => i.portId === 'dvi1').hz).toBe(s1Out.hz);
  });

  test('resolveConsoleCombinedOutputs returns the merged LED resolution only when 2+ ports feed the same LED', () => {
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'splicer' }, 0),
        node('s1', 'sending', {}, 100),
        node('s2', 'sending', {}, 150),
        ledNode('led1', 0, zoneLedDesign()),
      ],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
        { id: 'e3', kind: 'video', from: { nodeId: 'c1', portId: 'dvi2' }, to: { nodeId: 's2', portId: 'in' } },
        { id: 'e4', kind: 'lan', from: { nodeId: 's2', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    const combined = resolveConsoleCombinedOutputs(graph, graph.nodes[0]);
    expect(combined).toEqual([{ ledNodeId: 'led1', w: 512, h: 512 }]);

    // 포트가 하나만 물린 경우엔 "합계"라는 개념이 없으므로 빈 배열.
    const singlePortGraph = {
      nodes: [node('c1', 'console', { deviceId: 'novastar-j6', mode: 'splicer' }, 0), node('s1', 'sending', {}, 100), ledNode('led1', 0, zoneLedDesign())],
      edges: [
        { id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi1' }, to: { nodeId: 's1', portId: 'in' } },
        { id: 'e2', kind: 'lan', from: { nodeId: 's1', portId: 'out' }, to: { nodeId: 'led1', portId: 'in' } },
      ],
    };
    expect(resolveConsoleCombinedOutputs(singlePortGraph, singlePortGraph.nodes[0])).toEqual([]);
  });

  test('a port that goes to a prompter (no sending card) is skipped', () => {
    const graph = {
      nodes: [
        node('c1', 'console', { deviceId: 'novastar-j6', mode: 'switcher' }, 0),
        node('p1', 'prompter', {}, 100),
      ],
      edges: [{ id: 'e1', kind: 'video', from: { nodeId: 'c1', portId: 'dvi3' }, to: { nodeId: 'p1', portId: 'in' } }],
    };
    expect(resolveConsoleOutputInfo(graph, graph.nodes[0])).toEqual([]);
  });

  test('no output edges at all reports no entries', () => {
    const graph = { nodes: [node('c1', 'console', { deviceId: 'novastar-j6' }, 0)], edges: [] };
    expect(resolveConsoleOutputInfo(graph, graph.nodes[0])).toEqual([]);
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
