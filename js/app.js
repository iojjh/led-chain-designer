// ── app 부트스트랩 ──────────────────────────────────
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

  renderNodeCards();
  renderPropertiesPanel();
  renderValidation();
})();
