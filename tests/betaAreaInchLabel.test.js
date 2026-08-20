const { betaAreaInchLabel } = require('../js/leddesign/betaAreaInchLabel.js');

describe('betaAreaInchLabel', () => {
  test('3500×2000mm → 대각선 약 158.7"', () => {
    expect(betaAreaInchLabel(3500, 2000)).toBe('대각선 158.7" (약 159형)');
  });

  test('가로 0이면 빈 문자열', () => {
    expect(betaAreaInchLabel(0, 2000)).toBe('');
  });

  test('세로 0이면 빈 문자열', () => {
    expect(betaAreaInchLabel(3500, 0)).toBe('');
  });

  test('정사각형(1000×1000) → 대각선 = 변 × √2', () => {
    const expected = 1000 * Math.SQRT2 / 25.4;
    expect(betaAreaInchLabel(1000, 1000)).toBe(`대각선 ${expected.toFixed(1)}" (약 ${Math.round(expected)}형)`);
  });
});
