// Tests of BulkSheet.writeTable and of ResultSheet.write on top of it. Registered by tests/run.js.
//
//  GOLDEN: tests/golden/legacy-result-sheet.js is ResultSheet.write as it was (clear, one number format per column, ONE setValues of the whole
//  table). Both run in fresh scopes on the same simulated book; sheets must come out identical for small and for tall tables.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');
const FILES = ['Data Type.js', 'BulkSheet.js', 'ResultSheet.js'];

module.exports = function register(t) {
  const { test } = t;

  function scope(prefill) {
    const book = new SimBook({ api: false });
    const ctx = vm.createContext({ console: { log() {}, error() {} } });
    book.install(ctx);
    FILES.forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    new vm.Script(fs.readFileSync(path.join(ROOT, 'tests/golden/legacy-result-sheet.js'), 'utf8'), { filename: 'legacy-result-sheet.js' }).runInContext(ctx);
    vm.runInContext('globalThis.dbgLog = () => {};', ctx);
    if (prefill) prefill(book);
    return { book, ctx, run: code => vm.runInContext(code, ctx) };
  }
  const snap = (book, name) => JSON.parse(JSON.stringify(book.sheets[name].snapshot()));
  const tall = (rows, cols) => [Array.from({ length: cols }, (_, c) => 'h' + c)].concat(
    Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (c % 3 === 0 ? r : c % 3 === 1 ? 'x' + r : r / 4))));

  function same(name, table, types, prefill) {
    test('golden: ResultSheet.write - ' + name, () => {
      const old = scope(prefill), now = scope(prefill);
      [old, now].forEach(s => { s.ctx.__table = JSON.parse(JSON.stringify(table)); s.ctx.__types = types; });
      old.run(`LegacyResultSheet.write('Wynik', __table, __types)`);
      now.run(`ResultSheet.write('Wynik', __table, __types)`);
      const a = snap(now.book, 'Wynik'), b = snap(old.book, 'Wynik');
      if (JSON.stringify(a) !== JSON.stringify(b)) {              // no deepStrictEqual on 100 000 cells: its diff takes minutes
        const key = Object.keys(Object.assign({}, a.cells, b.cells)).find(k => JSON.stringify(a.cells[k]) !== JSON.stringify(b.cells[k]));
        assert.fail('sheets differ, first at cell ' + key + ': new ' + JSON.stringify(a.cells[key]) + ' old ' + JSON.stringify(b.cells[key]));
      }
      assert.deepStrictEqual(Object.keys(now.book.sheets), Object.keys(old.book.sheets));
    });
  }
  const T = [['No', 'Name', 'Qty', 'Posted', 'Ok'], ['1', 'A', 2.5, 45000, true], ['2', '', 0, '', false]];
  const TYPES = ['Edm.String', 'Edm.String', 'Edm.Decimal', 'Edm.DateTimeOffset', 'Edm.Boolean'];
  same('a new sheet', T, TYPES);
  same('header only', [T[0]], TYPES);
  same('a single cell', [['x']], ['Edm.String']);
  same('fewer types than columns, an unknown type, a JS type name', T, ['number', 'whatever']);
  same('more types than columns', [['a']], ['Edm.Int32', 'Edm.Decimal', 'Edm.Date']);
  same('an existing sheet with more rows, columns and formats than the new table', T, TYPES, book => {
    const s = book.add('Wynik');
    for (let r = 1; r <= 20; r++) for (let c = 1; c <= 9; c++) { s.setValue(r, c, 'old' + r + c, ''); s.cell(r, c, true).fmt.bg = '#ff0000'; s.cell(r, c, true).fmt.numFmt = '0.000'; }
    s.cell(2, 2, true).note = 'old note';
  });
  same('an existing sheet that is empty', T, TYPES, book => { book.add('Wynik'); });
  same('another sheet is left alone', T, TYPES, book => { book.add('Inny').setValue(1, 1, 'mine', ''); });
  same('a table taller than one chunk (20 000 rows x 6 columns) on a sheet that is big enough', tall(20000, 6), ['Edm.Int32', 'Edm.String', 'Edm.Decimal', 'Edm.Int32', 'Edm.String', 'Edm.Decimal'], book => { book.add('Wynik', 25000, 26); });
  same('a table of exactly the sheet\'s height', tall(999, 3), ['Edm.Int32'], book => { book.add('Wynik'); });

  test('a tall table on a new sheet (1000 rows) and a wide one (30 columns): the sheet grows to fit, then every cell is there', () => {
    const s = scope(), tbl = tall(5000, 30);
    s.ctx.__table = tbl;
    s.run(`ResultSheet.write('Wynik', __table, ['Edm.Int32'])`);
    const w = s.book.sheets['Wynik'];
    assert.ok(w.rowCount >= 5001 && w.colCount >= 30, w.rowCount + 'x' + w.colCount);
    assert.strictEqual(w.cell(5001, 30).v, tbl[5000][29]);
    assert.strictEqual(w.cell(2500, 2).v, tbl[2499][1]);
    assert.strictEqual(w.cell(5001, 1).fmt.numFmt, '#', 'the format reaches the last row');
  });

  test('chunks: the values go in calls of whole rows, at most chunkCells cells each; the result is the same cell by cell', () => {
    const s = scope(), tbl = tall(1000, 7);
    s.ctx.__table = tbl;
    const before = s.book.serviceCalls;
    const res = s.run(`BulkSheet.writeTable('W', __table, { columnFormats: [], chunkCells: 1500 })`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res)), { rows: 1001, cols: 7, chunks: 5 });         // 214 rows per chunk: 5 calls
    assert.strictEqual(s.book.sheets['W'].cell(1001, 7).v, tbl[1000][6]);
    assert.strictEqual(s.book.sheets['W'].cell(215, 1).v, tbl[214][0], 'the first row of the second chunk');
    assert.strictEqual(s.book.sheets['W'].cell(1, 1).v, 'h0');
    assert.ok(s.book.serviceCalls - before < 20, 'a handful of calls: ' + (s.book.serviceCalls - before));
  });

  test('chunks: a row wider than chunkCells still goes one row at a time; the default chunk is 50 000 cells', () => {
    const s = scope();
    s.ctx.__table = tall(3, 10);
    assert.strictEqual(s.run(`BulkSheet.writeTable('W', __table, { chunkCells: 4 }).chunks`), 4);
    assert.strictEqual(s.run(`BULK_CHUNK_CELLS`), 50000);
    s.ctx.__t2 = tall(10000, 10);
    assert.strictEqual(s.run(`BulkSheet.writeTable('W2', __t2).chunks`), 3, '100 010 cells / 5000 rows per chunk');
  });

  test('a bad table is refused before the sheet is created or cleared', () => {
    const s = scope(book => { book.add('W').setValue(1, 1, 'keep me', ''); });
    [`[]`, `[[]]`, `null`, `[['a', 'b'], ['x']]`, `[['a'], 'x']`].forEach(tbl => {
      assert.throws(() => s.run(`BulkSheet.writeTable('W', ${tbl}, {})`), /BulkSheet\.writeTable/, tbl);
      assert.strictEqual(s.book.sheets['W'].cell(1, 1).v, 'keep me', tbl);
    });
    assert.throws(() => s.run(`BulkSheet.writeTable('Nowy', [], {})`), /nothing to write/);
    assert.strictEqual(s.book.sheets['Nowy'], undefined);
    assert.throws(() => s.run(`BulkSheet.writeTable('W', [['a', 'b'], ['x']], {})`), /row 2 has 1 cells, the first row has 2/);
  });

  test('formats: null / undefined / holes leave the column alone, any other string is set for the whole table height, also past the data width', () => {
    const s = scope();
    s.run(`BulkSheet.writeTable('W', [['a', 'b', 'c'], [1, 2, 3], [4, 5, 6]], { columnFormats: ['0.0', null, , '#', 'yyyy'] })`);
    const w = s.book.sheets['W'];
    assert.deepStrictEqual([1, 2, 3].map(r => w.cell(r, 1).fmt.numFmt), ['0.0', '0.0', '0.0']);
    assert.strictEqual((w.cell(2, 2).fmt || {}).numFmt, undefined);
    assert.strictEqual((w.cell(2, 3).fmt || {}).numFmt, undefined);
    assert.strictEqual(w.cell(3, 4).fmt.numFmt, '#');
    assert.strictEqual(w.cell(1, 5).fmt.numFmt, 'yyyy');
  });

  test('rule: BulkSheet.js knows nothing of the project and loads alone; only it clears and fills a result table', () => {
    const text = fs.readFileSync(path.join(ROOT, 'BulkSheet.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/Konfiguracja|Ustawienia|OData|\bBC\b|DataType|getMainSettings|Settings|Controller/.test(text));
    assert.ok(!/Sheets\.Spreadsheets/.test(text), 'service only');
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'BulkSheet.js'), 'utf8'), {});
    const rs = fs.readFileSync(path.join(ROOT, 'ResultSheet.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/SpreadsheetApp|getRange|getSheetByName|insertSheet/.test(rs));
  });
};
