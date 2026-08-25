// ── app 부트스트랩 ──────────────────────────────────
// package.json의 version과 맞춰 수동으로 올린다. 기능 변경 시 이 값과
// service-worker.js의 CACHE_VERSION을 함께 동기화할 것(CLAUDE.md 참고).
const APP_VERSION = '0.5.15';

(function () {
  const canvasEl = document.getElementById('graphCanvas');
  const nodeLayerEl = document.getElementById('nodeLayer');

  initCanvasRenderer(canvasEl, nodeLayerEl);
  initNodeCardRenderer(nodeLayerEl);
  initPropertiesPanel(document.getElementById('propsPanel'));
  initValidationUi(document.getElementById('issuesList'), document.getElementById('issuesCount'));
  initSaveLoadUi();
  initInteractions(canvasEl, nodeLayerEl);

  document.getElementById('issuesToggle').addEventListener('click', () => {
    document.getElementById('issuesPanel').classList.toggle('collapsed');
  });

  // 좁은 화면(모바일)에서는 이슈 패널을 접힌 채로 시작해, 속성 패널이 하단
  // 시트로 열릴 공간을 확보한다(둘 다 펼쳐지면 하단에서 서로 겹침).
  if (window.matchMedia('(max-width: 640px)').matches) {
    document.getElementById('issuesPanel').classList.add('collapsed');
  }

  renderNodeCards();
  renderPropertiesPanel();
  renderValidation();
})();

// ── 업데이트 완료 감지 ──────────────────────────────
// index.html의 SW 등록 스크립트는 백그라운드 자동 갱신/수동 새로고침 직전에
// sessionStorage 'sw-just-updated'를 세팅만 하고 reload한다 — 그 플래그를
// 다음 로드에서 소비해 "방금 업데이트됐다"는 걸 실제로 사용자에게 보여주는
// 곳이 이 블록이다(없으면 리로드만 조용히 일어나 사용자가 이유를 모름).
// localStorage 버전 비교는 그 보완 안전망: 앱이 완전히 종료된 채로 백그라운드에서
// SW가 갱신돼 controllerchange를 아예 못 본 세션도 다음 실행에서 잡아낸다.
(function () {
  try {
    const prevVersion = localStorage.getItem('sw-app-version');
    if (prevVersion && prevVersion !== APP_VERSION) {
      sessionStorage.setItem('sw-just-updated', '1');
    }
    localStorage.setItem('sw-app-version', APP_VERSION);

    if (sessionStorage.getItem('sw-just-updated')) {
      sessionStorage.removeItem('sw-just-updated');
      const toast = document.getElementById('updateToast');
      const toastCard = document.getElementById('updateToastCard');
      if (toast && toastCard) {
        toastCard.textContent = `v${APP_VERSION}으로 업데이트되었습니다`;
        toast.classList.add('show');
        setTimeout(() => { toast.classList.remove('show'); }, 1750);
      }
    }
  } catch (_) {
    // localStorage/sessionStorage 접근 불가(비공개 모드 등) — 업데이트 알림만 건너뛴다.
  }
})();
