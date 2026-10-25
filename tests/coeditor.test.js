// Tests of the config sheet co-editing: what SheetCoeditor reads from the sheet and what it writes back (rows inserted,
// dropdowns, notes). Registered by tests/run.js.
//
//  GOLDEN: tests/golden/legacy-sheet-coeditor.js is SheetCoeditor as it was while it still used the Spreadsheet service itself.
//  Both classes run in a fresh scope (like an Apps Script execution) with the REAL query model (Content Tracker.js, Data Validations.js,
//  Fix Register.js) and a faked metadata, on the same simulated sheet; the sheets must come out identical - the new one through both
//  commit paths of the Grid (API batchUpdate and Spreadsheet service).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');
const FILES = ['Grid.js', 'Grid Util.js', 'Config Grid.js', 'Custom errors.js', 'functions.js', 'OData Query.js', 'Fix Register.js',
  'Data Validations.js', 'Content Tracker.js', 'Sheet Coeditor.js'];

module.exports = function register(t) {
  const { test } = t;

  /** A fresh scope on a new simulated book: { book, ctx, run(code), co(name, reading) }. */
  function scope(mode, opts) {
    opts = opts || {};
    const book = new SimBook({ api: mode === 'api' });
    const calls = [];
    const ctx = vm.createContext({ console: { log() {}, error() {} }, __calls: calls });
    book.install(ctx);
    FILES.forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    new vm.Script(fs.readFileSync(path.join(ROOT, 'tests/golden/legacy-sheet-coeditor.js'), 'utf8'), { filename: 'legacy-sheet-coeditor.js' }).runInContext(ctx);
    vm.runInContext(`
      globalThis.dbgLog = () => {};
      globalThis.__offline = ${!!opts.offline}; globalThis.__offlineAll = ${!!opts.offlineAll};
      globalThis.getMetadata = () => ({
        listTables: () => { if (__offline) throw new ConnectionError('offline'); return ['Customers', 'Items']; },
        listProperties: t => { if (__offlineAll) throw new ConnectionError('offline'); return ['No', 'Name', 'PostingDate']; },
        listNavProperties: t => { if (__offlineAll) throw new ConnectionError('offline'); return ['Lines', 'Dimensions']; },
        getDataType: (f, t) => { if (__offlineAll) throw new ConnectionError('offline'); return f === 'PostingDate' ? 'Edm.Date' : 'Edm.String'; }
      });`, ctx);
    const run = code => vm.runInContext(code, ctx);
    return { book, ctx, run, calls };
  }

  /** Writes config lines [[b, c, d, e, f], ...] from row 6 down, after the header exists. */
  function fillLines(book, lines) {
    const s = book.sheets['K'];
    lines.forEach((row, i) => row.forEach((v, j) => { if (v !== '') s.setValue(6 + i, 2 + j, v, ''); }));
  }

  const compact = book => {
    const s = book.sheets['K'].snapshot();
    delete s.condRules;                    // the grey rules for stale cells are new (tests/stale-grey.test.js); the frozen class knows nothing of them
    return JSON.parse(JSON.stringify(s));
  };

  const SCENARIOS = {
    'no lines at all': [],
    'a table only': [['table', 'Customers']],
    'table and an option': [['table', 'Customers'], ['queryOption', 'select']],
    'table, select, fields, filter': [['table', 'Customers'], ['queryOption', 'select'], ['select', 'Name'], ['queryOption', 'filter'], ['filter', 'PostingDate']],
    'table with expand and its own table': [['table', 'Customers'], ['queryOption', 'expand'], ['expand', 'Lines'], ['queryOption', 'select'], ['select', 'No']],
    'two inserts at different lines (extend option, query option)': [['table', 'Customers'], ['extend', 'Lines'], ['select', 'Name']],
    'extend first, then the table': [['extend', 'Lines'], ['table', 'Customers'], ['queryOption', 'select'], ['select', 'No'], ['queryOption', 'filter']],
    'two tables and an extend': [['table', 'Customers'], ['queryOption', 'select'], ['extend', 'Lines'], ['select', 'Name'], ['table', 'Items']],
    'a half written line': [['table', ''], ['queryOption', 'sel']],
    'an unknown table': [['table', 'Nonsense'], ['queryOption', 'select']]
  };

  /** The same edit by the frozen class and by the current one: sheets (and the model's answers) must be the same. */
  function sameEdit(name, lines, opts) {
    ['api', 'service'].forEach(mode => test('golden: SheetCoeditor edit - ' + name + (opts && opts.offline ? ' (BC offline)' : '') + ' [' + mode + ']', () => {
      const old = scope('service', opts), now = scope(mode, opts);
      [old, now].forEach(s => { s.run(`ConfigGrid.create('K')`); fillLines(s.book, lines); });
      old.run(`globalThis.__co = new LegacySheetCoeditor('K', true); __co.sheetEdit({}); __co.switchReadingControl(false);`);
      now.run(`globalThis.__co = new SheetCoeditor('K', true); __co.sheetEdit({}); __co.switchReadingControl(false);`);
      assert.deepStrictEqual(compact(now.book), compact(old.book));
      ['getTable()', 'getExtendTable()', 'getTableQueryArray()', 'getExtendQueryArray()', 'getDataTypes()'].forEach(m =>
        assert.deepStrictEqual(JSON.parse(now.run(`JSON.stringify(__co.${m})`) || 'null'), JSON.parse(old.run(`JSON.stringify(__co.${m})`) || 'null'), m));
    }));
  }
  Object.keys(SCENARIOS).forEach(n => sameEdit(n, SCENARIOS[n]));
  sameEdit('table and an option', SCENARIOS['table and an option'], { offline: true });
  sameEdit('table, select, fields, filter', SCENARIOS['table, select, fields, filter'], { offline: true });

  ['api', 'service'].forEach(mode => {
    test('golden: an edit repeated on the result of the first one changes nothing more [' + mode + ']', () => {
      const old = scope('service'), now = scope(mode);
      [old, now].forEach(s => { s.run(`ConfigGrid.create('K')`); fillLines(s.book, SCENARIOS['table, select, fields, filter']); });
      old.run(`new LegacySheetCoeditor('K', false).sheetEdit({}); new LegacySheetCoeditor('K', false).sheetEdit({});`);
      now.run(`new SheetCoeditor('K', false).sheetEdit({}); new SheetCoeditor('K', false).sheetEdit({});`);
      assert.deepStrictEqual(compact(now.book), compact(old.book));
    });

    test('golden: the new rows keep what the row above them had (validations of the user, other columns) [' + mode + ']', () => {
      const old = scope('service'), now = scope(mode);
      [old, now].forEach(s => {
        s.run(`ConfigGrid.create('K')`);
        fillLines(s.book, [['table', 'Customers'], ['queryOption', 'select']]);
        s.book.sheets['K'].setValue(7, 7, 'moja notatka', '');          // outside the five columns
      });
      old.run(`new LegacySheetCoeditor('K', false).sheetEdit({})`);
      now.run(`new SheetCoeditor('K', false).sheetEdit({})`);
      assert.deepStrictEqual(compact(now.book), compact(old.book));
    });

    test('golden: the status cells during an edit - estimate greyed, reading lit and off again [' + mode + ']', () => {
      const old = scope('service'), now = scope(mode);
      [old, now].forEach(s => { s.run(`ConfigGrid.create('K')`); s.run(`new SheetCoeditor('K', false).setTotRowsInfo(5)`); });
      old.run(`const c = new LegacySheetCoeditor('K', true); c.sheetEdit({});`);
      now.run(`const c = new SheetCoeditor('K', true); c.sheetEdit({});`);
      assert.deepStrictEqual(compact(now.book), compact(old.book));
      const s = now.book.sheets['K'];
      assert.strictEqual(s.cell(2, 2).fmt.bg, '#008000', 'reading still lit until the use case switches it off');
      assert.strictEqual(s.cell(2, 5).fmt.color, '#999999', 'estimate info greyed by the edit');
    });
  });

  // ---- what the edit does, spelled out (so a reader does not need the legacy file) ---------------------------------------
  ['api', 'service'].forEach(mode => {
    test('an edit inserts the lines the model asks for and puts dropdowns and the offline note on the sheet [' + mode + ']', () => {
      const s = scope(mode, { offline: true });
      s.run(`ConfigGrid.create('K')`);
      fillLines(s.book, [['table', 'Customers'], ['queryOption', 'select']]);
      s.run(`new SheetCoeditor('K', false).sheetEdit({})`);
      const sh = s.book.sheets['K'];
      const rows = []; for (let r = 6; r <= sh.lastRow(); r++) rows.push([2, 3, 4, 5, 6].map(c => (sh.cell(r, c) || { v: '' }).v));
      assert.ok(rows.length >= 2);
      assert.strictEqual(rows[0][0], 'table');
      assert.ok(/Pusta lista/.test((sh.cell(6, 3) || {}).note || ''), 'empty list explained: ' + JSON.stringify(sh.cell(6, 3)));
      assert.ok(/^list:/.test((sh.cell(6, 3) || {}).dv || ''), 'dropdown on the table cell');
    });
  });

  test('the lines are read from B6 down to the last row that has anything in columns B-F (at least one row), five columns wide - not "sheet last row minus one"', () => {
    ['api', 'service'].forEach(mode => {
      const s = scope(mode);
      s.run(`ConfigGrid.create('K')`);
      const rowsOf = () => JSON.parse(s.run(`JSON.stringify(new SheetCoeditor('K', false).cct.originalArray)`));
      assert.deepStrictEqual(rowsOf(), [['', '', '', '', '']], mode + ': an empty sheet is one empty line');
      fillLines(s.book, [['table', 'Customers'], ['queryOption', 'select'], ['select', 'Name']]);
      let seen = rowsOf();
      assert.strictEqual(seen.length, 3, mode);
      assert.deepStrictEqual(seen[0], ['table', 'Customers', '', '', ''], mode);
      assert.deepStrictEqual(seen[2], ['select', 'Name', '', '', ''], mode);
      assert.ok(seen.every(r => r.length === 5), mode);
      s.book.sheets['K'].setValue(12, 7, 'a remark in column G', '');           // outside B-F: not part of the lines
      assert.strictEqual(rowsOf().length, 3, mode + ': content outside B-F does not stretch the lines');
      s.book.sheets['K'].setValue(12, 6, 'far down', '');                        // a line far below a gap
      seen = rowsOf();
      assert.strictEqual(seen.length, 7, mode + ': everything down to the last line is read, gaps included');
      assert.strictEqual(seen[6][4], 'far down', mode);
    });
  });

  test('API path: an edit that inserts lines writes in three batchUpdates (estimate grey, the lines, dropdowns + notes); the old code made a service call per line and per range', () => {
    const s = scope('api');
    s.run(`ConfigGrid.create('K')`);
    fillLines(s.book, SCENARIOS['table, select, fields, filter']);
    s.book.requests.length = 0; s.book.gets.length = 0;
    s.run(`new SheetCoeditor('K', false).sheetEdit({})`);
    assert.strictEqual(s.book.gets.length, 9, 'constructor read + edit read + the two "has the sheet changed" reads (2 gets each: sheet size, window) + status cells; no read after the inserts');
    assert.strictEqual(s.book.requests.length, 3, 'estimate grey, the inserted lines, the dropdowns and notes');
  });

  test('a config sheet that vanished before the lines are read says so', () => {
    const s = scope('service');
    s.run(`ConfigGrid.create('K')`);
    s.run(`globalThis.__co = new SheetCoeditor('K', false)`);
    delete s.book.sheets['K'];
    assert.throws(() => s.run(`__co.sheetEdit({})`), /Nie znaleziono arkusza konfiguracji "K"/);
  });

  test('rule: Sheet Coeditor.js and Content Tracker.js / Data Validations.js do not touch the spreadsheet (ConfigGrid.lines / status do)', () => {
    ['Sheet Coeditor.js', 'Content Tracker.js', 'Data Validations.js', 'Fix Register.js'].forEach(f => {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
      const uses = (text.match(/SpreadsheetApp\.\w+/g) || []).filter(x => x !== 'SpreadsheetApp.newDataValidation' && x !== 'SpreadsheetApp.DataValidationCriteria');
      assert.deepStrictEqual(uses, [], f);
      assert.ok(!/\.getRange\(|\.getSheetByName|\bsheet\.insertRow|\bsheet\.getLastRow|\.setValues\(/.test(text), f);
    });
  });

  // BC unreachable AND nothing cached: listTables falls back to the empty list, and so must the field / navigation property lists (before, they threw
  // ConnectionError and the whole co-edit aborted half way: bugs-todo #3). The frozen class still throws, so these are not golden comparisons.
  ['api', 'service'].forEach(mode => {
    test('BC unreachable (tables, fields, navigation properties, data types): the co-edit completes, every BC-dependent dropdown is an empty list with the explaining note [' + mode + ']', () => {
      const s = scope(mode, { offline: true, offlineAll: true });
      s.run(`ConfigGrid.create('K')`);
      fillLines(s.book, SCENARIOS['table, select, fields, filter'].concat([['extend', 'Lines']]));
      s.run(`new SheetCoeditor('K', false).sheetEdit({})`);
      const sh = s.book.sheets['K'];
      const empty = (r, c) => /^list::/.test((sh.cell(r, c) || {}).dv || '') && /Pusta lista/.test((sh.cell(r, c) || {}).note || '');
      const at = label => { for (let r = 6; r <= sh.lastRow(); r++) if ((sh.cell(r, 2) || {}).v === label) return r; };
      assert.ok(empty(at('table'), 3), 'the table list');
      assert.ok(empty(at('extend'), 3), 'the navigation property list');
      assert.ok(empty(at('queryOption'), 4), 'the field list of the first query option line (select / filter)');
      assert.ok(sh.lastRow() >= 12, 'the co-edit went through to the end: the lines the model asked for are there');
    });

    test('BC unreachable: the field-type lookup for a date column does not abort the co-edit either (no date validation, no error) [' + mode + ']', () => {
      const s = scope(mode, { offline: true, offlineAll: true });
      s.run(`ConfigGrid.create('K')`);
      fillLines(s.book, [['table', 'Customers'], ['queryOption', 'filter'], ['filter', 'PostingDate']]);
      s.run(`new SheetCoeditor('K', false).sheetEdit({})`);
      assert.ok(s.book.sheets['K'].lastRow() >= 8);
    });
  });

  // ---- only the last co-edit completes (checkpoints) -------------------------------------------------------------------------------------------
  ['api', 'service'].forEach(mode => {
    test('checkpoints: sheetEdit asks shouldContinue three times (before the first write, after the lines are inserted, before the dropdowns are written) and returns true when all was done [' + mode + ']', () => {
      const s = scope(mode);
      s.run(`ConfigGrid.create('K')`);
      fillLines(s.book, SCENARIOS['table and an option']);
      s.run(`globalThis.__asked = 0; globalThis.__r = new SheetCoeditor('K', false).sheetEdit({}, () => { __asked++; return true; })`);
      assert.deepStrictEqual([s.run('__asked'), s.run('__r')], [3, true]);
      assert.strictEqual(s.run(`new SheetCoeditor('K', false).sheetEdit({})`), true, 'without a callback it always goes through');
    });

    [[1, 'before anything is written'], [2, 'after the lines are inserted, before the dropdowns'], [3, 'with the dropdowns prepared, before they are written']].forEach(([stopAt, when]) =>
      test(`checkpoints: stopping at checkpoint ${stopAt} (${when}) writes nothing after it and returns false [${mode}]`, () => {
        const s = scope(mode);
        s.run(`ConfigGrid.create('K')`);
        fillLines(s.book, SCENARIOS['table and an option']);
        const before = JSON.stringify(compact(s.book));
        s.run(`globalThis.__asked = 0; globalThis.__r = new SheetCoeditor('K', false).sheetEdit({}, () => ++__asked < ${stopAt})`);
        assert.strictEqual(s.run('__r'), false);
        const sh = s.book.sheets['K'];
        const dropdowns = () => { let n = 0; for (let r = 6; r <= sh.lastRow(); r++) for (let c = 2; c <= 6; c++) if ((sh.cell(r, c) || {}).dv) n++; return n; };
        if (stopAt === 1) assert.strictEqual(JSON.stringify(compact(s.book)), before, 'the sheet is exactly as found');
        if (stopAt === 2) { assert.ok(sh.lastRow() > 7, 'the inserted lines are there'); assert.strictEqual(dropdowns(), 0, 'no dropdowns'); }
        if (stopAt === 3) { assert.ok(sh.lastRow() > 7); assert.strictEqual(dropdowns(), 0, 'no dropdowns'); }
        // and the newer run finds a sheet it can complete
        assert.strictEqual(s.run(`new SheetCoeditor('K', false).sheetEdit({})`), true);
        assert.ok(dropdowns() > 0);
      }));
  });

  // The real thing: AnalyseConfig + runLatestOnly + the co-editor, with a later edit that arrives while the first co-edit is in BC's hands.
  const { FakePlatform } = require('./platform-fakes');
  function analyseScope(mode, hookAt) {
    const book = new SimBook({ api: mode === 'api' });
    const p = new FakePlatform();
    const files = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Controller.js', 'functions.js', ...FILES.filter(f => !['functions.js', 'Custom errors.js'].includes(f)), 'AnalyseConfig.js', 'Coedit Trace.js'];
    const run = (code, extra) => {
      const ex = p.execution(files, Object.assign({ SpreadsheetApp: book.SpreadsheetApp, Utilities: Object.assign({}, book.Utilities, { sleep: ms => { p.advance(ms / 1000); } }), Sheets: mode === 'api' ? book.Sheets : undefined, __hookAt: hookAt, __book: book }, extra || {}));
      ex.eval(`globalThis.dbgLog = () => {}; globalThis.__calls = {}; globalThis.getMetadata = () => ({
        listTables: () => { __tick('listTables'); return ['Customers', 'Items']; },
        listProperties: t => { __tick('listProperties'); return ['No', 'Name']; }, listNavProperties: t => ['Lines'], getDataType: () => 'Edm.String' });
        function __tick(name) { __calls[name] = (__calls[name] || 0) + 1; if (typeof __hook === 'function' && name === __hookAt.name && __calls[name] === __hookAt.nth) __hook(); }`);
      return ex.eval(code);
    };
    return { book, p, run };
  }
  const newerRunStarts = `() => { Store.set('document', 'K_coedit', 'a-newer-run'); }`;
  ['api', 'service'].forEach(mode => [
    ['while the first co-edit reads (its model is being built)', { name: 'listTables', nth: 2 }, 'nothing'],
    ['while the dropdowns are being prepared (the lines are already in)', { name: 'listProperties', nth: 1 }, 'lines']
  ].forEach(([when, hookAt, expectLeft]) => test(`only the last co-edit completes: a newer one starts ${when}: the first drops out, leaves the reading light to the newer one, and the newer one finishes the sheet [${mode}]`, () => {
    const s = analyseScope(mode, hookAt);
    s.run(`ConfigGrid.create('K')`);
    fillLines(s.book, SCENARIOS['table, select, fields, filter']);
    const below = () => JSON.stringify(Object.entries(compact(s.book).cells).filter(([k]) => Number(k.split(',')[0]) >= 3));      // rows 1-2 hold the lights
    const before = below();
    s.run(`globalThis.__hook = ${newerRunStarts}; AnalyseConfig.run('K', {})`);
    const sh = s.book.sheets['K'];
    const dropdowns = () => { let n = 0; for (let r = 6; r <= sh.lastRow(); r++) for (let c = 2; c <= 6; c++) if ((sh.cell(r, c) || {}).dv) n++; return n; };
    assert.strictEqual(sh.cell(2, 2).fmt.bg, '#008000', 'the dropped run did not switch the reading light off');
    if (expectLeft === 'nothing') assert.strictEqual(below(), before, 'the lines are exactly as found');
    else { assert.ok(sh.lastRow() > 10, 'the lines were inserted'); assert.strictEqual(dropdowns(), 0, 'but no dropdowns were written by the dropped run'); }
    // the newer run (its ticket is already in the flag): it takes the lock, finds itself the latest, completes and puts the light back
    s.run(`globalThis.__hook = null; runLatestOnly(isLatest => new SheetCoeditor('K', false).sheetEdit({}, isLatest), 'K_coedit')`);
    s.run(`new SheetCoeditor('K', false).switchReadingControl(false)`);
    assert.ok(dropdowns() > 0);
    assert.strictEqual(sh.cell(2, 2).fmt.bg, '#cccccc');
  })));

  // ---- the sheet changed under the co-edit (a paste while it works) ------------------------------------------------------------------------------
  // The model is built from what was read; BC calls take seconds. If the lines are not what was read any more when the co-edit is about to write, it starts
  // again from a fresh read instead of writing rows and dropdowns that fit the old picture (the paste would lose its dropdowns, inserted rows would land in
  // the wrong place). Independent of any other run: it needs no trigger to come and fix things.
  const PASTED = ['queryOption', 'filter', 'PostingDate', '>=', '2025-01-01'];
  const pasteInto = (s, row, values, dvFrom) => {          // what a paste does: values and the validations copied from the source line
    values.forEach((v, j) => s.book.sheets['K'].setValue(row, 2 + j, v, ''));
    values.forEach((v, j) => { s.book.sheets['K'].cell(row, 2 + j, true).dv = 'list:copied:strict:dropdown'; });
  };
  const dropdownCells = (s, row) => [2, 3, 4, 5, 6].map(c => ((s.book.sheets['K'].cell(row, c) || {}).dv || '-').slice(0, 9));
  function pasteScope(mode, atCall, row, what) {
    const s = scope(mode, {});
    s.run(`ConfigGrid.create('K')`);
    fillLines(s.book, [['table', 'Customers'], ['queryOption', 'select'], ['select', 'Name'], ['extend', 'Lines']]);
    s.run(`globalThis.__calls = {}; globalThis.__passes = 0;
      globalThis.getMetadata = () => ({
        listTables: () => { __calls.t = (__calls.t || 0) + 1; __onCall('listTables', __calls.t); return ['Customers', 'Items']; },
        listProperties: t => { __calls.p = (__calls.p || 0) + 1; __onCall('listProperties', __calls.p); return ['No', 'Name', 'PostingDate']; },
        listNavProperties: t => ['Lines'], getDataType: (f, t) => (f === 'PostingDate' ? 'Edm.Date' : 'Edm.String') });`);
    s.ctx.__onCall = (name, n) => { if (name === atCall.name && n === atCall.nth) what(s); };
    return s;
  }

  ['api', 'service'].forEach(mode => {
    [['while the model is being built (before anything is written)', { name: 'listTables', nth: 3 }],     // (#1 and #2: the two constructors)
     ['while the dropdowns are being prepared (the missing lines are already in)', { name: 'listProperties', nth: 1 }]].forEach(([when, at]) =>
      test(`a paste ${when}: the co-edit starts again and the pasted line ends up with all its dropdowns, in ONE sheetEdit [${mode}]`, () => {
        const s = pasteScope(mode, at, 11, sc => pasteInto(sc, 11, PASTED));
        s.run(`new SheetCoeditor('K', false)`);                                   // (constructor: listTables #1)
        assert.strictEqual(s.run(`new SheetCoeditor('K', false).sheetEdit({})`), true);       // (constructor #2, then the pass: #3 ...)
        const sh = s.book.sheets['K'];
        let row = null;
        for (let r = 6; r <= sh.lastRow(); r++) if ((sh.cell(r, 3) || {}).v === 'filter') row = r;
        assert.ok(row, 'the pasted line is there');
        assert.deepStrictEqual(dropdownCells(s, row).map(x => x.slice(0, 5)), ['-', 'list:', 'list:', 'list:', 'date'], 'field list, operators and the date check on the date field');
        assert.ok(!dropdownCells(s, row).some(x => /copied/.test(x)), 'the copied validations were replaced');
      }));

    test('the co-edit that finds nothing changed reads the lines twice more (before writing, before the dropdowns) and does one pass [' + mode + ']', () => {
      const s = scope(mode);
      s.run(`ConfigGrid.create('K')`);
      fillLines(s.book, SCENARIOS['table and an option']);
      s.run(`globalThis.__n = 0; ConfigGrid.__lines = ConfigGrid.lines; ConfigGrid.lines = n => { __n++; return ConfigGrid.__lines(n); }`);
      s.run(`new SheetCoeditor('K', false).sheetEdit({})`);
      assert.strictEqual(s.run('__n'), 1 + 1 + 2, 'the constructor, the pass, and the two "has it changed" reads');
    });

    test('a sheet that keeps changing is tried 3 times and then left to the next trigger (no endless loop), the result is still "done" [' + mode + ']', () => {
      const s = pasteScope(mode, { name: 'listTables', nth: 0 }, 12, () => {});
      s.ctx.__onCall = (name, n) => { if (name === 'listTables' && n >= 2) s.book.sheets['K'].setValue(30 + n, 2, 'x' + n, ''); };      // every pass: another edit lands
      assert.strictEqual(s.run(`new SheetCoeditor('K', false).sheetEdit({})`), true);
      assert.ok(s.run('__calls.t') <= 5, 'listTables calls: ' + s.run('__calls.t'));
    });
  });

  // ---- the doubled queryOption / extend pairs seen on a real sheet (c06ab0e+) ------------------------------------------------------------------
  // What the flight recorder showed on the real sheet: a co-edit whose execution STARTED before another one committed kept reading the lines as they were at its
  // start - the same 13 rows, the same hash, 8-11 s on, through re-reads and waits - until its own flush (after its own commit) brought the view up to date
  // (the probes had shown the same: reads lag until the reading execution calls SpreadsheetApp.flush()). An execution that started after the commit read it
  // right away. So it inserted the extend line and the empty queryOption line again. The model below is that: reads of an execution are served from the
  // state at its start until it flushes. ConfigGrid.lines() now flushes before it reads.
  const countLabels = sh => { const n = {}; for (let r = 6; r <= sh.lastRow(); r++) { const l = (sh.cell(r, 2) || {}).v; const blank = ![3, 4, 5, 6].some(c => (sh.cell(r, c) || {}).v); const k = l + (blank ? '(empty)' : ''); n[k] = (n[k] || 0) + 1; } return n; };
  const cloneSheet = sim => Object.assign(Object.create(Object.getPrototypeOf(sim)), sim, { cells: JSON.parse(JSON.stringify(sim.cells)), merges: sim.merges.map(m => Object.assign({}, m)), condRules: [] });
  /** Reads of the Spreadsheet service come from `frozen` (state of the sheets at the start of the reading execution) until SpreadsheetApp.flush() is called; writes go to the sheet. */
  function staleView(book) {
    let frozen = null;
    const original = book.spreadsheet.bind(book);
    book.spreadsheet = () => {
      const ss = original(), getSheet = ss.getSheetByName;
      ss.getSheetByName = name => {
        const real = getSheet(name);
        if (!frozen || !frozen[name] || !real) return real;
        const old = book.sheetObj(frozen[name]);
        return Object.assign({}, real, { getLastRow: old.getLastRow, getLastColumn: old.getLastColumn, getMaxRows: old.getMaxRows, getMaxColumns: old.getMaxColumns,
          getRange: (...a) => { const r = real.getRange(...a), o = old.getRange(...a); return Object.assign({}, r, { getValues: o.getValues, getFormulas: o.getFormulas, getValue: o.getValue, getMergedRanges: o.getMergedRanges }); } });
      };
      return ss;
    };
    // A flush brings the view of the flushing execution up to date - but only to the state of that moment: the flush of the constructor (the reading light), long
    // before the lock was got and the other co-edit committed, brings nothing. So here a flush counts only after this execution has got the lock.
    let since = 0, platform = null;
    book.SpreadsheetApp.flush = () => { if (frozen && platform.calls.slice(since).includes('lock.acquired')) frozen = null; };
    return {
      snapshot: () => { const x = {}; Object.keys(book.sheets).forEach(n => { x[n] = cloneSheet(book.sheets[n]); }); return x; },
      staleFrom: (snap, p) => { frozen = snap; platform = p; since = p.calls.length; },
      isStale: () => frozen !== null
    };
  }
  const WITHOUT_FLUSH = `ConfigGrid.lines = eval('({' + ConfigGrid.lines.toString().replace('SpreadsheetApp.flush();', '') + '})').lines;`;      // ConfigGrid.lines as it was

  {
    const staleRun = (beforeSecond) => {
      const s = analyseScope('service', { name: 'none', nth: 0 });
      const view = staleView(s.book);
      s.run(`ConfigGrid.create('K')`);
      fillLines(s.book, [['table', 'Customers'], ['queryOption', 'select'], ['select', 'Name']]);
      const startOfSecond = view.snapshot();                       // the second co-edit's execution has started: this is what it sees
      s.run(`AnalyseConfig.run('K', {})`);                         // the first co-edit: inserts the extend line and an empty queryOption line, commits, flushes
      view.staleFrom(startOfSecond, s.p);
      s.run(`${beforeSecond || ''} AnalyseConfig.run('K', {})`);   // the second co-edit
      return s;
    };

    test('stale view reproduces the symptom of the real trace: reading without a flush, the second co-edit inserts the extend line and the empty queryOption line AGAIN', () => {
      const s = staleRun(WITHOUT_FLUSH);
      const n = countLabels(s.book.sheets['K']);
      assert.strictEqual(n['extend(empty)'], 2, JSON.stringify(n));
      assert.strictEqual(n['queryOption(empty)'], 2, JSON.stringify(n));
    });

    test('with the flush before every read of the lines the second co-edit sees what the first one committed and inserts nothing twice', () => {
      const s = staleRun();
      const n = countLabels(s.book.sheets['K']);
      assert.strictEqual(n['extend(empty)'], 1, JSON.stringify(n));
      assert.strictEqual(n['queryOption(empty)'], 1, JSON.stringify(n));
    });

    test('the flight recorder shows the stale view the way the real one did: stale-suspected, a re-read that brings nothing, then the same inserts again', () => {
      const s = staleRun(WITHOUT_FLUSH);
      const runs = Object.keys(s.p.props.document).filter(k => k.indexOf('coeditTrace:') === 0).sort().map(k => JSON.parse(s.p.props.document[k]));
      const second = runs[1].events.map(x => x.e);
      assert.ok(second.includes('stale-suspected') && second.includes('reread') && !second.includes('stale-confirmed') && second.includes('insert'), second.join(','));
      const ev = runs[1].events, read = ev.slice(0, ev.findIndex(x => x.e === 'insert')).filter(x => x.e === 'read');       // up to the first insert
      assert.ok(read.length >= 2 && read.every(x => x.hash === read[0].hash && x.rows === read[0].rows), 'the same picture again and again');
    });
  }

  ['api', 'service'].forEach(mode => {
    test(`the flight recorder: every co-edit leaves its events in its own property; coeditTrace() prints them in time order [${mode}]`, () => {
      const s = analyseScope(mode, { name: 'none', nth: 0 });
      s.run(`ConfigGrid.create('K')`);
      fillLines(s.book, [['table', 'Customers'], ['queryOption', 'select'], ['select', 'Name']]);
      s.run(`AnalyseConfig.run('K', {}); AnalyseConfig.run('K', {});`);
      const keys = Object.keys(s.p.props.document).filter(k => k.indexOf('coeditTrace:') === 0).sort();
      assert.strictEqual(keys.length, 2, 'one property per co-edit: ' + keys.join(', '));
      const [a, b] = keys.map(k => JSON.parse(s.p.props.document[k]));
      const names = r => r.events.map(x => x.e);
      assert.deepStrictEqual(names(a).slice(0, 5), ['start', 'read', 'ticket', 'lock', 'read'], 'start, the constructor\'s read, the ticket, the lock, the in-lock read');
      assert.ok(names(a).includes('insert') && names(a).includes('commit'), names(a).join(','));
      assert.strictEqual(a.events.find(x => x.e === 'insert').lines.length, 2, 'the extend and the empty queryOption line');
      assert.ok(!names(b).includes('insert') && !names(b).includes('stale-suspected'), 'the second finds the lines and the right row count: ' + names(b).join(','));
      assert.strictEqual(names(a).at(-1), 'end');
      assert.strictEqual(a.events.at(-1).outcome, 'completed');
      const text = s.run(`coeditTrace()`);
      const lines = text.split('\n');
      assert.ok(lines.length >= 15 && lines.every(l => /^\d\d:\d\d:\d\d\.\d\d\d \[[0-9a-z]{4}\] /.test(l)), text);
    });

    test(`the flight recorder keeps the last 20 runs only and coeditTraceClear() empties it; a dropped run and an error leave their story too [${mode}]`, () => {
      const s = analyseScope(mode, { name: 'none', nth: 0 });
      s.run(`ConfigGrid.create('K')`);
      fillLines(s.book, [['table', 'Customers']]);
      s.run(`for (let i = 0; i < 23; i++) AnalyseConfig.run('K', {});`);
      assert.strictEqual(Object.keys(s.p.props.document).filter(k => k.indexOf('coeditTrace:') === 0).length, 20);
      s.run(`coeditTraceClear()`);
      assert.strictEqual(Object.keys(s.p.props.document).filter(k => k.indexOf('coeditTrace:') === 0).length, 0);
      s.run(`SheetCoeditor.prototype.sheetEdit = function (e, isLatest) { Store.set('document', 'K_coedit', 'a-newer-run'); coeditNote_('checkpoint', { n: 1, continue: isLatest() }); return isLatest(); }; AnalyseConfig.run('K', {})`);
      s.run(`SheetCoeditor.prototype.sheetEdit = () => { throw new Error('boom'); }; try { AnalyseConfig.run('K', {}); } catch (e) {}`);
      const all = Object.keys(s.p.props.document).filter(k => k.indexOf('coeditTrace:') === 0).map(k => JSON.parse(s.p.props.document[k]).events.map(x => x.e).join(','));
      assert.ok(all.some(x => /error/.test(x)), 'the error run: ' + all.join(' | '));
      assert.ok(all.some(x => /checkpoint.*end$/.test(x) || /checkpoint/.test(x)), 'the dropped run: ' + all.join(' | '));
    });
  });
};
