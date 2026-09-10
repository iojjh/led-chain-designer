// ── scheduleFeed ────────────────────────────────────
// 밴드 일정을 서버·로그인 없이 앱으로 가져오는 피드. 자매 모듈 cloudShare.js와
// 같은 구조 — 쓰기는 구글 설문지 응답 제출(숨은 iframe <form> POST, 응답을 읽지
// 않으므로 CORS도 로그인도 불필요), 읽기는 그 응답이 쌓이는 시트를 "웹에 게시"한
// CSV를 fetch로 읽는다(구글이 공개 게시 문서엔 CORS를 허용해 프록시가 필요 없음).
// cloudShare의 프리셋 공유와는 완전히 별개인 두 번째 폼/시트를 쓴다.
//
// 소스 무관 설계: 앱은 SCHEDULE_SHEET_CSV_URL의 행만 읽는다. 지금은 사람이 앱
// textarea(또는 구글 폼)에 밴드 메시지를 붙여넣어 행이 쌓이지만, 나중에
// Gmail→시트 Apps Script나 밴드 웹 스크래퍼가 같은 열 순서(타임스탬프·날짜·
// 제목·일정 내용)로 행을 추가해도 앱 코드는 그대로 동작한다.
//
// 설정 절차(아래 5개 상수 채우기): 일정-피드-설정.md 참고. 상수가 비어 있으면
// 기능은 비활성 — 모달이 "설정되지 않았습니다"를 표시하고 요청을 하지 않는다.

const SCHEDULE_FORM_RESPONSE_URL = '';   // 구글 폼 제출 URL (.../formResponse)
const SCHEDULE_FORM_ENTRY_DATE = '';     // 'entry.XXXXXXX' — 날짜 질문
const SCHEDULE_FORM_ENTRY_TITLE = '';    // 'entry.XXXXXXX' — 제목 질문
const SCHEDULE_FORM_ENTRY_BODY = '';     // 'entry.XXXXXXX' — 일정 내용 질문
const SCHEDULE_SHEET_CSV_URL = '';       // 응답 시트 "웹에 게시" CSV URL

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

// cloudShare.js의 submitCloudForm과 같은 방식 — 숨은 iframe(cloudShareFrame,
// 없으면 생성)을 타깃한 <form> POST. 교차 출처라 성공 여부를 JS로 못 읽으므로
// 잠깐 기다렸다가 완료 처리한다(실제 반영은 사용자가 목록에서 확인).
function submitScheduleForm(date, title, body) {
  if (!SCHEDULE_FORM_RESPONSE_URL) {
    return Promise.reject(new Error('일정 폼이 아직 설정되지 않았습니다.'));
  }
  return new Promise(resolve => {
    let iframe = document.getElementById('cloudShareFrame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'cloudShareFrame';
      iframe.name = 'cloudShareFrame';
      iframe.hidden = true;
      document.body.appendChild(iframe);
    }
    const form = document.createElement('form');
    form.action = SCHEDULE_FORM_RESPONSE_URL;
    form.method = 'POST';
    form.target = 'cloudShareFrame';
    form.hidden = true;
    const addField = (name, value) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };
    addField(SCHEDULE_FORM_ENTRY_DATE, date);
    addField(SCHEDULE_FORM_ENTRY_TITLE, title);
    addField(SCHEDULE_FORM_ENTRY_BODY, body);
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => { form.remove(); resolve(); }, 600);
  });
}

if (typeof module !== 'undefined') { module.exports = { mapScheduleRows }; }
