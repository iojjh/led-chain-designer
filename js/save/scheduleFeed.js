// ── scheduleFeed ────────────────────────────────────
// 밴드 일정을 서버·로그인 없이 앱으로 가져오는 읽기 전용 피드. 밴드 일정이
// 자동으로 쌓이는 구글 시트를 "웹에 게시"한 CSV를 fetch로 읽는다(구글이 공개
// 게시 문서엔 CORS를 허용해 프록시가 필요 없음).
//
// 소스 무관 설계: 앱은 SCHEDULE_SHEET_CSV_URL의 행만 읽는다 — 그 행을 무엇이
// 채우는지(Gmail→시트 Apps Script, 밴드 스크래퍼, 구글 폼 수동 입력 등)는
// 앱과 무관하다. 열 순서만 타임스탬프·날짜·제목·일정 내용으로 지키면 된다.
//
// 설정 절차: 일정-피드-설정.md 참고. URL이 비어 있으면 기능 비활성 — 모달이
// "설정되지 않았습니다"를 표시하고 요청을 하지 않는다.

const SCHEDULE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSbpnMw8YKfLM_4ZnJA1CP95OMsHZwv9XQwpapvHmhYrNPl0mNPMk_wFq5PDq7XRYjLE5_c2QKJQ5z4/pub?gid=608217936&single=true&output=csv';

// 브라우저에선 cloudShare.js가 먼저 로드돼 parseCsv가 이미 전역이다.
// Jest에선 여기서 끌어온다(ledAreaSetup.js의 SPECS 로딩과 같은 패턴).
if (typeof module !== 'undefined' && typeof parseCsv === 'undefined') {
  global.parseCsv = require('./cloudShare.js').parseCsv;
}

// 응답 시트 열 순서: 타임스탬프 | 날짜 | 제목 | 일정 내용 (구글 폼 응답 시트 기본).
function mapScheduleRows(rows) {
  return rows.slice(1) // 헤더 제외
    .filter(r => r.length >= 4 && r[3]) // 본문 있는 행만
    .map(r => ({ submittedAt: r[0], date: r[1], title: r[2], body: r[3] }))
    .reverse(); // 최신순
}

async function fetchScheduleEntries() {
  if (!SCHEDULE_SHEET_CSV_URL) { return []; }
  const res = await fetch(SCHEDULE_SHEET_CSV_URL, { cache: 'no-store' });
  if (!res.ok) { throw new Error('HTTP ' + res.status); }
  return mapScheduleRows(parseCsv(await res.text()));
}

if (typeof module !== 'undefined') { module.exports = { mapScheduleRows }; }
