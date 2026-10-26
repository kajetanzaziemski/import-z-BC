// The developer tool "Test weryfikacji": builds a scratch sheet that writes the same operator dropdown and the same values in every combination (rule written by the
// Spreadsheet service or by the Sheets API; value written by the service, by the API, or left empty to pick from the list) so that the red warnings on a real sheet
// show which part matters (docs/bugs-todo.md #18). It exists only to be looked at; these tests pin the layout.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');

module.exports = function register(t) {
  const { test } = t;

  function scope(mode, prefill) {
    const book = new SimBook({ api: mode === 'api' });
    const ctx = vm.createContext({ console: { log() {}, error() {} } });
    book.install(ctx);
    ['OData Query.js', 'Validation Lab.js'].forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    vm.runInContext('globalThis.dbgLog = () => {};', ctx);
    if (prefill) prefill(book);
    return { book, ctx, run: code => vm.runInContext(code, ctx) };
  }
  const OPS = ["'<", "'>", "'=", "'<>", "'<=", "'>=", "'endswith", "'startswith", "'contains"];
  const PLAIN = ['<', '>', '<>', '<=', '>=', 'endswith', 'startswith', 'contains'];
  const dvList = (book, r, c) => { const dv = (book.sheets['Test weryfikacji'].cell(r, c) || {}).dv || ''; const m = dv.match(/^list:(.*):(strict|loose):(dropdown|plain)$/); return m ? { items: m[1].split('|'), mode: m[2] } : dv; };
  const val = (book, r, c) => (book.sheets['Test weryfikacji'].cell(r, c) || { v: '' }).v;

  ['api', 'service'].forEach(mode => {
    test(`lab: the sheet is built - four rule rows by five value columns, the same values and rules in every cell of a column / row [${mode}]`, () => {
      const s = scope(mode);
      s.run(`ValidationLab.build()`);
      assert.ok(s.book.sheets['Test weryfikacji']);
      // (the simulated service keeps the apostrophe of "'=" - the real one takes it as the sign of plain text)
      [5, 6, 7, 8].forEach(r => {
        assert.strictEqual(typeof val(s.book, r, 1), 'string', 'a label in column A');
        const want = mode === 'api' ? ['>=', '>=', "'=", '=', ''] : ['>=', '', "'=", '', ''];
        assert.deepStrictEqual([2, 3, 4, 5, 6].map(c => val(s.book, r, c)), want, 'row ' + r);
      });
      const rows = (list, expectedRows) => expectedRows.forEach(r => [2, 3, 4, 5, 6].forEach(c => assert.deepStrictEqual(dvList(s.book, r, c), r === 6 || r === 8 ? (mode === 'api' ? list : '') : list, `rule ${r},${c}`)));
      rows({ items: OPS, mode: 'loose' }, [5, 6]);
      rows({ items: PLAIN, mode: 'loose' }, [7, 8]);
    });
  });

  test('lab: with the Sheets API the "API" rows get their rules and the "API" columns their values from a batchUpdate; the service writes the others', () => {
    const s = scope('api');
    s.run(`ValidationLab.build()`);
    const reqs = s.book.requests.flat();
    const rules = reqs.filter(r => r.updateCells && r.updateCells.fields === 'dataValidation');
    const values = reqs.filter(r => r.updateCells && r.updateCells.fields === 'userEnteredValue');
    assert.strictEqual(rules.length, 10, 'two API rule rows x five columns');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules.map(r => r.updateCells.start.rowIndex).sort())), [5, 5, 5, 5, 5, 7, 7, 7, 7, 7], 'rows 6 and 8 (0-based 5 and 7)');
    assert.strictEqual(values.length, 8, 'two API value columns x four rows');
    assert.ok(values.every(v => v.updateCells.rows[0].values[0].userEnteredValue.stringValue !== undefined));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules[0].updateCells.rows[0].values[0].dataValidation.condition.values.map(v => v.userEnteredValue))), OPS);
  });

  test('lab: without the Sheets service the API rows and columns say so instead of being written', () => {
    const s = scope('service');
    const note = s.run(`ValidationLab.build()`);
    assert.ok(/Sheets/.test(note), note);
    assert.ok(/API/.test(String(val(s.book, 6, 1))));
    assert.strictEqual(dvList(s.book, 6, 2), '', 'no rule in an API row');
    assert.strictEqual(val(s.book, 5, 3), '', 'no value in an API column');
  });

  test('lab: building it again replaces the old sheet (nothing else is touched)', () => {
    const s = scope('api', book => { book.add('Test weryfikacji').setValue(20, 20, 'stare', ''); book.add('Inny').setValue(1, 1, 'mine', ''); });
    s.run(`ValidationLab.build()`);
    assert.strictEqual(val(s.book, 20, 20), '');
    assert.strictEqual(s.book.sheets['Inny'].cell(1, 1).v, 'mine');
    assert.strictEqual(Object.keys(s.book.sheets).filter(n => n === 'Test weryfikacji').length, 1);
  });
};
