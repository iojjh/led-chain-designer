// ── scheduleFeed ────────────────────────────────────
// 밴드 일정을 노드앱으로 가져오는 읽기 전용 피드. 계산기앱도 쓰는 Outlook 공유
// 캘린더의 ICS를 읽어 파싱한다 — 사람이 하는 일은 "밴드 일정 → Outlook 캘린더"
// 뿐(계산기용으로 이미 하던 작업).
//
// Outlook ICS 응답엔 CORS 헤더가 없어 브라우저에서 직접 못 읽는다. 그래서
// apps-script/ics-proxy.gs 를 "웹 앱"으로 배포해 그 /exec URL을 아래
// SCHEDULE_ICS_PROXY_URL 에 넣는다(설정 절차: 일정-피드-설정.md). 비어 있으면
// 기능 비활성 — 모달이 "설정되지 않았습니다"를 표시하고 요청을 안 한다.

const SCHEDULE_ICS_PROXY_URL = 'https://script.google.com/macros/s/AKfycbzPAdGgWQrHLCxgKUWH37wpZ_MwY2Udi2xq88czs20VLNqPM7OvoTsv6nzpT0NKiwFv/exec';   // Apps Script 웹 앱 (.../exec)
const SCHEDULE_RECENT_DAYS = 7;      // 시작일이 오늘 -이 일수 이전인 일정은 목록에서 제외

// ── ICS 파싱 (계산기앱 script.js의 _parseIcs·_stripSchedFooter 이식) ──
function parseIcs(raw) {
  // 줄바꿈 정규화 후 폴딩(다음 줄 첫 글자가 공백/탭) 해제
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  for (const blk of blocks) {
    const body = blk.split('END:VEVENT')[0];
    const ev = { date: '', title: '', description: '' };
    for (const line of body.split('\n')) {
      const sep = line.indexOf(':');
      if (sep < 0) { continue; }
      const key = line.slice(0, sep).split(';')[0].toUpperCase();
      const val = line.slice(sep + 1).trim();
      if (key === 'SUMMARY') { ev.title = icsUnescape(val); }
      else if (key === 'DESCRIPTION') { ev.description = icsUnescape(val); }
      else if (key === 'DTSTART') { ev.date = icsDate(val); }
    }
    if (ev.title && ev.date) { events.push(ev); }
  }
  return events;
}

function icsUnescape(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// 'YYYYMMDD' 또는 'YYYYMMDDTHHMMSS[Z]' → 'YYYY-MM-DD'
function icsDate(val) {
  const s = val.replace(/Z$/, '');
  if (s.length >= 8) { return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
  return '';
}

// Band→Outlook 변환 시 붙는 " - 대문자..." 꼬리말 제거 (계산기 _stripSchedFooter).
function stripSchedFooter(s) {
  const idx = String(s || '').search(/ - [A-Z]/);
  return (idx > 0 ? s.slice(0, idx) : String(s || '')).trim();
}

function _cutoffYmd(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

async function fetchScheduleEntries() {
  if (!SCHEDULE_ICS_PROXY_URL) { return []; }
  const res = await fetch(SCHEDULE_ICS_PROXY_URL, { cache: 'no-store' });
  if (!res.ok) { throw new Error('HTTP ' + res.status); }
  const cutoff = _cutoffYmd(SCHEDULE_RECENT_DAYS);
  return parseIcs(await res.text())
    .filter(e => e.date >= cutoff)
    // 설치면적(N*M) 표기가 없는 일정(예: "영상오퍼")은 목록에서 뺀다.
    .filter(e => /\d\s*[*×xX]\s*\d/.test(e.title + ' ' + e.description))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(e => ({ date: e.date, title: e.title, body: stripSchedFooter(e.description) }));
}

if (typeof module !== 'undefined') { module.exports = { parseIcs, stripSchedFooter, icsDate }; }
