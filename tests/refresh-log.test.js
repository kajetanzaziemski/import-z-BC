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

  MODES.forEach(mode => test('log sheet: the row of a run is written over (start, after a sheet, the end) IN PLACE, found by the hash of its cells even when newer entries came above it; a row the user edited or lost = a new row; every write is flushed [' + mode + ']', () => {
    const s = gridScope(mode);
    const base = `source: 'Autoodświeżanie', start: new Date(Date.UTC(2026, 10, 5, 10, 7)), technical: 'Clock trigger t7'`;
    const open = `({ ${base}, end: null, duration: '', status: 'Nieznany (w trakcie lub błąd wykonania)', sheets: '0 arkuszy' })`;
    const part = `({ ${base}, end: null, duration: '', status: 'Nieznany (w trakcie lub błąd wykonania)', sheets: '1 arkusz:\\nDane K1 (3 wiersze)' })`;
    const done = `({ ${base}, end: new Date(Date.UTC(2026, 10, 5, 10, 8)), duration: '1 m 0 s', status: 'OK ✅', sheets: '2 arkusze:\\nDane K1 (3 wiersze)\\nDane K2 (1 wiersz)' })`;
    s.run(`globalThis.__flushes = 0; { const f = SpreadsheetApp.flush; SpreadsheetApp.flush = function () { __flushes++; return f.apply(this, arguments); }; }`);
    const h1 = s.run(`RefreshLogGrid.append('Dziennik pobrań', ${open})`);
    assert.ok(s.run(`__flushes`) >= 1, 'flushed after the row is written');
    const sh = s.book.sheets['Dziennik pobrań'];
    const v = (r, c) => (sh.cells[r + ',' + c] || {}).v ?? '';
    assert.deepStrictEqual([v(2, 3), v(2, 4), v(2, 5)], ['', '', 'Nieznany (w trakcie lub błąd wykonania)'], 'no end yet');
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);          // another run puts its entry above
    const before = s.run(`__flushes`);
    const h2 = s.run(`RefreshLogGrid.update('Dziennik pobrań', '${h1}', ${part})`);
    assert.ok(s.run(`__flushes`) > before, 'flushed after the update');
    assert.notStrictEqual(h2, h1, 'another content, another hash');
    assert.deepStrictEqual([v(2, 7), v(3, 7), v(4, 7), v(3, 6)], ['Clock trigger t2', 'Clock trigger t7', '', '1 arkusz:\nDane K1 (3 wiersze)'], 'written over where it was');
    const h3 = s.run(`RefreshLogGrid.update('Dziennik pobrań', '${h2}', ${done})`);
    assert.deepStrictEqual([v(3, 4), v(3, 5), v(4, 7)], ['1 m 0 s', 'OK ✅', ''], 'completed, still two entries');
    assert.ok(/UTC\+9/.test((sh.cells['3,3'].fmt || {}).numFmt), 'the end has its date format');
    // the user edited the row meanwhile: it is not found, the entry is a new row on top
    sh.cells['3,5'].v = 'zmienione przez użytkownika';
    const h4 = s.run(`RefreshLogGrid.update('Dziennik pobrań', '${h3}', ${entry(9)})`);
    assert.deepStrictEqual([v(2, 7), v(3, 7), v(4, 7), v(4, 5)], ['Clock trigger t9', 'Clock trigger t2', 'Clock trigger t7', 'zmienione przez użytkownika'], 'the edited row is left alone');
    assert.strictEqual(typeof h4, 'string');
    // the hash is the same for the values an entry is written with and for the values read back
    assert.strictEqual(s.run(`RefreshLogGrid.rowHash(RefreshLogGrid.values_(${entry(9)}))`), h4);
  }));

  const WIDTHS = [200, 200, 200, 100, 200, 300, 200];
  const WRAPS = ['WRAP', 'WRAP', 'WRAP', 'WRAP', 'WRAP', 'WRAP', 'CLIP'];

  MODES.forEach(mode => test('log sheet: headers bold, centred, wrapped and FROZEN; FIXED widths 200 / 200 / 200 / 100 / 200 / 300 / 200 px (nothing fitted); wrap in all columns but the technical one, which is cut; the technical column Courier New 8 pt; entries left aligned and top; the new row is fitted to its content [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);
    const sh = s.book.sheets['Dziennik pobrań'];
    const f = (r, c) => (sh.cells[r + ',' + c] || { fmt: {} }).fmt;
    for (let c = 1; c <= 7; c++) assert.deepStrictEqual([f(1, c).bold, f(1, c).hAlign, f(1, c).wrap], [true, 'center', 'WRAP'], 'header ' + c);
    for (const r of [2, 3]) {
      for (let c = 1; c <= 7; c++) assert.deepStrictEqual([f(r, c).hAlign, f(r, c).vAlign], ['left', 'top'], `entry ${r} column ${c}`);
      assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(c => f(r, c).wrap), WRAPS, 'wrap of entry ' + r);
      assert.deepStrictEqual([f(r, 7).family, f(r, 7).size], ['Courier New', 8], 'technical column, row ' + r);
      assert.ok(!f(r, 5).family && !f(r, 5).size, 'only the technical column has the small monospaced font');
    }
    const snap = sh.snapshot();
    assert.strictEqual(snap.frozen, 1, 'the header row is frozen');
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(c => (snap.colPx || {})[c]), WIDTHS);
    assert.deepStrictEqual(snap.fitted.columns, [], 'no column is fitted to its content');
    assert.ok(snap.fitted.rows.length > 0, 'the new row is fitted to its wrapped content');
  }));

  MODES.forEach(mode => test('log sheet: widths, wrapping and the look of the entries are set ONCE, with the sheet; a later entry is inserted as "a row above" the first entry and takes ITS look - what the user changed stays, and the headers\' look does not leak in [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    const sh = s.book.sheets['Dziennik pobrań'];
    // the user changes the look of the entry and the width of a column
    for (let c = 1; c <= 7; c++) { const fmt = (sh.cells['2,' + c] || (sh.cells['2,' + c] = { v: '', f: '', note: '', dv: null, fmt: {} })).fmt; fmt.wrap = 'OVERFLOW'; fmt.bg = '#ffffcc'; fmt.size = 11; }
    sh.colPx[4] = 333;
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(3)})`);
    const f = (r, c) => (sh.cells[r + ',' + c] || { fmt: {} }).fmt;
    for (const r of [2, 3]) for (let c = 1; c <= 7; c++) assert.deepStrictEqual([f(r, c).wrap, f(r, c).bg, f(r, c).size, f(r, c).bold], ['OVERFLOW', '#ffffcc', 11, undefined], `new entry row ${r} column ${c} looks like the entry it was inserted above`);
    assert.strictEqual(sh.colPx[4], 333, 'the width the user set is left');
    assert.deepStrictEqual([1, 2, 3, 5, 6, 7].map(c => sh.colPx[c]), [200, 200, 200, 200, 300, 200]);
    assert.strictEqual(f(1, 1).bg, '#cccccc', 'the headers keep theirs');
    assert.strictEqual(f(4, 1).bg, '#ffffcc');
  }));

  MODES.forEach(mode => test('log sheet: the time cells carry the zone of the moment they were written in (UTC+N in the format), per cell; the freeze is set once, with the sheet (the user may unfreeze) [' + mode + ']', () => {
    const s = gridScope(mode);
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(1)})`);
    const sh = s.book.sheets['Dziennik pobrań'];
    sh.frozen = 0;                                                                          // the user unfreezes the header
    s.run(`RefreshLogGrid.append('Dziennik pobrań', ${entry(2)})`);
    assert.strictEqual(sh.frozen, 0, 'a later entry does not freeze it again');
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
  function useCase(over, files) {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify(Object.assign({ addonStatus: true, importSheetName: 'Ustawienia' }, over && over.settings || {}));
    const ex = p.execution(USE_CASE_BASE.concat(files || []), {});
    ex.eval(`globalThis.__entries = []; RefreshLogGrid = { append: (name, e) => { if (globalThis.__appendFails) throw new Error('sheet unavailable'); __entries.push({ name, ...e }); return String(__entries.length - 1); }, update: (name, token, e) => { if (globalThis.__appendFails) throw new Error('sheet unavailable'); if (!__entries[token]) throw new Error('row not found'); __entries[token] = { name, ...e }; return token; } };`);
    return { p, ex, entries: () => plain(ex.eval(`__entries`)) };
  }

  test('entry: OK, the sheets with their rows (one cell, a line each), the Polish plural of sheets and rows, start / end / duration, the technical text', () => {
    const u = useCase();
    u.ex.eval(`RefreshLog.run('Autoodświeżanie', 'Clock trigger t1', () => { RefreshLog.noteSheet('Dane K1', 1234); RefreshLog.noteSheet('Dane K3', 1); RefreshLog.noteSheet('Dane K4', 22); })`);
    const [e] = u.entries();
    assert.deepStrictEqual([e.name, e.source, e.status, e.technical], ['Dziennik pobrań', 'Autoodświeżanie', 'OK ✅', 'Clock trigger t1']);
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

  test('entry: an error while the data of a sheet was pulled - the status only says for which sheet, the error itself goes to the technical column; the error is thrown on', () => {
    const u = useCase(null, ['RefreshSheet.js']);
    u.ex.eval(`getMainSettings = () => ({ getResultSheetName: n => 'Dane ' + n, getConfigSheetNames: () => ['K1'] }); RefreshSheet.run_ = () => { throw new TypeError("Cannot read properties of null (reading 'getAllAttributeValuesArraysFromChildren')"); };`);
    assert.throws(() => u.ex.eval(`RefreshLog.run('Odświeżanie jednego arkusza', 'Menu: refresh one sheet (config sheet: K1)', () => RefreshSheet.run('K1'))`), /getAllAttributeValuesArraysFromChildren/);
    const [e] = u.entries();
    assert.strictEqual(e.status, 'Błąd ❗️ Przy pobieraniu danych dla arkusza Dane K1.');
    assert.strictEqual(e.technical, "Menu: refresh one sheet (config sheet: K1). Errors: Dane K1: Cannot read properties of null (reading 'getAllAttributeValuesArraysFromChildren')");
    assert.ok(!/getAllAttribute/.test(e.status));
  });

  test('entry: the sheet is named by its result sheet, else the settings\' result sheet of the config sheet, else the config sheet; more than one failed sheet: "dla arkuszy: A, B."; handled problems stay in the status before the error', () => {
    const u = useCase(null, ['RefreshSheet.js']);
    const name = (cfg, res, settings) => { u.ex.eval(`getMainSettings = () => (${settings})`); return u.ex.eval(`RefreshSheet.nameForLog_(${JSON.stringify(cfg)}, ${JSON.stringify(res)})`); };
    assert.strictEqual(name('K1', 'Wynik 1', `{ getResultSheetName: () => 'x' }`), 'Wynik 1');
    assert.strictEqual(name('K1', undefined, `{ getResultSheetName: () => 'Dane K1' }`), 'Dane K1');
    assert.strictEqual(name('K1', undefined, `{ getResultSheetName: () => null }`), 'K1');
    assert.strictEqual(name('K1', undefined, `{ getResultSheetName: () => { throw new Error('settings unreadable'); } }`), 'K1', 'never throws');
    u.ex.eval(`RefreshLog.run('Odświeżanie wszystkich arkuszy', 'Menu: refresh all sheets', () => { RefreshLog.noteProblem('Brak tabeli w arkuszu konfiguracji „K9”'); RefreshLog.noteFailedSheet('Dane K1', new Error('a')); RefreshLog.noteFailedSheet('Dane K2', new Error('b')); RefreshLog.noteFailedSheet('Dane K3', new Error('c')); })`);
    const [e] = u.entries();
    assert.strictEqual(e.status, 'Brak tabeli w arkuszu konfiguracji „K9”; Błąd ❗️ Przy pobieraniu danych dla arkuszy: Dane K1, Dane K2, Dane K3.');
    assert.strictEqual(e.technical, 'Menu: refresh all sheets. Errors: Dane K1: a | Dane K2: b | Dane K3: c');
  });

  test('entry: sheets that failed in different ways - BC answered with an error document (two of them), the platform threw (one) - ALL are named in the generic status and ALL have their error in the technical column, each with its sheet', () => {
    const u = useCase();
    u.ex.eval(`RefreshLog.run('Odświeżanie wszystkich arkuszy', 'Menu: refresh all sheets', () => {
      RefreshLog.noteFailedSheet('Dane wg. Konfiguracja 4', 'BC BadRequest: Could not find a property named \\'SalesOrderSalesLines\\' on type \\'NAV.Zapisy_księgi_głównej_Excel\\'.  CorrelationId:  420b4d7d');
      RefreshLog.noteSheet('Dane wg. Konfiguracja 1', 12);
      RefreshLog.noteFailedSheet('Dane wg. Konfiguracja 6', "BC BadRequest: Term '(;$top=100;$count=true)' is not valid in a $select or $expand expression.  CorrelationId:  122bd183");
      RefreshLog.noteFailedSheet('Dane wg. Konfiguracja 2', new TypeError("Cannot read properties of null (reading 'getAllAttributeValuesArraysFromChildren')"));
    })`);
    const [e] = u.entries();
    assert.strictEqual(e.status, 'Błąd ❗️ Przy pobieraniu danych dla arkuszy: Dane wg. Konfiguracja 4, Dane wg. Konfiguracja 6, Dane wg. Konfiguracja 2.');
    assert.ok(!/BadRequest|CorrelationId/.test(e.status), 'no BC message in the status');
    assert.strictEqual(e.sheets, '1 arkusz:\nDane wg. Konfiguracja 1 (12 wierszy)', 'only the sheet that went through');
    ['Dane wg. Konfiguracja 4: BC BadRequest: Could not find a property named', 'Dane wg. Konfiguracja 6: BC BadRequest: Term', "Dane wg. Konfiguracja 2: Cannot read properties of null (reading 'getAllAttributeValuesArraysFromChildren')"]
      .forEach(part => assert.ok(e.technical.includes(part), part + ' | ' + e.technical));
    assert.ok(e.technical.startsWith('Menu: refresh all sheets. Errors: '));
  });

  test('entry: "Access not granted or expired." says "Odmowa dostępu do BC" after the name of the sheet (one sheet, several, mixed with other failures); the technical column keeps the platform\'s text', () => {
    const u = useCase();
    u.ex.eval(`RefreshLog.run('Autoodświeżanie', 'Clock trigger t1', () => { RefreshLog.noteFailedSheet('Dane wg. Konfiguracja 1', new ConnectionError('Access not granted or expired.')); })`);
    u.ex.eval(`RefreshLog.run('Autoodświeżanie', 'Clock trigger t1', () => { RefreshLog.noteProblem('Brak tabeli w arkuszu konfiguracji „K9”'); RefreshLog.noteFailedSheet('Dane wg. Konfiguracja 1', new ConnectionError('Access not granted or expired.')); RefreshLog.noteFailedSheet('Dane wg. Konfiguracja 2', 'BC BadRequest: zle'); RefreshLog.noteFailedSheet('Dane wg. Konfiguracja 3', new ConnectionError('Access not granted or expired.')); })`);
    const [one, many] = u.entries();
    assert.strictEqual(one.status, 'Błąd ❗️ Przy pobieraniu danych dla arkusza Dane wg. Konfiguracja 1: Odmowa dostępu do BC.');
    assert.strictEqual(one.technical, 'Clock trigger t1. Errors: Dane wg. Konfiguracja 1: Access not granted or expired.');
    assert.strictEqual(many.status, 'Brak tabeli w arkuszu konfiguracji „K9”; Błąd ❗️ Przy pobieraniu danych dla arkuszy: Dane wg. Konfiguracja 1: Odmowa dostępu do BC, Dane wg. Konfiguracja 2, Dane wg. Konfiguracja 3: Odmowa dostępu do BC.');
  });

  test('entry: an error that is not tied to a sheet (no sheet was being pulled) is still the status as it is', () => {
    const u = useCase();
    assert.throws(() => u.ex.eval(`RefreshLog.run('Autoodświeżanie', 'Clock trigger t1', () => { throw new Error('Exceeded maximum execution time'); })`), /Exceeded/);
    assert.deepStrictEqual(u.entries().map(e => [e.status, e.technical]), [['Exceeded maximum execution time', 'Clock trigger t1']]);
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
    RefreshSheet = { run: (cfg, res) => { try { if (cfg === 'BAD') throw new Error('Brak połączenia'); RefreshLog.noteSheet(res ?? 'Dane ' + cfg, cfg === 'K1' ? 10 : 20); } catch (e) { RefreshLog.noteFailedSheet(res ?? 'Dane ' + cfg, e); throw e; } } };`;

  test('menu "Pobierz dane dla wszystkich arkuszy": one entry "Odświeżanie wszystkich arkuszy" with every sheet and its rows; menu "dla tego arkusza": "Odświeżanie jednego arkusza" with the config sheet in the technical text', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`RefreshAll.all()`);
    u.ex.eval(`MenuActions.activeConfigSheet = () => 'K2'; MenuActions.refreshActive()`);
    const [all, one] = u.entries();
    assert.deepStrictEqual([all.source, all.sheets, all.technical, all.status], ['Odświeżanie wszystkich arkuszy', '2 arkusze:\nDane K1 (10 wierszy)\nDane K2 (20 wierszy)', 'Menu: refresh all sheets', 'OK ✅']);
    assert.deepStrictEqual([one.source, one.sheets, one.technical], ['Odświeżanie jednego arkusza', '1 arkusz:\nDane K2 (20 wierszy)', 'Menu: refresh one sheet (config sheet: K2)']);
  });

  test('menu: on a sheet that is not a config sheet nothing is refreshed and nothing is logged', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`MenuActions.activeConfigSheet = () => null; Controller.registerClosingOnce = () => {}; MenuActions.refreshActive()`);
    assert.deepStrictEqual(u.entries(), []);
  });

  test('a failing sheet does not stop the others: all are tried, the first error is thrown at the end; the entry counts and lists ONLY the sheets that went through, names the failed ones and has their errors in the technical column', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`getMainSettings = () => ({ getSheetList: () => [{ configSheet: 'K1', resultSheet: 'R1' }, { configSheet: 'BAD', resultSheet: 'R2' }, { configSheet: 'K2', resultSheet: 'R3' }, { configSheet: 'BAD', resultSheet: 'R4' }] })`);
    assert.throws(() => u.ex.eval(`RefreshAll.all()`), /Brak połączenia/);
    const [e] = u.entries();
    assert.strictEqual(e.sheets, '2 arkusze:\nR1 (10 wierszy)\nR3 (20 wierszy)', 'the two that went through: counted and listed');
    assert.strictEqual(e.status, 'Błąd ❗️ Przy pobieraniu danych dla arkuszy: R2, R4.');
    assert.strictEqual(e.technical, 'Menu: refresh all sheets. Errors: R2: Brak połączenia | R4: Brak połączenia');
    // one failed sheet: singular
    const one = useCase(); one.ex.eval(STUBS);
    one.ex.eval(`getMainSettings = () => ({ getSheetList: () => [{ configSheet: 'K1', resultSheet: 'R1' }, { configSheet: 'BAD', resultSheet: 'R2' }] })`);
    assert.throws(() => one.ex.eval(`RefreshAll.all()`), /Brak połączenia/);
    assert.deepStrictEqual(one.entries().map(x => [x.status, x.sheets]), [['Błąd ❗️ Przy pobieraniu danych dla arkusza R2.', '1 arkusz:\nR1 (10 wierszy)']]);
    // everything failed: none counted
    const none = useCase(); none.ex.eval(STUBS);
    none.ex.eval(`getMainSettings = () => ({ getSheetList: () => [{ configSheet: 'BAD', resultSheet: 'R1' }] })`);
    assert.throws(() => none.ex.eval(`RefreshAll.all()`), /Brak połączenia/);
    assert.strictEqual(none.entries()[0].sheets, '0 arkuszy');
  });

  test('automatic refresh: RefreshAll.scheduled writes "Autoodświeżanie" with the clock trigger in the technical text; a trigger that retires writes an entry that says nothing was refreshed', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`RefreshAll.scheduled('Clock trigger t1')`);
    const [e] = u.entries();
    assert.deepStrictEqual([e.source, e.technical, e.sheets, e.status], ['Autoodświeżanie', 'Clock trigger t1', '1 arkusz:\nDane K1 (10 wierszy)', 'OK ✅']);
    const text = fs.readFileSync(path.join(ROOT, 'ScheduleRefresh.js'), 'utf8');
    assert.ok(/RefreshAll\.scheduled\(ScheduleRefresh\.triggerText_\(e\.triggerUid,false\)\)/.test(text) && /RefreshAll\.scheduled\(ScheduleRefresh\.triggerText_\(e\.triggerUid,true\)\)/.test(text));
    assert.ok(/logRetired_\(e\.triggerUid,false\)/.test(text) && /logRetired_\(e\.triggerUid,true\)/.test(text), 'both handlers log a retired trigger');
  });

  test('every run: the entry is opened when the run STARTS (start, source, technical; status "Nieznany (w trakcie lub błąd wykonania)", no end) and completed at the end, in place', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`globalThis.__seen = []; { const f = RefreshAll.ticked; RefreshAll.ticked = () => { __seen.push(JSON.parse(JSON.stringify(__entries))); return f(); }; }`);
    u.ex.eval(`RefreshAll.scheduled('Clock trigger t1')`);
    const during = plain(u.ex.eval(`__seen[0]`));
    assert.strictEqual(during.length, 1);
    assert.deepStrictEqual([during[0].source, during[0].status, during[0].end, during[0].duration, during[0].sheets, during[0].technical],
      ['Autoodświeżanie', 'Nieznany (w trakcie lub błąd wykonania)', null, '', '0 arkuszy', 'Clock trigger t1']);
    const after = u.entries();
    assert.strictEqual(after.length, 1, 'completed in place, not added');
    assert.deepStrictEqual([after[0].status, after[0].start], ['OK ✅', during[0].start]);
    // the menu refreshes open their entry too
    const menu = useCase(); menu.ex.eval(`RefreshLog.run('Odświeżanie wszystkich arkuszy', 'Menu', () => { globalThis.__n = JSON.parse(JSON.stringify(__entries)); })`);
    assert.deepStrictEqual(plain(menu.ex.eval(`__n`)).map(e => e.status), ['Nieznany (w trakcie lub błąd wykonania)']);
    assert.strictEqual(menu.entries().length, 1);
  });

  test('every run: the row is written over after each sheet with what is known by then (the sheets so far, the errors so far; the status still unknown, no end)', () => {
    const u = useCase();
    u.ex.eval(`globalThis.__snap = []; { const up = RefreshLogGrid.update; RefreshLogGrid.update = (n, t, e) => { __snap.push(JSON.parse(JSON.stringify(e))); return up(n, t, e); }; }`);
    u.ex.eval(`RefreshLog.run('Odświeżanie wszystkich arkuszy', 'Menu', () => { RefreshLog.noteSheet('Dane K1', 5); RefreshLog.noteFailedSheet('Dane K2', new Error('zle')); RefreshLog.noteSheet('Dane K3', 1); })`);
    const snaps = plain(u.ex.eval(`__snap`));
    assert.strictEqual(snaps.length, 4, 'after each of the three sheets and at the end');
    assert.deepStrictEqual(snaps.slice(0, 3).map(e => [e.status, e.end, e.sheets.split('\n')[0]]), [
      ['Nieznany (w trakcie lub błąd wykonania)', null, '1 arkusz:'], ['Nieznany (w trakcie lub błąd wykonania)', null, '1 arkusz:'], ['Nieznany (w trakcie lub błąd wykonania)', null, '2 arkusze:']]);
    assert.ok(/Errors: Dane K2: zle/.test(snaps[1].technical) && !/Errors/.test(snaps[0].technical));
    assert.strictEqual(snaps[3].status, 'Błąd ❗️ Przy pobieraniu danych dla arkusza Dane K2.');
    assert.strictEqual(u.entries().length, 1, 'one row');
    // a failing progress write does not fail the run and is not reported
    const bad = useCase(); bad.ex.eval(`{ const up = RefreshLogGrid.update; let n = 0; RefreshLogGrid.update = (a, b, c) => { if (n++ == 0) throw new Error('hiccup'); return up(a, b, c); }; }`);
    assert.doesNotThrow(() => bad.ex.eval(`RefreshLog.run('Odświeżanie jednego arkusza', 'Menu', () => { RefreshLog.noteSheet('Dane K1', 5); })`));
    assert.strictEqual(bad.entries()[0].status, 'OK ✅');
  });

  test('scheduled run: a run that never finishes (killed by the platform) leaves the opened entry as "Nieznany ..."; an entry that cannot be written never fails the run; a lost row is added as a new entry', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`RefreshAll.ticked = () => { globalThis.__open = JSON.parse(JSON.stringify(__entries)); }`);
    u.ex.eval(`RefreshAll.scheduled('Clock trigger t1')`);
    assert.strictEqual(plain(u.ex.eval(`__open`))[0].status, 'Nieznany (w trakcie lub błąd wykonania)');
    const down = useCase(); down.ex.eval(STUBS); down.ex.eval(`globalThis.__appendFails = true`);
    assert.doesNotThrow(() => down.ex.eval(`RefreshAll.scheduled('Clock trigger t1')`));
    const lost = useCase(); lost.ex.eval(STUBS);
    lost.ex.eval(`RefreshLogGrid.update = (name, token, e) => RefreshLogGrid.append(name, e)`);
    lost.ex.eval(`RefreshAll.scheduled('Clock trigger t1')`);
    const statuses = lost.entries().map(e => e.status);
    assert.strictEqual(statuses[0], 'Nieznany (w trakcie lub błąd wykonania)');
    assert.strictEqual(statuses[statuses.length - 1], 'OK ✅', 'the end is written as a new row when the row is not found');
  });

  test('scheduled run: out of time (1700 s) the rest of the sheets is not tried, the entry says so and lists them, the run fails with the log written', () => {
    const u = useCase(); u.ex.eval(STUBS);
    u.ex.eval(`{ const g = getMainSettings; getMainSettings = () => Object.assign(g(), { getSheetListWithRefreshTrue: () => [{ configSheet: 'K1', resultSheet: 'Dane K1', refresh: true }, { configSheet: 'K2', resultSheet: 'Dane K2', refresh: true }, { configSheet: 'K3', resultSheet: 'Dane K3', refresh: true }] }); }`);
    u.ex.eval(`globalThis.__clock = Date.now(); Date.now = () => __clock; globalThis.__tried = []; RefreshSheet.run = (c, r) => { __tried.push(c); __clock += 1000 * 1000; RefreshLog.noteSheet(r, 1); };`);
    assert.throws(() => u.ex.eval(`RefreshAll.scheduled('Clock trigger t1')`), /Przekroczono limit czasu odświeżania \(1700 s\)\. Nie odświeżono arkuszy: Dane K3\./);
    assert.deepStrictEqual(plain(u.ex.eval(`__tried`)), ['K1', 'K2']);
    const [e] = u.entries();
    assert.ok(/Przekroczono limit czasu odświeżania \(1700 s\)\. Nie odświeżono arkuszy: Dane K3\./.test(e.status), e.status);
    assert.ok(e.sheets.startsWith('2 arkusze'), e.sheets);
    // the paging of one sheet checks the time too
    const paging = fs.readFileSync(path.join(ROOT, 'OData Connection.js'), 'utf8');
    assert.ok(/RefreshLog\.checkTime\(\);[^\n]*\n\s*this\.fetchHttpResponse\(this\.nextPage\)/.test(paging), 'checked before every page');
    const none = useCase(); none.ex.eval(`RefreshLog.run('Odświeżanie jednego arkusza', 'Menu', () => { RefreshLog.checkTime(); })`);
    assert.strictEqual(none.entries()[0].status, 'OK ✅', 'no limit, no failure');
  });

  test('the clock triggers log their id with Logger.log (not only with the debug log on)', () => {
    const text = fs.readFileSync(path.join(ROOT, 'ScheduleRefresh.js'), 'utf8');
    assert.ok(/Logger\.log\(`Clock trigger autoRefreshHandler\. Id = \$\{e\.triggerUid\}/.test(text) && /Logger\.log\(`Clock trigger autoRefresh \(old version\)\. Id = \$\{e\.triggerUid\}/.test(text));
  });

  test('the sheets: RefreshSheet notes a written result sheet with its data rows (header not counted), a BC error document as a FAILED sheet, a config sheet without a table as a problem', () => {
    const text = fs.readFileSync(path.join(ROOT, 'RefreshSheet.js'), 'utf8');
    assert.ok(/refreshed = bcError \? null : \{name: sheetName, rows: Math\.max\(table\.length - 1,0\)\}/.test(text) && /if\(refreshed\) RefreshLog\.noteSheet\(refreshed\.name,refreshed\.rows\)/.test(text), 'a sheet counts as refreshed only at the very end');
    assert.ok(/RefreshLog\.noteFailedSheet\(sheetName,`BC \$\{\[bcError\.code,bcError\.message\]/.test(text), 'a BC error document is a failed sheet');
    assert.ok(/RefreshLog\.noteProblem\(`Brak tabeli w arkuszu konfiguracji/.test(text));
  });

  // ---- the developer tools are not mentioned to the user -----------------------------------------------------------------------------------
  test('rule: no message the user can see (errors, error details, dialogs, sidebars) refers to the developer tools menu ("Narzędzia programisty"); only the menu itself and the live check (a developer\'s tool) name it', () => {
    const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const offenders = fs.readdirSync(ROOT).filter(f => /\.(js|html)$/.test(f) && !/^Live Check/.test(f) && f !== 'Menu.js')
      .filter(f => /Narzędzia programisty/.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
    assert.deepStrictEqual(offenders, []);
    const menu = strip(fs.readFileSync(path.join(ROOT, 'Menu.js'), 'utf8'));
    assert.strictEqual((menu.match(/Narzędzia programisty/g) || []).length, 1, 'Menu.js: only the title of the submenu');
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
