// The operator dropdown (docs/bugs-fixed.md #18). A bare "=" cannot be a cell value or a list item (it starts a formula, picking it asks for formula text), and the
// quote prefix ("'=") is read differently by the Spreadsheet service and the Sheets API. So the equality operator in the dropdown is " =" - with a leading space - and
// every other operator is a plain item. The query builder accepts " =" like "=" (and the OData words, and the other symbols as before). Lists are written as they are
// by both paths.
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
  const OPERATORS = ['<', '>', ' =', '<>', '<=', '>=', 'endswith', 'startswith', 'contains'];
  const sentLists = book => book.requests.flat().filter(r => r.updateCells && r.updateCells.fields === 'dataValidation')
    .map(r => r.updateCells.rows[0].values[0].dataValidation.condition.values.map(v => v.userEnteredValue));
  const setList = (s, list) => s.run(`(() => { const g = Grid.open({ sheetName: 'K' }); g.getRange(3, 3).setDataValidation({ list: ${JSON.stringify(list)}, strict: false, dropdown: true }); g.commit(); })()`);

  test('operators: the dropdown items are plain, except equality which is " =" (a leading space; nothing carries an apostrophe)', () => {
    const s = scope('service');
    assert.deepStrictEqual(plain(s.run(`new ConfigDValStore().simple.operators.dataValArguments[0]`)), OPERATORS);
  });

  test('query builder: every way of writing an operator gives the OData one - " =", "=", "==", the OData words, the symbols, with stray spaces', () => {
    const s = scope('service');
    const op = x => s.run(`new ODataQuery().letterFormat(${JSON.stringify(x)})`);
    const cases = { ' =': 'eq', '=': 'eq', '==': 'eq', ' == ': 'eq', 'eq': 'eq', ' eq ': 'eq', '<': 'lt', ' < ': 'lt', '>': 'gt', '<>': 'ne', '!=': 'ne', 'ne': 'ne', '<=': 'le', '>=': 'ge',
      'le': 'le', 'ge': 'ge', 'endswith': 'endswith', ' contains': 'contains', 'startswith': 'startswith' };
    Object.entries(cases).forEach(([given, want]) => assert.strictEqual(op(given), want, JSON.stringify(given)));
    ['', ' ', 'foo', '= =', "'=", null, undefined].forEach(bad => assert.strictEqual(op(bad), null, JSON.stringify(bad)));
  });

  test('query builder: a filter with " =" is built like one with "="', () => {
    const s = scope('service');
    const text = x => s.run(`new ODataQuery([['filter', 'No', ${JSON.stringify(x)}, 'C1']], {}).queryText()`);
    assert.strictEqual(text(' ='), text('='));
    assert.ok(/\$filter=\(No eq 'C1'\)/.test(text(' =')), text(' ='));
  });

  test('both paths write the operator list as it is - no twin items, no apostrophes, nothing left to the Spreadsheet service on the API path', () => {
    const api = scope('api'), svc = scope('service');
    const before = api.book.serviceCalls;
    setList(api, OPERATORS); setList(svc, OPERATORS);
    assert.deepStrictEqual(plain(sentLists(api.book)), [OPERATORS]);
    assert.strictEqual(api.book.sheets['K'].cell(3, 3).dv, svc.book.sheets['K'].cell(3, 3).dv);
    assert.strictEqual(svc.book.sheets['K'].cell(3, 3).dv, 'list:' + OPERATORS.join('|') + ':loose:dropdown');
    assert.ok(api.book.serviceCalls - before < 40, 'reads of the open only');
    const text = fs.readFileSync(path.join(ROOT, 'Grid.js'), 'utf8');
    assert.ok(!/quotedList_|apiListItems_/.test(text), 'the earlier workarounds are gone');
  });
};
