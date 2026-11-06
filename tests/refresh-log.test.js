// Tests of the download log (Refresh Log.js, Refresh Log Grid.js): the sheet and its entries (newest first, through both commit paths of the Grid), what an entry says
// (status, sheets and rows), the three kinds of refresh that write one, the name of the log sheet, and the page. Registered by tests/run.js.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const GRID_FILES = ['Grid.js', 'Grid Util.js', 'Settings Grid.js', 'Refresh Log Grid.js'];
const USE_CASE_BASE = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'functions.js', 'Settings Grid.js',
  'Auto Refresh Panel.js', 'Refresh Log.js', 'RefreshAll.js', 'Menu Actions.js'];
const MODES = ['api', 'service'];

module.exports = function register(t) {
  const { test } = t;
  const plain = x => JSON.parse(JSON.stringify(x === undefined ? null : x));

  // ---- the sheet: both commit paths of the Grid ---------------------------------------------------------------------------------------------
  function gridScope(mode) {
    const book = new SimBook({ api: mode === 'api' });
    const ctx = vm.createContext({ console: { log() {}, error() {} } });
    book.install(ctx);
    GRID_FILES.forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    return { book, ctx, run: code => vm.runInContext(code, ctx) };
  }
  const entry = (n) => `({ source: 'Autoodświeżanie', start: new Date(Date.UTC(2026, 10, 5, 10, ${n})), end: new Date(Date.UTC(2026, 10, 5, 10, ${n}, 30)), duration: '30 s', status: 'OK', sheets: '1 arkusz:\\nDane K1 (${n} wierszy)', technical: 'Clock trigger t${n}' })`;

  MODES.forEach(mode => test('log sheet: the first entry makes the sheet with the headers (bold, grey) and writes the entry under them; the next one goes ABOVE it, right under the headers [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    const sh = s.book.sheets['Dziennik pobrań'];
    const v = (r, c) => (sh.cells[r + ',' + c] || {}).v ?? '';
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(c => v(1, c)), ['Źródło', 'Początek', 'Koniec', 'Czas trwania', 'Status', 'Odświeżone arkusze', 'Dane techniczne']);
    assert.deepStrictEqual([v(2, 1), v(2, 4), v(2, 5), v(2, 6), v(2, 7)], ['Autoodświeżanie', '30 s', 'OK', '1 arkusz:\nDane K1 (1 wierszy)', 'Clock trigger t1']);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);
    assert.deepStrictEqual([v(2, 7), v(3, 7), v(4, 7)], ['Clock trigger t2', 'Clock trigger t1', ''], 'the newest first');
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(c => v(1, c))[0], 'Źródło', 'the headers stay on top');
  }));

  MODES.forEach(mode => test('log sheet: the new row does not inherit the look of the headers (not bold, no grey), has date formats in start and end, wraps, top aligned; the headers keep theirs [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);
    const sh = s.book.sheets['Dziennik pobrań'];
    const f = (r, c) => (sh.cells[r + ',' + c] || { fmt: {} }).fmt;
    assert.strictEqual(f(1, 1).bold, true);
    assert.strictEqual(f(1, 1).bg, '#cccccc', 'the grey of the headers of a config sheet');
    [2, 3].forEach(r => { assert.ok(!f(r, 1).bold, 'row ' + r + ' not bold'); assert.ok(!f(r, 1).bg, 'row ' + r + ' no fill'); });
    assert.deepStrictEqual([f(2, 2).numFmt, f(2, 3).numFmt], ['yyyy-mm-dd hh:mm:ss "UTC+9"', 'yyyy-mm-dd hh:mm:ss "UTC+9"'], 'date, time AND the zone (the sim\'s spreadsheet is in UTC+9)');
    assert.strictEqual(f(2, 6).wrap, 'WRAP');
    assert.strictEqual(f(2, 6).vAlign, 'top');
  }));

  MODES.forEach(mode => test('log sheet: headers bold, centred, clipped and FROZEN; "Źródło" 200 px and "Odświeżone arkusze" 300 px, the other columns fitted; the technical text CLIPPED (cut) in Courier New 8 pt; the technical column Courier New 8 pt on every entry; entries left aligned, top; wrap only in the two fixed columns, the technical text cut, the rest one line; the new row is fitted to its content [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);
    const sh = s.book.sheets['Dziennik pobrań'];
    const f = (r, c) => (sh.cells[r + ',' + c] || { fmt: {} }).fmt;
    for (let c = 1; c <= 7; c++) assert.deepStrictEqual([f(1, c).bold, f(1, c).hAlign, f(1, c).wrap], [true, 'center', 'CLIP'], 'header ' + c);
    for (const r of [2, 3]) {
      for (let c = 1; c <= 7; c++) assert.deepStrictEqual([f(r, c).hAlign, f(r, c).vAlign], ['left', 'top'], `entry ${r} column ${c}`);
      // only the two columns of a fixed width wrap; the fitted ones are one line (a wrapped column would be fitted by its wrapped layout); the technical text is cut
      assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(c => f(r, c).wrap), ['WRAP', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'WRAP', 'CLIP'], 'wrap of entry ' + r);
      assert.deepStrictEqual([f(r, 7).family, f(r, 7).size], ['Courier New', 8], 'technical column, row ' + r);
      assert.ok(!f(r, 5).family && !f(r, 5).size, 'only the technical column has the small monospaced font');
    }
    const snap = sh.snapshot();
    assert.strictEqual(snap.frozen, 1, 'the header row is frozen');
    assert.deepStrictEqual([(snap.colPx || {})[1], (snap.colPx || {})[6]], [200, 300], '"Źródło" 200 px, "Odświeżone arkusze" 300 px');
    assert.deepStrictEqual(Object.keys(snap.colPx || {}).sort(), ['1', '6'], 'the other columns are fitted, not fixed');
    assert.ok(snap.fitted.columns.some(x => x[0] === 2 && x[1] === 4) && snap.fitted.columns.some(x => x[0] === 7 && x[1] === 1), 'columns B-E and G fit their content: ' + JSON.stringify(snap.fitted.columns));
    assert.ok(!snap.fitted.columns.some(x => x[0] <= 1 && x[0] + x[1] > 1) && !snap.fitted.columns.some(x => x[0] <= 6 && x[0] + x[1] > 6), 'not the two fixed ones');
    assert.ok(snap.fitted.rows.length > 0, 'the new row is fitted to its wrapped content');
  }));

  MODES.forEach(mode => test('log sheet: the wrapping is set per COLUMN for all entries on every write - a log sheet made by an older version (every column wrapped) is put right, so "fit to data" sizes the columns by their text [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);
    const sh = s.book.sheets['Dziennik pobrań'];
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 7; c++) (sh.cells[r + ',' + c] || (sh.cells[r + ',' + c] = { v: '', f: '', note: '', dv: null, fmt: {} })).fmt.wrap = 'WRAP';        // as an older version left it
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(3)})`);
    const wrap = (r, c) => (sh.cells[r + ',' + c] || { fmt: {} }).fmt.wrap;
    for (const r of [2, 3, 4]) assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(c => wrap(r, c)), ['WRAP', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'WRAP', 'CLIP'], 'entry row ' + r + ' (also the older ones)');
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(c => wrap(1, c)), Array(7).fill('CLIP'), 'the headers');
  }));

  MODES.forEach(mode => test('log sheet: the time cells carry the zone of the moment they were written in (UTC+N in the format), per cell; the freeze and the width are set once, with the sheet [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    const sh = s.book.sheets['Dziennik pobrań'];
    sh.colPx[6] = 410; sh.colPx[1] = 250;                                                   // the user widens two columns
    sh.frozen = 0;                                                                          // and unfreezes the header
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);
    assert.deepStrictEqual([sh.colPx[1], sh.colPx[6]], [250, 410], 'a later entry does not set the widths again');
    assert.strictEqual(sh.frozen, 0, 'nor the freeze');
    assert.ok(/UTC\+9"$/.test((sh.cells['2,2'] || { fmt: {} }).fmt.numFmt) && /UTC\+9"$/.test((sh.cells['3,3'] || { fmt: {} }).fmt.numFmt));
  }));

  MODES.forEach(mode => test('log sheet: an entry is one commit, and the grid reads only the first rows (the log grows; the entries below are not read) [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    for (let i = 2; i <= 30; i++) s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(i % 50)})`);
    const requestsBefore = s.book.requests.length;
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(31)})`);
    if (mode === 'api') assert.strictEqual(s.book.requests.length - requestsBefore, 1, 'one batchUpdate');
    const sh = s.book.sheets['Dziennik pobrań'];
    assert.strictEqual((sh.cells['2,7'] || {}).v, 'Clock trigger t31');
    assert.strictEqual((sh.cells['32,7'] || {}).v, 'Clock trigger t1', 'all 31 entries are there, the oldest last');
  }));

  test('log sheet: both commit paths leave the same sheet', () => {
    const a = gridScope('api'), b = gridScope('service');
    [a, b].forEach(s => { s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`); s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`); });
    assert.deepStrictEqual(plain(a.book.sheets['Dziennik pobrań'].snapshot().cells), plain(b.book.sheets['Dziennik pobrań'].snapshot().cells));
  });

  // ---- the entry: what it says ------------------------------------------------------------------------------------------------------------------
  function useCase(over) {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify(Object.assign({ addonStatus: true, importSheetName: 'Ustawienia' }, over && over.settings || {}));
    const ex = p.execution(USE_CASE_BASE, {});
    ex.eval(`globalThis.__entries = []; RefreshLogGrid = { append: (name, e) => { if (globalThis.__appendFails) throw new Error('sheet unavailable'); __entries.push({ name, ...e }); } };`);
    return { p, ex, entries: () => plain(ex.eval(`__entries`)) };
  }

  test('entry: OK, the sheets with their rows (one cell, a line each), the Polish plural of sheets and rows, start / end / duration, the technical text', () => {
    const u = useCase();
    u.ex.eval(`RefreshLog.run('Autoodświeżanie', 'Clock trigger t1', () => { RefreshLog.noteSheet('Dane K1', 1234); RefreshLog.noteSheet('Dane K3', 1); RefreshLog.noteSheet('Dane K4', 22); })`);
    const [e] = u.entries();
    assert.deepStrictEqual([e.name, e.source, e.status, e.technical], ['Dziennik pobrań', 'Autoodświeżanie', 'OK', 'Clock trigger t1']);
    assert.strictEqual(e.sheets, '3 arkusze:\nDane K1 (1234 wiersze)\nDane K3 (1 wiersz)\nDane K4 (22 wiersze)');
    assert.ok(Date.parse(e.start) <= Date.parse(e.end));
    assert.ok(/^\d+ s$|^\d+ m \d+ s$/.test(e.duration), e.duration);
    const plural = n => u.ex.eval(`[RefreshLog.plural_(${n}, 'a', 'b', 'c')]`)[0];
    assert.deepStrictEqual([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 112].map(plural), ['c', 'a', 'b', 'b', 'c', 'c', 'c', 'c', 'c', 'b', 'c', 'c']);
  });

  test('entry: no sheet refreshed = "0 arkuszy"; a failure the add-on handled (no table, BC error) is the status, joined; the run itself is not an error', () => {
    const u = useCase();
    u.ex.eval(`RefreshLog.run('Odświeżanie wszystkich arkuszy', 'Menu', () => { RefreshLog.noteProblem('Brak tabeli w arkuszu konfiguracji „K2”'); RefreshLog.noteProblem('BC (Dane K3): Authorization_RequestDenied: brak uprawnień'); RefreshLog.noteSheet('Dane K1', 5); })`);
    const [e] = u.entries();
    assert.strictEqual(e.status, 'Brak tabeli w arkuszu konfiguracji „K2”; BC (Dane K3): Authorization_RequestDenied: brak uprawnień');
    assert.strictEqual(e.sheets, '1 arkusz:\nDane K1 (5 wierszy)');
    const none = useCase();
    none.ex.eval(`RefreshLog.run('Odświeżanie jednego arkusza', 'Menu', () => {})`);
    assert.strictEqual(none.entries()[0].sheets, '0 arkuszy');
  });

  test('entry: an error the platform throws is the status (what was refreshed before it is listed) and is thrown on after the entry is written', () => {
    const u = useCase();
    assert.throws(() => u.ex.eval(`RefreshLog.run('Odświeżanie wszystkich arkuszy', 'Menu', () => { RefreshLog.noteSheet('Dane K1', 7); throw new Error('Exceeded maximum execution time'); })`), /Exceeded maximum execution time/);
    const [e] = u.entries();
    assert.deepStrictEqual([e.status, e.sheets], ['Exceeded maximum execution time', '1 arkusz:\nDane K1 (7 wierszy)']);
  });

  test('entry: a refresh inside a refresh is ONE entry (the outer one); notes outside of any refresh are ignored', () => {
    const u = useCase();
    u.ex.eval(`RefreshLog.noteSheet('x', 1); RefreshLog.noteProblem('y');`);
    u.ex.eval(`RefreshLog.run('Odświeżanie wszystkich arkuszy', 'Menu', () => { RefreshLog.run('Odświeżanie jednego arkusza', 'inner', () => RefreshLog.noteSheet('Dane K1', 2)); })`);
    const list = u.entries();
    assert.strictEqual(list.length, 1);
    assert.deepStrictEqual([list[0].source, list[0].sheets], ['Odświeżanie wszystkich arkuszy', '1 arkusz:\nDane K1 (2 wiersze)']);
  });

  test('entry: a log that cannot be written never fails the refresh (console.error and a note), and the next refresh is logged again', () => {
    const u = useCase();
    u.ex.eval(`globalThis.__appendFails = true`);
    assert.doesNotThrow(() => u.ex.eval(`RefreshLog.run('Autoodświeżanie', 't', () => RefreshLog.noteSheet('Dane K1', 1))`));
    assert.ok(u.p.consoleErrors.some(m => /The download log was not written/.test(m) && /sheet unavailable/.test(m)), u.p.consoleErrors.join('|'));
    u.ex.eval(`globalThis.__appendFails = false`);
    u.ex.eval(`RefreshLog.run('Autoodświeżanie', 't', () => {})`);
    assert.strictEqual(u.entries().length, 1);
  });

  test('entry: logOnly (a clock trigger that deleted itself) = an entry with no sheets and the reason as the status', () => {
    const u = useCase();
    u.ex.eval(`RefreshLog.logOnly('Autoodświeżanie', 'Clock trigger t9. The trigger was deleted', 'Odświeżanie nie zostało wykonane')`);
    const [e] = u.entries();
    assert.deepStrictEqual([e.source, e.status, e.sheets, e.technical], ['Autoodświeżanie', 'Odświeżanie nie zostało wykonane', '0 arkuszy', 'Clock trigger t9. The trigger was deleted']);
  });

  // ---- the three kinds of refresh write an entry -------------------------------------------------------------------------------------------------
  const STUBS = `getMainSettings = () => ({ getSheetList: () => [{ configSheet: 'K1', resultSheet: 'Dane K1', refresh: true }, { configSheet: 'K2', resultSheet: 'Dane K2', refresh: false }],
      getSheetListWithRefreshTrue: () => [{ configSheet: 'K1', resultSheet: 'Dane K1', refresh: true }], setLastRefresh() {}, getConfigSheetName: n => n });
    RefreshSheet = { run: (cfg, res) => { if (cfg === 'BAD') throw new Error('Brak połączenia'); RefreshLog.noteSheet(res ?? 'Dane ' + cfg, cfg === 'K1' ? 10 : 20); } };`;

  test('menu "Pobierz dane dla wszystkich arkuszy": one entry "Odświeżanie wszystkich arkuszy" with every sheet and its rows; menu "dla tego arkusza": "Odświeżanie jednego arkusza" with the config sheet in the technical text', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`RefreshAll.all()`);
    u.ex.eval(`MenuActions.activeConfigSheet = () => 'K2'; MenuActions.refreshActive()`);
    const [all, one] = u.entries();
    assert.deepStrictEqual([all.source, all.sheets, all.technical, all.status], ['Odświeżanie wszystkich arkuszy', '2 arkusze:\nDane K1 (10 wierszy)\nDane K2 (20 wierszy)', 'Menu: refresh all sheets', 'OK']);
    assert.deepStrictEqual([one.source, one.sheets, one.technical], ['Odświeżanie jednego arkusza', '1 arkusz:\nDane K2 (20 wierszy)', 'Menu: refresh one sheet (config sheet: K2)']);
  });

  test('menu: on a sheet that is not a config sheet nothing is refreshed and nothing is logged; a failing sheet stops the run and the entry carries the error', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`MenuActions.activeConfigSheet = () => null; Controller.registerClosingOnce = () => {}; MenuActions.refreshActive()`);
    assert.deepStrictEqual(u.entries(), []);
    u.ex.eval(`getMainSettings = () => ({ getSheetList: () => [{ configSheet: 'K1', resultSheet: 'R1' }, { configSheet: 'BAD', resultSheet: 'R2' }, { configSheet: 'K2', resultSheet: 'R3' }] })`);
    assert.throws(() => u.ex.eval(`RefreshAll.all()`), /Brak połączenia/);
    const [e] = u.entries();
    assert.deepStrictEqual([e.status, e.sheets], ['Brak połączenia', '1 arkusz:\nR1 (10 wierszy)']);
  });

  test('automatic refresh: RefreshAll.scheduled writes "Autoodświeżanie" with the clock trigger in the technical text; a trigger that retires writes an entry that says nothing was refreshed', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`RefreshAll.scheduled('Clock trigger t1')`);
    const [e] = u.entries();
    assert.deepStrictEqual([e.source, e.technical, e.sheets, e.status], ['Autoodświeżanie', 'Clock trigger t1', '1 arkusz:\nDane K1 (10 wierszy)', 'OK']);
    const text = fs.readFileSync(path.join(ROOT, 'ScheduleRefresh.js'), 'utf8');
    assert.ok(/RefreshAll\.scheduled\(ScheduleRefresh\.triggerText_\(e\.triggerUid,false\)\)/.test(text) && /RefreshAll\.scheduled\(ScheduleRefresh\.triggerText_\(e\.triggerUid,true\)\)/.test(text));
    assert.ok(/logRetired_\(e\.triggerUid,false\)/.test(text) && /logRetired_\(e\.triggerUid,true\)/.test(text), 'both handlers log a retired trigger');
  });

  test('the sheets: RefreshSheet notes a written result sheet with its data rows (header not counted), a BC error document as a problem, a config sheet without a table as a problem', () => {
    const text = fs.readFileSync(path.join(ROOT, 'RefreshSheet.js'), 'utf8');
    assert.ok(/RefreshLog\.noteSheet\(sheetName,Math\.max\(table\.length - 1,0\)\)/.test(text));
    assert.ok(/RefreshLog\.noteProblem\(`BC \(\$\{sheetName\}\): /.test(text) && /RefreshLog\.noteProblem\(`Brak tabeli w arkuszu konfiguracji/.test(text));
  });

  // ---- the name of the log sheet ----------------------------------------------------------------------------------------------------------------
  test('name: the default is "Dziennik pobrań"; the name is trimmed, empty = the default, longer than 100 characters is refused', () => {
    const u = useCase();
    assert.strictEqual(u.ex.eval(`MainSettings.getLogSheetName()`), 'Dziennik pobrań');
    u.ex.eval(`getMainSettings = () => ({ getSheetList: () => [] }); settingsSheetExists = () => true; MainSettings.setLogSheetName('  Moje pobrania ')`);
    assert.strictEqual(u.ex.eval(`MainSettings.getLogSheetName()`), 'Moje pobrania');
    u.ex.eval(`MainSettings.setLogSheetName('   ')`);
    assert.strictEqual(u.ex.eval(`MainSettings.getLogSheetName()`), 'Dziennik pobrań');
    assert.throws(() => u.ex.eval(`MainSettings.setLogSheetName('x'.repeat(101))`), /najwyżej 100 znaków/);
  });

  test('name: the settings sheet, a config sheet or a result sheet cannot be the log (not told apart by case); the name is kept when refused', () => {
    const u = useCase();
    u.ex.eval(`getMainSettings = () => ({ getSheetList: () => [{ configSheet: 'Konfiguracja 1', resultSheet: 'Dane K1' }] }); settingsSheetExists = () => true; MainSettings.setLogSheetName('Dziennik')`);
    ['Ustawienia', 'ustawienia', 'Konfiguracja 1', 'DANE K1'].forEach(n => assert.throws(() => u.ex.eval(`MainSettings.setLogSheetName(${JSON.stringify(n)})`), /jest już używana/, n));
    assert.strictEqual(u.ex.eval(`MainSettings.getLogSheetName()`), 'Dziennik');
    u.ex.eval(`settingsSheetExists = () => false; getMainSettings = () => { throw new Error('must not be built'); }`);
    u.ex.eval(`MainSettings.setLogSheetName('Konfiguracja 1')`);       // no settings sheet: only its own name is known
    assert.strictEqual(u.ex.eval(`MainSettings.getLogSheetName()`), 'Konfiguracja 1');
  });

  test('name: the sidebar functions are ordinary runs; the set one hands the live check the name; the page has the section "Arkusz dziennika pobrań" in Ogólne', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Main Settings.js'), 'utf8');
    assert.ok(/Controller\.run\("requestRefreshLogSheetName"/.test(text));
    assert.ok(/Controller\.checkInput\("requestSetRefreshLogSheetName",\{name\}\);\s*return Controller\.run\("requestSetRefreshLogSheetName"/.test(text));
    const html = fs.readFileSync(path.join(ROOT, 'New Status Sidebar.html'), 'utf8');
    const ogolne = html.slice(html.indexOf('<div id="tab-status"'), html.indexOf('<div id="tab-help"'));
    assert.ok(/<h1> Arkusz dziennika pobrań <\/h1>/.test(ogolne) && /\.getRefreshLogSheetName\(\)/.test(html) && /\.setRefreshLogSheetName\(form\.logSheetName\.value\)/.test(html));
    assert.ok(ogolne.indexOf('Arkusz ustawień importu') < ogolne.indexOf('Arkusz dziennika pobrań') && ogolne.indexOf('Arkusz dziennika pobrań') < ogolne.indexOf('Stan konfiguracji'), 'after the settings sheet, before the state');
    assert.ok(/refreshLogSheetInfo\(\);\s*\}\s*window\.onload/.test(html), 'read when the sidebar opens');
  });
};
