// Tests of the refresh and estimate workflows (RefreshSheet / EstimateSheet, formerly refreshAllDataForConfigSheet / estimateResponseSize in Menu.js),
// of the result sheet write (ResultSheet) and of the menu functions that call them. Registered by tests/run.js.
//
// The real project files run in a fresh global scope (tests/platform-fakes.js) on the simulated spreadsheet (tests/sim.js, Spreadsheet service).
// What is FAKED: the config sheet reader (SheetCoeditor), the BC connection (ODataConnection), the metadata (getMetadata) and the settings sheet
// (getMainSettings). They record every call, so the tests pin the ORDER of the status-cell switches, the error handling and what lands on the result sheet.
// What is REAL: Menu.js, the use cases, DataType (number formats), Controller / Settings / Store, the result sheet write on the simulated sheet.
//
// Written FIRST against the old Menu.js code (characterisation); the extraction must keep all of it green.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');
const BASE = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Data Type.js', 'Menu.js'];
// the files of the extraction, loaded once they exist
const USE_CASE_FILES = ['Import Query.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

const FAKES = `
  globalThis.SheetCoeditor = class {
    constructor(name, readingActive) { __log.push(['coed.new', name, !!readingActive]); __coeditor = this; this.name = name; }
    getTable() { if (__cfg.tableError) throw new Error(__cfg.tableError); return __cfg.table; }
    getTableQueryArray() { return __cfg.queryArray; }
    getExtendTable() { return __cfg.extendTable; }
    getExtendQueryArray() { return __cfg.extendArray; }
    getDataTypes() { return __cfg.dataTypes; }
    switchReadingControl(a) { __log.push(['reading', a]); }
    switchConnectionControl(a) { __log.push(['connection', a]); }
    switchDataWritingControl(a) { __log.push(['writing', a]); }
    setTotRowsInfo(n) { __log.push(['totRows', n]); }
  };
  globalThis.ODataConnection = class {
    constructor() { __log.push(['conn.new']); }
    setODataQuery(table, queryArray, dataTypes) { __log.push(['conn.query', table, queryArray, dataTypes]); return this; }
    setExtendQuery(table, queryArray, dataTypes) { __log.push(['conn.extend', table, queryArray, dataTypes]); return this; }
    setupConnection() { __log.push(['conn.setup']); this.queryURL = 'https://bc/query'; return this; }
    readAllPages(shCoed) { __log.push(['conn.readAllPages', shCoed === __coeditor]); if (__cfg.readError) throw new Error(__cfg.readError); return this; }
    getColumnInfo() { return __cfg.columnInfo; }
    getDataArray() { return __cfg.dataArray; }
    fetchHttpResponse() { __log.push(['conn.fetch']); if (__cfg.fetchError) throw new Error(__cfg.fetchError); return this; }
    readPage() { __log.push(['conn.readPage']); return this; }
    getTotalRows() { return __cfg.totalRows; }
  };
  getMetadata = () => ({ getDataType: (field, table) => { __log.push(['meta.type', field, table]); return __cfg.types[field] ?? null; } });
  getMainSettings = () => ({
    getConfigSheetNames: () => __cfg.configSheets,
    getConfigSheetName: active => (__cfg.configSheets.includes(active) ? active : null),
    getResultSheetName: config => { __log.push(['settings.resultName', config]); return 'Dane wg. ' + config; },
    getSheetList: () => __cfg.sheetList,
    getSheetListWithRefreshTrue: () => __cfg.sheetList.filter(x => x.refresh)
  });
`;

module.exports = function register(t) {
  const { test } = t;
  const FILES = [...BASE, ...USE_CASE_FILES];
  const plain = v => JSON.parse(JSON.stringify(v));

  /** A fresh execution: simulated spreadsheet (service path), the faked collaborators, the add-on switched ON. */
  function scenario(over) {
    const cfg = Object.assign({
      table: 'Customers', queryArray: [['select', 'No']], extendTable: null, extendArray: [], dataTypes: { No: 'Edm.String' },
      dataArray: [['No', 'Balance', 'Since'], ['C1', 10.5, '2020-01-01'], ['C2', 20, '2021-02-02']],
      columnInfo: [{ table: null, field: 'No' }, { table: null, field: 'Balance' }, { table: 'Sales', field: 'Since' }],
      types: { No: 'Edm.String', Balance: 'Edm.Decimal', Since: 'Edm.Date' },
      totalRows: 2, configSheets: ['Konfiguracja 1'], sheetList: [], activeSheet: 'Konfiguracja 1'
    }, over || {});
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: 'Ustawienia' });
    const book = new SimBook({ api: false });
    const log = [];
    const ss = book.spreadsheet();
    const app = {
      getActiveSpreadsheet: () => ss, flush() {}, WrapStrategy: book.SpreadsheetApp.WrapStrategy,
      getActive: () => ({ getActiveSheet: () => ({ getName: () => cfg.activeSheet }) }),
      getUi: () => ({ alert: m => log.push(['alert', m]) })
    };
    const ex = p.execution(FILES, { SpreadsheetApp: app, __cfg: cfg, __log: log, __coeditor: null });
    ex.eval(`StatusManager.fullStatusCheck = () => {}`);
    ex.eval(FAKES);
    return { p, book, ex, log, cfg, calls: () => plain(log) };
  }
  const names = log => log.map(x => x[0]);
  const sheetValues = (book, name, rows, cols) => {
    const s = book.sheets[name];
    return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (s.cell(i + 1, j + 1) || { v: '' }).v));
  };

  // ---- refreshAllDataForConfigSheet -------------------------------------------------------------------------------------------
  test('refresh: reads the config, queries BC, switches reading -> writing, and writes the result sheet (values and number formats per column)', () => {
    const { book, ex, log, calls } = scenario();
    ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`);
    assert.deepStrictEqual(names(calls()), ['coed.new', 'conn.new', 'conn.query', 'conn.extend', 'conn.setup', 'conn.readAllPages', 'meta.type', 'meta.type', 'meta.type', 'reading', 'writing', 'writing']);
    assert.deepStrictEqual(calls().slice(0, 1), [['coed.new', 'Konfiguracja 1', true]], 'the reading cell is lit by the constructor');
    assert.deepStrictEqual(calls().filter(c => /^(reading|writing)$/.test(c[0])), [['reading', false], ['writing', true], ['writing', false]]);
    assert.deepStrictEqual(sheetValues(book, 'Wynik', 3, 3), [['No', 'Balance', 'Since'], ['C1', 10.5, '2020-01-01'], ['C2', 20, '2021-02-02']]);
    const fmt = (r, c) => (book.sheets['Wynik'].cell(r, c) || { fmt: {} }).fmt.numFmt;
    assert.deepStrictEqual([1, 2, 3].map(c => fmt(1, c)), ['@', '#,##0.00', 'yyyy-mm-dd'], 'format by data type, from the header row down');
    assert.deepStrictEqual([3].map(c => fmt(3, c)), ['yyyy-mm-dd']);
  });

  test('refresh: the query is built from the config (table, query lines, extend, data types) and read with the coeditor that lights the indicators', () => {
    const { ex, calls } = scenario({ extendTable: 'SalesLines', extendArray: [['select', 'Qty']], dataTypes: { No: 'Edm.String', Qty: 'Edm.Int32' } });
    ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`);
    const c = calls();
    assert.deepStrictEqual(c.find(x => x[0] === 'conn.query'), ['conn.query', 'Customers', [['select', 'No']], { No: 'Edm.String', Qty: 'Edm.Int32' }]);
    assert.deepStrictEqual(c.find(x => x[0] === 'conn.extend'), ['conn.extend', 'SalesLines', [['select', 'Qty']], { No: 'Edm.String', Qty: 'Edm.Int32' }]);
    assert.deepStrictEqual(c.find(x => x[0] === 'conn.readAllPages'), ['conn.readAllPages', true]);
  });

  test('refresh: the data type of a column comes from the metadata, with the table of the column or else the main table', () => {
    const { ex, calls } = scenario();
    ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`);
    assert.deepStrictEqual(calls().filter(c => c[0] === 'meta.type'), [['meta.type', 'No', 'Customers'], ['meta.type', 'Balance', 'Customers'], ['meta.type', 'Since', 'Sales']]);
  });

  test('refresh: an existing result sheet is reused and wiped first (content AND formats), other sheets are not touched', () => {
    const { book, ex } = scenario();
    const old = book.add('Wynik');
    old.setValue(1, 1, 'old', ''); old.setValue(9, 9, 'far away', ''); old.cell(9, 9).fmt.bg = '#ff0000'; old.cell(1, 1).fmt.numFmt = '0.0%';
    const other = book.add('Inna'); other.setValue(1, 1, 'mine', '');
    ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`);
    assert.strictEqual(Object.keys(book.sheets).filter(n => n === 'Wynik').length, 1);
    assert.strictEqual(book.sheets['Wynik'].cell(9, 9), undefined, 'the whole old data range was cleared');
    assert.strictEqual(book.sheets['Wynik'].cell(1, 1).v, 'No');
    assert.strictEqual(book.sheets['Wynik'].cell(1, 1).fmt.numFmt, '@');
    assert.strictEqual(book.sheets['Inna'].cell(1, 1).v, 'mine');
  });

  test('refresh: the result sheet name defaults to the settings sheet\'s, the config sheet to the first one', () => {
    const { book, ex, calls } = scenario({ configSheets: ['Konfiguracja 7', 'Konfiguracja 8'] });
    ex.eval(`refreshAllDataForConfigSheet()`);
    assert.deepStrictEqual(calls()[0], ['coed.new', 'Konfiguracja 7', true]);
    assert.deepStrictEqual(calls().find(c => c[0] === 'settings.resultName'), ['settings.resultName', 'Konfiguracja 7']);
    assert.ok(book.sheets['Dane wg. Konfiguracja 7']);
  });

  test('refresh: without a table in the config sheet it only puts the reading cell back to idle (nothing is queried or written)', () => {
    const { book, ex, calls } = scenario({ table: null });
    ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`);
    assert.deepStrictEqual(calls(), [['coed.new', 'Konfiguracja 1', true], ['reading', false]]);
    assert.deepStrictEqual(Object.keys(book.sheets), []);
  });

  test('refresh: a failure while reading gives the error back, puts reading idle, never lights writing, leaves the result sheet alone', () => {
    const { book, ex, calls } = scenario({ readError: 'BC down' });
    book.add('Wynik').setValue(1, 1, 'keep me', '');
    assert.throws(() => ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`), /BC down/);
    assert.deepStrictEqual(calls().filter(c => /^(reading|writing)$/.test(c[0])), [['reading', false]]);
    assert.strictEqual(book.sheets['Wynik'].cell(1, 1).v, 'keep me');
  });

  test('refresh: a failure while the config is read (table lookup) gives the error back and puts reading idle', () => {
    const { ex, calls } = scenario({ tableError: 'config broken' });
    assert.throws(() => ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`), /config broken/);
    assert.deepStrictEqual(calls().filter(c => /^(reading|writing)$/.test(c[0])), [['reading', false]]);
  });

  test('refresh: a failure while writing puts writing back to idle and gives the error back', () => {
    const { ex, calls } = scenario({ dataArray: [] });            // table1[0].length fails
    assert.throws(() => ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`), /Cannot read properties of undefined/);
    assert.deepStrictEqual(calls().filter(c => /^(reading|writing)$/.test(c[0])), [['reading', false], ['writing', true], ['writing', false]]);
  });

  test('refresh: the "no data" message of the connection is written like any result (one cell)', () => {
    const { book, ex } = scenario({ dataArray: [['Brak danych spełniających zadane kryteria.']], columnInfo: [{ table: null, field: 'x' }], types: { x: null } });
    ex.eval(`refreshAllDataForConfigSheet('Konfiguracja 1', 'Wynik')`);
    assert.strictEqual(book.sheets['Wynik'].cell(1, 1).v, 'Brak danych spełniających zadane kryteria.');
    assert.strictEqual(book.sheets['Wynik'].cell(1, 1).fmt.numFmt, 'General', 'unknown type -> General');
  });

  // ---- estimateResponseSize ---------------------------------------------------------------------------------------------------
  test('estimate: reading -> idle, connection on while one page is fetched, connection off, then the estimate is written', () => {
    const { ex, calls } = scenario({ totalRows: 12345 });
    ex.eval(`estimateResponseSize('Konfiguracja 1')`);
    assert.deepStrictEqual(names(calls()), ['coed.new', 'reading', 'connection', 'conn.new', 'conn.query', 'conn.extend', 'conn.setup', 'conn.fetch', 'conn.readPage', 'connection', 'totRows']);
    assert.deepStrictEqual(calls().filter(c => /^(reading|connection|totRows)$/.test(c[0])), [['reading', false], ['connection', true], ['connection', false], ['totRows', 12345]]);
    assert.deepStrictEqual(calls()[0], ['coed.new', 'Konfiguracja 1', true]);
  });

  test('estimate: nothing is written to any sheet', () => {
    const { book, ex } = scenario();
    ex.eval(`estimateResponseSize('Konfiguracja 1')`);
    assert.deepStrictEqual(Object.keys(book.sheets), []);
  });

  test('estimate: a failed fetch puts the connection cell back to idle, gives the error back and writes no estimate', () => {
    const { ex, calls } = scenario({ fetchError: 'timeout' });
    assert.throws(() => ex.eval(`estimateResponseSize('Konfiguracja 1')`), /timeout/);
    assert.deepStrictEqual(calls().filter(c => /^(reading|connection|totRows)$/.test(c[0])), [['reading', false], ['connection', true], ['connection', false]]);
  });

  test('estimate: a failure while the config is read puts reading idle and gives the error back', () => {
    const { ex, calls } = scenario({ tableError: 'config broken' });
    assert.throws(() => ex.eval(`estimateResponseSize('Konfiguracja 1')`), /config broken/);
    assert.deepStrictEqual(calls().filter(c => /^(reading|connection|totRows)$/.test(c[0])), [['reading', false]]);
  });

  test('estimate: KNOWN QUIRK pinned - without a table it returns early and leaves the reading cell lit (the live check reports "still showing activity")', () => {
    const { ex, calls } = scenario({ table: null });
    ex.eval(`estimateResponseSize('Konfiguracja 1')`);
    assert.deepStrictEqual(calls(), [['coed.new', 'Konfiguracja 1', true]], 'no reading(false), nothing else');
  });

  test('estimate: the config sheet defaults to the first one', () => {
    const { ex, calls } = scenario({ configSheets: ['Konfiguracja 3'] });
    ex.eval(`estimateResponseSize()`);
    assert.deepStrictEqual(calls()[0], ['coed.new', 'Konfiguracja 3', true]);
  });

  // ---- the menu functions around them ---------------------------------------------------------------------------------------------
  test('menu: refreshCurrentSheet refreshes the config sheet that belongs to the active sheet; on any other sheet it only warns (once)', () => {
    const a = scenario({ activeSheet: 'Konfiguracja 1' });
    a.ex.eval(`refreshCurrentSheet()`);
    assert.deepStrictEqual(a.calls()[0], ['coed.new', 'Konfiguracja 1', true]);
    assert.ok(a.book.sheets['Dane wg. Konfiguracja 1']);
    const b = scenario({ activeSheet: 'Arkusz1' });
    b.ex.eval(`refreshCurrentSheet()`);
    assert.deepStrictEqual(names(b.calls()), ['alert']);
    assert.ok(/nie jest arkszuem konfiguracji/.test(b.calls()[0][1]));
  });

  test('menu: estimateForCurrentSheet estimates for the active config sheet; on any other sheet it does nothing at all', () => {
    const a = scenario({ activeSheet: 'Konfiguracja 1', totalRows: 77 });
    a.ex.eval(`estimateForCurrentSheet()`);
    assert.deepStrictEqual(a.calls().filter(c => c[0] === 'totRows'), [['totRows', 77]]);
    const b = scenario({ activeSheet: 'Arkusz1' });
    b.ex.eval(`estimateForCurrentSheet()`);
    assert.deepStrictEqual(b.calls(), []);
  });

  test('menu: estimateForCurrentSheet does not leak a global variable "configSheet" any more (bugs-todo #4; the only intended change of the extraction)', () => {
    const a = scenario({ activeSheet: 'Konfiguracja 1' });
    a.ex.eval(`estimateForCurrentSheet()`);
    assert.strictEqual(a.ex.eval(`typeof globalThis.configSheet`), 'undefined');
  });

  test('menu: refreshAll refreshes every config/result pair of the settings sheet, in order; refreshAllTrue only those ticked', () => {
    const list = [{ configSheet: 'K1', resultSheet: 'R1', refresh: true }, { configSheet: 'K2', resultSheet: 'R2', refresh: false }, { configSheet: 'K3', resultSheet: 'R3', refresh: true }];
    const a = scenario({ sheetList: list });
    a.ex.eval(`refreshAll()`);
    assert.deepStrictEqual(a.calls().filter(c => c[0] === 'coed.new').map(c => c[1]), ['K1', 'K2', 'K3']);
    assert.deepStrictEqual(Object.keys(a.book.sheets).sort(), ['R1', 'R2', 'R3']);
    const b = scenario({ sheetList: list });
    b.ex.eval(`refreshAllTrue()`);
    assert.deepStrictEqual(b.calls().filter(c => c[0] === 'coed.new').map(c => c[1]), ['K1', 'K3']);
    const c = scenario({ sheetList: [{ configSheet: 'K2', resultSheet: 'R2', refresh: false }] });
    c.ex.eval(`refreshAllTrue()`);
    assert.deepStrictEqual(c.calls(), []);
  });

  test('menu: the entry points keep their action names for the live check (menuRefreshCurrentSheet, menuRefreshAll, menuEstimateForCurrentSheet)', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Menu.js'), 'utf8');
    ['menuRefreshCurrentSheet', 'menuRefreshAll', 'menuEstimateForCurrentSheet'].forEach(a => assert.ok(text.includes('Controller.run("' + a + '"'), a));
  });

  // ---- the extracted parts on their own ----------------------------------------------------------------------------------------------
  test('ResultSheet.write: creates the sheet when missing, writes header + rows, one number format per column by data type', () => {
    const { book, ex } = scenario();
    ex.eval(`ResultSheet.write('Nowy', [['a', 'b'], [1, 'x'], [2, 'y']], ['Edm.Int32', 'Edm.Guid'])`);
    assert.deepStrictEqual(sheetValues(book, 'Nowy', 3, 2), [['a', 'b'], [1, 'x'], [2, 'y']]);
    assert.deepStrictEqual([1, 2].map(c => book.sheets['Nowy'].cell(3, c).fmt.numFmt), ['#', '@']);
  });

  test('ResultSheet.write: JS data type names work too, unknown types give General, a column without a type gets no format', () => {
    const { book, ex } = scenario();
    ex.eval(`ResultSheet.write('Nowy', [['a', 'b', 'c'], [1, 2, 3]], ['number', 'whatever'])`);
    const s = book.sheets['Nowy'];
    assert.deepStrictEqual([1, 2, 3].map(c => (s.cell(2, c) || { fmt: {} }).fmt.numFmt), ['#,##0.00', 'General', undefined]);
  });

  test('ResultSheet.write: an empty table fails (nothing to write) and leaves no half-written sheet content', () => {
    const { book, ex } = scenario();
    assert.throws(() => ex.eval(`ResultSheet.write('Nowy', [], [])`), /Cannot read properties of undefined/);
  });

  test('ImportQuery.connectionFor: asks the coeditor for table, query lines, extend and types, and sets the connection up (no fetch)', () => {
    const { ex, calls } = scenario({ extendTable: 'Lines', extendArray: [['select', 'Qty']] });
    ex.eval(`ImportQuery.connectionFor(new SheetCoeditor('Konfiguracja 1', false))`);
    assert.deepStrictEqual(names(calls()), ['coed.new', 'conn.new', 'conn.query', 'conn.extend', 'conn.setup']);
  });

  // ---- rules ----------------------------------------------------------------------------------------------------------------------------
  const code = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

  test('rule: the use cases do not touch the spreadsheet themselves (no SpreadsheetApp, no ranges): sheets are reached through SheetCoeditor / ResultSheet', () => {
    ['RefreshSheet.js', 'EstimateSheet.js', 'Import Query.js'].forEach(f => assert.ok(!/SpreadsheetApp|getRange|getSheetByName|insertSheet/.test(code(f)), f));
  });

  test('rule: Menu.js builds no connection and reads no config itself - the workflows are in the use cases; the old names are one-line forwarders', () => {
    const m = code('Menu.js');
    assert.ok(!/new\s+(ODataConnection|SheetCoeditor)\b/.test(m));
    assert.ok(/function refreshAllDataForConfigSheet\(configSheetName,resultSheetName\)\{\s*return RefreshSheet\.run\(configSheetName,resultSheetName\);\s*\}/.test(m));
    assert.ok(/function estimateResponseSize\(configSheetName\)\{\s*return EstimateSheet\.run\(configSheetName\);\s*\}/.test(m));
  });

  test('rule: only ResultSheet.js writes a result table (clear + setValues of a data range)', () => {
    const offenders = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && f !== 'ResultSheet.js' && !/^(Live Check|Test Functions|Grid)/.test(f))
      .filter(f => /getDataRange\(\)\.clear\(\)/.test(code(f)));
    assert.deepStrictEqual(offenders, []);
  });

  test('rule: the new files load alone, in any order (nothing is used at load time)', () => {
    const vm = require('vm');
    ['Import Query.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js'].forEach(f => vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), {}));
  });
};
