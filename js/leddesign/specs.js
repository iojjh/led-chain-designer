// ── specs ───────────────────────────────────────────
// led-calculator/script.js:721-748 그대로 이식(순수 데이터/함수).
// LED 피치별 패널 해상도(px) — px500: 500×500mm 패널, px1000: 500×1000mm 패널.

const SPECS = {
  '2mm': { px500: { w: 192, h: 192 }, px1000: { w: 192, h: 384 } },
  '3mm': { px500: { w: 128, h: 128 }, px1000: { w: 128, h: 256 } },
  '4mm': { px500: { w: 104, h: 104 }, px1000: { w: 104, h: 208 } },
};

// 아무 장비도 그래프에 연결되지 않았을 때만 쓰는 포트당 픽셀 상한 기본값.
// 실제 값은 상류에 연결된 콘솔/샌딩카드 장비 프리셋에서 가져온다.
const MAX_PX = 655360;

const PWR_PORT_COUNT = 18;

const PC = [
  '#378ADD', '#E24B4A', '#EF9F27', '#1D9E75', '#7F77DD', '#D85A30', '#5DCAA5', '#D4537E',
  '#2196F3', '#9C27B0', '#FF5722', '#00BCD4', '#8BC34A', '#FF9800', '#607D8B', '#E91E63',
  '#795548', '#009688',
];

function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function portColor(i) {
  if (i < PC.length) { return PC[i]; }
  return _hslToHex(Math.round((i * 137.508) % 360), 65, 42);
}

if (typeof module !== 'undefined') {
  module.exports = { SPECS, MAX_PX, PWR_PORT_COUNT, PC, portColor };
}
