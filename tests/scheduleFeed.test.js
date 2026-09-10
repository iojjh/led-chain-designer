const { parseIcs, stripSchedFooter, icsDate, dedupeScheduleRows } = require('../js/save/scheduleFeed.js');
const { parseScheduleText } = require('../js/leddesign/scheduleParse.js');

// 실측 Outlook 피드에서 뽑은 형태 (CRLF, 줄 폴딩, TZID, \, \n 이스케이프 포함)
const REAL_ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DESCRIPTION:3mm 4*2.5 프로파일 전기단상 75m 콘솔 10m - A-TEAM(CJ)',
  ' : 기본 캘린더\\, 양영열(전식\\,특효는 A-TEAM) 등록\\n',
  'UID:040000008200E00074C5B7101A82E008-1',
  'SUMMARY:영등포 정원축제 셋업',
  'DTSTART;TZID=Korea Standard Time:20260611T110000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:인천반도체포럼 행사(3y)',
  'DESCRIPTION:영상오퍼',
  'DTSTART;VALUE=DATE:20260626',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcs', () => {
  test('VEVENT 2건 파싱, 줄 폴딩 해제', () => {
    const events = parseIcs(REAL_ICS);
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('영등포 정원축제 셋업');
    expect(events[0].date).toBe('2026-06-11');
    // 줄 폴딩(CRLF + 공백 1칸)은 CRLF와 그 공백까지 함께 제거된다(RFC 5545).
    expect(events[0].description).toBe(
      '3mm 4*2.5 프로파일 전기단상 75m 콘솔 10m - A-TEAM(CJ): 기본 캘린더, 양영열(전식,특효는 A-TEAM) 등록\n',
    );
  });

  test('VALUE=DATE 종일 일정도 날짜 파싱', () => {
    expect(parseIcs(REAL_ICS)[1].date).toBe('2026-06-26');
  });

  test('SUMMARY 또는 DTSTART 없는 블록은 버림', () => {
    const ics = 'BEGIN:VEVENT\r\nDTSTART:20260101\r\nEND:VEVENT\r\n';
    expect(parseIcs(ics)).toEqual([]);
  });

  test('빈 입력', () => {
    expect(parseIcs('')).toEqual([]);
    expect(parseIcs(null)).toEqual([]);
  });
});

describe('stripSchedFooter', () => {
  test('" - 대문자..." 꼬리말 제거', () => {
    expect(stripSchedFooter('3mm 4*2.5 프로파일 전기단상 75m 콘솔 10m - A-TEAM(CJ) : 기본 캘린더'))
      .toBe('3mm 4*2.5 프로파일 전기단상 75m 콘솔 10m');
  });

  test('꼬리말 없으면 그대로(trim만)', () => {
    expect(stripSchedFooter('  3mm 7*3 프로파일  ')).toBe('3mm 7*3 프로파일');
  });

  test('빈/누락 입력', () => {
    expect(stripSchedFooter('')).toBe('');
    expect(stripSchedFooter(null)).toBe('');
  });
});

describe('dedupeScheduleRows', () => {
  test('같은 날짜·제목이면 본문이 가장 긴 것만 남긴다', () => {
    const rows = [
      { date: '2026-09-11', title: '생물다양성탐사대회 셋업', body: '3mm 4*3 레이허 야외' },
      { date: '2026-09-11', title: '생물다양성탐사대회 셋업', body: '3mm 4*3 레이허 야외 11시 도착 전기 20m' },
      { date: '2026-09-12', title: '허준인트로축제', body: '3mm 7*3 프로파일' },
      { date: '2026-09-12', title: '허준인트로축제', body: '3mm 7*3 프로파일' },
    ];
    expect(dedupeScheduleRows(rows)).toEqual([
      { date: '2026-09-11', title: '생물다양성탐사대회 셋업', body: '3mm 4*3 레이허 야외 11시 도착 전기 20m' },
      { date: '2026-09-12', title: '허준인트로축제', body: '3mm 7*3 프로파일' },
    ]);
  });

  test('날짜가 다르면 유지', () => {
    const rows = [
      { date: '2026-09-11', title: '크레스트72', body: 'a' },
      { date: '2026-09-12', title: '크레스트72', body: 'b' },
    ];
    expect(dedupeScheduleRows(rows)).toHaveLength(2);
  });
});

describe('icsDate', () => {
  test('YYYYMMDDTHHMMSS', () => { expect(icsDate('20260611T110000')).toBe('2026-06-11'); });
  test('YYYYMMDD', () => { expect(icsDate('20260626')).toBe('2026-06-26'); });
  test('trailing Z', () => { expect(icsDate('20260910T144835Z')).toBe('2026-09-10'); });
});

describe('parseIcs → stripSchedFooter → parseScheduleText 통합', () => {
  test('실측 일정이 피치·면적으로 파싱됨', () => {
    const e = parseIcs(REAL_ICS)[0];
    const body = stripSchedFooter(e.description);
    expect(parseScheduleText(e.title + '\n' + body)).toEqual([
      { label: null, pitch: '3mm', areaWm: 4, areaHm: 2.5 },
    ]);
  });

  test('LED 아닌 일정("영상오퍼")은 parseScheduleText가 throw', () => {
    const e = parseIcs(REAL_ICS)[1];
    expect(() => parseScheduleText(e.title + '\n' + stripSchedFooter(e.description)))
      .toThrow(/피치 또는 설치 면적/);
  });
});
