const { parseScheduleText, panelSizeForPitch } = require('../js/leddesign/scheduleParse.js');

describe('parseScheduleText — 단일', () => {
  test('기본형 "3mm 7*3"', () => {
    expect(parseScheduleText('3mm 7*3')).toEqual([
      { label: null, pitch: '3mm', areaWm: 7, areaHm: 3 },
    ]);
  });

  test('2mm + 소수 면적', () => {
    expect(parseScheduleText('2mm 4*3.5')).toEqual([
      { label: null, pitch: '2mm', areaWm: 4, areaHm: 3.5 },
    ]);
  });

  test('피치·면적 사이 공백 "LED 4 mm 10 * 6"', () => {
    expect(parseScheduleText('LED 4 mm 10 * 6')).toEqual([
      { label: null, pitch: '4mm', areaWm: 10, areaHm: 6 },
    ]);
  });

  test('구분자 ×/x/X 모두 허용', () => {
    const want = [{ label: null, pitch: '3mm', areaWm: 7, areaHm: 3 }];
    expect(parseScheduleText('3mm 7×3')).toEqual(want);
    expect(parseScheduleText('3mm 7x3')).toEqual(want);
    expect(parseScheduleText('3mm 7X3')).toEqual(want);
  });

  test('피치 없으면 3mm로 가정', () => {
    expect(parseScheduleText('7*3')).toEqual([
      { label: null, pitch: '3mm', areaWm: 7, areaHm: 3 },
    ]);
  });

  test('지원 밖 피치(5mm)도 3mm로 가정', () => {
    expect(parseScheduleText('5mm 7*3')).toEqual([
      { label: null, pitch: '3mm', areaWm: 7, areaHm: 3 },
    ]);
  });

  test('양쪽 소수 "3mm 6.5*2.25"', () => {
    expect(parseScheduleText('3mm 6.5*2.25')).toEqual([
      { label: null, pitch: '3mm', areaWm: 6.5, areaHm: 2.25 },
    ]);
  });

  test('제목+본문 blob에서 전화번호·주소는 안 걸림', () => {
    const text = 'OO페스티벌 무대 LED\n장소: 서울 강남구 어딘가로 123\n담당 010-1234-5678\n3mm 12*4.5 설치';
    expect(parseScheduleText(text)).toEqual([
      { label: null, pitch: '3mm', areaWm: 12, areaHm: 4.5 },
    ]);
  });
});

describe('parseScheduleText — 멀티(좌우/중앙)', () => {
  test('"중앙 6*3, 좌우 3*2.5" → 3섹션', () => {
    expect(parseScheduleText('중앙 6*3, 좌우 3*2.5')).toEqual([
      { label: '중앙', pitch: '3mm', areaWm: 6, areaHm: 3 },
      { label: '좌', pitch: '3mm', areaWm: 3, areaHm: 2.5 },
      { label: '우', pitch: '3mm', areaWm: 3, areaHm: 2.5 },
    ]);
  });

  test('좌측/우측 개별 크기', () => {
    expect(parseScheduleText('중앙 6*3 좌측 2*2 우측 2.5*2')).toEqual([
      { label: '중앙', pitch: '3mm', areaWm: 6, areaHm: 3 },
      { label: '좌', pitch: '3mm', areaWm: 2, areaHm: 2 },
      { label: '우', pitch: '3mm', areaWm: 2.5, areaHm: 2 },
    ]);
  });

  test('피치는 모든 섹션에 적용', () => {
    const out = parseScheduleText('3mm 중앙 6*3 좌우 3*2.5');
    expect(out.map(s => s.pitch)).toEqual(['3mm', '3mm', '3mm']);
  });

  test('라벨 없는 첫 N*M을 중앙으로', () => {
    expect(parseScheduleText('6*3 좌우 3*2.5')).toEqual([
      { label: '중앙', pitch: '3mm', areaWm: 6, areaHm: 3 },
      { label: '좌', pitch: '3mm', areaWm: 3, areaHm: 2.5 },
      { label: '우', pitch: '3mm', areaWm: 3, areaHm: 2.5 },
    ]);
  });

  test('좌우만 있으면 2섹션', () => {
    expect(parseScheduleText('좌측 3*2 우측 3*2')).toEqual([
      { label: '좌', pitch: '3mm', areaWm: 3, areaHm: 2 },
      { label: '우', pitch: '3mm', areaWm: 3, areaHm: 2 },
    ]);
  });

  test('"좌 N" 축약형도 멀티로 인식', () => {
    expect(parseScheduleText('중앙 6*3 좌 2*2 우 2*2')).toEqual([
      { label: '중앙', pitch: '3mm', areaWm: 6, areaHm: 3 },
      { label: '좌', pitch: '3mm', areaWm: 2, areaHm: 2 },
      { label: '우', pitch: '3mm', areaWm: 2, areaHm: 2 },
    ]);
  });

  test('자유 텍스트에 "중앙무대"·"좌우중계" 단어만 섞이면 단일로 폴백', () => {
    // 실측: 섹션 2개를 못 뽑으면 첫 N*M 하나만. 라벨 오염 안 됨.
    expect(parseScheduleText('광복절 전야제 셋업\n3mm 18*5 중앙무대(대진렌탈) 4mm 20*5 좌우중계 더 팀')).toEqual([
      { label: null, pitch: '3mm', areaWm: 18, areaHm: 5 },
    ]);
  });

  test('"중앙 1*4 패턴" 같은 부가 설명이 있어도 첫 N*M(주 화면)을 잡음', () => {
    expect(parseScheduleText('경기도자비엔날레 셋업\n3mm 14*4 중앙 1*4 패턴 좌우 2줄 4mm 6*4 좌우 레이허')).toEqual([
      { label: null, pitch: '3mm', areaWm: 14, areaHm: 4 },
    ]);
  });
});

