// ── projectState ────────────────────────────────────
// 그래프 State ↔ 저장 가능한 스냅샷 변환. led-calculator의 getAppState/loadAppState
// (script.js:1377-1434) 패턴을 미러링하되, v1의 그래프 상태는 Set 없이 전부 순수
// JSON이라 별도 직렬화/역직렬화(Set↔배열 변환)가 필요 없다 — 깊은 복사만 하면 된다.

function getProjectState(name, state) {
  return {
    name,
    date: new Date().toLocaleDateString('ko-KR'),
    graph: JSON.parse(JSON.stringify(state.graph)),
  };
}

function applyProjectState(state, snapshot) {
  state.graph = JSON.parse(JSON.stringify(snapshot.graph));
  state.ui.selectedId = null;
  state.ui.selectedEdgeId = null;
}

if (typeof module !== 'undefined') {
  module.exports = { getProjectState, applyProjectState };
}
