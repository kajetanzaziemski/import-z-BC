// The operator dropdown and the Sheets API (docs/bugs-todo.md #18). The operators are plain items except "=": a lone "=" cannot be typed (it starts a formula), so its item is
// the quoted form "'=" - picking it enters the text "=". Found on a real sheet (Validation Lab): a list written through the API takes its items literally, so the value "="
// entered by that pick is not in a list that only has "'=". The sheet accepts "'=" as input and checks it against "=": so for the API the list carries both, "'=" and "=".
// The Spreadsheet service reads "'=" as the typed text itself and needs no twin.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');

module.exports = function register(t) {
  const { test } = t;
  const plain = v => JSON.parse(JSON.stringify(v));

  function scope(mode) {
    const book = new SimBook({ api: mode === 'api' });
    const ctx = vm.createContext({ console: { log() {}, error() {} } });
    book.install(ctx);
    ['Grid.js', 'Grid Util.js', 'OData Query.js', 'Custom errors.js', 'functions.js', 'Fix Register.js', 'Data Validations.js'].forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    vm.runInContext(`globalThis.dbgLog = () => {}; globalThis.getMetadata = () => ({ listTables: () => ['Customers'] });`, ctx);
    book.add('K', 20, 8);
    return { book, ctx, run: code => vm.runInContext(code, ctx) };
  }
  const OPERATORS = ['<', '>', "'=", '<>', '<=', '>=', 'endswith', 'startswith', 'contains'];
  const sentLists = book => book.requests.flat().filter(r => r.updateCells && r.updateCells.fields === 'dataValidation')
    .map(r => r.updateCells.rows[0].values[0].dataValidation.condition.values.map(v => v.userEnteredValue));
  const setList = (s, list) => s.run(`(() => { const g = Grid.open({ sheetName: 'K' }); g.getRange(3, 3).setDataValidation({ list: ${JSON.stringify(list)}, strict: false, dropdown: true }); g.commit(); })()`);

  test('operators: the dropdown items are plain, except "=" which is "\'=" (nothing else carries an apostrophe)', () => {
    const s = scope('service');
    assert.deepStrictEqual(plain(s.run(`new ConfigDValStore().simple.operators.dataValArguments[0]`)), OPERATORS);
  });

  test('api: a list item with an apostrophe is sent together with the same item without it - the list the sheet then checks the picked value against', () => {
    const s = scope('api');
    setList(s, OPERATORS);
    assert.deepStrictEqual(plain(sentLists(s.book)), [['<', '>', "'=", '=', '<>', '<=', '>=', 'endswith', 'startswith', 'contains']]);
  });

  test('api: no duplicate when the plain twin is in the list already; lists without apostrophes are sent as they are', () => {
    const s = scope('api');
    setList(s, ["'=", '=', '<']);
    assert.deepStrictEqual(plain(sentLists(s.book)), [["'=", '=', '<']]);
    const t2 = scope('api');
    setList(t2, ['AND', 'OR']);
    assert.deepStrictEqual(plain(sentLists(t2.book)), [['AND', 'OR']]);
  });

  test('service: the list is written as it is - "\'=" alone, no twin', () => {
    const s = scope('service');
    setList(s, OPERATORS);
    assert.strictEqual(s.book.sheets['K'].cell(3, 3).dv, 'list:' + OPERATORS.join('|') + ':loose:dropdown');
  });

  test('api: a validation is written by the batchUpdate only - the Spreadsheet service writes none (the workaround that sent quoted lists through it is gone)', () => {
    const s = scope('api');
    const before = s.book.serviceCalls;
    setList(s, OPERATORS);
    assert.ok(s.book.serviceCalls - before < 40, 'reads of the open only');
    assert.strictEqual(sentLists(s.book).length, 1);
    assert.ok(!/quotedList_/.test(fs.readFileSync(path.join(ROOT, 'Grid.js'), 'utf8')));
  });

  test('the co-edit writes the same operator rule through both paths (the simulated sheet takes "\'=" and "=" as one item, like the real one)', () => {
    const api = scope('api'), svc = scope('service');
    setList(api, OPERATORS); setList(svc, OPERATORS);
    assert.strictEqual(api.book.sheets['K'].cell(3, 3).dv, svc.book.sheets['K'].cell(3, 3).dv);
  });
};