describe('parseScheduleText — 여러 조가 줄마다 나뉜 목록(2026-09-16, 사용자 제보 실측 스크린샷 2건)', () => {
  test('강남페스티벌: 중앙/좌/우 + 라벨 없는 항목(피치·크기가 줄마다 따로) 5개 전부 뽑힘', () => {
    const text = [
      '강남페스티벌 셋업',
      '1.도산공원 진입로',
      '3mm 중앙 6*4 좌우 3*4',
      '4mm 콘솔 6*3.5',
      '레이허',
      '2.도산대로',
      '4mm 10*6',
      '레이허',
      '',
      '01시 셋업',
    ].join('\n');
    expect(parseScheduleText(text)).toEqual([
      { label: '중앙', pitch: '3mm', areaWm: 6, areaHm: 4 },
      { label: '좌', pitch: '3mm', areaWm: 3, areaHm: 4 },
      { label: '우', pitch: '3mm', areaWm: 3, areaHm: 4 },
      { label: '콘솔', pitch: '4mm', areaWm: 6, areaHm: 3.5 },
      { label: '5', pitch: '4mm', areaWm: 10, areaHm: 6 },
    ]);
  });

  test('시흥 동아리 축제: 번호 매긴 4줄 전부 뽑히고 괄호 설명은 라벨로 쓰임', () => {
    const text = [
      '시흥 동아리 축제 셋업',
      '1.메인 중앙 3mm 8*3',
      '2.4mm 4*3',
      '3.4mm 4*3',
      '4.4mm 3*2(게임중계화면)',
      '프로필',
      '오후 셋업',
    ].join('\n');
    expect(parseScheduleText(text)).toEqual([
      { label: '중앙', pitch: '3mm', areaWm: 8, areaHm: 3 },
      { label: '2', pitch: '4mm', areaWm: 4, areaHm: 3 },
      { label: '3', pitch: '4mm', areaWm: 4, areaHm: 3 },
      { label: '게임중계화면', pitch: '4mm', areaWm: 3, areaHm: 2 },
    ]);
  });

  test('한 줄에만 피치+크기가 있으면(나머지는 부가 줄) 목록 모드로 안 들어가고 단일로 폴백', () => {
    // qualifying line이 1개뿐이면(2개 미만) 기존 오탐 방지 로직 그대로 유지.
    expect(parseScheduleText('제목\n3mm 7*3\n부가 설명 줄')).toEqual([
      { label: null, pitch: '3mm', areaWm: 7, areaHm: 3 },
    ]);
  });
});

describe('parseScheduleText — 에러', () => {
  test('무관한 텍스트', () => {
    expect(() => parseScheduleText('안녕하세요 회의 잘 부탁드립니다')).toThrow(/피치 또는 설치 면적/);
  });

  test('피치만 있고 면적 없음', () => {
    expect(() => parseScheduleText('3mm 설치 예정')).toThrow(/설치 면적/);
  });

  test('멀티 키워드만 있고 크기 없음', () => {
    expect(() => parseScheduleText('좌우 있음')).toThrow(/설치 면적/);
  });
});

describe('panelSizeForPitch', () => {
  test('2mm → 500×500', () => {
    expect(panelSizeForPitch('2mm')).toEqual({ panelW: 500, panelH: 500 });
  });

  test('3mm/4mm → 500×1000', () => {
    expect(panelSizeForPitch('3mm')).toEqual({ panelW: 500, panelH: 1000 });
    expect(panelSizeForPitch('4mm')).toEqual({ panelW: 500, panelH: 1000 });
  });
});
