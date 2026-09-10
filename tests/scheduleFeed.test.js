const { mapScheduleRows } = require('../js/save/scheduleFeed.js');
const { parseCsv } = require('../js/save/cloudShare.js');
const { parseScheduleText } = require('../js/leddesign/scheduleParse.js');

const HEADER = ['타임스탬프', '날짜', '제목', '일정 내용'];

describe('mapScheduleRows', () => {
  test('헤더 제외, 최신순(역순), 필드 매핑', () => {
    const rows = [
      HEADER,
      ['2026-09-01 10:00', '9/10', '첫 현장', '3mm 7*3'],
      ['2026-09-02 11:00', '9/12', '둘째 현장', '4mm 5*3'],
    ];
    expect(mapScheduleRows(rows)).toEqual([
      { submittedAt: '2026-09-02 11:00', date: '9/12', title: '둘째 현장', body: '4mm 5*3' },
      { submittedAt: '2026-09-01 10:00', date: '9/10', title: '첫 현장', body: '3mm 7*3' },
    ]);
  });

  test('본문 빈 행은 제외', () => {
    const rows = [HEADER, ['2026-09-01', '9/10', '제목만', '']];
    expect(mapScheduleRows(rows)).toEqual([]);
  });

  test('열이 모자란 행은 제외', () => {
    const rows = [HEADER, ['2026-09-01', '9/10', '제목만']];
    expect(mapScheduleRows(rows)).toEqual([]);
  });

  test('헤더만 있으면 빈 배열', () => {
    expect(mapScheduleRows([HEADER])).toEqual([]);
  });

  test('완전히 빈 입력', () => {
    expect(mapScheduleRows([])).toEqual([]);
  });
});

describe('parseCsv → mapScheduleRows 통합', () => {
  test('따옴표로 감싼 본문의 줄바꿈·쉼표·이스케이프 보존', () => {
    const csv = [
      '타임스탬프,날짜,제목,일정 내용',
      '2026-09-01,9/10,"현장, A","3mm 7*3\n담당자: ""홍길동"""',
      '',
    ].join('\n');
    expect(mapScheduleRows(parseCsv(csv))).toEqual([
      { submittedAt: '2026-09-01', date: '9/10', title: '현장, A', body: '3mm 7*3\n담당자: "홍길동"' },
    ]);
  });

  test('멀티라인 멀티섹션 본문 → parseScheduleText까지 e2e', () => {
    const csv = [
      '타임스탬프,날짜,제목,일정 내용',
      '2026-09-01,9/10,행사,"중앙 6*3,\n좌우 3*2.5"',
      '',
    ].join('\n');
    const entry = mapScheduleRows(parseCsv(csv))[0];
    const sections = parseScheduleText(entry.title + '\n' + entry.body);
    expect(sections).toEqual([
      { label: '중앙', pitch: '3mm', areaWm: 6, areaHm: 3 },
      { label: '좌', pitch: '3mm', areaWm: 3, areaHm: 2.5 },
      { label: '우', pitch: '3mm', areaWm: 3, areaHm: 2.5 },
    ]);
  });
});
