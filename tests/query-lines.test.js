// What the query is built from: the lines of the config sheet, cut to the cells each line is made of (docs: my-todo.md "Guarding against stale data in query area").
// A cell beyond the width of its line, or after the first empty cell of the line, is stale input: it is not part of the query.
//   widths, counted from column B: table / extend 2 | select, limit 3 | filterLogic, orderBy 4 | filter 5 | an unknown option word 2
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['Custom errors.js', 'functions.js', 'Data Type.js', 'OData Query.js', 'Fix Register.js', 'Data Validations.js', 'Content Tracker.js'];

module.exports = function register(t) {
  const { test } = t;
  function scope() {
    const ctx = vm.createContext({ console: { log() {}, error() {} } });
    FILES.forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    vm.runInContext(`globalThis.dbgLog = () => {}; globalThis.getMetadata = () => ({ listTables: () => ['Customers'], listProperties: () => ['No', 'Name', 'Date'], listNavProperties: () => ['Lines'], getDataType: () => 'Edm.String' });`, ctx);
    return ctx;
  }
  const row = (...cells) => { const r = cells.slice(); while (r.length < 5) r.push(''); return r; };
  /** { table: [...query array of the table lines], extend: [...], text: the $-text of the table query, ctx } for the given sheet lines */
  function query(lines) {
    const ctx = scope();
    ctx.__lines = lines;
    const out = vm.runInContext(`(() => { const c = new CCTImportConfig(__lines);
      const tq = c.getTableQueryArray(), eq = c.getExtendQueryArray();
      return JSON.stringify({ table: tq, extend: eq, tableText: new ODataQuery(tq).queryText(), extendText: new ODataQuery(eq).queryText(), tableName: c.getTable(), extendName: c.getExtendTable() }); })()`, ctx);
    return JSON.parse(out);
  }
  const TABLE = row('table', 'Customers');

  test('query lines: select is ONE field - the cells after it are stale, not further fields', () => {
    const q = query([TABLE, row('queryOption', 'select', 'No', 'Name', 'Date')]);
    assert.deepStrictEqual(q.table, [['select', 'No', null, null]]);
    assert.ok(/\$select=No(&|$)/.test(q.tableText) && !/Name|Date/.test(q.tableText), q.tableText);
  });

  test('query lines: a select with no field chosen yet selects nothing, whatever stands to the right of the empty cell', () => {
    const q = query([TABLE, row('queryOption', 'select', '', 'stale', 'old')]);
    assert.deepStrictEqual(q.table, [['select', '', null, null]]);
    assert.ok(!/\$select/.test(q.tableText), q.tableText);
  });

  test('query lines: limit is its own cell only; an empty limit leaves the default (100), stale cells after it are not read', () => {
    assert.ok(/\$top=7/.test(query([TABLE, row('queryOption', 'limit', '7', 'x', 'y')]).tableText));
    const q = query([TABLE, row('queryOption', 'limit', '', '9', '')]);
    assert.deepStrictEqual(q.table, [['limit', '', null, null]]);
    assert.ok(/\$top=100/.test(q.tableText), q.tableText);
  });

  test('query lines: orderBy and filterLogic take field + one cell (4 cells with B and the option word); the 5th cell is stale', () => {
    const o = query([TABLE, row('queryOption', 'orderBy', 'No', 'desc', 'stale')]);
    assert.deepStrictEqual(o.table, [['orderBy', 'No', 'desc', null]]);
    assert.ok(/\$orderby=No desc/.test(o.tableText), o.tableText);
    const l = query([TABLE, row('queryOption', 'filterLogic', 'No', 'OR', 'stale')]);
    assert.deepStrictEqual(l.table, [['filterLogic', 'No', 'OR', null]]);
  });

  test('query lines: filter keeps all its 5 cells (option, field, operator, value); a filter that stops at an empty cell is not applied, even with a value after the gap', () => {
    const f = query([TABLE, row('queryOption', 'filter', 'No', '=', '5')]);
    assert.deepStrictEqual(f.table, [['filter', 'No', '=', '5']]);
    assert.ok(/\$filter=/.test(f.tableText) && /No eq/.test(f.tableText), f.tableText);
    const gap = query([TABLE, row('queryOption', 'filter', 'No', '', '5')]);
    assert.deepStrictEqual(gap.table, [['filter', 'No', '', null]]);
    assert.ok(!/\$filter/.test(gap.tableText), gap.tableText);
    const noField = query([TABLE, row('queryOption', 'filter', '', '=', '5')]);
    assert.ok(!/\$filter/.test(noField.tableText), 'no field: nothing to filter: ' + noField.tableText);
  });

  test('query lines: an empty or unknown option word is just the word - what stands after it is ignored', () => {
    const q = query([TABLE, row('queryOption', '', 'No', 'x', 'y'), row('queryOption', 'selekt', 'No', 'Name', '')]);
    assert.deepStrictEqual(q.table, [[''], ['selekt']].map(r => r.concat([null, null, null].slice(0, 4 - r.length))));
    assert.ok(!/\$select/.test(q.tableText), q.tableText);
  });

  test('query lines: orderBy / filterLogic with no field are ignored (they used to order by the empty field)', () => {
    const q = query([TABLE, row('queryOption', 'orderBy', '', 'desc'), row('queryOption', 'filterLogic', '', 'OR')]);
    assert.ok(!/\$orderby/.test(q.tableText), q.tableText);
  });

  test('query lines: the same widths hold for extendOption lines, and table / extend names are the first cell after the label only', () => {
    const q = query([row('table', 'Customers', 'stale', 'x'), row('queryOption', 'select', 'No'), row('extend', 'Lines', 'stale'), row('extendOption', 'select', 'Qty', 'Price', 'Cost')]);
    assert.strictEqual(q.tableName, 'Customers');
    assert.strictEqual(q.extendName, 'Lines');
    assert.deepStrictEqual(q.extend, [['select', 'Qty', null, null]]);
  });

  test('query lines: lines are returned in sheet order and several lines are cut each on its own', () => {
    const q = query([TABLE, row('queryOption', 'select', 'No', 'stale'), row('queryOption', 'orderBy', 'No', 'asc', 'x'), row('queryOption', 'limit', '5', 'x')]);
    assert.deepStrictEqual(q.table.map(r => r.join('|')), ['select|No||', 'orderBy|No|asc|', 'limit|5||']);
  });

  test('rule: the widths live in ONE table in Content Tracker.js (QUERY_OPTION_WIDTHS), which the cell greying uses too', () => {
    const ctx = scope();
    assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify([QUERY_OPTION_WIDTHS, LINE_WIDTH_TABLE])', ctx)), [{ select: 3, limit: 3, filterLogic: 4, orderBy: 4, filter: 5 }, 2]);
  });
};
