// Tests of the automatic refresh: creating the time trigger from the refresh frequency, the permit that decides which trigger may refresh,
// the two trigger handlers (current and legacy) and the refresh loops (RefreshAll / ScheduleRefresh, formerly in Menu.js and Settings Sheet.js).
// Registered by tests/run.js.
//
// The real files run in a fresh global scope on fake Properties / Cache / Lock / ScriptApp services (tests/platform-fakes.js, real trigger bookkeeping).
// Faked: the settings sheet object (getMainSettings), the config reader and the BC connection (the refresh of one sheet is tested in refresh.test.js).
// Written FIRST against the old code (characterisation); the extraction must keep all of it green.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const BASE = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js', 'Data Type.js', 'Menu.js', 'Settings Sheet.js'];
const USE_CASE_FILES = ['Import Query.js', 'BulkSheet.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js', 'RefreshAll.js', 'ScheduleRefresh.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

const FAKES = `
  globalThis.SheetCoeditor = class {
    constructor(name, readingActive) { __log.push(['refresh', name]); }
    getTable() { if (__cfg.refreshError) throw new Error(__cfg.refreshError); return null; }     // no table: RefreshSheet.run stops right away
    switchReadingControl() {}
  };
  getMainSettings = () => ({
    getSheetList: () => __cfg.sheetList,
    getSheetListWithRefreshTrue: () => __cfg.sheetList.filter(x => x.refresh),
    setLastRefresh: t => { __log.push(['lastRefresh', t instanceof Date]); },
    getConfigSheetNames: () => __cfg.sheetList.map(x => x.configSheet)
  });
`;

module.exports = function register(t) {
  const { test } = t;
  const FILES = [...BASE, ...USE_CASE_FILES];
  const plain = v => JSON.parse(JSON.stringify(v));
  const OTHER = { id: 'other-doc-trigger', fn: 'autoRefreshHandler', type: 'CLOCK', source: null, params: { everyHours: 1 } };

  function scenario(over) {
    const cfg = Object.assign({
      sheetList: [{ configSheet: 'K1', resultSheet: 'R1', refresh: true }, { configSheet: 'K2', resultSheet: 'R2', refresh: false }, { configSheet: 'K3', resultSheet: 'R3', refresh: true }]
    }, over || {});
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify(Object.assign({ addonStatus: true, importSheetName: 'Ustawienia' }, cfg.settings || {}));
    const log = [];
    const ex = p.execution(FILES, { __cfg: cfg, __log: log });
    ex.eval(`Agents.ensureActive = () => {}`);
    ex.eval(FAKES);
    const stored = () => JSON.parse(p.props.document.importSettingsArray);
    return { p, ex, log, cfg, calls: () => plain(log), stored,
      save: () => ex.eval(`getImportSettings().saveArray()`),
      /** the settings sheet object with a given refresh frequency, without reading any sheet */
      settingsSheet: freq => ex.eval(`(() => { const s = Object.create(SettingsSheet.prototype); s.sheet = { getParent: () => ({}) }; s.settings = []; s.refreshFrequency = ${JSON.stringify(freq)}; return s; })()`) };
  }
  const triggers = p => p.triggers.map(x => ({ id: x.id, fn: x.fn, type: x.type, params: x.params }));
  const permit = sc => sc.stored().refreshPermit;
  const event = id => `({ triggerUid: '${id}' })`;

  // ---- setting the time trigger up (SettingsSheet.setRefreshTrigger) --------------------------------------------------------------------
  test('schedule: every N hours -> one time trigger "autoRefreshHandler", a permit issued for it with that interval; the old refresh triggers are gone, others stay', () => {
    const sc = scenario();
    sc.p.triggers.push(Object.assign({}, OTHER), { id: 'old-legacy', fn: 'autoRefresh', type: 'CLOCK', source: null, params: {} }, { id: 'agent', fn: 'sheetEdit', type: 'ON_EDIT', source: 'ss-1', params: {} });
    const s = sc.settingsSheet({ freq: 6, unit: 'hrs' });
    sc.ex.eval(`MainSettings`);
    s.setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p), [{ id: 'agent', fn: 'sheetEdit', type: 'ON_EDIT', params: {} }, { id: 'trig-1', fn: 'autoRefreshHandler', type: 'CLOCK', params: { everyHours: 6 } }]);
    assert.deepStrictEqual([permit(sc).issuedFor, permit(sc).intervalHours, typeof permit(sc).lastRefresh], ['trig-1', 6, 'number']);
  });

  test('schedule: every N days -> everyDays(N), the permit interval is given in hours (24 x N)', () => {
    const sc = scenario();
    sc.settingsSheet({ freq: 2, unit: 'days' }).setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p), [{ id: 'trig-1', fn: 'autoRefreshHandler', type: 'CLOCK', params: { everyDays: 2 } }]);
    assert.strictEqual(permit(sc).intervalHours, 48);
  });

  test('schedule: no frequency (empty) -> the refresh triggers are removed, nothing is created, the old permit is left as it was', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'old', lastRefresh: 1, intervalHours: 3 } } });
    sc.p.triggers.push(Object.assign({}, OTHER));
    sc.settingsSheet({ freq: '', unit: 'hrs' }).setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p), []);
    assert.strictEqual(permit(sc).issuedFor, 'old');
  });

  test('schedule: an unknown unit -> the refresh triggers are removed, nothing is created, the permit is not changed', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'old', lastRefresh: 1, intervalHours: 3 } } });
    sc.p.triggers.push(Object.assign({}, OTHER));
    sc.settingsSheet({ freq: 3, unit: null }).setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p), []);
    assert.strictEqual(permit(sc).issuedFor, 'old');
  });

  test('schedule: KNOWN QUIRK pinned - without a refresh frequency row (null) the refresh triggers are removed first and then it fails with a TypeError', () => {
    const sc = scenario();
    sc.p.triggers.push(Object.assign({}, OTHER));
    assert.throws(() => sc.settingsSheet(null).setRefreshTrigger(), /Cannot read properties of null/);
    assert.deepStrictEqual(triggers(sc.p), []);
  });

  test('schedule: KNOWN QUIRK pinned - it removes the refresh triggers of ALL documents of the user (project-wide), bugs-todo #5', () => {
    const sc = scenario();
    sc.p.triggers.push(Object.assign({}, OTHER, { source: 'another-document' }));
    sc.settingsSheet({ freq: 1, unit: 'hrs' }).setRefreshTrigger();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['trig-1']);
  });

  test('schedule: setting it up twice leaves one trigger and a permit for the newest one', () => {
    const sc = scenario();
    const s = sc.settingsSheet({ freq: 6, unit: 'hrs' });
    s.setRefreshTrigger(); s.setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['trig-2']);
    assert.strictEqual(permit(sc).issuedFor, 'trig-2');
  });

  // ---- the time trigger fires (autoRefreshHandler -> autoRefreshContent) ----------------------------------------------------------------
  test('trigger: with its own permit it refreshes the ticked sheets in order, then notes the time, then touches the permit (lastRun)', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6 } } });
    sc.p.triggers.push({ id: 'trig-A', fn: 'autoRefreshHandler', type: 'CLOCK', source: null, params: {} });
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    assert.deepStrictEqual(sc.calls(), [['refresh', 'K1'], ['refresh', 'K3'], ['lastRefresh', true]]);
    assert.strictEqual(typeof permit(sc).lastRun, 'number');
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['trig-A'], 'it stays');
  });

  test('trigger: with no ticked sheet nothing is refreshed, but the time is still noted (quirk kept)', () => {
    const sc = scenario({ sheetList: [{ configSheet: 'K1', resultSheet: 'R1', refresh: false }], settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6 } } });
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    assert.deepStrictEqual(sc.calls(), [['lastRefresh', true]]);
  });

  test('trigger: without any permit it deletes itself (only itself) and refreshes nothing', () => {
    const sc = scenario();
    sc.p.triggers.push({ id: 'trig-A', fn: 'autoRefreshHandler', type: 'CLOCK', source: null, params: {} }, Object.assign({}, OTHER));
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    assert.deepStrictEqual(sc.calls(), []);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['other-doc-trigger']);
  });

  test('trigger: with a permit issued for another trigger it deletes itself and refreshes nothing, the permit is not touched', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-B', lastRefresh: 1, intervalHours: 6 } } });
    sc.p.triggers.push({ id: 'trig-A', fn: 'autoRefreshHandler', type: 'CLOCK', source: null, params: {} }, { id: 'trig-B', fn: 'autoRefreshHandler', type: 'CLOCK', source: null, params: {} });
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    assert.deepStrictEqual(sc.calls(), []);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['trig-B']);
    assert.strictEqual(permit(sc).lastRun, undefined);
  });

  test('trigger: a failing refresh gives the error back and neither notes the time nor touches the permit', () => {
    const sc = scenario({ refreshError: 'BC down', settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6 } } });
    assert.throws(() => sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`), /BC down/);
    assert.deepStrictEqual(sc.calls().filter(c => c[0] === 'lastRefresh'), []);
    assert.strictEqual(permit(sc).lastRun, undefined);
  });

  test('trigger: the permit is re-read when it is touched: if another run reissued it meanwhile, this run does not write its lastRun over it', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6 } } });
    const other = sc.p.execution(FILES);
    // while this run "refreshes" (here: when it notes the time), another execution reissues the permit and saves it
    sc.ex.ctx.__reissue = () => other.eval(`MainSettings.setRefreshPermit('trig-B', 12); getImportSettings().saveArray()`);
    sc.ex.eval(`getMainSettings = () => ({ getSheetListWithRefreshTrue: () => [], setLastRefresh: () => __reissue() })`);
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    sc.save();
    assert.strictEqual(permit(sc).issuedFor, 'trig-B');
    assert.strictEqual(permit(sc).lastRun, undefined);
  });

  // ---- the legacy handler (autoRefresh, older triggers) ------------------------------------------------------------------------------------
  test('legacy trigger: without a permit it issues one for itself (no interval) and refreshes', () => {
    const sc = scenario();
    sc.p.triggers.push({ id: 'trig-L', fn: 'autoRefresh', type: 'CLOCK', source: null, params: {} });
    sc.ex.eval(`autoRefresh(${event('trig-L')})`);
    assert.deepStrictEqual(sc.calls(), [['refresh', 'K1'], ['refresh', 'K3'], ['lastRefresh', true]]);
    assert.strictEqual(permit(sc).issuedFor, 'trig-L');
    assert.strictEqual(permit(sc).intervalHours, undefined);
    // KNOWN QUIRK pinned: touchRefreshPermit re-reads the STORE, where the permit issued a moment ago in this very run is not saved yet,
    // so the first legacy run records no lastRun.
    assert.strictEqual(permit(sc).lastRun, undefined);
  });

  test('legacy trigger: with its own permit it refreshes; with somebody else\'s it deletes itself', () => {
    const mine = scenario({ settings: { refreshPermit: { issuedFor: 'trig-L', lastRefresh: 1, intervalHours: 6 } } });
    mine.ex.eval(`autoRefresh(${event('trig-L')})`);
    assert.deepStrictEqual(mine.calls().filter(c => c[0] === 'refresh').length, 2);
    const other = scenario({ settings: { refreshPermit: { issuedFor: 'trig-B', lastRefresh: 1, intervalHours: 6 } } });
    other.p.triggers.push({ id: 'trig-L', fn: 'autoRefresh', type: 'CLOCK', source: null, params: {} });
    other.ex.eval(`autoRefresh(${event('trig-L')})`);
    assert.deepStrictEqual(other.calls(), []);
    assert.deepStrictEqual(triggers(other.p), []);
  });

  // ---- the entry points keep what the live check relies on --------------------------------------------------------------------------------
  test('entry points: both handlers run under the action name "requestAutoRefesh" (live check) and hand over the event', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Settings Sheet.js'), 'utf8');
    assert.ok(/Controller\.checkInput\("requestAutoRefesh",\{e,legacy:false\}\);\s*Controller\.run\("requestAutoRefesh"/.test(text));
    assert.ok(/Controller\.checkInput\("requestAutoRefesh",\{e,legacy:true\}\);\s*Controller\.run\("requestAutoRefesh"/.test(text));
  });

  // ---- the refresh loops --------------------------------------------------------------------------------------------------------------------
  test('refresh loops: refreshAll() = every pair of the settings sheet in order, refreshAllTrue() = only the ticked ones, nothing ticked = nothing', () => {
    const a = scenario(); a.ex.eval(`refreshAll()`);
    assert.deepStrictEqual(a.calls(), [['refresh', 'K1'], ['refresh', 'K2'], ['refresh', 'K3']]);
    const b = scenario(); b.ex.eval(`refreshAllTrue()`);
    assert.deepStrictEqual(b.calls(), [['refresh', 'K1'], ['refresh', 'K3']]);
    const c = scenario({ sheetList: [{ configSheet: 'K2', resultSheet: 'R2', refresh: false }] }); c.ex.eval(`refreshAllTrue()`);
    assert.deepStrictEqual(c.calls(), []);
  });

  test('refresh loops: autoRefreshFunction() = the ticked ones, then the time is noted on the settings sheet', () => {
    const sc = scenario();
    sc.ex.eval(`autoRefreshFunction()`);
    assert.deepStrictEqual(sc.calls(), [['refresh', 'K1'], ['refresh', 'K3'], ['lastRefresh', true]]);
  });

  test('refresh loops: the first failing sheet stops the loop (later sheets are not refreshed)', () => {
    const sc = scenario({ refreshError: 'boom' });
    assert.throws(() => sc.ex.eval(`refreshAllTrue()`), /boom/);
    assert.deepStrictEqual(sc.calls(), [['refresh', 'K1']]);
  });

  // ---- rules -----------------------------------------------------------------------------------------------------------------------------------
  const code = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

  test('rule: RefreshAll and ScheduleRefresh never touch a spreadsheet; only ScheduleRefresh creates time-based triggers and removes the refresh triggers (the agent triggers belong to Trigger Manager)', () => {
    ['RefreshAll.js', 'ScheduleRefresh.js'].forEach(f => assert.ok(!/SpreadsheetApp|getRange|getSheetByName/.test(code(f)), f));
    const offenders = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && f !== 'ScheduleRefresh.js' && !/^(Test Functions|Live Check)/.test(f))
      .filter(f => /\.timeBased\(\)|\["autoRefresh","autoRefreshHandler"\]/.test(code(f)));
    assert.deepStrictEqual(offenders, []);
  });

  test('rule: the old names are one-line forwarders (Settings Sheet.js, Menu.js); the settings sheet no longer decides how a trigger is made', () => {
    const ss = code('Settings Sheet.js'), menu = code('Menu.js');
    assert.ok(/setRefreshTrigger\(\)\{\s*ScheduleRefresh\.setUp\(this\.getRefreshFrequency\(\)\);\s*\}/.test(ss));
    assert.ok(/function autoRefreshFunction\(e\)\{\s*RefreshAll\.scheduled\(\);\s*\}/.test(ss));
    assert.ok(/function autoRefreshContent\(e\) \{\s*ScheduleRefresh\.run\(e\);\s*\}/.test(ss));
    assert.ok(/function autoRefreshContentOld\(e\) \{\s*ScheduleRefresh\.runLegacy\(e\);\s*\}/.test(ss));
    assert.ok(/function refreshAllTrue\(\)\{\s*RefreshAll\.ticked\(\);\s*\}/.test(menu));
    assert.ok(/Controller\.run\("menuRefreshAll",\(\) => RefreshAll\.all\(\)\)/.test(menu));
    assert.ok(!/ScriptApp\.newTrigger\('autoRefreshHandler'\)/.test(ss));
  });

  test('rule: the new files load alone, in any order (nothing is used at load time)', () => {
    const vm = require('vm');
    ['RefreshAll.js', 'ScheduleRefresh.js'].forEach(f => vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), {}));
  });
};
