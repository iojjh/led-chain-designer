const { makeId } = require('../js/core/idgen.js');

test('makeId prefixes the id with the given prefix', () => {
  expect(makeId('n')).toMatch(/^n_/);
  expect(makeId('e')).toMatch(/^e_/);
});

test('makeId returns unique ids across repeated calls', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) { ids.add(makeId('n')); }
  expect(ids.size).toBe(200);
});
