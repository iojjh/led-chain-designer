// ── cloudShare ──────────────────────────────────────
// 프리셋을 서버·계정 없이 앱 사용자끼리 공유한다. 쓰기는 구글 설문지 응답
// 제출(숨은 iframe으로 타깃팅한 <form> POST — 응답을 읽지 않으므로 CORS 자체가
// 안 걸리고, 로그인도 불필요), 읽기는 그 응답이 쌓이는 스프레드시트를 "웹에
// 게시"한 CSV를 fetch로 그냥 읽는다(구글이 공개 게시 문서엔 CORS를 허용해
// 프록시가 필요 없음). 자매 프로젝트 led-calculator의 아웃룩 ICS 일정
// 불러오기(§13, corsproxy.io 경유)와 같은 발상이지만, 쓰기 경로가 없던 그쪽과
// 달리 이쪽은 쓰기까지 로그인 없이 가능하다.
//
// 세팅(2026-08-24, 사용자 제공):
// - 구글 설문지: 이름(단답형) + 데이터(장문형) 2문항, 로그인 요구 없음
// - 응답 스프레드시트를 "웹에 게시 → CSV"로 공개

const CLOUD_FORM_RESPONSE_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdXPL8DP4KcenvgJWQgA4HRI2Gk_7W4JU2CW2ObMP9i1Ipxbw/formResponse';
const CLOUD_FORM_ENTRY_NAME = 'entry.335371680';
const CLOUD_FORM_ENTRY_DATA = 'entry.1249276452';
const CLOUD_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSiGrEoZDXutjfj9BuOSWT3V5oUwuUNfgWWiV8_ajEMOGOGYQc_8hxIv-6z_UBq2lLqAefAJByVafK6/pub?gid=1800045482&single=true&output=csv';
// 삭제 전용 — 설문지로는 응답을 지울 수 없어, 같은 시트에 바인딩한 Apps
// Script 웹 앱(사용자가 직접 배포, doPost로 "데이터" 열이 일치하는 행을 삭제)을 쓴다.
const CLOUD_DELETE_URL = 'https://script.google.com/macros/s/AKfycbywbXtmvgGly-5M0EL5cgiUzfbAGCiSsZbLM7u_PfYaVPABu0uwDg92u_bR51HgGNDwgw/exec';

// ── base64url ────────────────────────────────────────
function bytesToBase64Url(bytes) {
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// ── gzip 압축/해제 — CompressionStream 미지원 브라우저는 무압축(raw)으로 폴백 ──
async function compressToTagged(str) {
  const bytes = new TextEncoder().encode(str);
  if (typeof CompressionStream === 'undefined') { return 'raw:' + bytesToBase64Url(bytes); }
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  return 'gz:' + bytesToBase64Url(compressed);
}

async function decompressFromTagged(tagged) {
  const sep = tagged.indexOf(':');
  const tag = sep === -1 ? 'raw' : tagged.slice(0, sep);
  const data = sep === -1 ? tagged : tagged.slice(sep + 1);
  const bytes = base64UrlToBytes(data);
  if (tag === 'raw') { return new TextDecoder().decode(bytes); }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('이 브라우저는 압축 해제(DecompressionStream)를 지원하지 않습니다.');
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const decompressed = new Uint8Array(await new Response(ds.readable).arrayBuffer());
  return new TextDecoder().decode(decompressed);
}

// ── 스프레드시트 CSV 파서(RFC4180 최소 구현 — 따옴표/쉼표/개행 이스케이프만 처리,
// 구글 시트 "웹에 게시" 출력이 이 규칙을 그대로 따름) ──
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') { i += 1; }
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── 쓰기: 숨은 iframe으로 설문지 응답 제출 ──────────────
function submitCloudForm(name, dataStr) {
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
    form.action = CLOUD_FORM_RESPONSE_URL;
    form.method = 'POST';
    form.target = 'cloudShareFrame';
    form.hidden = true;
    const addField = (fieldName, value) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = fieldName;
      input.value = value;
      form.appendChild(input);
    };
    addField(CLOUD_FORM_ENTRY_NAME, name);
    addField(CLOUD_FORM_ENTRY_DATA, dataStr);
    document.body.appendChild(form);
    form.submit();
    // 교차 출처 iframe이라 제출 성공 여부를 JS로 읽을 방법이 없다 — 구글 폼
    // 다운타임 정도가 아니면 거의 실패하지 않으므로, 잠깐 기다렸다가 완료
    // 처리한다. 실제 반영 여부는 사용자가 커뮤니티 목록에서 확인할 수 있다.
    setTimeout(() => { form.remove(); resolve(); }, 600);
  });
}

async function shareGraphToCloud(name, graph) {
  const tagged = await compressToTagged(JSON.stringify(graph));
  await submitCloudForm(name, tagged);
}

// ── 읽기: 게시된 CSV fetch ───────────────────────────
async function fetchCloudPresets() {
  const res = await fetch(CLOUD_SHEET_CSV_URL, { cache: 'no-store' });
  if (!res.ok) { throw new Error('HTTP ' + res.status); }
  const rows = parseCsv(await res.text());
  return rows.slice(1) // 헤더(타임스탬프,이름,데이터) 제외
    .filter(r => r.length >= 3 && r[2])
    .map(r => ({ date: r[0], name: r[1], data: r[2] }))
    .reverse(); // 최신순
}

async function loadCloudPresetGraph(dataStr) {
  return JSON.parse(await decompressFromTagged(dataStr));
}

// ── 삭제: Apps Script 웹 앱에 "데이터" 열 값으로 행 식별해 삭제 요청 ──
// text/plain Content-Type을 써서 브라우저가 프리플라이트(OPTIONS) 없이 바로
// 보내는 "단순 요청"으로 만든다 — Apps Script 웹 앱은 OPTIONS를 처리하지 않아
// application/json으로 보내면 CORS 프리플라이트에서 막힌다.
async function deleteCloudPreset(dataStr) {
  // keepalive: true — 화면에서는 삭제 버튼을 누르는 즉시 목록에서 지우고 이 요청은
  // 기다리지 않고 백그라운드로 보낸다(saveStore.js의 onCloudDeleteClick). keepalive가
  // 없으면 요청이 끝나기 전에 앱(탭)이 닫힐 때 브라우저가 요청 자체를 중단시킨다.
  const res = await fetch(CLOUD_DELETE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'delete', key: dataStr }),
    keepalive: true,
  });
  if (!res.ok) { throw new Error('HTTP ' + res.status); }
  const result = await res.json();
  if (!result.ok) { throw new Error(result.error || '삭제 실패'); }
}

if (typeof module !== 'undefined') { module.exports = { parseCsv }; }
