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
    // the frozen class asks for the zone's short name ("z"): the test gives it the notation the new code writes (UTC+9), so the sheets can be compared
    ctx.Utilities = { formatDate: (d, tz, p) => { if (p !== 'z') return simUtilities.formatDate(d, tz, p); const o = simUtilities.formatDate(d, tz, 'Z'); return 'UTC' + o[0] + parseInt(o.slice(1, 3), 10) + (o.slice(3) == '00' ? '' : ':' + o.slice(3)); } };
    FILES.filter(f => fs.existsSync(path.join(ROOT, f))).forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    new vm.Script(fs.readFileSync(path.join(ROOT, LEGACY), 'utf8'), { filename: LEGACY }).runInContext(ctx);
    vm.runInContext(`
      globalThis.dbgLog = () => {};
      globalThis.MainSettings = { getSettingsSheetName: () => 'Ustawienia', setSettingsSheetName() {} };
      globalThis.__stored = []; globalThis.ManagedSheets = { store: s => __stored.push(s.getConfigSheetNames()) };
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
      // a sheet that does not exist yet is made by SettingsGrid.create in both scopes: the frozen class would make the OLD header (without the refreshTime
      // and refreshStatus lines); how a new sheet looks is pinned by its own test below
      if (!prefill) [old, now].forEach(x => x.run(`SettingsGrid.create('Ustawienia')`));
      const answers = [old, now].map((s, i) => {
        s.run(`globalThis.__ss = new ${i === 0 ? 'LegacySettingsSheet' : 'SettingsSheet'}()`);
        return steps.map(code => plain(s.run(code)));
      });
      assert.deepStrictEqual(answers[1], answers[0], 'answers');
      // (opts.noApiLook: a Date written by the Sheets API into a cell without a number format shows as a number - Grid's API path does not guess a format)
      if (!(opts && opts.noApiLook && mode === 'api')) assert.deepStrictEqual(snap(now.book), snap(old.book), 'sheets');
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
    test('building the settings sheet object sets up NO triggers any more (the frozen class created raw, unlogged ones); agents come from the status check only [' + mode + ']', () => {
      const old = scope('service'), now = scope(mode);
      old.run(`new LegacySettingsSheet()`); now.run(`new SettingsSheet()`);
      assert.deepStrictEqual(old.created, ['sheetEdit:edit', 'sheetChange:change'], 'the frozen class');
      assert.deepStrictEqual(now.created, []);
    });
  });

  MODES.forEach(mode => test('addNewSheetInfo hands the new list of config sheets to the managed sheets cache (once per added line) [' + mode + ']', () => {
    const s = scope(mode, sh => fillSettings(sh, { configs: CONFIGS }));
    s.run(`globalThis.__ss = new SettingsSheet()`);
    assert.deepStrictEqual(JSON.parse(s.run('JSON.stringify(__stored)')), [], 'building the object stores nothing');
    s.run(`__ss.addNewSheetInfo('N', 'Dane N', true)`);
    const stored = JSON.parse(s.run('JSON.stringify(__stored)'));
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0][stored[0].length - 1], 'N');
  }));

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


  // ---- the refreshTime and refreshStatus lines (not in the frozen class) ------------------------------------------------------------------
  MODES.forEach(mode => test('a new settings sheet: the old header, then the refreshTime and refreshStatus lines, (config lines are added where they were) [' + mode + ']', () => {
    const s = scope(mode);
    s.run(`globalThis.__ss = new SettingsSheet()`);
    const rows = plain(s.run(`__ss.grid.rows()`));
    assert.deepStrictEqual(rows.slice(4, 8).map(r => r[0]), ['lastRefresh', 'refreshFrequency', 'refreshTime', 'refreshStatus']);
    assert.strictEqual(s.run(`__ss.refreshTimePos`), 7);
  }));

  MODES.forEach(mode => test('the refresh time cell (D of refreshTime): HH:mm, right aligned - on a new sheet, and on a legacy sheet when the line is inserted (directly below refreshFrequency, refreshStatus directly below it); never set again [' + mode + ']', () => {
    const fmtOf = (s, row) => { const c = s.book.sheets['Ustawienia'].cells[row + ',4']; return c && { numFmt: c.fmt.numFmt, hAlign: c.fmt.hAlign }; };
    const fresh = scope(mode);
    fresh.run(`globalThis.__ss = new SettingsSheet()`);
    assert.deepStrictEqual(fmtOf(fresh, 7), { numFmt: 'HH:mm', hAlign: 'right' });

    const s = scope(mode, sh => fillSettings(sh, { configs: CONFIGS }));
    s.run(`globalThis.__ss = new SettingsSheet(); Utilities.formatDate = (d, tz, p) => p === 'Z' ? '+0200' : 'x'`);
    const f = plain(s.run(`__ss.refreshFrequencyPos`));
    s.run(`__ss.setRefreshMessage({ ok: true, when: new Date(1750000000000), frequency: { freq: 6, unit: 'hrs' }, next: new Date(1750100000000) })`);
    const keys = plain(s.run(`__ss.grid.rows().map(r => r[0])`));
    assert.deepStrictEqual(keys.slice(f - 1, f + 2), ['refreshFrequency', 'refreshTime', 'refreshStatus']);
    assert.deepStrictEqual(fmtOf(s, f + 1), { numFmt: 'HH:mm', hAlign: 'right' });
    // the user changes the look; a later message leaves it alone
    const cell = s.book.sheets['Ustawienia'].cells[(f + 1) + ',4'];
    cell.fmt.numFmt = 'h:mm AM/PM'; cell.fmt.hAlign = 'left';
    s.run(`__ss.setRefreshMessage({ ok: false, when: new Date(1750000000000) })`);
    assert.deepStrictEqual(fmtOf(s, f + 1), { numFmt: 'h:mm AM/PM', hAlign: 'left' });
  }));

  MODES.forEach(mode => test('refresh time typed as a bare hour: 17 -> 17:00, as text, a number, or what the sheet gives back for 17 in a time cell (the 17th day at midnight) [' + mode + ']', () => {
    const s = scope(mode);
    s.run(`globalThis.__ss = new SettingsSheet()`);
    const sh = s.book.sheets['Ustawienia'];
    s.run(`{ const f = Utilities.formatDate; const wall = (d, tz) => { const z = f(d, tz, 'Z'); return new Date(d.getTime() + (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3)) * 60000).toISOString(); };
      Utilities.formatDate = (d, tz, p) => p === 'yyyy-MM-dd' ? wall(d, tz).slice(0, 10) : p === 'HH:mm' ? wall(d, tz).slice(11, 16) : f(d, tz, p); }`);
    const at = v => { sh.cells['7,4'].v = v; s.run(`globalThis.__ss = new SettingsSheet()`); const r = plain(s.run(`__ss.getRefreshStartAt()`)); if (r) { assert.strictEqual(r.timeZone, 'Asia/Tokyo', 'the time is in the spreadsheet time zone'); delete r.timeZone; } return r; };
    assert.deepStrictEqual(at('17'), { hour: 17, minute: 0 });
    assert.deepStrictEqual(at('5 PM'), { hour: 17, minute: 0 });
    assert.deepStrictEqual(at(17), { hour: 17, minute: 0 });        // the sheet's number 17 (days) is read back as a Date by a time format, see the next line
    assert.deepStrictEqual(at(0.75), { hour: 18, minute: 0 });
    assert.strictEqual(at(24), null);
    assert.strictEqual(at(17.5), null);
  }));

  MODES.forEach(mode => test('time zones are written as UTC+N: E of refreshTime (the zone the time is in), E of lastRefresh; the inserted refreshTime line has no godzin / dni list from the line above [' + mode + ']', () => {
    const s = scope(mode, sh => fillSettings(sh, { configs: CONFIGS }));
    s.run(`globalThis.__ss = new SettingsSheet()`);
    const sh = s.book.sheets['Ustawienia'];
    const f = plain(s.run(`__ss.refreshFrequencyPos`));
    sh.cells[f + ',5'].dv = 'list:godzin|dni:loose:dropdown';                       // as the sheet has it
    s.run(`globalThis.__ss = new SettingsSheet(); { const u = Utilities.formatDate; Utilities.formatDate = (d, tz, p) => p === 'yyyy-MM-dd HH:mm:ss' ? 'x' : u(d, tz, p); }`);
    s.run(`__ss.setRefreshMessage({ ok: true, when: new Date(1750000000000), frequency: { freq: 6, unit: 'hrs' }, next: new Date(1750100000000) })`);
    const row = f + 1;
    assert.strictEqual(sh.cells[row + ',5'].v, 'UTC+9');
    assert.ok(!sh.cells[row + ',5'].dv && !(sh.cells[row + ',4'] && sh.cells[row + ',4'].dv), 'no data validation on the new line');
    assert.ok(sh.cells[f + ',5'].dv, 'the list of the frequency unit is still there');
    assert.ok(!(sh.cells[(row + 1) + ',5'] && sh.cells[(row + 1) + ',5'].dv), 'no data validation on the status line');
    s.run(`__ss.setLastRefresh(new Date(1750000000000))`);
    assert.strictEqual(plain(s.run(`__ss.grid.rows()[${plain(s.run('__ss.lastRefreshPos'))} - 1][3]`)), 'UTC+9');
    const fresh = scope(mode);
    fresh.run(`globalThis.__ss = new SettingsSheet()`);
    assert.strictEqual(fresh.book.sheets['Ustawienia'].cells['7,5'].v, 'UTC+9', 'a new sheet names the zone from the start');
  }));

  MODES.forEach(mode => test('row 3 is where the config list starts: the first config line takes it and the general settings lines (and the message) move down, found by key [' + mode + ']', () => {
    const s = scope(mode);
    s.run(`globalThis.__ss = new SettingsSheet(); __ss.addNewSheetInfo('N', 'Dane N', true)`);
    const keys = plain(s.run(`__ss.grid.rows().map(r => r[0])`));
    assert.deepStrictEqual(keys.slice(2, 5), ['configSheet', '', 'headerGeneralSettings']);
    assert.deepStrictEqual([s.run(`__ss.refreshFrequencyPos`), s.run(`__ss.refreshTimePos`)], [7, 8]);
    s.run(`Utilities.formatDate = (d, tz, p) => p === 'Z' ? '+0200' : 'x'`);
    s.run(`__ss.setRefreshMessage({ ok: false, when: new Date(1750000000000) })`);
    assert.match(s.run(`__ss.grid.rows()[8][1]`), /^Ustawienia odświeżania/);                    // row 9 now, found by its key
    assert.strictEqual(s.run(`__ss.grid.rows()[2][1]`), 'N');                                    // the config line was not touched
  }));

  MODES.forEach(mode => test('message: success is green with the frequency, next refresh and set-up time; failure is red; in C:E of the refreshStatus line [' + mode + ']', () => {
    const s = scope(mode);
    s.run(`globalThis.__ss = new SettingsSheet()`);
    s.run(`Utilities.formatDate = (d, tz, p) => p === 'Z' ? '+0200' : p === 'z' ? 'CEST' : d.toISOString().slice(0, 19).replace('T', ' ')`);
    const msg = () => s.run(`__ss.grid.rows()[7][1]`);
    s.run(`__ss.setRefreshMessage({ ok: true, when: new Date(1750000000000), frequency: { freq: 2, unit: 'days' }, next: new Date(1750100000000) })`);
    assert.match(msg(), /^Dane będą odświeżane automatycznie co 2 dni\.\nNastępne odświeżenie \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\+2\.\nOdświeżanie zostało ustawione /);
    s.run(`__ss.setRefreshMessage({ ok: false, when: new Date(1750000000000) })`);
    assert.match(msg(), /^Ustawienia odświeżania nie zostały zaktualizowane!\nZmień ustawienia, żeby spróbować ponownie lub zobacz szczegóły w menu dodatku:\nImport z BC -> Ustawienia\.\nPróba zmiany ustawień została podjęta /);
    assert.deepStrictEqual(plain(s.run(`__ss.grid.rows()[7].slice(2)`)), ['', '']);     // merged: D and E are empty
    assert.ok(s.book.sheets['Ustawienia'].snapshot().merges.includes('8,3,8,5'));
  }));

  MODES.forEach(mode => test('message: the refresh switched off (no frequency) is yellow and says "wyłączone", not "ustawione" [' + mode + ']', () => {
    const s = scope(mode);
    s.run(`globalThis.__ss = new SettingsSheet(); Utilities.formatDate = (d, tz, p) => p === 'Z' ? '+0200' : 'x'`);
    s.run(`__ss.setRefreshMessage({ ok: true, off: true, when: new Date(1750000000000), frequency: { freq: '', unit: 'hrs' }, next: null })`);
    const msg = s.run(`__ss.grid.rows()[7][1]`);
    assert.match(msg, /^Odświeżanie automatyczne jest wyłączone\.\nOdświeżanie zostało wyłączone /);
    assert.ok(!/ustawione|Następne/.test(msg));
    const bg = () => s.book.sheets['Ustawienia'].cells['8,3'].fmt.bg;
    assert.strictEqual(bg(), '#fff2cc');
    s.run(`__ss.setRefreshMessage({ ok: true, when: new Date(1750000000000), frequency: { freq: 6, unit: 'hrs' }, next: new Date(1750100000000) })`);
    assert.strictEqual(bg(), '#d9ead3');
    s.run(`__ss.setRefreshMessage({ ok: false, when: new Date(1750000000000) })`);
    assert.strictEqual(bg(), '#f4cccc');
  }));

  MODES.forEach(mode => test('failure message: the current state after the headline (on / off), the place "Import z BC -> Ustawienia" on its own line and in bold; a later message has no bold left [' + mode + ']', () => {
    const s = scope(mode);
    s.run(`globalThis.__ss = new SettingsSheet(); Utilities.formatDate = (d, tz, p) => p === 'Z' ? '+0100' : p === 'z' ? 'CET' : d.toISOString().slice(0, 19).replace('T', ' ')`);
    const cell = () => s.book.sheets['Ustawienia'].cells['8,3'];
    const msg = () => s.run(`__ss.grid.rows()[7][1]`);
    s.run(`__ss.setRefreshMessage({ ok: false, when: new Date(1750000000000), current: { active: true, frequency: { freq: 1, unit: 'days' }, next: new Date(1750100000000) } })`);
    assert.match(msg(), /^Ustawienia odświeżania nie zostały zaktualizowane!\nDane będą odświeżane automatycznie co 1 dzień\.\nNastępne odświeżenie 2025-06-16 \d\d:\d\d:\d\d UTC\+1\.\nZmień ustawienia/);
    const at = msg().indexOf('Import z BC -> Ustawienia');
    assert.deepStrictEqual(plain(cell().fmt.boldRuns), [[at, at + 'Import z BC -> Ustawienia'.length]]);
    assert.ok(msg().slice(at - 1, at + 26).startsWith('\nImport z BC -> Ustawienia'.slice(0, 27)));
    s.run(`__ss.setRefreshMessage({ ok: false, when: new Date(1750000000000), current: { active: false } })`);
    assert.match(msg(), /^Ustawienia odświeżania nie zostały zaktualizowane!\nOdświeżanie automatyczne jest wyłączone\.\nZmień/);
    s.run(`__ss.setRefreshMessage({ ok: false, when: new Date(1750000000000) })`);                 // the state could not be read: no status lines
    assert.match(msg(), /^Ustawienia odświeżania nie zostały zaktualizowane!\nZmień/);
    s.run(`__ss.setRefreshMessage({ ok: true, when: new Date(1750000000000), frequency: { freq: 6, unit: 'hrs' }, next: new Date(1750100000000) })`);
    assert.strictEqual(cell().fmt.boldRuns, undefined);
  }));

  MODES.forEach(mode => test('a sheet made before the two lines: the first message adds them after the frequency line; the lines below and the remembered rows move [' + mode + ']', () => {
    const s = scope(mode, sh => fillSettings(sh, { configs: CONFIGS }));
    s.run(`globalThis.__ss = new SettingsSheet(); Utilities.formatDate = (d, tz, p) => p === 'Z' ? '+0200' : 'x'`);
    const before = plain(s.run(`__ss.getConfigSheetNames()`));
    s.run(`__ss.setRefreshMessage({ ok: true, when: new Date(1750000000000), frequency: { freq: 6, unit: 'hrs' }, next: new Date(1750100000000) })`);
    const keys = plain(s.run(`__ss.grid.rows().map(r => r[0])`));
    const f = keys.indexOf('refreshFrequency');
    assert.deepStrictEqual(keys.slice(f, f + 3), ['refreshFrequency', 'refreshTime', 'refreshStatus']);
    assert.deepStrictEqual(plain(s.run(`__ss.getConfigSheetNames()`)), before);
    assert.strictEqual(s.run(`__ss.refreshTimePos`), f + 2);
    assert.strictEqual(s.run(`__ss.refreshFrequencyPos`), f + 1);
  }));

  MODES.forEach(mode => test('refresh time: "17:30", "5:30 PM", "3:45 pm", 7:05 -> {hour, minute}; empty, text, 25:00, 13:00 PM -> null; no such line -> null; editing it is a frequency edit [' + mode + ']', () => {
    const s = scope(mode);
    s.run(`globalThis.__ss = new SettingsSheet()`);
    const sh = s.book.sheets['Ustawienia'];
    const at = v => { sh.setValue(7, 4, v, ''); s.run(`globalThis.__ss = new SettingsSheet()`); const r = plain(s.run(`__ss.getRefreshStartAt()`)); if (r) { assert.strictEqual(r.timeZone, 'Asia/Tokyo', 'the time is in the spreadsheet time zone'); delete r.timeZone; } return r; };
    assert.deepStrictEqual(at('17:30'), { hour: 17, minute: 30 });
    assert.deepStrictEqual(at('5:30 PM'), { hour: 17, minute: 30 });
    assert.deepStrictEqual(at('3:45 pm'), { hour: 15, minute: 45 });
    assert.deepStrictEqual(at('12:10 AM'), { hour: 0, minute: 10 });
    assert.deepStrictEqual(at('7:05'), { hour: 7, minute: 5 });
    ['', 'wieczorem', '25:00', '13:00 PM'].forEach(v => assert.strictEqual(at(v), null, v));
    assert.strictEqual(s.run(`__ss.isRefreshFrequencyCell({ getRow: () => 7, getColumn: () => 4, getLastRow: () => 7, getLastColumn: () => 4 })`), true);
  }));

  test('rule: Settings Sheet.js and the settings code around it reach the sheet through SettingsGrid only', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Settings Sheet.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/getRange\(|getSheetByName|insertSheet|insertRowAfter|getLastRow|\.setValues\(|setNumberFormat|insertCheckboxes|autoResizeColumns/.test(text));
    assert.ok(!/SpreadsheetApp|ScriptApp/.test(text), 'no platform service at all');
  });

  test('rule: Settings Grid.js reaches the sheet through Grid only (SpreadsheetApp.flush and Utilities.formatDate are all it calls) and loads alone', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Settings Grid.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.deepStrictEqual([...new Set(text.match(/SpreadsheetApp\.\w+/g) || [])], ['SpreadsheetApp.flush']);
    assert.ok(!/getSheetByName|getActiveSpreadsheet/.test(text));
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'Settings Grid.js'), 'utf8'), {});
  });

  // The row numbers SettingsSheet remembers (lastRefreshPos, refreshFrequencyPos) follow a line that addNewSheetInfo inserts above them (a new config line goes
  // after row 2 while there are no config lines). Before, the later setLastRefresh of the same run wrote into the row where lastRefresh WAS (bugs-fixed #11);
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
