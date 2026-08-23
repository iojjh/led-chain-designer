// ── betaPanels ──────────────────────────────────────
// led-calculator/script.js:2849-2898 그대로 이식(순수 함수, 의존성 없음).
// 구역(zone)을 실제 LED 패널 사각형들로 타일링한다.
//
// zone.cells가 있으면(led-calculator에는 없는, 이 앱만의 자유 구역 — 격자 칸을
// 하나씩 골라 만든 비정형 구역) 아래의 사각형 타일링 대신 각 칸을 그대로 500×500
// 패널 하나로 매핑한다. 비정형 형태에 500×1000 같은 큰 패널을 자동으로 짝짓는
// 알고리즘은 없음 — 자유 구역은 항상 500×500 단위로만 채운다(단순함·안전성 우선).
function betaPanels(zone) {
  if (zone.cells) {
    return zone.cells.map(({ row, col }) => ({
      key: `${zone.id}:${row}:${col}`,
      x: col * 500, y: row * 500, w: 500, h: 500,
      led: zone.led, zoneId: zone.id,
    }));
  }

  const spanC = zone.panelW / 500;
  const spanR = zone.panelH / 500;
  const fullC = Math.floor(zone.cols / spanC);
  const fullR = Math.floor(zone.rows / spanR);
  const remC = zone.cols % spanC;
  const remR = zone.rows % spanR;
  const panels = [];

  // 잔여 행 (최상단)
  if (remR) {
    for (let cc = 0; cc < zone.cols; cc++) {
      panels.push({
        key: `${zone.id}:rr:${cc}`,
        x: (zone.startCol + cc) * 500,
        y: zone.startRow * 500,
        w: 500, h: 500,
        led: zone.led, zoneId: zone.id,
      });
    }
  }

  // 전체 패널 (잔여 행 아래부터, 잔여 열 오른쪽부터)
  for (let pr = 0; pr < fullR; pr++) {
    // 잔여 열 (최좌측)
    if (remC) {
      for (let rs = 0; rs < spanR; rs++) {
        panels.push({
          key: `${zone.id}:${pr}:rc${rs}`,
          x: zone.startCol * 500,
          y: (zone.startRow + remR + pr * spanR + rs) * 500,
          w: 500, h: 500,
          led: zone.led, zoneId: zone.id,
        });
      }
    }
    // 전체 크기 패널
    for (let pc = 0; pc < fullC; pc++) {
      panels.push({
        key: `${zone.id}:${pr}:${pc}`,
        x: (zone.startCol + remC + pc * spanC) * 500,
        y: (zone.startRow + remR + pr * spanR) * 500,
        w: zone.panelW, h: zone.panelH,
        led: zone.led, zoneId: zone.id,
      });
    }
  }

  return panels;
}

if (typeof module !== 'undefined') {
  module.exports = { betaPanels };
}
