// Tests of ConfigGrid ("Config Grid.js") and of SheetCoeditor's use of it. Registered by tests/run.js.
//
//  GOLDEN: tests/golden/legacy-config-header.js is the frozen pre-Grid code (setupConfigHeader, switch*Control, setTotRowsInfo).
//  It is run against the simulated Spreadsheet service; ConfigGrid must leave the same sheet, through BOTH commit paths.
//  tests/golden/config-header.snapshot.json holds the legacy result as a file, so a later change of the header shows up as a diff
//  (regenerate on purpose with  UPDATE_GOLDEN=1 node tests/run.js ).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');
const legacy = require('./golden/legacy-config-header');

const ROOT = path.join(__dirname, '..');
const GOLDEN = path.join(__dirname, 'golden', 'config-header.snapshot.json');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

module.exports = function register(t) {
  const { test, both, MODES, Grid } = t;

  // Config Grid.js and Sheet Coeditor.js, loaded the way Apps Script loads them: top-level code only, in the shared global scope.
  vm.runInThisContext(read('Config Grid.js') + '\n;globalThis.__CG = { ConfigGrid, CONFIG_LAYOUT };', { filename: 'Config Grid.js' });
  vm.runInThisContext(read('Sheet Coeditor.js') + '\n;globalThis.__SC = SheetCoeditor;', { filename: 'Sheet Coeditor.js' });
  const ConfigGrid = globalThis.__CG.ConfigGrid;
  const SheetCoeditor = globalThis.__SC;

  /** What the old code leaves on a new config sheet. */
  const legacyBook = (steps) => {
    const book = new SimBook({ api: false });
    book.install(globalThis);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('K');
    legacy.setupConfigHeader(sheet, SpreadsheetApp);
    if (steps) steps(sheet, book);
    return book;
  };
  const snap = (book, name) => book.sheets[name || 'K'].snapshot();
  const header = (s, r, c) => s.cells[r + ',' + c] || {};

  test('golden: the legacy header looks as the snapshot file says (the frozen copy and the simulation agree)', () => {
    const actual = snap(legacyBook());
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 1) + '\n');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });

  test('golden: the header block has what the user sees (spot checks on the snapshot)', () => {
    const s = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    assert.strictEqual(s.cells['1,2'].v, 'Zapytanie do bazy danych BC');
    assert.deepStrictEqual(s.merges, ['1,2,1,6', '3,3,3,6']);
    assert.strictEqual(s.cells['2,2'].v, 'Analiza zapytania');
    assert.strictEqual(s.cells['2,5'].v, 'Szacowana liczba wierszy:');
    assert.deepStrictEqual([s.cells['4,3'].v, s.cells['4,4'].v, s.cells['4,5'].v, s.cells['4,6'].v], [1, 2, 3, 4]);
    assert.ok(/Skrypt czyta tylko linie/.test(s.cells['4,2'].note));
    assert.deepStrictEqual([s.cells['2,3'].fmt.bg, s.cells['2,3'].fmt.color, s.cells['2,3'].fmt.wrap], ['#cccccc', '#999999', 'WRAP']);
    assert.strictEqual(s.cells['1,2'].fmt.bold, true);
    assert.strictEqual(s.cells['2,2'].fmt.hAlign, 'center');
  });

  both('golden: ConfigGrid.create leaves the sheet the legacy code left', env => {
    ConfigGrid.create('K');
    assert.deepStrictEqual(snap(env.book), JSON.parse(JSON.stringify(snap(legacyBookKeep(env)))));
  });
  // the legacy book installs its own globals: build it, then put this test's book back
  function legacyBookKeep(env) { const l = legacyBook(); env.book.install(globalThis); return l; }

  both('golden: ConfigGrid.create costs one batchUpdate on the API path (the old code made about forty calls)', env => {
    if (env.mode !== 'api') return;
    ConfigGrid.create('K');
    assert.strictEqual(env.book.requests.length, 1);
    assert.strictEqual(env.book.gets.length, 0, 'a new sheet is not read');
  });

  both('golden: resetHeader on a used sheet = the legacy header on the same sheet; the query lines below are untouched', env => {
    const fill = book => {
      const s = book.add('K');
      s.setValue(2, 2, 'old', ''); s.cell(1, 1, true).fmt.bg = '#ff00ff';
      [['table', 'Customers'], ['queryOption', 'select'], ['select', 'Name']].forEach((row, i) => row.forEach((v, j) => s.setValue(6 + i, 2 + j, v, '')));
      s.cell(6, 3, true).dv = 'list:Customers|Items:strict:dropdown';
      return s;
    };
    fill(env.book);
    assert.strictEqual(ConfigGrid.resetHeader('K'), true);
    const mine = snap(env.book);

    const lb = new SimBook({ api: false }); lb.install(globalThis);
    fill(lb);
    legacy.setupConfigHeader(lb.sheets['K'] && SpreadsheetApp.getActiveSpreadsheet().getSheetByName('K'), SpreadsheetApp);
    assert.deepStrictEqual(mine, snap(lb));
    env.book.install(globalThis);
    assert.strictEqual(mine.cells['7,3'].v, 'select', 'query lines kept');
    assert.strictEqual(mine.cells['6,3'].dv, 'list:Customers|Items:strict:dropdown', 'their validation kept');
  });

  both('resetHeader: a missing sheet gives false and creates nothing', env => {
    assert.strictEqual(ConfigGrid.resetHeader('Nie ma'), false);
    assert.deepStrictEqual(Object.keys(env.book.sheets), []);
  });

  // ---- status cells -------------------------------------------------------------------------------------------------
  const SEQUENCE = [
    ['switchReadingControl', true], ['switchConnectionControl', true], ['switchConnectionControl', false],
    ['setTotRowsInfo', 1234567], ['switchEstimateInfoActive', false], ['switchReadingControl', false],
    ['switchDataWritingControl', true], ['switchEstimateInfoActive', true], ['switchDataWritingControl', false],
    ['switchConnectionControl', true], ['switchConnectionControl', false]
  ];
  const newMethod = { switchReadingControl: (h, a) => h.set('reading', a), switchConnectionControl: (h, a) => h.set('connection', a),
    switchDataWritingControl: (h, a) => h.set('writing', a), switchEstimateInfoActive: (h, a) => h.setEstimateActive(a), setTotRowsInfo: (h, n) => h.setTotalRows(n) };

  both('golden: every status switch leaves the sheet the legacy switch left (after each step of a whole refresh)', env => {
    ConfigGrid.create('K');
    const handle = ConfigGrid.status('K');
    const lb = legacyBookKeep(env);
    SEQUENCE.forEach(([name, arg], i) => {
      newMethod[name](handle, arg);
      // the legacy step on its own book
      lb.install(globalThis); legacy[name](SpreadsheetApp.getActiveSpreadsheet().getSheetByName('K'), arg); env.book.install(globalThis);
      assert.deepStrictEqual(snap(env.book), snap(lb), 'after step ' + (i + 1) + ': ' + name + '(' + arg + ')');
    });
  });

  both('status: one commit per switch, a few rows read once (not the whole sheet)', env => {
    ConfigGrid.create('K');
    env.book.requests.length = 0; env.book.gets.length = 0;
    const handle = ConfigGrid.status('K');
    handle.set('reading', true); handle.set('connection', true); handle.set('connection', false); handle.setTotalRows(10);
    if (env.mode === 'api') {
      assert.strictEqual(env.book.gets.length, 1, 'one read');
      assert.ok(/!1:6$/.test(env.book.gets[0].ranges[0]), 'of rows 1-6: ' + env.book.gets[0].ranges[0]);
      assert.strictEqual(env.book.requests.length, 4, 'one batchUpdate per switch');
    }
    assert.strictEqual(env.book.sheets['K'].cell(2, 6).v, 10);
  });

  both('status: the number of estimated rows is a number with the format #,##0, the label turns black', env => {
    ConfigGrid.create('K');
    ConfigGrid.status('K').setTotalRows(1234567);
    const s = env.book.sheets['K'];
    assert.deepStrictEqual([s.cell(2, 6).v, s.cell(2, 6).fmt.numFmt, s.cell(2, 5).fmt.color, s.cell(2, 6).fmt.color], [1234567, '#,##0', '#000000', '#000000']);
  });

  both('status: a missing sheet gives null; an unknown cell kind fails loudly', env => {
    assert.strictEqual(ConfigGrid.status('Nie ma'), null);
    ConfigGrid.create('K');
    assert.throws(() => ConfigGrid.status('K').set('printing', true), /unknown status cell/);
  });

  both('status: the handle survives a header change made by someone else between two switches (only its own cells are written)', env => {
    ConfigGrid.create('K');
    const handle = ConfigGrid.status('K');
    handle.set('reading', true);
    env.book.sheets['K'].setValue(1, 2, 'Moj tytuł', '');                  // the user edits the title meanwhile
    handle.set('reading', false);
    assert.strictEqual(env.book.sheets['K'].cell(1, 2).v, 'Moj tytuł');
    assert.strictEqual(env.book.sheets['K'].cell(2, 2).fmt.bg, '#cccccc');
  });

  // ---- SheetCoeditor (the real file) -----------------------------------------------------------------------------------
  function coeditorEnv() {
    globalThis.dbgLog = () => {};
    globalThis.SimpleError = class SimpleError extends Error {};
    globalThis.CCTImportConfig = class { constructor(values) { this.values = values; } };     // the query model is not under test here
    globalThis.getMetadata = () => ({});
  }

  both('SheetCoeditor: a missing config sheet is created with the golden header and the reading cell lit', env => {
    coeditorEnv();
    const co = new SheetCoeditor('K', true);
    const s = env.book.sheets['K'];
    assert.ok(s, 'sheet created');
    assert.strictEqual(s.cell(2, 2).fmt.bg, '#008000', 'reading on (green)');
    assert.strictEqual(s.cell(1, 2).v, 'Zapytanie do bazy danych BC');
    co.switchReadingControl(false);
    assert.strictEqual(s.cell(2, 2).fmt.bg, '#cccccc');
    assert.ok(co.cct, 'the query model was loaded from the sheet');
    assert.strictEqual(co.cct.values[0][0], '', 'data range starts at row 6, column 2 (empty here)');
  });

  both('SheetCoeditor: the whole refresh sequence through the real methods = the legacy sequence', env => {
    coeditorEnv();
    const co = new SheetCoeditor('K', true);                     // reading on
    const lb = legacyBookKeep(env);
    lb.install(globalThis); legacy.switchReadingControl(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('K'), true); env.book.install(globalThis);
    SEQUENCE.forEach(([name, arg], i) => {
      co[name](arg);
      lb.install(globalThis); legacy[name](SpreadsheetApp.getActiveSpreadsheet().getSheetByName('K'), arg); env.book.install(globalThis);
      assert.deepStrictEqual(snap(env.book), snap(lb), 'after step ' + (i + 1) + ': SheetCoeditor.' + name + '(' + arg + ')');
    });
  });

  both('SheetCoeditor: an existing config sheet is not touched by the constructor except the reading cell', env => {
    coeditorEnv();
    ConfigGrid.create('K');
    const s = env.book.sheets['K'];
    s.setValue(1, 2, 'Moj tytuł', ''); s.setValue(6, 2, 'table', ''); s.setValue(6, 3, 'Items', '');
    const before = JSON.stringify(s.snapshot().cells);
    new SheetCoeditor('K', false);
    assert.strictEqual(JSON.stringify(s.snapshot().cells), before);
    new SheetCoeditor('K', true);
    assert.strictEqual(s.cell(2, 2).fmt.bg, '#008000');
    assert.strictEqual(s.cell(1, 2).v, 'Moj tytuł');
  });

  both('SheetCoeditor.setupConfigHeader(sheet) still works for the manual repair in Test Functions.js', env => {
    coeditorEnv();
    const co = new SheetCoeditor('K', false);
    env.book.sheets['K'].setValue(1, 2, 'zepsute', '');
    co.setupConfigHeader(co.sheet);
    assert.strictEqual(env.book.sheets['K'].cell(1, 2).v, 'Zapytanie do bazy danych BC');
  });

  both('SheetCoeditor: a status switch on a sheet deleted meanwhile says so (no silent success)', env => {
    coeditorEnv();
    const co = new SheetCoeditor('K', false);
    delete env.book.sheets['K'];
    co.statusGrid = null;
    assert.throws(() => co.switchReadingControl(true), /Nie znaleziono arkusza konfiguracji "K"/);
  });

  // ---- rules -------------------------------------------------------------------------------------------------------------
  test('rule: the header and status formatting is gone from Sheet Coeditor.js (ConfigGrid is the only place)', () => {
    const text = read('Sheet Coeditor.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/setFontWeights|setBackgrounds|setFontSizes|setHorizontalAlignments|setVerticalAlignments|setWrapStrategies|setFontColor|setBackground\(|setNumberFormat|insertSheet/.test(text));
  });

  test('rule: Config Grid.js reaches the sheet through Grid only (no SpreadsheetApp but flush)', () => {
    const text = read('Config Grid.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const uses = (text.match(/SpreadsheetApp\.\w+/g) || []);
    assert.deepStrictEqual([...new Set(uses)], ['SpreadsheetApp.flush']);
    assert.ok(!/\.getSheetByName|\.getActiveSpreadsheet/.test(text));
  });

  test('rule: Config Grid.js loads alone (nothing is used at load time)', () => {
    vm.runInNewContext(read('Config Grid.js'), {});
  });
};
