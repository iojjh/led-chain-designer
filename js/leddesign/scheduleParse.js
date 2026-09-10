// ── scheduleParse ───────────────────────────────────
// 밴드 일정 텍스트에서 LED 피치와 설치 면적을 뽑아낸다. 자매 앱
// led-calculator/script.js의 _schedParseText(§13)를 이식하되, 단일/멀티(좌우·
// 중앙)를 하나의 섹션 배열로 통일한다 — 노드앱은 섹션마다 LED디스플레이 노드를
// 하나씩 만들기 때문.
//
// Section = { label: '중앙'|'좌'|'우'|null, pitch: '2mm'|'3mm'|'4mm', areaWm, areaHm }
// areaWm / areaHm 은 일정에 적힌 그대로의 "미터" 값이다 — 미터→mm 환산과 500mm
// 격자 스냅은 하류 planFullAreaLed(ledAreaSetup.js)가 한다.
//
// N*M 정규식은 주소("3층 5*2")나 부가 설명("모니터 2개")에 오탐할 수 있어
// 호출부에서 미리보기 confirm으로 완화한다. 멀티(좌우·중앙)는 "중앙 6*3, 좌우
// 3*2.5"처럼 섹션이 2개 이상 깔끔히 잡힐 때만 적용하고, 자유 텍스트에 "중앙무대"
// 같은 단어만 섞이면 첫 N*M 하나만 뽑는 단일 모드로 폴백한다(실측 데이터 기준).
// Outlook 변환 꼬리말(" - A-TEAM(CJ)…")은 outlook-sync.gs 쪽에서 잘라 시트에
// 넣으므로 여기선 신경 쓰지 않는다.

// SPECS(specs.js) 키가 '2mm'|'3mm'|'4mm'뿐이라 그 외 피치는 못 쓴다.
// 피치를 못 찾거나 지원 밖이면 계산기와 동일하게 '3mm'로 가정한다.
function parseScheduleText(text) {
  const src = String(text || '');
  const pitchM = src.match(/(\d+)\s*mm/i);
  const n = pitchM ? parseInt(pitchM[1], 10) : null;
  const pitch = (n === 2 || n === 3 || n === 4) ? n + 'mm' : null;
  const resolvedPitch = pitch || '3mm';

  const SZ = '(\\d+\\.?\\d*)\\s*[*×xX]\\s*(\\d+\\.?\\d*)';
  const toSize = m => (m ? { areaWm: parseFloat(m[1]), areaHm: parseFloat(m[2]) } : null);

  const isMulti = /좌우|좌측|우측/.test(src) || /[좌우]\s*\d/.test(src);

  if (isMulti) {
    const centerM = src.match(new RegExp('중앙\\s*' + SZ));
    const sideM = src.match(new RegExp('좌우\\s*' + SZ));
    // 좌우가 있으면 좌/우 개별 매칭 불필요(둘이 같은 크기).
    const leftM = sideM ? null : src.match(new RegExp('(?:좌측|좌)\\s*' + SZ));
    const rightM = sideM ? null : src.match(new RegExp('(?:우측|우)\\s*' + SZ));

    let center = toSize(centerM);
    const left = toSize(sideM) || toSize(leftM);
    const right = toSize(sideM) || toSize(rightM);

    // 중앙 미표기 시 라벨 없는 첫 번째 N*M을 중앙으로.
    if (!center) {
      let tmp = src;
      [sideM, leftM, rightM].forEach(m => { if (m) { tmp = tmp.replace(m[0], ''); } });
      const rem = tmp.match(new RegExp(SZ));
      if (rem) { center = { areaWm: parseFloat(rem[1]), areaHm: parseFloat(rem[2]) }; }
    }

    const sections = [];
    if (center) { sections.push({ label: '중앙', pitch: resolvedPitch, areaWm: center.areaWm, areaHm: center.areaHm }); }
    if (left) { sections.push({ label: '좌', pitch: resolvedPitch, areaWm: left.areaWm, areaHm: left.areaHm }); }
    if (right) { sections.push({ label: '우', pitch: resolvedPitch, areaWm: right.areaWm, areaHm: right.areaHm }); }
    // 섹션이 2개 이상 깔끔하게 잡힐 때만 멀티로 본다. 1개 이하면 자유 텍스트에
    // "중앙무대"·"좌우중계" 같은 단어가 우연히 섞인 것이므로 아래 단일 모드로
    // 폴백해 첫 번째 N*M 하나만 뽑는다(실측 데이터 기준).
    if (sections.length >= 2) { return sections; }
  }

  const sizeM = src.match(new RegExp(SZ));
  if (n === null && !sizeM) {
    throw new Error('일정에서 LED 피치 또는 설치 면적을 찾을 수 없습니다.\n(예: 3mm 7*3)');
  }
  // 계산기는 면적 없이 피치만 있어도 통과시켰지만(나중에 적용 단계에서 막힘),
  // 노드앱은 구역 하나를 바로 만들어야 해 면적이 없으면 여기서 막는다.
  if (!sizeM) {
    throw new Error('일정에서 설치 면적을 찾을 수 없습니다.\n(예: 3mm 7*3)');
  }
  return [{ label: null, pitch: resolvedPitch, areaWm: parseFloat(sizeM[1]), areaHm: parseFloat(sizeM[2]) }];
}

// 계산기 _schedApplyParsedBeta와 동일 규칙 — 2mm는 500×500, 그 외는 500×1000.
function panelSizeForPitch(pitch) {
  return pitch === '2mm' ? { panelW: 500, panelH: 500 } : { panelW: 500, panelH: 1000 };
}

if (typeof module !== 'undefined') { module.exports = { parseScheduleText, panelSizeForPitch }; }
