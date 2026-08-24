const { parseCsv } = require('../js/save/cloudShare.js');

describe('parseCsv', () => {
  test('parses plain comma-separated rows', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('handles quoted field containing a comma', () => {
    const rows = parseCsv('name,data\n"홍길동, 현장",abc123\n');
    expect(rows).toEqual([['name', 'data'], ['홍길동, 현장', 'abc123']]);
  });

  test('unescapes doubled quotes inside a quoted field', () => {
    const rows = parseCsv('a\n"he said ""hi"""\n');
    expect(rows).toEqual([['a'], ['he said "hi"']]);
  });

  test('handles quoted field containing an embedded newline', () => {
    const rows = parseCsv('a,b\n"line1\nline2",x\n');
    expect(rows).toEqual([['a', 'b'], ['line1\nline2', 'x']]);
  });

  test('handles last row without a trailing newline', () => {
    const rows = parseCsv('a,b\n1,2');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
  });
});
