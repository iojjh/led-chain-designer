// ── betaAreaInchLabel ───────────────────────────────
// led-calculator/script.js:3082-3086 그대로 이식(순수 함수, 의존성 없음).

function betaAreaInchLabel(w, h) {
  if (!w || !h) { return ''; }
  const inch = Math.sqrt(w ** 2 + h ** 2) / 25.4;
  return `대각선 ${inch.toFixed(1)}" (약 ${Math.round(inch)}형)`;
}

if (typeof module !== 'undefined') {
  module.exports = { betaAreaInchLabel };
}
