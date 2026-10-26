// The developer tool "Pokaż weryfikację komórki": what the platform stored for the data validation of the active cell, read back two ways - through the Spreadsheet
// service and through the Sheets API (spreadsheets.get) - so that the two representations can be compared (the operator dropdown, docs/bugs-todo.md #18).
// Read-only. Fakes for both services; the point is what is asked for and what is reported.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

module.exports = function register(t) {
  const { test } = t;

  function scope(over) {
    const cfg = Object.assign({ sheet: "Konfiguracja 'A'", a1: 'E7', row: 7, col: 5, api: true, apiThrows: null, dv: { type: 'VALUE_IN_LIST', values: [["'<", "'>", "'="], true], allowInvalid: false },
      value: '<', formula: '', display: '<' }, over || {});
    const log = [];
    const range = {
      getRow: () => cfg.row, getColumn: () => cfg.col, getA1Notation: () => cfg.a1, getSheet: () => ({ getName: () => cfg.sheet }),
      getValue: () => cfg.value, getFormula: () => cfg.formula, getDisplayValue: () => cfg.display,
      getDataValidation: () => cfg.dv ? { getCriteriaType: () => cfg.dv.type, getCriteriaValues: () => cfg.dv.values, getAllowInvalid: () => cfg.dv.allowInvalid, getHelpText: () => '' } : null
    };
    const ss = { getId: () => 'ss-1', getActiveRange: () => range, getActiveSheet: () => ({ getActiveRange: () => range }) };
    const ctx = vm.createContext({ console: { log() {}, error() {} }, __cfg: cfg, __log: log });
    ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ss, getActive: () => ss, flush() {} };
    if (cfg.api) ctx.Sheets = { Spreadsheets: { get: (id, o) => {
      log.push(['get', id, o]);
      if (cfg.apiThrows) throw new Error(cfg.apiThrows);
      return { sheets: [{ data: [{ rowData: [{ values: [{ userEnteredValue: { stringValue: '<' }, formattedValue: '<',
        dataValidation: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: "'<" }, { userEnteredValue: "'>" }] }, strict: true, showCustomUi: true } }] }] }] }] };
    } } };
    new vm.Script(fs.readFileSync(path.join(ROOT, 'Cell Inspector.js'), 'utf8'), { filename: 'Cell Inspector.js' }).runInContext(ctx);
    return { ctx, log, run: code => vm.runInContext(code, ctx) };
  }
  const plain = v => JSON.parse(JSON.stringify(v));

  test('inspector: reports the cell, its value as the service sees it, and the validation read back through the service AND through the API', () => {
    const s = scope();
    const r = plain(s.run(`CellInspector.describe()`));
    assert.deepStrictEqual(r.cell, { sheet: "Konfiguracja 'A'", a1: 'E7' });
    assert.deepStrictEqual(r.service.value, { value: '<', formula: '', display: '<', valueType: 'string' });
    assert.deepStrictEqual(r.service.validation, { type: 'VALUE_IN_LIST', values: [["'<", "'>", "'="], true], allowInvalid: false });
    assert.strictEqual(r.api.validation.condition.values[0].userEnteredValue, "'<");
    assert.strictEqual(r.api.userEnteredValue.stringValue, '<');
  });

  test('inspector: the API is asked for that one cell only, with the fields that carry the rule (quoted sheet name)', () => {
    const s = scope();
    s.run(`CellInspector.describe()`);
    const [, id, o] = s.log[0];
    assert.strictEqual(id, 'ss-1');
    assert.deepStrictEqual(plain(o.ranges), ["'Konfiguracja ''A'''!E7"]);
    assert.strictEqual(o.includeGridData, true);
    assert.ok(/dataValidation/.test(o.fields) && /userEnteredValue/.test(o.fields) && /formattedValue/.test(o.fields), o.fields);
  });

  test('inspector: a cell with no validation, no Sheets service, or an API error is reported as such - never a thrown error', () => {
    assert.strictEqual(scope({ dv: null }).run(`CellInspector.describe().service.validation`), null);
    assert.strictEqual(scope({ api: false }).run(`CellInspector.describe().api`), 'The Sheets advanced service is not available.');
    assert.strictEqual(scope({ apiThrows: 'boom' }).run(`CellInspector.describe().api`), 'Sheets API error: boom');
  });

  test('inspector: the text shown is JSON of the report, readable as it is (indented), for the active cell', () => {
    const s = scope();
    const text = s.run(`CellInspector.text()`);
    assert.deepStrictEqual(plain(JSON.parse(text)).cell, { sheet: "Konfiguracja 'A'", a1: 'E7' });
    assert.ok(/\n  "service"/.test(text));
  });
};
