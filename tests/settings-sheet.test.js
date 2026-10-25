// Tests of the settings sheet ("Ustawienia importu"): what SettingsSheet reads from it and writes to it. Registered by tests/run.js.
//
//  GOLDEN: tests/golden/legacy-settings-sheet.js is SettingsSheet as it was while it used the Spreadsheet service itself.
//  Old and new class run in a fresh scope each on the same simulated book; the sheets and every answer must be the same,
//  the new class through both commit paths of the Grid.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');
const FILES = ['Grid.js', 'Grid Util.js', 'Settings Grid.js', 'Custom errors.js', 'functions.js', 'Settings Sheet.js'];
const LEGACY = 'tests/golden/legacy-settings-sheet.js';
const MODES = ['api', 'service'];

module.exports = function register(t) {
  const { test } = t;

  /** A fresh scope on a simulated book. `prefill(sheet)` runs on the settings sheet "Ustawienia" before the class is constructed. */
  function scope(mode, prefill) {
    const book = new SimBook({ api: mode === 'api' });
    const created = [];
    const ctx = vm.createContext({ console: { log() {}, error() {} }, __created: created });
    book.install(ctx);
    const simUtilities = ctx.Utilities;
    ctx.Utilities = { formatDate: (d, tz, p) => (p === 'z' ? 'CEST' : simUtilities.formatDate(d, tz, p)) };
    FILES.filter(f => fs.existsSync(path.join(ROOT, f))).forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    new vm.Script(fs.readFileSync(path.join(ROOT, LEGACY), 'utf8'), { filename: LEGACY }).runInContext(ctx);
    vm.runInContext(`
      globalThis.dbgLog = () => {};
      globalThis.MainSettings = { getSettingsSheetName: () => 'Ustawienia', setSettingsSheetName() {} };
      const builder = fn => { const b = { forSpreadsheet: () => b, onEdit: () => { b.type = 'edit'; return b; }, onChange: () => { b.type = 'change'; return b; }, create: () => __created.push(fn + ':' + b.type) }; return b; };
      globalThis.ScriptApp = { getUserTriggers: () => (__existing || []), newTrigger: builder };
      globalThis.__existing = [];
      { const D = Date; globalThis.Date = class extends D { constructor(...a) { if (a.length) super(...a); else super(1750000000000); } static now() { return 1750000000000; } }; }`, ctx);
    if (prefill) { book.add('Ustawienia'); prefill(book.sheets['Ustawienia'], book); }
    return { book, ctx, created, run: code => vm.runInContext(code, ctx) };
  }
  const plain = x => JSON.parse(JSON.stringify(x === undefined ? null : x));
  const snap = book => plain(Object.fromEntries(Object.entries(book.sheets).map(([n, s]) => [n, s.snapshot()])));

  /** The same steps by the frozen class and by the new one; sheets and answers must be identical. */
  function same(name, steps, prefill, opts) {
    MODES.forEach(mode => test('golden: SettingsSheet - ' + name + ' [' + mode + ']', () => {
      const old = scope('service', prefill), now = scope(mode, prefill);
      const answers = [old, now].map((s, i) => {
        s.run(`globalThis.__ss = new ${i === 0 ? 'LegacySettingsSheet' : 'SettingsSheet'}()`);
        return steps.map(code => plain(s.run(code)));
      });
      assert.deepStrictEqual(answers[1], answers[0], 'answers');
      // (opts.noApiLook: a Date written by the Sheets API into a cell without a number format shows as a number - Grid's API path does not guess a format)
      if (!(opts && opts.noApiLook && mode === 'api')) assert.deepStrictEqual(snap(now.book), snap(old.book), 'sheets');
      assert.deepStrictEqual(now.created, old.created, 'triggers set up');
    }));
  }

  const READS = [
    `__ss.getSheetList()`, `__ss.getConfigSheetNames()`, `__ss.getRefreshFrequency()`, `__ss.getLastRefresh()`,
    `__ss.getSheetListWithRefreshTrue()`, `__ss.getConfigSheetName('Dane K2')`, `__ss.getResultSheetName('K1')`,
    `[__ss.isConfigSheet('K1'), __ss.isResultSheet('Dane K1'), __ss.isRefreshFrequencyCell({ getRow: () => 6, getLastRow: () => 6, getColumn: () => 4, getLastColumn: () => 4 })]`
  ];
  const fillSettings = (s, opt) => {
    opt = opt || {};
    s.setValue(2, 2, 'Opis linii', ''); s.setValue(2, 3, 'Arkusz konfiguracji', '');
    s.setValue(4, 2, 'headerGeneralSettings', '');
    if (!opt.noLast) { s.setValue(5, 2, 'lastRefresh', ''); s.setValue(5, 4, (Date.UTC(2025, 2, 3, 10, 30) - Date.UTC(1899, 11, 30)) / 86400000, ''); s.cell(5, 4, true).fmt.numFmt = 'yyyy-mm-dd hh:mm'; }
    if (!opt.noFreq) { s.setValue(6, 2, 'refreshFrequency', ''); s.setValue(6, 4, opt.freq === undefined ? 12 : opt.freq, ''); s.setValue(6, 5, opt.unit || 'godzin', ''); }
    (opt.configs || []).forEach((c, i) => { const r = 7 + i; s.setValue(r, 2, 'configSheet', ''); s.setValue(r, 3, c[0], ''); s.setValue(r, 4, c[1], ''); s.setValue(r, 5, c[2], ''); });
  };
  const CONFIGS = [['K1', 'Dane K1', true], ['K2', 'Dane K2', false], ['K3', 'Dane K3', true]];

  same('a missing settings sheet is created with its header, dropdown and date format', READS);
  same('an existing sheet with three config sheets is only read', READS, s => fillSettings(s, { configs: CONFIGS }));
  same('frequency in days', READS, s => fillSettings(s, { configs: CONFIGS, freq: 3, unit: 'dni' }));
  same('an unknown frequency unit', READS, s => fillSettings(s, { configs: CONFIGS, unit: 'tygodni' }));
  same('no frequency row and no last refresh row', READS, s => fillSettings(s, { configs: CONFIGS, noFreq: true, noLast: true }));
  same('a sheet with a gap between the lines and trailing blank rows', READS, s => { fillSettings(s, { configs: CONFIGS }); s.setValue(15, 2, 'configSheet', ''); s.setValue(15, 3, 'K9', ''); s.setValue(15, 4, 'Dane K9', ''); });

  same('addNewSheetInfo: default names, then named, on a new sheet', [
    `__ss.addNewSheetInfo()`, `__ss.addNewSheetInfo('Moja', 'Wynik', true)`, `__ss.getSheetList()`, `__ss.getConfigSheetNames()`]);
  same('addNewSheetInfo after existing config sheets (inserted after the last one)', [
    `__ss.addNewSheetInfo()`, `__ss.addNewSheetInfo('Moja', 'Wynik', true)`, `__ss.getSheetList()`], s => fillSettings(s, { configs: CONFIGS }));
  same('addNewSheetInfo keeps the lines that follow (frequency rows move down)', [
    `__ss.addNewSheetInfo('N', 'Wynik N')`, `[__ss.sheetList.length, __ss.lastConfigSheetPos]`], s => fillSettings(s, { configs: CONFIGS }));

  same('setLastRefresh writes the time and the zone, and reads it back', [
    `__ss.setLastRefresh(new Date(Date.UTC(2025, 5, 1, 8, 15)))`, `__ss.getLastRefresh()`, `__ss.readLastRefresh()`], s => fillSettings(s, { configs: CONFIGS }));
  same('setLastRefresh on a sheet without the lastRefresh row adds the row', [
    `__ss.setLastRefresh(new Date(Date.UTC(2025, 5, 1, 8, 15)))`, `__ss.getLastRefresh()`], s => fillSettings(s, { configs: CONFIGS, noLast: true }), { noApiLook: true });
  same('setLastRefresh with no argument uses now (a fixed clock)', [
    `__ss.setLastRefresh()`, `__ss.getLastRefresh()`], s => fillSettings(s, { configs: CONFIGS }));
  same('setLastRefresh then addNewSheetInfo (the later setLastRefresh differs from the frozen class on purpose: see the test at the end)', [
    `__ss.setLastRefresh(new Date(Date.UTC(2025, 5, 1, 8, 15)))`, `__ss.addNewSheetInfo('Z', 'Dane Z', true)`, `__ss.getSheetList()`], s => fillSettings(s, { configs: CONFIGS }));

  MODES.forEach(mode => {
    test('golden: the edit triggers are set up only when missing (same as before) [' + mode + ']', () => {
      const old = scope('service'), now = scope(mode);
      [old, now].forEach(s => s.run(`__existing = [{ getHandlerFunction: () => 'sheetEdit' }]`));
      old.run(`new LegacySettingsSheet()`); now.run(`new SettingsSheet()`);
      assert.deepStrictEqual(now.created, old.created);
      assert.deepStrictEqual(old.created, ['sheetChange:change']);
    });
  });

  test('API path: building the sheet object is one read; adding a config sheet and a refresh time are one batchUpdate each', () => {
    const s = scope('api', sh => fillSettings(sh, { configs: CONFIGS }));
    s.run(`globalThis.__ss = new SettingsSheet()`);
    const getsAfterCtor = s.book.gets.length;
    assert.ok(getsAfterCtor <= 2, 'the sheet is read once (sheet size + window): ' + getsAfterCtor);
    s.book.requests.length = 0;
    s.run(`__ss.addNewSheetInfo('N', 'Dane N', true)`);
    assert.strictEqual(s.book.requests.length, 1);
    s.run(`__ss.setLastRefresh(new Date(Date.UTC(2025, 5, 1, 8, 15)))`);
    assert.strictEqual(s.book.requests.length, 2);
    assert.strictEqual(s.book.gets.length, getsAfterCtor, 'no read after the first one');
  });

  test('rule: Settings Sheet.js and the settings code around it reach the sheet through SettingsGrid only', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Settings Sheet.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/getRange\(|getSheetByName|insertSheet|insertRowAfter|getLastRow|\.setValues\(|setNumberFormat|insertCheckboxes|autoResizeColumns/.test(text));
    const uses = (text.match(/SpreadsheetApp\.\w+/g) || []);
    assert.deepStrictEqual([...new Set(uses)], ['SpreadsheetApp.getActiveSpreadsheet'], 'only for the triggers');
  });

  test('rule: Settings Grid.js reaches the sheet through Grid only (SpreadsheetApp.flush and Utilities.formatDate are all it calls) and loads alone', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Settings Grid.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.deepStrictEqual([...new Set(text.match(/SpreadsheetApp\.\w+/g) || [])], ['SpreadsheetApp.flush']);
    assert.ok(!/getSheetByName|getActiveSpreadsheet/.test(text));
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'Settings Grid.js'), 'utf8'), {});
  });

  // The row numbers SettingsSheet remembers (lastRefreshPos, refreshFrequencyPos) follow a line that addNewSheetInfo inserts above them (a new config line goes
  // after row 2 while there are no config lines). Before, the later setLastRefresh of the same run wrote into the row where lastRefresh WAS (bugs-todo #11);
  // this is the one place where the new class intentionally differs from the frozen one.
  MODES.forEach(mode => test('after addNewSheetInfo the remembered lastRefresh and refreshFrequency rows follow the insert [' + mode + ']', () => {
    const s = scope(mode, sh => fillSettings(sh, {}));
    s.run(`globalThis.__ss = new SettingsSheet(); __ss.addNewSheetInfo('N', 'Dane N', true); __ss.setLastRefresh(new Date(Date.UTC(2025, 6, 2, 9, 0)))`);
    const sh = s.book.sheets['Ustawienia'];
    const ref = scope(mode, rb => fillSettings(rb, {}));          // the same time written on a sheet where nothing was inserted: what the cell should hold
    ref.run(`new SettingsSheet().setLastRefresh(new Date(Date.UTC(2025, 6, 2, 9, 0)))`);
    const serial = ref.book.sheets['Ustawienia'].cell(5, 4).v;
    assert.strictEqual(sh.cell(6, 2).v, 'lastRefresh', 'the lastRefresh line moved down by one');
    assert.strictEqual(sh.cell(6, 4).v, serial, 'and got the new time');
    assert.strictEqual(sh.cell(5, 2).v, 'headerGeneralSettings');
    assert.strictEqual((sh.cell(5, 4) || { v: '' }).v, '', 'the line above it is not touched');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.run(`[__ss.lastRefreshPos, __ss.refreshFrequencyPos]`))), [6, 7]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.run(`__ss.readRefreshFrequency()`))), { freq: 12, unit: 'hrs' }, 'the frequency is read from where it is now');
  }));
};
