// ── scheduleParse ───────────────────────────────────
// 밴드 일정 텍스트에서 LED 피치와 설치 면적을 뽑아낸다. 자매 앱
// led-calculator/script.js의 _schedParseText(§13)를 이식하되, 단일/멀티(좌우·
// 중앙)를 하나의 섹션 배열로 통일한다 — 노드앱은 섹션마다 LED디스플레이 노드를
// 하나씩 만들기 때문.
//
// Section = { label: '중앙'|'좌'|'우'|string|null, pitch: '2mm'|'3mm'|'4mm', areaWm, areaHm }
// areaWm / areaHm 은 일정에 적힌 그대로의 "미터" 값이다 — 미터→mm 환산과 500mm
// 격자 스냅은 하류 planFullAreaLed(ledAreaSetup.js)가 한다.
//
// N*M 정규식은 주소("3층 5*2")나 부가 설명("모니터 2개")에 오탐할 수 있어
// 호출부에서 미리보기 confirm으로 완화한다. 멀티(좌우·중앙)는 "중앙 6*3, 좌우
// 3*2.5"처럼 섹션이 2개 이상 깔끔히 잡힐 때만 적용하고, 자유 텍스트에 "중앙무대"
// 같은 단어만 섞이면 첫 N*M 하나만 뽑는 단일 모드로 폴백한다(실측 데이터 기준).
// Outlook 변환 꼬리말(" - A-TEAM(CJ)…")은 scheduleFeed.js의 stripSchedFooter가
// 이미 떼어낸 뒤 넘겨주므로 여기선 신경 쓰지 않는다.
//
// ── 여러 조가 줄마다 나뉜 "목록" 형태(2026-09-16, 사용자 제보 스크린샷 2건) ──
// 밴드가 한 일정에 LED를 여러 조 나열해두는 경우가 실제로 있다(예: "1.진입로
// 3mm 중앙 6*4 좌우 3*4 / 4mm 콘솔 6*3.5 / 2.대로 4mm 10*6"). 이런 목록은
// LED 하나마다 그 줄 안에 자기 피치(Nmm)와 크기(N*M)를 **함께** 적어두는 게
// 특징이다 — 그런 줄이 2개 이상이면(=서로 다른 화면을 나열한 목록이 거의
// 확실) parseScheduleListLines가 줄마다 전부 뽑아 하나도 안 빠뜨린다. 반대로
// (아래 "광복절"/"경기도자비엔날레" 테스트처럼) 부가 설명·다른 장비 치수가
// 한 줄에 뒤섞여 있을 땐 그 줄 하나만 "자기 피치+크기"를 갖췄으므로(2개 미만)
// 목록 모드로 안 들어가고 기존 단일/멀티(좌우·중앙) 로직으로 폴백한다(오탐 방지
// — 실측 데이터에서 두 번째 N*M이 진짜 두 번째 화면이 아니라 부가 장비 치수인
// 경우가 있었기 때문에, "같은 줄에 여러 크기"만으로는 목록으로 안 본다).
function parseScheduleText(text) {
  const src = String(text || '');
  const SZ = '(\\d+\\.?\\d*)\\s*[*×xX]\\s*(\\d+\\.?\\d*)';
  const toSize = m => (m ? { areaWm: parseFloat(m[1]), areaHm: parseFloat(m[2]) } : null);

  // "좌우 NxM"은 좌·우가 각각 같은 크기의 독립된 화면 두 개라는 뜻이므로,
  // 이후 로직(단일/멀티 판정, 목록 추출) 모두 "좌 NxM 우 NxM"으로 미리 펼친
  // 문자열을 기준으로 삼는다.
  const expanded = src.replace(new RegExp('좌우\\s*' + SZ, 'g'), (_m, w, h) => `좌 ${w}*${h} 우 ${w}*${h}`);

  const listSections = parseScheduleListLines(expanded, SZ);
  if (listSections) { return listSections; }

  // ── 기존 단일/멀티(좌우·중앙) 로직 ──
  const pitchM = src.match(/(\d+)\s*mm/i);
  const n = pitchM ? parseInt(pitchM[1], 10) : null;
  const pitch = (n === 2 || n === 3 || n === 4) ? n + 'mm' : null;
  const resolvedPitch = pitch || '3mm';

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

// 줄마다 "자기 피치(Nmm)+크기(N*M)"를 갖춘 줄이 2개 이상이면 목록으로 보고
// 전부 뽑아 반환한다. 그렇지 않으면 null(호출부가 기존 단일/멀티 로직으로
// 폴백하게).
function parseScheduleListLines(expanded, SZ) {
  const lines = expanded.split(/\r?\n/);

  const qualifies = line => {
    const hasPitch = [...line.matchAll(/(\d+)\s*mm/gi)].some(m => {
      const n = parseInt(m[1], 10);
      return n === 2 || n === 3 || n === 4;
    });
    return hasPitch && new RegExp(SZ).test(line);
  };
  if (lines.filter(qualifies).length < 2) { return null; }

  const sections = [];
  let currentPitch = null;
  lines.forEach(line => {
    const anchors = [...line.matchAll(/(\d+)\s*mm/gi)]
      .map(m => ({ idx: m.index, n: parseInt(m[1], 10) }))
      .filter(a => a.n === 2 || a.n === 3 || a.n === 4);

    // 줄 안에 피치가 하나도 없으면(예: 이전 줄에 이어지는 설명) 통째로 이전
    // 줄에서 이어받은 피치(currentPitch)를 쓴다. 있으면 각 피치 등장 위치부터
    // (첫 등장 앞의 라벨 텍스트는 그 첫 피치 몫으로 포함) 다음 피치 직전까지를
    // 그 피치의 구간으로 나눈다 — 한 줄에 "3mm 중앙 6*4 좌우 3*4"처럼 피치
    // 하나에 크기가 여럿이어도, "3mm 4*3 4mm 5*2"처럼 피치가 여럿이어도 맞게
    // 나뉜다.
    const segs = anchors.length
      ? anchors.map((a, i) => ({
        pitch: a.n + 'mm',
        text: line.slice(i === 0 ? 0 : a.idx, i + 1 < anchors.length ? anchors[i + 1].idx : line.length),
      }))
      : [{ pitch: currentPitch, text: line }];

    segs.forEach(seg => {
      if (seg.pitch) { currentPitch = seg.pitch; }
      const resolvedPitch = seg.pitch || '3mm';
      const szRe = new RegExp(SZ, 'g');
      let sm;
      while ((sm = szRe.exec(seg.text))) {
        const before = seg.text.slice(Math.max(0, sm.index - 20), sm.index);
        const after = seg.text.slice(sm.index + sm[0].length, sm.index + sm[0].length + 20);
        sections.push({
          label: extractListLabel(before, after),
          pitch: resolvedPitch,
          areaWm: parseFloat(sm[1]),
          areaHm: parseFloat(sm[2]),
        });
      }
    });
  });

  if (!sections.length) { return null; }

  // 좌/우는 있는데 중앙이 명시적으로 안 잡혔으면(예: 라벨 없이 "6*4 좌우
  // 3*4") 라벨 없는 첫 항목을 중앙으로 본다 — 기존 단일 그룹 로직의 "라벨
  // 없는 첫 N*M → 중앙" 규칙과 같은 취지.
  const hasCenter = sections.some(s => s.label === '중앙');
  const hasSide = sections.some(s => s.label === '좌' || s.label === '우');
  if (!hasCenter && hasSide) {
    const firstNull = sections.find(s => s.label === null);
    if (firstNull) { firstNull.label = '중앙'; }
  }
  // 그래도 라벨이 없는 항목(부가 설명 없는 일반 크기)은 노드 이름이 전부
  // 똑같아 구분이 안 되므로 목록 순번을 붙인다.
  sections.forEach((s, i) => { if (!s.label) { s.label = String(i + 1); } });
  return sections;
}

// 크기 앞의 좌/우/중앙 라벨, 없으면 크기 앞의 설명 단어(예: "콘솔"), 그것도
// 없으면 크기 뒤의 괄호 설명(예: "3*2(게임중계화면)")을 라벨로 쓴다.
function extractListLabel(before, after) {
  if (/좌측|좌\s*$/.test(before)) { return '좌'; }
  if (/우측|우\s*$/.test(before)) { return '우'; }
  if (/중앙/.test(before)) { return '중앙'; }
  const trailing = before.match(/([가-힣a-zA-Z][가-힣a-zA-Z0-9]{0,9})\s*$/);
  if (trailing && !/^mm$/i.test(trailing[1])) { return trailing[1]; }
  const paren = after.match(/^\s*\(([^)]+)\)/);
  return paren ? paren[1].trim() : null;
}

// 계산기 _schedApplyParsedBeta와 동일 규칙 — 2mm는 500×500, 그 외는 500×1000.
function panelSizeForPitch(pitch) {
  return pitch === '2mm' ? { panelW: 500, panelH: 500 } : { panelW: 500, panelH: 1000 };
}

if (typeof module !== 'undefined') { module.exports = { parseScheduleText, panelSizeForPitch }; }
