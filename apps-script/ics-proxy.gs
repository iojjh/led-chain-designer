/**
 * Outlook 공개 캘린더(ICS) CORS 프록시
 * ====================================
 * 노드앱은 브라우저에서 Outlook ICS를 직접 못 읽는다(응답에 CORS 헤더가 없음).
 * 이 Apps Script를 "웹 앱"으로 배포하면, doGet이 서버에서 ICS를 받아 CORS가
 * 열린 응답으로 그대로 돌려준다. 노드앱은 이 /exec URL을 fetch한다.
 *
 * 배포:
 *  1. script.google.com → 새 프로젝트 → 이 내용 붙여넣기
 *  2. 저장 → 배포 → 새 배포 → 유형: 웹 앱
 *     - 실행: 나(kdj3531)
 *     - 액세스 권한: 모든 사용자
 *  3. 배포 → 처음이면 권한 승인(외부 URL 읽기)
 *  4. 나오는 웹 앱 URL(.../exec)을 js/save/scheduleFeed.js 의
 *     SCHEDULE_ICS_PROXY_URL 에 붙여넣기
 *
 * 캘린더를 바꾸려면 아래 ICS_URL만 고치고 다시 배포(기존 배포 관리 → 편집 → 새 버전).
 */

var ICS_URL = 'https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/cfc7d81d-4e85-4980-8652-3a1ecc64867d/cid-610EC8FF2A0B2E95/calendar.ics';

function doGet() {
  var res = UrlFetchApp.fetch(ICS_URL, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; apps-script)' },
  });
  var body = res.getResponseCode() === 200 ? res.getContentText() : 'ICS HTTP ' + res.getResponseCode();
  // Apps Script 웹 앱의 doGet 응답에는 Access-Control-Allow-Origin: * 가 자동으로 붙어
  // 브라우저 fetch(GET)가 교차 출처로 읽을 수 있다.
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.TEXT);
}
