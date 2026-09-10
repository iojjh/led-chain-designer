/**
 * Outlook 공개 캘린더(ICS) → 구글 시트 동기화
 * ================================================
 * 노드앱 "일정에서 LED 추가"가 읽는 시트에, 계산기앱도 쓰는 Outlook 공유
 * 캘린더의 일정을 자동으로 채워 넣는다. 사람이 하는 일은 "밴드 일정 → Outlook
 * 캘린더" 뿐이고(계산기앱용으로 이미 하던 작업), 그다음은 이 스크립트가 15~30분
 * 마다 돌면서 처리한다.
 *
 * 설치:
 *  1. 노드앱 일정이 쌓이는 그 구글 시트를 연다 → 확장 프로그램 → Apps Script
 *  2. 이 파일 내용을 통째로 붙여넣고 저장
 *  3. 함수 목록에서 syncOutlookToSheet 선택 → 실행 → 권한 승인(1회)
 *     (외부 URL fetch + 스프레드시트 쓰기 권한)
 *  4. 함수 목록에서 installTrigger 실행 → 30분 주기 트리거 설치
 *     (또는 왼쪽 "트리거" → 트리거 추가 → syncOutlookToSheet / 시간 기반 / 30분)
 *
 * 시트 열 순서는 타임스탬프 | 날짜 | 제목 | 일정 내용 이어야 한다
 * (노드앱 scheduleFeed.js의 mapScheduleRows 가정과 동일).
 */

// ── 설정 ───────────────────────────────────────────
var ICS_URL = 'https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/cfc7d81d-4e85-4980-8652-3a1ecc64867d/cid-610EC8FF2A0B2E95/calendar.ics';
var TARGET_GID = 608217936;        // 노드앱이 읽는(게시된) 시트 탭의 gid. 0이면 첫 번째 탭 사용.
var SEEN_SHEET_NAME = '_seen';     // 처리한 UID를 적어두는 숨김 탭(중복 방지)
var DATE_CUTOFF_DAYS = 60;         // 이 일수보다 오래 지난(시작일 기준) 일정은 건너뜀
var MAX_ROWS_PER_RUN = 50;         // 한 번에 추가할 최대 행 수(안전장치)

// ── 메인 ───────────────────────────────────────────
function syncOutlookToSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var target = _sheetByGid(ss, TARGET_GID) || ss.getSheets()[0];
  var seen = _readSeen(ss);

  var res = UrlFetchApp.fetch(ICS_URL, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; apps-script)' },
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('ICS HTTP ' + res.getResponseCode());
  }

  var events = _parseIcs(res.getContentText());
  var cutoff = _ymd(new Date(Date.now() - DATE_CUTOFF_DAYS * 86400000));

  var fresh = events.filter(function (e) {
    if (!e.uid || seen[e.uid]) { return false; }
    if (e.date !== '' && e.date < cutoff) { return false; }
    // LED 설치가 아닌 일정(예: "영상오퍼")은 시트에 안 넣는다 — 설치면적(N*M) 표기가 있어야.
    return /\d\s*[*×xX]\s*\d/.test((e.summary || '') + ' ' + (e.description || ''));
  }).slice(0, MAX_ROWS_PER_RUN);

  if (fresh.length) {
    var now = new Date();
    var rows = fresh.map(function (e) {
      var body = ((e.summary || '') + '\n' + _stripFooter(e.description || '')).trim();
      return [now, e.date, e.summary || '', body];
    });
    target.getRange(target.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    _appendSeen(ss, fresh.map(function (e) { return e.uid; }));
  }

  Logger.log('추가 ' + fresh.length + ' / ICS 이벤트 ' + events.length);
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncOutlookToSheet') { ScriptApp.deleteTrigger(t); }
  });
  ScriptApp.newTrigger('syncOutlookToSheet').timeBased().everyMinutes(30).create();
  Logger.log('30분 주기 트리거 설치 완료');
}

// ── ICS 파서 (계산기앱 script.js의 _parseIcs 이식) ──
function _parseIcs(raw) {
  // 줄바꿈 정규화 후 폴딩(다음 줄 첫 글자가 공백/탭) 해제
  var text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  var blocks = text.split('BEGIN:VEVENT').slice(1);
  var events = [];
  for (var i = 0; i < blocks.length; i++) {
    var body = blocks[i].split('END:VEVENT')[0];
    var lines = body.split('\n');
    var ev = { uid: '', summary: '', description: '', location: '', date: '' };
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      var sep = line.indexOf(':');
      if (sep < 0) { continue; }
      var key = line.slice(0, sep).split(';')[0].toUpperCase();
      var val = line.slice(sep + 1).trim();
      if (key === 'UID') { ev.uid = val; }
      else if (key === 'SUMMARY') { ev.summary = _icsUnescape(val); }
      else if (key === 'DESCRIPTION') { ev.description = _icsUnescape(val); }
      else if (key === 'LOCATION') { ev.location = _icsUnescape(val); }
      else if (key === 'DTSTART') { ev.date = _icsDate(val); }
    }
    if (ev.uid && ev.summary) { events.push(ev); }
  }
  return events;
}

function _icsUnescape(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// 'YYYYMMDD' 또는 'YYYYMMDDTHHMMSS[Z]' → 'YYYY-MM-DD'
function _icsDate(val) {
  var s = val.replace(/Z$/, '');
  if (s.length >= 8) { return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
  return '';
}

function _ymd(d) {
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + day;
}

// 계산기앱 _stripSchedFooter — Band→Outlook 변환 시 붙는 " - 대문자..." 꼬리말 제거
function _stripFooter(s) {
  var idx = s.search(/ - [A-Z]/);
  return (idx > 0 ? s.slice(0, idx) : s).trim();
}

// ── 처리 완료 UID 저장(_seen 숨김 탭) ──────────────
function _readSeen(ss) {
  var sh = ss.getSheetByName(SEEN_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SEEN_SHEET_NAME);
    sh.hideSheet();
    return {};
  }
  var last = sh.getLastRow();
  var map = {};
  if (last > 0) {
    var vals = sh.getRange(1, 1, last, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (vals[i][0]) { map[String(vals[i][0])] = true; }
    }
  }
  return map;
}

function _appendSeen(ss, uids) {
  var sh = ss.getSheetByName(SEEN_SHEET_NAME) || ss.insertSheet(SEEN_SHEET_NAME);
  var rows = uids.map(function (u) { return [u]; });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 1).setValues(rows);
}

function _sheetByGid(ss, gid) {
  if (!gid) { return null; }
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) { return sheets[i]; }
  }
  return null;
}
