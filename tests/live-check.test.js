// The live check helpers on this branch ("Live Check*.js", merged from live-test-helpers) are the judge of what the add-on keeps doing in a
// real spreadsheet. They were written against the add-on as it was BEFORE the refactor, so the refactor must satisfy them - they are not
// adapted to the refactored code. These tests protect that arrangement. Registered by tests/run.js.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const PIN = path.join(__dirname, 'golden', 'live-check.sha256.json');
const HELPERS = ['Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js', 'Live Check Sidebar.html'];
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');

module.exports = function register(t) {
  const { test, both } = t;
  const FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
    'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js',
    'Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js'];

  test('live check: the helper files are exactly the ones merged from live-test-helpers (pinned; they define what must not change)', () => {
    const actual = Object.fromEntries(HELPERS.map(f => [f, sha(f)]));
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(PIN, JSON.stringify(actual, null, 1) + '\n');
    const pinned = JSON.parse(fs.readFileSync(PIN, 'utf8'));
    HELPERS.forEach(f => assert.strictEqual(actual[f], pinned[f],
      f + ' was changed. The live check helpers say what the add-on is expected to do (they were written against the code before the refactor): ' +
      'change them only together with an INTENDED change of behaviour, then re-pin with UPDATE_GOLDEN=1 node tests/run.js'));
  });

  test('live check: every action name the code gives to Controller.run / Controller.checked has a verifier, and no verifier is orphaned', () => {
    const files = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^Live Check( Verifiers)?\.js$/.test(f) && f !== 'Test Functions.js');   // the framework and the verifiers only LIST the names
    const used = new Set();
    files.forEach(f => {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
      (text.match(/Controller\.(?:run|checked)\(\s*["']([^"']+)["']/g) || []).forEach(m => used.add(m.match(/["']([^"']+)["']/)[1]));
    });
    const p = new FakePlatform();
    const ex = p.execution(FILES);
    const listed = new Set(ex.eval(`LIVE_CHECK_ENTRY_POINTS.map(x => x.action)`));
    const notListed = [...used].filter(a => !listed.has(a));
    assert.deepStrictEqual(notListed, [], 'entry points in the code that the live check does not know (renamed or new?)');
    const cov = JSON.parse(JSON.stringify(ex.eval(`liveCheckCoverage()`)));
    assert.deepStrictEqual(cov.missing, [], 'entry points listed without a verifier');
    assert.deepStrictEqual(cov.unknown, [], 'verifiers for actions that are not listed');
    assert.deepStrictEqual([...listed].filter(a => !used.has(a)), [], 'listed entry points that no code calls any more (removed or renamed?)');
  });

  test('live check: switched off, the helpers do nothing (no property is written, the action runs as before)', () => {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true });
    const ex = p.execution(FILES);
    const before = JSON.stringify(p.props);
    assert.strictEqual(ex.eval(`Controller.run('requestAddonStatus', () => MainSettings.getAddonStatus())`), true);
    assert.strictEqual(JSON.stringify(p.props), before);
    assert.deepStrictEqual(p.calls.filter(c => /liveCheck/.test(c)), []);
  });

  test('live check: switched on, a check never throws into the run it checks (here the platform is too thin for the verifier: it must crash quietly)', () => {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true });
    p.props.document.liveCheckEnabled = 'on';
    const ex = p.execution(FILES, { Session: { getActiveUser: () => ({ getEmail: () => 'u@example.com' }) } });
    assert.strictEqual(ex.eval(`Controller.run('requestAddonStatus', () => MainSettings.getAddonStatus())`), true);
    assert.strictEqual(ex.eval(`Controller.run('requestSettingsSheetName', () => 'ok')`), 'ok');
    assert.throws(() => ex.eval(`Controller.run('requestAddonStatus', () => { throw new Error('boom') })`), /boom/, 'the action\'s own error still comes through');
    assert.ok(Object.keys(p.props.document).some(k => /^liveCheck:/.test(k)), 'something was recorded: ' + Object.keys(p.props.document).join(','));
  });

  // The verifiers carry their OWN copy of the config sheet layout (LC_CONFIG_HEADER, the idle colours, the estimate format), written from
  // the code before the refactor. ConfigGrid has to produce exactly that: three independent descriptions agree (verifier, legacy golden, ConfigGrid).
  const lcConstants = () => {
    const ex = new FakePlatform().execution(FILES);
    return JSON.parse(JSON.stringify({ header: ex.eval('LC_CONFIG_HEADER'), idleBg: ex.eval('LC_IDLE_BACKGROUND'), idleFont: ex.eval('LC_IDLE_FONT') }));
  };

  both('live check: a config sheet made by ConfigGrid has the header the verifiers expect (texts, backgrounds, weights, merges)', env => {
    const { header } = lcConstants();
    globalThis.__CG.ConfigGrid.create('K');
    const s = env.book.sheets['K'];
    const cell = (r, c) => s.cell(r, c) || { v: '', fmt: {} };
    const grid = f => [1, 2, 3, 4].map(r => [1, 2, 3, 4, 5, 6, 7].map(c => f(cell(r, c))));
    assert.deepStrictEqual(grid(x => x.v), header.values, 'header texts');
    assert.deepStrictEqual(grid(x => x.fmt.bg), header.backgrounds, 'header backgrounds');
    assert.deepStrictEqual(grid(x => (x.fmt.bold ? 'bold' : 'normal')), header.fontWeights, 'header font weights');
    const colName = n => String.fromCharCode(64 + n);
    assert.deepStrictEqual(s.merges.map(m => colName(m.c1) + m.r1 + ':' + colName(m.c2) + m.r2).sort(), header.merges, 'merged ranges');
  });

  both('live check: after a whole refresh the status cells are idle as the verifiers define it, the estimate is #,##0 and black', env => {
    const { idleBg, idleFont } = lcConstants();
    const CG = globalThis.__CG.ConfigGrid;
    CG.create('K');
    const h = CG.status('K');
    ['reading', 'connection', 'writing'].forEach(kind => { h.set(kind, true); h.set(kind, false); });
    h.setTotalRows(1234567);
    const s = env.book.sheets['K'];
    ['B2', 'C2', 'D2'].forEach((a1, i) => {
      const c = s.cell(2, 2 + i);
      assert.deepStrictEqual([a1, c.fmt.bg, c.fmt.color], [a1, idleBg, idleFont]);
    });
    assert.strictEqual(s.cell(2, 6).fmt.numFmt, '#,##0');
    assert.deepStrictEqual([s.cell(2, 5).fmt.color, s.cell(2, 6).fmt.color], ['#000000', '#000000']);
  });

  // ---- the indicator check: against the state BEFORE the run for cells the run does not work with; what it saw; a parallel run is a WARN ----------
  // Deliberate changes of the helper files (docs/testing.md); everything else in them is as merged.
  const IDLE = { background: '#cccccc', font: '#999999' };
  const HAND = { background: '#ffffff', font: '#000000' };      // a cell somebody cleared and made black by hand
  const RED = { background: '#ff0000', font: '#000000' };       // lit: "data writing"
  /**
   * Runs lcVerifyIdleIndicators_ for a sheet "Konfiguracja 1" whose B2:D2 look like `now` (default idle) and looked like `before` before the run
   * (undefined = no baseline for the sheet). `touches` as the flow passes it. Returns the recorded checks.
   */
  function indicatorCheck(o) {
    const p = new FakePlatform();
    const iso = ms => new Date(Date.now() - ms).toISOString();
    (o.running || []).forEach((r, i) => { p.props.document['liveCheck:' + iso(r.agoMs) + ':run' + i] = JSON.stringify({ t: iso(r.agoMs), a: r.action, s: r.state || 'RUN', ms: 0, c: [] }); });
    const ex = p.execution(FILES);
    if (o.nested) ex.eval(`lcStack.push({ key: ${JSON.stringify(o.nested)} })`);
    ex.ctx.__args = { now: Object.assign({ B2: IDLE, C2: IDLE, D2: IDLE }, o.now || {}), before: o.before === undefined ? undefined : Object.assign({ B2: IDLE, C2: IDLE, D2: IDLE }, o.before),
      snapshot: o.snapshot, touches: o.touches };
    return JSON.parse(JSON.stringify(ex.eval(`(() => {
      const out = [];
      const c = { key: 'liveCheck:own', before: {}, pass: (n, d) => out.push(['pass', n, d]), warn: (n, d) => out.push(['warn', n, d]), fail: (n, d) => out.push(['fail', n, d]) };
      if (__args.snapshot !== undefined) c.before.indicators = __args.snapshot;
      else if (__args.before !== undefined) c.before.indicators = { 'Konfiguracja 1': __args.before };
      const cols = ['B2', 'C2', 'D2'];
      const sheet = { getName: () => 'Konfiguracja 1', getRange: a1 => ({ getBackgrounds: () => [cols.map(k => __args.now[k].background)], getFontColors: () => [cols.map(k => __args.now[k].font)] }) };
      lcVerifyIdleIndicators_(c, sheet, '[Konfiguracja 1]', __args.touches);
      return out;
    })()`)));
  }
  const NAME = '[Konfiguracja 1] activity indicators back to idle';

  const kinds = r => r.map(x => x[0]);
  const detail = r => r[0][2] || '';

  test('live check indicators: all idle -> PASS', () => {
    const r = indicatorCheck({ before: {} });
    assert.deepStrictEqual([r.length, r[0][0], r[0][1]], [1, 'pass', NAME]);
  });

  test('live check indicators: D2 was edited by hand before the run and the run does not work with D2 (a co-edit) -> PASS, and the detail says it was left as found', () => {
    const r = indicatorCheck({ before: { D2: HAND }, now: { D2: HAND }, touches: ['B2'] });
    assert.deepStrictEqual(kinds(r), ['pass']);
    assert.ok(/not idle, but not touched by this run and the same as before it: data writing \(D2: background #ffffff, font #000000\)/.test(detail(r)), detail(r));
  });

  test('live check indicators: the same hand-edited D2 in a REFRESH (which lights D2 and puts it back) must be idle afterwards, else FAIL', () => {
    const left = indicatorCheck({ before: { D2: HAND }, now: { D2: HAND }, touches: ['B2', 'C2', 'D2'] });
    assert.deepStrictEqual(kinds(left), ['fail']);
    assert.ok(/data writing \(D2: background #ffffff, font #000000; before the run: background #ffffff, font #000000\)/.test(detail(left)));
    assert.deepStrictEqual(kinds(indicatorCheck({ before: { D2: HAND }, now: {}, touches: ['B2', 'C2', 'D2'] })), ['pass'], 'a refresh that resets it is fine');
  });

  test('live check indicators: a cell the run does not work with, idle before and lit after, is the code\'s doing -> FAIL with both looks', () => {
    const r = indicatorCheck({ before: {}, now: { D2: RED }, touches: ['B2'] });
    assert.deepStrictEqual(kinds(r), ['fail']);
    assert.ok(/data writing \(D2: background #ff0000, font #000000; before the run: background #cccccc, font #999999\)/.test(detail(r)), detail(r));
    assert.ok(/no other checked run is in progress/.test(detail(r)));
  });

  test('live check indicators: a hand-edited cell the run changed and left not idle -> FAIL', () => {
    const r = indicatorCheck({ before: { D2: HAND }, now: { D2: RED }, touches: ['B2'] });
    assert.deepStrictEqual(kinds(r), ['fail']);
  });

  test('live check indicators: the cells the run works with are strict: the reading cell left lit after a co-edit is a FAIL even if it was lit before', () => {
    const lit = { background: '#008000', font: '#000000' };
    assert.deepStrictEqual(kinds(indicatorCheck({ before: { B2: lit }, now: { B2: lit }, touches: ['B2'] })), ['fail']);
    assert.deepStrictEqual(kinds(indicatorCheck({ before: { B2: lit }, now: {}, touches: ['B2'] })), ['pass'], 'but reset by the run is fine');
  });

  test('live check indicators: no baseline for the sheet (new sheet, part missing or unavailable) -> every cell is expected to be idle, as before', () => {
    assert.deepStrictEqual(kinds(indicatorCheck({ now: { D2: HAND }, touches: ['B2'] })), ['fail']);
    assert.deepStrictEqual(kinds(indicatorCheck({ snapshot: { __unavailable: 'x' }, now: { D2: HAND }, touches: ['B2'] })), ['fail']);
    assert.deepStrictEqual(kinds(indicatorCheck({ snapshot: { 'Inny arkusz': {} }, now: { D2: HAND }, touches: ['B2'] })), ['fail']);
    assert.ok(/no state before the run known/.test(detail(indicatorCheck({ now: { D2: HAND }, touches: ['B2'] }))));
  });

  test('live check indicators: touches left out = all three cells are strict (the old behaviour)', () => {
    assert.deepStrictEqual(kinds(indicatorCheck({ before: { D2: HAND }, now: { D2: HAND } })), ['fail']);
  });

  test('live check indicators: a lit cell while ANOTHER checked run is in progress is a WARN naming that run, not a FAIL', () => {
    const r = indicatorCheck({ before: {}, now: { D2: RED }, touches: ['B2'], running: [{ agoMs: 20000, action: 'menuRefreshCurrentSheet' }] });
    assert.deepStrictEqual(kinds(r), ['warn']);
    assert.ok(/another run is in progress and may be lighting it: menuRefreshCurrentSheet since \d\d:\d\d:\d\d UTC/.test(detail(r)), detail(r));
  });

  test('live check indicators: runs that do not count as "in progress": finished, LOST, older than 10 minutes, nested runs of this execution', () => {
    const base = { before: {}, now: { D2: RED }, touches: ['B2'] };
    assert.deepStrictEqual(kinds(indicatorCheck(Object.assign({ running: [{ agoMs: 5000, action: 'x', state: 'PASS' }] }, base))), ['fail'], 'finished');
    assert.deepStrictEqual(kinds(indicatorCheck(Object.assign({ running: [{ agoMs: 5000, action: 'x', state: 'LOST' }] }, base))), ['fail'], 'lost');
    assert.deepStrictEqual(kinds(indicatorCheck(Object.assign({ running: [{ agoMs: 11 * 60 * 1000, action: 'x' }] }, base))), ['fail'], 'stale RUN is a lost run');
    const p = new FakePlatform();
    const now = new Date().toISOString();
    p.props.document['liveCheck:own'] = JSON.stringify({ t: now, a: 'menuRefreshAll', s: 'RUN', ms: 0, c: [] });
    p.props.document['liveCheck:nested'] = JSON.stringify({ t: now, a: 'forceAgentRefresh', s: 'RUN', ms: 0, c: [] });
    const ex = p.execution(FILES);
    const run = () => JSON.parse(JSON.stringify(ex.eval(`lcOtherRunsInProgress_({ key: 'liveCheck:own' })`)));
    assert.strictEqual(run().length, 1, 'the nested one is another stored RUN');
    ex.eval(`lcStack.push({ key: 'liveCheck:nested' })`);
    assert.deepStrictEqual(run(), [], 'but not while it belongs to this execution; the own run never counts');
  });

  test('live check indicators: a broken property store gives "no other run" - the check cannot throw because of the lookup', () => {
    const p = new FakePlatform();
    const ex = p.execution(FILES);
    p.broken['properties.document'] = 'throw';
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ex.eval(`lcOtherRunsInProgress_({ key: 'k' })`))), []);
  });

  // The "before" picture: LC_CAPTURE.indicators reads B2:D2 of the config sheets the settings sheet lists (read only, nothing created).
  test('live check indicators: the snapshot part reads B2:D2 of every listed config sheet and nothing else', () => {
    const { SimBook } = require('./sim');
    const p = new FakePlatform();
    const book = new SimBook({ api: false });
    p.props.document.importSettingsArray = JSON.stringify({ importSheetName: 'Ustawienia' });
    const st = book.add('Ustawienia');
    [['Opis linii'], ['configSheet', 'Konfiguracja 1', 'Dane 1', false], ['configSheet', 'Konfiguracja 9', 'Dane 9', false]].forEach((row, i) => row.forEach((v, j) => st.setValue(i + 2, j + 2, v, '')));
    const cfg = book.add('Konfiguracja 1');
    [2, 3, 4].forEach(col => { cfg.cell(2, col, true).fmt.bg = '#cccccc'; cfg.cell(2, col, true).fmt.color = '#999999'; });
    cfg.cell(2, 4, true).fmt.bg = '#ffffff'; cfg.cell(2, 4, true).fmt.color = '#000000';                // D2 edited by hand
    book.add('Inny').setValue(1, 1, 'x', '');
    const ex = p.execution(FILES, { SpreadsheetApp: { getActiveSpreadsheet: () => book.spreadsheet(), flush() {} } });
    const snap = JSON.parse(JSON.stringify(ex.eval(`LC_CAPTURE.indicators()`)));
    assert.deepStrictEqual(Object.keys(snap), ['Konfiguracja 1'], 'listed but missing sheets and other sheets are skipped');
    assert.deepStrictEqual(snap['Konfiguracja 1'], { B2: { background: '#cccccc', font: '#999999' }, C2: { background: '#cccccc', font: '#999999' }, D2: { background: '#ffffff', font: '#000000' } });
    assert.deepStrictEqual(Object.keys(book.sheets).sort(), ['Inny', 'Konfiguracja 1', 'Ustawienia'], 'nothing created');
  });

  test('live check indicators: no settings sheet -> an empty picture (and no error)', () => {
    const p = new FakePlatform();
    const ex = p.execution(FILES);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ex.eval(`LC_CAPTURE.indicators()`))), {});
  });

  test('live check indicators: the verifiers that reach the check ask for the part, and tell which cells their flow works with', () => {
    const text = read('Live Check Verifiers.js');
    ['sheetEditAction', 'sheetChangeAction', 'requestAutoRefesh', 'requestCheckConfigSheet', 'menuEstimateForCurrentSheet', 'menuRefreshCurrentSheet', 'menuRefreshAll'].forEach(n =>
      assert.ok(new RegExp('    ' + n + ': \\{\\n      needs: \\[[^\\]]*"indicators"').test(text), n + ' does not capture the indicators'));
    const calls = text.match(/lcVerifyIdleIndicators_\(c,[^;]*;/g);
    assert.ok(calls.filter(x => /\[\"B2\"/.test(x)).length >= 4, calls.join('\n'));
  });

  // ---- end to end: the live check switched ON around the real menu actions, D2 edited by hand ----------------------------------------
  // Real: Menu.js, the use cases, SheetCoeditor's status methods, ConfigGrid, Controller, the live check files. Faked: the query model, BC, the settings
  // sheet object. Only the line "activity indicators back to idle" of the recorded result is looked at (the thin environment fails other checks).
  function e2e(o) {
    const { SimBook } = require('./sim');
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: 'Ustawienia' });
    p.props.document.liveCheckEnabled = 'on';
    const book = new SimBook({ api: false });
    const st = book.add('Ustawienia');
    [['Opis linii'], ['configSheet', 'Konfiguracja 1', 'Wynik', false]].forEach((row, i) => row.forEach((v, j) => st.setValue(i + 2, j + 2, v, '')));
    book.activeName = 'Konfiguracja 1';
    const ss = book.spreadsheet();
    const app = { getActiveSpreadsheet: () => ss, flush() {}, WrapStrategy: book.SpreadsheetApp.WrapStrategy, newDataValidation: book.SpreadsheetApp.newDataValidation,
      DataValidationCriteria: book.SpreadsheetApp.DataValidationCriteria,
      getActive: () => ({ getActiveSheet: () => ({ getName: () => 'Konfiguracja 1' }) }), getUi: () => ({ alert() {} }) };
    const files = [...FILES, 'Data Type.js', 'Menu.js', 'Import Query.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js', 'Sheet Coeditor.js', 'Grid.js', 'Grid Util.js', 'Config Grid.js'];
    const ex = p.execution(files, { SpreadsheetApp: app, Utilities: book.Utilities, Session: { getActiveUser: () => ({ getEmail: () => 'u' }) } });
    ex.eval(`StatusManager.fullStatusCheck = () => {};
      globalThis.CCTImportConfig = class { constructor(v) { this.v = v; } };
      SheetCoeditor.prototype.getTable = () => 'Customers'; SheetCoeditor.prototype.getTableQueryArray = () => []; SheetCoeditor.prototype.getExtendTable = () => null;
      SheetCoeditor.prototype.getExtendQueryArray = () => []; SheetCoeditor.prototype.getDataTypes = () => ({});
      globalThis.ODataConnection = class { setODataQuery() { return this } setExtendQuery() { return this } setupConnection() { this.queryURL = 'u'; return this }
        readAllPages(sh) { sh.switchConnectionControl(true); sh.setTotRowsInfo(1); sh.switchConnectionControl(false); return this }
        fetchHttpResponse() { return this } readPage() { return this } getTotalRows() { return 1 }
        getColumnInfo() { return [{ table: null, field: 'No' }] } getDataArray() { return [['No'], ['C1']] } };
      getMetadata = () => ({ getDataType: () => 'Edm.String' });
      getMainSettings = () => ({ getConfigSheetName: n => (n === 'Konfiguracja 1' ? n : null), getResultSheetName: () => 'Wynik', getConfigSheetNames: () => ['Konfiguracja 1'], getSheetList: () => [{ configSheet: 'Konfiguracja 1', resultSheet: 'Wynik' }] });`);
    ex.eval(`new SheetCoeditor('Konfiguracja 1', false)`);                       // the sheet with its header
    const cfg = book.sheets['Konfiguracja 1'];
    if (o.handD2) { cfg.cell(2, 4, true).fmt.bg = '#ffffff'; cfg.cell(2, 4, true).fmt.color = '#000000'; }
    if (o.breakIt) ex.eval(o.breakIt);
    ex.eval(o.run);
    const entries = Object.keys(p.props.document).filter(k => /^liveCheck:\d/.test(k)).sort().map(k => JSON.parse(p.props.document[k]));
    const mine = entries.filter(e => e.a === o.action);
    assert.strictEqual(mine.length, 1, 'one recorded run of ' + o.action + ': ' + entries.map(e => e.a).join(','));
    const line = mine[0].c.find(x => /activity indicators back to idle/.test(x[1]));
    assert.ok(line, 'the check ran: ' + JSON.stringify(mine[0].c.map(x => x[1])));
    return { status: line[0], detail: line[2] || '' };
  }

  test('live check, end to end: D2 edited by hand + an ESTIMATE (which does not work with D2) -> PASS, "left as found"', () => {
    const r = e2e({ handD2: true, run: 'estimateForCurrentSheet()', action: 'menuEstimateForCurrentSheet' });
    assert.strictEqual(r.status, 'PASS');
    assert.ok(/not touched by this run and the same as before it: data writing \(D2: background #ffffff, font #000000\)/.test(r.detail), r.detail);
  });

  test('live check, end to end: D2 edited by hand + a REFRESH (which resets D2 itself) -> PASS', () => {
    const r = e2e({ handD2: true, run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet' });
    assert.strictEqual(r.status, 'PASS');
  });

  test('live check, end to end: untouched sheet + estimate / refresh -> PASS without a note', () => {
    assert.deepStrictEqual(e2e({ run: 'estimateForCurrentSheet()', action: 'menuEstimateForCurrentSheet' }), { status: 'PASS', detail: '' });
    assert.deepStrictEqual(e2e({ run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet' }), { status: 'PASS', detail: '' });
  });

  test('live check, end to end: code that leaves D2 lit after an estimate (a cell it should not touch) -> FAIL showing before and after', () => {
    const r = e2e({ run: 'estimateForCurrentSheet()', action: 'menuEstimateForCurrentSheet',
      breakIt: `SheetCoeditor.prototype.setTotRowsInfo = function () { this.switchDataWritingControl(true); }` });
    assert.strictEqual(r.status, 'FAIL');
    assert.ok(/data writing \(D2: background #ff0000, font #000000; before the run: background #cccccc, font #999999\)/.test(r.detail), r.detail);
  });

  test('live check, end to end: code that forgets to reset the writing cell after a refresh -> FAIL, also when D2 was hand-edited before', () => {
    const forget = `SheetCoeditor.prototype.switchDataWritingControl = function (a) { if (a) ConfigGrid.status(this.sheetName).set('writing', true); }`;
    assert.strictEqual(e2e({ run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet', breakIt: forget }).status, 'FAIL');
    assert.strictEqual(e2e({ handD2: true, run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet', breakIt: forget }).status, 'FAIL');
  });

  // The sidebar: the details are coloured line by line. The two functions are taken out of the page and run against a minimal DOM.
  function sidebarFunctions() {
    const vm = require('vm');
    const html = read('Live Check Sidebar.html');
    const grab = name => { const m = html.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}')); assert.ok(m, name + ' not found in the sidebar'); return m[0]; };
    const element = () => ({ className: '', textContent: '', children: [], appendChild(x) { this.children.push(x); } });
    const ctx = vm.createContext({ document: { createElement: element }, String });
    vm.runInContext(grab('lineStatus') + '\n' + grab('showDetail'), ctx);
    return { pre: () => element(), show: (pre, text) => vm.runInContext('showDetail', ctx)(pre, text) };
  }

  test('live check sidebar: the details show FAIL and WARN lines in colour (classes), the head line in the colour of the run, PASS and SKIP quieter', () => {
    const sb = sidebarFunctions();
    const ex = new FakePlatform().execution(FILES);
    const text = ex.eval(`lcFormat_({ s: 'FAIL', a: 'menuRefreshAll', ms: 1200, c: [['PASS','config sheet exists',''],['FAIL','[K] activity indicators back to idle','still showing activity: data writing'],['WARN','duration within limits','301000 ms'],['SKIP','alert shown','UI']] })`);
    const pre = sb.pre();
    sb.show(pre, text);
    assert.deepStrictEqual(pre.children.map(x => x.className), ['l FAIL', 'l PASS', 'l FAIL', 'l WARN', 'l SKIP']);
    assert.strictEqual(pre.children.map(x => x.textContent).join('\n'), text, 'the text itself is unchanged');
    const lost = sb.pre(); sb.show(lost, ex.eval(`lcFormat_({ s: 'LOST', a: 'x', t: '2026-01-01T00:00:00Z', ms: 0, c: [] })`));
    assert.strictEqual(lost.children[0].className, 'l LOST');
  });

  test('live check sidebar: text from a check is shown as text (nothing is interpreted as HTML) and an empty line keeps its height', () => {
    const sb = sidebarFunctions();
    const pre = sb.pre();
    sb.show(pre, '    FAIL <img src=x onerror=alert(1)> - <b>detail</b>\n\n    WARN w');
    assert.strictEqual(pre.children[0].textContent, '    FAIL <img src=x onerror=alert(1)> - <b>detail</b>');
    assert.strictEqual(pre.children[0].children.length, 0);
    assert.strictEqual(pre.children[1].textContent, ' ');
    assert.deepStrictEqual(pre.children.map(x => x.className), ['l FAIL', 'l ', 'l WARN']);
  });

  test('live check sidebar: the colours exist in the stylesheet for FAIL and WARN lines (red / amber)', () => {
    const html = read('Live Check Sidebar.html');
    assert.ok(/\.detail \.l\.FAIL\s*\{[^}]*color: #a50e0e[^}]*background: #fce8e6/.test(html));
    assert.ok(/\.detail \.l\.WARN\s*\{[^}]*color: #7a4f01[^}]*background: #fef3c7/.test(html));
  });
};
