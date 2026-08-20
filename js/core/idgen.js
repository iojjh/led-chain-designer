// ── idgen ───────────────────────────────────────────
let _counter = 0;

function makeId(prefix) {
  _counter += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${_counter.toString(36)}${rand}`;
}

if (typeof module !== 'undefined') { module.exports = { makeId }; }
