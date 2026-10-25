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
    'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js',
    'Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js'];

  test('live check: the helper files are exactly the ones merged from live-test-helpers (pinned; they define what must not change)', () => {
    const actual = Object.fromEntries(HELPERS.map(f => [f, sha(f)]));
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(PIN, JSON.stringify(actual, null, 1) + '\n');
    const pinned = JSON.parse(fs.readFileSync(PIN, 'utf8'));
    HELPERS.forEach(f => assert.strictEqual(actual[f], pinned[f],
      f + ' was changed. The live check helpers say what the add-on is expected to do (they were written against the code before the refactor): ' +
      'change them only together with an INTENDED change of behaviour, then re-pin with UPDATE_GOLDEN=1 node tests/run.js'));
  });

  test('live check: every action name the code gives to Controller.run has a verifier, and no verifier is orphaned', () => {
    const files = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^Live Check( Verifiers)?\.js$/.test(f) && f !== 'Test Functions.js' && f !== 'Controller.js');   // the framework and the verifiers only LIST the names
    const used = new Set();
    files.forEach(f => {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
      (text.match(/Controller\.run\(\s*["']([^"']+)["']/g) || []).forEach(m => used.add(m.match(/["']([^"']+)["']/)[1]));
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
    const files = [...FILES, 'Data Type.js', 'Menu.js', 'Import Query.js', 'BulkSheet.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js', 'Sheet Coeditor.js', 'Grid.js', 'Grid Util.js', 'Config Grid.js'];
    const ex = p.execution(files, { SpreadsheetApp: app, Utilities: book.Utilities, Session: { getActiveUser: () => ({ getEmail: () => 'u' }) } });
    ex.eval(`Agents.ensureActive = () => {};
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
    if (o.table) { cfg.setValue(6, 2, 'table', ''); cfg.setValue(6, 3, 'Customers', ''); }
    if (o.handD2) { cfg.cell(2, 4, true).fmt.bg = '#ffffff'; cfg.cell(2, 4, true).fmt.color = '#000000'; }
    if (o.breakIt) ex.eval(o.breakIt);
    ex.eval(o.run);
    const entries = Object.keys(p.props.document).filter(k => /^liveCheck:\d/.test(k)).sort().map(k => JSON.parse(p.props.document[k]));
    const mine = entries.filter(e => e.a === o.action);
    assert.strictEqual(mine.length, 1, 'one recorded run of ' + o.action + ': ' + entries.map(e => e.a).join(','));
    const line = mine[0].c.find(x => (o.line || /activity indicators back to idle/).test(x[1]));
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

  test('live check: the "<sheet>_coedit" lock flags count as a change only when no other checked run overlapped this one', () => {
    const p = new FakePlatform();
    const ex = p.execution(FILES);
    const put = (k, t, s, ms) => ex.eval(`PropertiesService.getDocumentProperties().setProperty(LIVE_CHECK_RESULT_PREFIX + "${k}", JSON.stringify({t: "${t}", a: "x", s: "${s}", ms: ${ms}, c: []}))`);
    const startedAt = Date.parse('2026-10-25T10:00:10.000Z');
    ex.eval(`globalThis.__c = { key: 'mine', startedAt: ${startedAt} }; lcStoredResults_ = () => JSON.parse(globalThis.__stored)`);
    const flags = stored => { ex.ctx.__stored = JSON.stringify(stored); return ex.eval(`lcParallelCoeditFlags_(__c).length`); };
    const e = (k, t, s, ms) => ({ k, t, s, ms, a: 'sheetEditAction', c: [] });
    ex.eval(`Date.now = () => ${startedAt + 5000}`);
    assert.strictEqual(flags([]), 0, 'quiet document');
    assert.strictEqual(flags([e('o1', '2026-10-25T10:00:05.000Z', 'RUN', 0)]), 1, 'another run still going');
    assert.strictEqual(flags([e('o2', '2026-10-25T10:00:00.000Z', 'PASS', 12000)]), 1, 'another run that ended after this one started');
    assert.strictEqual(flags([e('o3', '2026-10-25T10:00:00.000Z', 'PASS', 3000)]), 0, 'another run that ended before this one started');
    assert.strictEqual(flags([e('mine', '2026-10-25T10:00:10.000Z', 'RUN', 0)]), 0, 'this run itself does not count');
  });

  const THREE_ROWS = `ODataConnection.prototype.getDataArray = () => [['No'], ['C1'], ['C2']];`;
  const FMT = /number format uniform in every column/;
  test('live check, end to end: a result column whose number format differs between data rows -> FAIL naming the column and the actual formats (header shown, not judged)', () => {
    const r = e2e({ run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet', line: FMT, table: true,
      breakIt: THREE_ROWS + `{ const w = ResultSheet.write; ResultSheet.write = function (n) { w.apply(this, arguments); SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n).getRange(3, 1).setNumberFormat('0.00'); }; }` });
    assert.strictEqual(r.status, 'FAIL');
    assert.strictEqual(r.detail, 'differs between the first and last data row: No (row 2: "@", row 3: "0.00"; header: "@")');
    assert.strictEqual(e2e({ run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet', line: FMT, table: true, breakIt: THREE_ROWS }).status, 'PASS');
  });

  test('live check, end to end: a header cell that Sheets reset to its automatic format (as it does in date columns) is not a FAIL; the data rows decide', () => {
    const r = e2e({ run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet', line: FMT, table: true,
      breakIt: THREE_ROWS + `{ const w = ResultSheet.write; ResultSheet.write = function (n) { w.apply(this, arguments); SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n).getRange(1, 1).setNumberFormat('0.###############'); }; }` });
    assert.strictEqual(r.status, 'PASS');
  });

  test('live check, end to end: code that forgets to reset the writing cell after a refresh -> FAIL, also when D2 was hand-edited before', () => {
    const forget = `SheetCoeditor.prototype.switchDataWritingControl = function (a) { if (a) ConfigGrid.status(this.sheetName).set('writing', true); }`;
    assert.strictEqual(e2e({ run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet', breakIt: forget }).status, 'FAIL');
    assert.strictEqual(e2e({ handD2: true, run: 'refreshCurrentSheet()', action: 'menuRefreshCurrentSheet', breakIt: forget }).status, 'FAIL');
  });

  // ---- jobs (intents): a run is reported under what it DID, via the technical trigger ---------------------------------------------------------
  const JOB_FILES = ['Import Query.js', 'BulkSheet.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js', 'RefreshAll.js', 'ScheduleRefresh.js', 'AnalyseConfig.js', 'Router.js',
    'Data Type.js', 'Menu.js', 'Sheet Coeditor.js', 'Grid.js', 'Grid Util.js', 'Config Grid.js'];

  test('live check jobs: every job the code announces (Controller.intent, the router\'s action table) is in the catalogue and has a verifier, and none is orphaned', () => {
    const text = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const announced = new Set();
    fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^(Live Check|Test Functions)/.test(f)).forEach(f => {
      (text(f).match(/Controller\.intent\(\s*["']([^"']+)["']/g) || []).forEach(m => announced.add(m.match(/["']([^"']+)["']/)[1]));
    });
    const table = text('Router.js').match(/const ROUTE_ACTIONS_ = \{([\s\S]*?)\n\};/)[1];
    (table.match(/^  "([a-z.A-Z]+)":/gm) || []).forEach(m => announced.add(m.match(/"([^"]+)"/)[1]));
    const ex = new FakePlatform().execution(FILES);
    const catalogue = new Set(ex.eval(`LIVE_CHECK_INTENTS.map(x => x.intent)`));
    assert.deepStrictEqual([...announced].filter(x => !catalogue.has(x)), [], 'announced but not in LIVE_CHECK_INTENTS');
    assert.deepStrictEqual([...catalogue].filter(x => !announced.has(x)), [], 'in the catalogue but nobody announces it');
    const verifiers = new Set(ex.eval(`Object.keys(liveCheckVerifiers())`));
    assert.deepStrictEqual([...catalogue].filter(x => !verifiers.has(x)), [], 'jobs without a verifier');
    const cov = JSON.parse(JSON.stringify(ex.eval(`liveCheckCoverage()`)));
    assert.deepStrictEqual([cov.missing, cov.unknown], [[], []]);
  });

  /**
   * The installable triggers with the live check ON: real Quick Start / Router / Controller / live check files, the simulated spreadsheet with a settings
   * sheet (config row, refresh frequency row), a logged trigger "t1". Faked: the settings sheet OBJECT (isConfigSheet / isRefreshFrequencyCell), the co-edit
   * itself (no-op; the live check's content checks therefore see an unfinished config sheet - only labels and which verifier ran are looked at).
   */
  function agentRun(o) {
    const { SimBook } = require('./sim');
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify(Object.assign({ addonStatus: true, importSheetName: 'Ustawienia' }, o.permit ? { refreshPermit: o.permit } : {}));
    (o.triggers || []).forEach(x => p.triggers.push(Object.assign({ type: 'CLOCK', source: null, params: {} }, x)));
    p.props.document.docTriggerArray = JSON.stringify([{ triggerId: 't1', trigEventType: 'ON_EDIT', trigFunction: 'sheetEdit', dateCreated: '2020-01-01', lastUsed: '2020-01-01', SsId: 'ss-1', powerOn: o.power !== false }]);
    p.props.document.liveCheckEnabled = 'on';
    const book = new SimBook({ api: false });
    const st = book.add('Ustawienia');
    [['Opis linii'], ['configSheet', 'Konfiguracja 1', 'Wynik', false], ['refreshFrequency', 'Odświeżaj co:', 6, 'godzin']].forEach((row, i) => row.forEach((v, j) => st.setValue(i + 2, j + 2, v, '')));
    book.activeName = o.active ?? 'Konfiguracja 1';
    const ss = book.spreadsheet();
    const app = { getActiveSpreadsheet: () => ss, flush() {}, WrapStrategy: book.SpreadsheetApp.WrapStrategy, newDataValidation: book.SpreadsheetApp.newDataValidation,
      DataValidationCriteria: book.SpreadsheetApp.DataValidationCriteria, getUi: () => ({ alert() {} }) };
    const files = [...FILES, 'Settings Sheet.js', ...JOB_FILES];
    const ex = p.execution(files, { SpreadsheetApp: app, Utilities: book.Utilities, Session: { getActiveUser: () => ({ getEmail: () => 'u' }) } });
    ex.eval(`Agents.ensureActive = () => {};
      globalThis.CCTImportConfig = class { constructor(v) { this.v = v; } };
      SheetCoeditor.prototype.sheetEdit = function () {};
      getMainSettings = () => ({ isConfigSheet: n => n === 'Konfiguracja 1', isRefreshFrequencyCell: r => isInRange(4, 4, r) || isInRange(4, 5, r),
        setRefreshTrigger: () => ScheduleRefresh.setUp({ freq: 6, unit: 'hrs' }) });`);
    ex.eval(`new SheetCoeditor('Konfiguracja 1', false)`);
    if (o.breakIt) ex.eval(o.breakIt);
    const range = o.range ?? { sheet: o.active ?? 'Konfiguracja 1', row: 6, col: 2 };
    ex.ctx.__e = { triggerUid: 't1', changeType: o.changeType ?? 'INSERT_ROW',
      range: { getSheet: () => ({ getName: () => range.sheet }), getA1Notation: () => 'B6', getRow: () => range.row, getLastRow: () => range.row, getColumn: () => range.col, getLastColumn: () => range.col },
      source: { getActiveSheet: () => ({ getName: () => o.active ?? 'Konfiguracja 1' }) } };
    ex.eval(o.entry === 'change' ? `sheetChange(__e)` : `sheetEdit(__e)`);
    const entries = Object.keys(p.props.document).filter(k => /^liveCheck:\d/.test(k)).sort().map(k => JSON.parse(p.props.document[k]));
    assert.strictEqual(entries.length, 1, 'one recorded run: ' + entries.map(e => e.a + '/' + e.i).join(','));
    const entry = entries[0];
    return { entry, ex, names: entry.c.map(x => x[1]), status: name => (entry.c.find(x => x[1] === name || x[1].indexOf(name) >= 0) || [])[0], head: ex.eval(`lcFormat_(${JSON.stringify(entry)})`).split('\n')[0] };
  }

  test('live check jobs: a config sheet edit is reported as config.coedit [sheet] via sheetEditAction; the job\'s own checks ran next to the trigger\'s', () => {
    const r = agentRun({ entry: 'edit' });
    assert.deepStrictEqual([r.entry.i, r.entry.d, r.entry.a], ['config.coedit', 'Konfiguracja 1', 'sheetEditAction']);
    assert.ok(/^\[LIVE-CHECK\] (PASS|WARN|FAIL) config\.coedit \[Konfiguracja 1\] \(via sheetEditAction\) \(\d+ ms\)$/.test(r.head), r.head);
    assert.ok(r.names.includes('settings sheet exists with its signature (created on demand)'), 'trigger side: ' + r.names.join(' | '));
    assert.ok(r.names.includes('Konfiguracja 1 is a config sheet listed in the settings sheet'), 'job side');
    assert.ok(r.names.some(n => /\[Konfiguracja 1\] activity indicators back to idle/.test(n)), 'job side: the co-edit result is judged');
  });

  test('live check jobs: a structure change on a config sheet is the SAME job (config.coedit) via sheetChangeAction', () => {
    const r = agentRun({ entry: 'change', changeType: 'INSERT_ROW' });
    assert.deepStrictEqual([r.entry.i, r.entry.d, r.entry.a], ['config.coedit', 'Konfiguracja 1', 'sheetChangeAction']);
    assert.ok(r.names.includes('a structure change, not a cell edit'));
  });

  test('live check jobs: the same sheetEdit on the settings sheet is a different job - settings.refreshFrequency when the frequency was edited, settings.edit otherwise', () => {
    const f = agentRun({ entry: 'edit', active: 'Ustawienia', range: { sheet: 'Ustawienia', row: 4, col: 4 } });
    assert.deepStrictEqual([f.entry.i, f.entry.d], ['settings.refreshFrequency', 'Ustawienia']);
    assert.ok(f.names.includes('the edit touched the refresh frequency (number or unit)'));
    assert.ok(f.names.includes("an autoRefreshHandler trigger exists for this document's permit"), 'the time trigger is judged: ' + f.names.join(' | '));
    const o = agentRun({ entry: 'edit', active: 'Ustawienia', range: { sheet: 'Ustawienia', row: 3, col: 3 } });
    assert.strictEqual(o.entry.i, 'settings.edit');
    assert.strictEqual(o.status('edit in the settings sheet outside the refresh frequency: nothing to do'), 'PASS');
  });

  test('live check jobs: setting a new refresh frequency leaves a stored permit for the new trigger - the exact checks that failed in the live run now pass (bugs-todo #1)', () => {
    const r = agentRun({ entry: 'edit', active: 'Ustawienia', range: { sheet: 'Ustawienia', row: 4, col: 5 } });
    assert.strictEqual(r.entry.i, 'settings.refreshFrequency');
    assert.strictEqual(r.status("an autoRefreshHandler trigger exists for this document's permit"), 'PASS');
    assert.strictEqual(r.status('permit issued for the new trigger'), 'PASS', JSON.stringify(r.entry.c.filter(x => x[0] !== 'PASS')));
    assert.strictEqual(r.status('permit interval in hours'), 'PASS');
    assert.strictEqual(r.entry.s, 'PASS', 'and the whole run: ' + JSON.stringify(r.entry.c.filter(x => x[0] !== 'PASS')));
  });

  test('live check jobs: setting the refresh up replaces the trigger the previous permit named; refresh triggers of other documents and old ones are left alone and only noted', () => {
    const f = agentRun({ entry: 'edit', active: 'Ustawienia', range: { sheet: 'Ustawienia', row: 4, col: 5 },
      permit: { issuedFor: 'mine-old', lastRefresh: 1, intervalHours: 3 },
      triggers: [{ id: 'mine-old', fn: 'autoRefreshHandler' }, { id: 'theirs', fn: 'autoRefreshHandler' }, { id: 'old-legacy', fn: 'autoRefresh' }] });
    assert.strictEqual(f.entry.s, 'PASS', JSON.stringify(f.entry.c.filter(x => x[0] !== 'PASS')));
    assert.strictEqual(f.status('the trigger the previous permit named is gone'), 'PASS');
    assert.strictEqual(f.status('other refresh triggers are left alone'), 'PASS');
  });

  test('live check jobs: the trigger the previous permit named still installed after setting the refresh up is a FAIL (the old trigger would go on refreshing)', () => {
    const f = agentRun({ entry: 'edit', active: 'Ustawienia', range: { sheet: 'Ustawienia', row: 4, col: 5 },
      permit: { issuedFor: 'mine-old', lastRefresh: 1, intervalHours: 3 }, triggers: [{ id: 'mine-old', fn: 'autoRefreshHandler' }],
      breakIt: `ScheduleRefresh.removeRefreshTrigger_ = () => {}` });
    assert.strictEqual(f.status('the trigger the previous permit named is gone'), 'FAIL');
  });

  test('live check jobs: an edit elsewhere is sheet.ignored, an EDIT/FORMAT change is change.ignored, a powered-off trigger is agent.skipped', () => {
    const a = agentRun({ entry: 'edit', active: 'Arkusz1', range: { sheet: 'Arkusz1', row: 1, col: 1 } });
    assert.strictEqual(a.entry.i, 'sheet.ignored');
    assert.strictEqual(a.status('not a config sheet: nothing to do'), 'PASS');
    const c = agentRun({ entry: 'change', changeType: 'FORMAT' });
    assert.strictEqual(c.entry.i, 'change.ignored');
    assert.strictEqual(c.status('only EDIT and FORMAT changes are ignored'), 'PASS');
    const s = agentRun({ entry: 'edit', power: false });
    assert.deepStrictEqual([s.entry.i, s.entry.d], ['agent.skipped', undefined]);
    assert.ok(/agent\.skipped \(via sheetEditAction\)/.test(s.head), s.head);
    assert.strictEqual(s.status('the trigger is powered off or not logged'), 'PASS');
    assert.strictEqual(s.status('power OFF or trigger not logged: edit action skipped, sheets untouched'), 'PASS', 'the trigger side stays');
  });

  test('live check jobs: a powered-off CHANGE trigger skips the change and announces agent.skipped, like an edit (was: it still co-edited and the job was not asserted)', () => {
    const r = agentRun({ entry: 'change', power: false });
    assert.strictEqual(r.entry.i, 'agent.skipped');
    assert.strictEqual(r.status('the trigger is powered off or not logged'), 'PASS');
  });

  test('live check jobs: a co-edit that dropped out because a newer one took over is reported as dropped (SKIP), not judged on a sheet the newer run is still completing', () => {
    const done = agentRun({ entry: 'edit' });
    assert.ok(done.status('has a "table" row') !== undefined, 'a normal run is judged on the content');
    const dropped = agentRun({ entry: 'edit', breakIt: `SheetCoeditor.prototype.sheetEdit = function (e, isLatest) { Store.set('document', 'Konfiguracja 1_coedit', 'a-newer-run'); return isLatest(); }` });
    assert.strictEqual(dropped.entry.i, 'config.coedit');
    assert.strictEqual(dropped.status('result'), 'SKIP');
    assert.ok(dropped.names.every(n => !/has a "table" row|dropdowns match|activity indicators/.test(n)), 'nothing about the content or the lights: ' + dropped.names.join(' | '));
    assert.notStrictEqual(dropped.entry.s, 'FAIL', JSON.stringify(dropped.entry.c.filter(x => x[0] !== 'PASS')));
  });

  test('live check jobs: a WRONGLY routed edit is a FAIL (each job re-derives its premise from the event, not from the router)', () => {
    const asConfig = agentRun({ entry: 'edit', active: 'Arkusz1', range: { sheet: 'Arkusz1', row: 1, col: 1 }, breakIt: `Router.routeEdit = e => ({ intent: 'config.coedit', sheet: 'Arkusz1', event: e })` });
    assert.strictEqual(asConfig.status('Arkusz1 is a config sheet listed in the settings sheet'), 'FAIL');
    const ignoredConfig = agentRun({ entry: 'edit', breakIt: `Router.routeEdit = e => ({ intent: 'sheet.ignored', sheet: 'Konfiguracja 1', event: e })` });
    assert.strictEqual(ignoredConfig.status('not a config sheet: nothing to do'), 'FAIL');
    const missedFrequency = agentRun({ entry: 'edit', active: 'Ustawienia', range: { sheet: 'Ustawienia', row: 4, col: 5 }, breakIt: `Router.routeEdit = e => ({ intent: 'settings.edit', sheet: 'Ustawienia', event: e })` });
    assert.strictEqual(missedFrequency.status('edit in the settings sheet outside the refresh frequency: nothing to do'), 'FAIL');
    const wrongFrequency = agentRun({ entry: 'edit', active: 'Ustawienia', range: { sheet: 'Ustawienia', row: 3, col: 3 }, breakIt: `Router.routeEdit = e => ({ intent: 'settings.refreshFrequency', sheet: 'Ustawienia', event: e })` });
    assert.strictEqual(wrongFrequency.status('the edit touched the refresh frequency (number or unit)'), 'FAIL');
    const wrongIgnore = agentRun({ entry: 'change', changeType: 'INSERT_ROW', breakIt: `Router.routeChange = e => ({ intent: 'change.ignored', changeType: e.changeType })` });
    assert.strictEqual(wrongIgnore.status('only EDIT and FORMAT changes are ignored'), 'FAIL');
  });

  test('live check jobs: when no job was announced (the run stopped before routing) the trigger\'s verifier judges the content itself, as it did before', () => {
    const r = agentRun({ entry: 'edit', breakIt: `Router.edit = () => {}` });
    assert.strictEqual(r.entry.i, undefined);
    assert.strictEqual(r.entry.a, 'sheetEditAction');
    assert.ok(r.names.some(n => /\[Konfiguracja 1\] activity indicators back to idle/.test(n)), 'content checked by the trigger verifier: ' + r.names.join(' | '));
  });

  test('live check jobs: switched OFF nothing is announced or stored (the router works the same without the live check)', () => {
    const p = new FakePlatform();
    const ex = p.execution(FILES);
    assert.doesNotThrow(() => ex.eval(`Controller.intent('config.coedit', { sheet: 'x', changeType: null })`));
    assert.deepStrictEqual(Object.keys(p.props.document).filter(k => /^liveCheck:/.test(k)), []);
  });

  test('live check jobs: reports, summary and the sidebar headline use the job; runs without a job keep their entry point name', () => {
    const ex = new FakePlatform().execution(FILES);
    const fmt = e => ex.eval(`lcFormat_(${JSON.stringify(e)})`);
    assert.ok(/^\[LIVE-CHECK\] FAIL config\.coedit \[Konfiguracja 1\] \(via sheetEditAction\) \(12 ms\)\n    FAIL x - y$/.test(fmt({ s: 'FAIL', a: 'sheetEditAction', i: 'config.coedit', d: 'Konfiguracja 1', ms: 12, c: [['FAIL', 'x', 'y']] })));
    assert.ok(/^\[LIVE-CHECK\] PASS menuRefreshAll \(5 ms\)/.test(fmt({ s: 'PASS', a: 'menuRefreshAll', ms: 5, c: [] })));
    assert.ok(/RUN settings\.edit \(via sheetEditAction\) \(started/.test(fmt({ s: 'RUN', a: 'sheetEditAction', i: 'settings.edit', t: '2026-01-01T00:00:00Z' })));
    const p = new FakePlatform();
    p.props.document['liveCheck:2026-01-01T00:00:01Z:a'] = JSON.stringify({ t: '2026-01-01T00:00:01Z', a: 'sheetEditAction', i: 'config.coedit', d: 'K1', s: 'PASS', ms: 1, c: [] });
    p.props.document['liveCheck:2026-01-01T00:00:02Z:b'] = JSON.stringify({ t: '2026-01-01T00:00:02Z', a: 'sheetEditAction', i: 'sheet.ignored', s: 'PASS', ms: 1, c: [] });
    p.props.document['liveCheck:2026-01-01T00:00:03Z:c'] = JSON.stringify({ t: '2026-01-01T00:00:03Z', a: 'menuRefreshAll', s: 'FAIL', ms: 1, c: [] });
    const e2 = p.execution(FILES);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(e2.eval(`liveCheckSummary()`))), { 'config.coedit': { PASS: 1, WARN: 0, FAIL: 0, SKIP: 0 }, 'sheet.ignored': { PASS: 1, WARN: 0, FAIL: 0, SKIP: 0 }, menuRefreshAll: { PASS: 0, WARN: 0, FAIL: 1, SKIP: 0 } });
    const rows = JSON.parse(JSON.stringify(e2.eval(`liveCheckSidebarData(null)`).rows));
    const byKey = Object.fromEntries(rows.map(r => [r.k.slice(-1), r]));
    assert.deepStrictEqual([byKey.a.i, byKey.a.d, byKey.a.a], ['config.coedit', 'K1', 'sheetEditAction']);
    assert.ok(/config sheet was edited or changed/.test(byKey.a.text));
    assert.strictEqual(byKey.c.i, null);
    assert.strictEqual(byKey.c.text, null);
  });

  test('live check jobs: the catalogue can be printed (liveCheckIntents) and describes every job in words', () => {
    const ex = new FakePlatform().execution(FILES);
    const text = ex.eval(`liveCheckIntents()`);
    ['config.coedit', 'settings.refreshFrequency', 'settings.edit', 'sheet.ignored', 'change.ignored', 'agent.skipped'].forEach(n => assert.ok(new RegExp('^' + n.replace('.', '\\.') + ': .{20,}', 'm').test(text), n));
  });

  // ---- agents repaired inside ONE run (no nested run any more) ----------------------------------------------------------------------------
  function repairRun(code, addonOn) {
    const { SimBook } = require('./sim');
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: addonOn, importSheetName: 'Ustawienia' });
    p.props.document.liveCheckEnabled = 'on';
    const book = new SimBook({ api: false });
    const st = book.add('Ustawienia');
    [['Opis linii']].forEach((row, i) => row.forEach((v, j) => st.setValue(i + 2, j + 2, v, '')));
    book.activeName = 'Ustawienia';
    const ss = book.spreadsheet();
    const app = { getActiveSpreadsheet: () => ss, flush() {}, WrapStrategy: book.SpreadsheetApp.WrapStrategy, newDataValidation: book.SpreadsheetApp.newDataValidation,
      DataValidationCriteria: book.SpreadsheetApp.DataValidationCriteria, getUi: () => ({ alert() {} }) };
    const ex = p.execution([...FILES, 'Menu.js', 'Settings Sheet.js', 'Data Type.js'], { SpreadsheetApp: app, Utilities: book.Utilities, Session: { getActiveUser: () => ({ getEmail: () => 'u' }) } });
    ex.eval(code);
    const entries = Object.keys(p.props.document).filter(k => /^liveCheck:\d/.test(k)).sort().map(k => JSON.parse(p.props.document[k]));
    return { p, entries, notPassing: entries.map(e => e.c.filter(x => x[0] === 'WARN' || x[0] === 'FAIL').map(x => e.a + ': ' + x[1] + ' - ' + x[2])).flat() };
  }

  test('live check: the sidebar\'s "repair agents" is ONE checked run and every check passes strictly (triggers, both logs, the agent pair)', () => {
    const r = repairRun('forceAgentRefresh()', true);
    assert.deepStrictEqual(r.entries.map(e => [e.a, e.s]), [['forceAgentRefresh', 'PASS']]);
    assert.deepStrictEqual(r.notPassing, []);
    assert.deepStrictEqual(r.p.consoleErrors.filter(m => /NESTED RUN/.test(m)), []);
  });

  test('live check: switching the add-on ON installs the agents in the same run - one checked run, no "known issue" fallbacks needed (bugs-todo #2)', () => {
    const r = repairRun('changeAddonStatus(true)', false);
    assert.deepStrictEqual(r.entries.map(e => [e.a, e.s]), [['requestChangeAddonStatus', 'PASS']]);
    assert.deepStrictEqual(r.notPassing, []);
    assert.ok(r.entries[0].c.some(x => /agents active after switching ON/.test(x[1]) && x[0] === 'PASS'));
    assert.strictEqual(r.entries[0].nested, undefined);
    assert.deepStrictEqual(r.p.triggers.map(t => t.fn), ['sheetEdit', 'sheetChange']);
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

  test('live check sidebar: the headline of a run is its job with the sheet, else the entry point; "via" and the description are shown for jobs', () => {
    const vm = require('vm');
    const html = read('Live Check Sidebar.html');
    const m = html.match(/function runLabel\(r\) \{[^\n]*\}/);
    assert.ok(m, 'runLabel not found');
    const runLabel = vm.runInNewContext('(' + m[0].replace('function runLabel', 'function') + ')');
    assert.strictEqual(runLabel({ a: 'sheetEditAction', i: 'config.coedit', d: 'Konfiguracja 1' }), 'config.coedit [Konfiguracja 1]');
    assert.strictEqual(runLabel({ a: 'sheetEditAction', i: 'sheet.ignored', d: null }), 'sheet.ignored');
    assert.strictEqual(runLabel({ a: 'menuRefreshAll', i: null }), 'menuRefreshAll');
    assert.ok(/via\.textContent = r\.i \? "via " \+ r\.a : ""/.test(html));
    assert.ok(/name\.title = r\.s \+ \(r\.text \? " - " \+ r\.text : ""\)/.test(html));
  });
};
