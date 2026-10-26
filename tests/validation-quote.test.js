// List items that begin with an apostrophe (the operator dropdown: "'<", "'=" ... - the apostrophe makes the picked value plain text, so a lone "=" is not a formula).
// On a real sheet the Sheets API reads such an item differently from the Spreadsheet service: a validation written through the API rejected the very value picked from
// its list ("podana wartość musi należeć do zakresu"), one written through the service accepted it. So Grid writes these through the service, also when it commits through the API.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');

module.exports = function register(t) {
  const { test } = t;
  const OPS = ["'<", "'>", "'=", "'<>", 'endswith'];

  function scope(mode) {
    const book = new SimBook({ api: mode === 'api' });
    const ctx = vm.createContext({ console: { log() {}, error() {} } });
    book.install(ctx);
    ['Grid.js', 'Grid Util.js'].forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    book.add('K', 20, 8);
    return { book, ctx, run: code => vm.runInContext(code, ctx) };
  }
  const write = s => s.run(`(() => {
    const g = Grid.open({ sheetName: 'K' });
    g.getRange(3, 3).setDataValidation({ list: ${JSON.stringify(OPS)}, strict: true, dropdown: true });          // operators: apostrophes
    g.getRange(4, 3).setDataValidation({ list: ['AND', 'OR'], strict: true, dropdown: true });                  // plain
    g.getRange(5, 3, 2, 1).setDataValidation({ list: ['asc', "x'y", 'desc'], strict: false, dropdown: true });  // an apostrophe inside an item is not a prefix
    g.getRange(3, 3).setValue('<');
    g.commit();
  })()`);
  const dvOf = (book, r, c) => (book.sheets['K'].cell(r, c) || {}).dv;

  test('validations: the API commit leaves the lists with apostrophe-prefixed items to the Spreadsheet service, the rest goes in the batchUpdate', () => {
    const s = scope('api');
    const before = s.book.serviceCalls;
    write(s);
    const sent = s.book.requests.flat().filter(r => r.updateCells && r.updateCells.fields === 'dataValidation').map(r => r.updateCells.rows[0].values[0].dataValidation.condition.values.map(v => v.userEnteredValue));
    assert.ok(!sent.some(list => list.some(x => x.startsWith("'"))), 'no apostrophe-prefixed list was sent to the API: ' + JSON.stringify(sent));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sent)), [['AND', 'OR'], ['asc', "x'y", 'desc'], ['asc', "x'y", 'desc']]);
    assert.ok(s.book.serviceCalls > before, 'the service set the operator validation');
    assert.ok(/'</.test(dvOf(s.book, 3, 3)), dvOf(s.book, 3, 3));
  });

  test('validations: the sheet comes out the same through the API commit as through the service commit', () => {
    const api = scope('api'), svc = scope('service');
    write(api); write(svc);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(api.book.sheets['K'].snapshot())), JSON.parse(JSON.stringify(svc.book.sheets['K'].snapshot())));
    assert.strictEqual(dvOf(api.book, 3, 3), dvOf(svc.book, 3, 3));
  });

  test('validations: with no apostrophe-prefixed list the Spreadsheet service is not touched for validations (one batchUpdate, as before)', () => {
    const s = scope('api');
    s.run(`(() => { const g = Grid.open({ sheetName: 'K' }); g.getRange(4, 3).setDataValidation({ list: ['AND', 'OR'], strict: true, dropdown: true }); g.commit(); })()`);
    const before = s.book.serviceCalls;
    s.run(`(() => { const g = Grid.open({ sheetName: 'K' }); g.getRange(5, 3).setDataValidation({ list: ['asc', 'desc'], strict: true, dropdown: true }); g.commit(); })()`);
    assert.ok(s.book.serviceCalls - before <= 40, 'only the reads of the open: ' + (s.book.serviceCalls - before));
    assert.strictEqual(s.book.requests.length, 2);
  });

  test('validations: a quoted list replaces an older validation of the cell (API or service), and removing it removes it', () => {
    const s = scope('api');
    s.run(`(() => { const g = Grid.open({ sheetName: 'K' }); g.getRange(3, 3).setDataValidation({ list: ['AND', 'OR'], strict: true, dropdown: true }); g.commit(); })()`);
    s.run(`(() => { const g = Grid.open({ sheetName: 'K' }); g.getRange(3, 3).setDataValidation({ list: ${JSON.stringify(OPS)}, strict: true, dropdown: true }); g.commit(); })()`);
    assert.ok(/'</.test(dvOf(s.book, 3, 3)));
    s.run(`(() => { const g = Grid.open({ sheetName: 'K' }); g.getRange(3, 3).setDataValidation(null); g.commit(); })()`);
    assert.ok(!dvOf(s.book, 3, 3));
  });
};
