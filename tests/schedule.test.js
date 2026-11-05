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
const USE_CASE_FILES = ['Import Query.js', 'BulkSheet.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js', 'RefreshAll.js', 'Refresh Registry.js', 'ScheduleRefresh.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

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
  const NAMED = (id, fn = 'autoRefreshHandler') => ({ id, fn, type: 'CLOCK', source: null, params: {} });
  const PERMIT = id => ({ refreshPermit: { issuedFor: id, lastRefresh: 1, intervalHours: 3 } });

  test('schedule: every N hours -> one new time trigger "autoRefreshHandler" and a permit issued for it with that interval; ONLY the trigger the old permit names is removed (other triggers, other documents\' included, stay)', () => {
    const sc = scenario({ settings: PERMIT('mine-old') });
    sc.p.triggers.push(Object.assign({}, OTHER), NAMED('mine-old'), NAMED('old-legacy', 'autoRefresh'), { id: 'agent', fn: 'sheetEdit', type: 'ON_EDIT', source: 'ss-1', params: {} });
    const s = sc.settingsSheet({ freq: 6, unit: 'hrs' });
    sc.ex.eval(`MainSettings`);
    s.setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['other-doc-trigger', 'old-legacy', 'agent', 'trig-1']);
    assert.deepStrictEqual(triggers(sc.p).pop(), { id: 'trig-1', fn: 'autoRefreshHandler', type: 'CLOCK', params: { everyHours: 6 } });
    assert.deepStrictEqual([permit(sc).issuedFor, permit(sc).intervalHours, typeof permit(sc).lastRefresh], ['trig-1', 6, 'number']);
  });

  test('schedule: with no permit yet nothing is removed (there is no way to tell whose a time trigger is); the new trigger gets the permit', () => {
    const sc = scenario();
    sc.p.triggers.push(Object.assign({}, OTHER), NAMED('old-legacy', 'autoRefresh'));
    sc.settingsSheet({ freq: 6, unit: 'hrs' }).setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['other-doc-trigger', 'old-legacy', 'trig-1']);
    assert.strictEqual(permit(sc).issuedFor, 'trig-1');
  });

  test('schedule: a permit that names an agent trigger (or anything that is not a refresh trigger) removes nothing', () => {
    const sc = scenario({ settings: PERMIT('agent') });
    sc.p.triggers.push({ id: 'agent', fn: 'sheetEdit', type: 'ON_EDIT', source: 'ss-1', params: {} });
    sc.settingsSheet({ freq: 6, unit: 'hrs' }).setRefreshTrigger();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['agent', 'trig-1']);
  });

  test('schedule: every N days -> everyDays(N), the permit interval is given in hours (24 x N)', () => {
    const sc = scenario();
    sc.settingsSheet({ freq: 2, unit: 'days' }).setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p), [{ id: 'trig-1', fn: 'autoRefreshHandler', type: 'CLOCK', params: { everyDays: 2 } }]);
    assert.strictEqual(permit(sc).intervalHours, 48);
  });

  test('schedule: no frequency (empty) -> the trigger the permit names is removed, nothing is created, the old permit is left as it was', () => {
    const sc = scenario({ settings: PERMIT('old') });
    sc.p.triggers.push(Object.assign({}, OTHER), NAMED('old'));
    sc.settingsSheet({ freq: '', unit: 'hrs' }).setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['other-doc-trigger']);
    assert.strictEqual(permit(sc).issuedFor, 'old');
  });

  test('schedule: an unknown unit -> the same: the permitted trigger is removed, nothing is created, the permit is not changed', () => {
    const sc = scenario({ settings: PERMIT('old') });
    sc.p.triggers.push(Object.assign({}, OTHER), NAMED('old'));
    sc.settingsSheet({ freq: 3, unit: null }).setRefreshTrigger();
    sc.save();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['other-doc-trigger']);
    assert.strictEqual(permit(sc).issuedFor, 'old');
  });

  test('schedule: switching the refresh OFF in a document that has no permit yet issues a permit for nobody - so an old (legacy) trigger of this document that never claimed one deletes itself when it fires instead of claiming it', () => {
    const sc = scenario();
    sc.p.triggers.push(NAMED('old-legacy', 'autoRefresh'));
    sc.settingsSheet({ freq: '', unit: 'hrs' }).setRefreshTrigger();
    sc.save();
    assert.strictEqual(permit(sc).issuedFor, null);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['old-legacy'], 'it cannot be told from another document\'s: it stays until it fires');
    const later = scenario({ settings: { refreshPermit: permit(sc) } });
    later.p.triggers.push(NAMED('old-legacy', 'autoRefresh'));
    later.ex.eval(`autoRefresh(${event('old-legacy')})`);
    assert.deepStrictEqual(later.calls(), [], 'nothing refreshed');
    assert.deepStrictEqual(triggers(later.p), [], 'and it removed itself');
  });

  test('schedule: legacy trigger of this document that was NOT named by the permit: setting the refresh up leaves it, and it deletes itself the next time it fires (the new permit is not its own)', () => {
    const sc = scenario();
    sc.p.triggers.push(NAMED('old-legacy', 'autoRefresh'));
    sc.settingsSheet({ freq: 6, unit: 'hrs' }).setRefreshTrigger();
    sc.save();
    const later = scenario({ settings: { refreshPermit: permit(sc) } });
    later.p.triggers.push(NAMED('old-legacy', 'autoRefresh'), NAMED('trig-1'));
    later.ex.eval(`autoRefresh(${event('old-legacy')})`);
    assert.deepStrictEqual(later.calls(), []);
    assert.deepStrictEqual(triggers(later.p).map(x => x.id), ['trig-1']);
  });

  test('schedule: a legacy trigger that claimed the permit (it ran with none) is the one the permit names, so the next setting-up replaces it', () => {
    const sc = scenario();
    sc.p.triggers.push(NAMED('old-legacy', 'autoRefresh'));
    sc.ex.eval(`autoRefresh(${event('old-legacy')})`);                     // no permit: it issues one for itself and refreshes
    sc.save();
    assert.strictEqual(permit(sc).issuedFor, 'old-legacy');
    const again = scenario({ settings: { refreshPermit: permit(sc) } });
    again.p.triggers.push(NAMED('old-legacy', 'autoRefresh'));
    again.settingsSheet({ freq: 2, unit: 'days' }).setRefreshTrigger();
    assert.deepStrictEqual(triggers(again.p).map(x => [x.id, x.fn]), [['trig-1', 'autoRefreshHandler']]);
  });

  test('schedule: without a refresh frequency row (null) it fails with a TypeError and changes NOTHING (before: the permitted trigger was removed first)', () => {
    const sc = scenario({ settings: PERMIT('old') });
    sc.p.triggers.push(Object.assign({}, OTHER), NAMED('old'));
    assert.throws(() => sc.settingsSheet(null).setRefreshTrigger(), /Cannot read properties of null/);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['other-doc-trigger', 'old']);
    assert.strictEqual(permit(sc).issuedFor, 'old');
  });

  test('schedule: an invalid number ("x", 1.5, -2; 0 and empty mean OFF) is an error and changes NOTHING: the old trigger and permit stay; "2" typed as text is accepted', () => {
    ['x', 1.5, -2, ' '].forEach(bad => {
      const sc = scenario({ settings: PERMIT('old') });
      sc.p.triggers.push(NAMED('old'));
      assert.throws(() => sc.settingsSheet({ freq: bad, unit: 'days' }).setRefreshTrigger(), /Nieprawidłowa częstotliwość|Error/, String(bad));
      sc.save();
      assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['old'], String(bad));
      assert.strictEqual(permit(sc).issuedFor, 'old', String(bad));
    });
    const ok = scenario();
    ok.settingsSheet({ freq: '2', unit: 'days' }).setRefreshTrigger();
    assert.deepStrictEqual(triggers(ok.p).map(x => x.params), [{ everyDays: 2 }]);
  });

  const FAIL_CREATE = (n = 1) => `{ const n0 = ScriptApp.newTrigger; let left = ${n}; ScriptApp.newTrigger = fn => { const b = n0(fn); const c = b.create; b.create = () => { if (left-- > 0) throw new Error('quota'); return c(); }; return b; }; }`;

  test('schedule: the old trigger is removed BEFORE the new one is created (an add-on may hold one time trigger per document and user: creating first fails with "too many triggers")', () => {
    const sc = scenario({ settings: PERMIT('old') });
    sc.p.triggers.push(NAMED('old'));
    sc.ex.eval(`{ const n0 = ScriptApp.newTrigger; globalThis.__atCreate = null; ScriptApp.newTrigger = fn => { const b = n0(fn); const c = b.create; b.create = () => { __atCreate = ScriptApp.getProjectTriggers().map(t => t.getUniqueId()); return c(); }; return b; }; }`);
    sc.settingsSheet({ freq: 3, unit: 'hrs' }).setRefreshTrigger();
    assert.deepStrictEqual(plain(sc.ex.eval(`__atCreate`)), [], 'nothing of the old one was left when the new one was created');
  });

  test('schedule: the new trigger cannot be created (quota ...): the old one is put back from the permit (same interval, time of day and zone), the permit keeps its run record and names the restored trigger, the error goes on', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'old', issuedBy: 'me', lastRefresh: 1, lastRun: 5, lastSheets: ['R1'], intervalHours: 48, startAt: '17:30', timeZone: 'Europe/Warsaw' } } });
    sc.p.triggers.push(NAMED('old'));
    sc.ex.eval(FAIL_CREATE(1));
    assert.throws(() => sc.settingsSheet({ freq: 3, unit: 'hrs' }).setRefreshTrigger(), /quota/);
    assert.deepStrictEqual(triggers(sc.p).map(x => [x.id, x.params]), [['trig-1', { everyDays: 2, atHour: 17, nearMinute: 30, inTimezone: 'Europe/Warsaw' }]]);
    const kept = sc.stored().refreshPermit;
    assert.deepStrictEqual([kept.issuedFor, kept.lastRun, kept.lastSheets, kept.intervalHours, kept.off], ['trig-1', 5, ['R1'], 48, undefined]);
  });

  test('schedule: even the old trigger cannot be put back: the permit is marked off (what is shown is what is true) and the error goes on', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'old', issuedBy: 'me', lastRefresh: 1, intervalHours: 6 } } });
    sc.p.triggers.push(NAMED('old'));
    sc.ex.eval(FAIL_CREATE(2));
    assert.throws(() => sc.settingsSheet({ freq: 3, unit: 'hrs' }).setRefreshTrigger(), /quota/);
    assert.deepStrictEqual(triggers(sc.p), []);
    assert.strictEqual(sc.stored().refreshPermit.off, true);
    assert.deepStrictEqual(plain(sc.ex.eval(`ScheduleRefresh.current()`)), { active: false });
  });

  test('schedule: switching off marks the kept permit "off": current() says nothing is set, not "another user\'s trigger"', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'old', lastRefresh: Date.now(), lastRun: Date.now(), intervalHours: 24 } } });
    sc.p.triggers.push(NAMED('old'));
    sc.settingsSheet({ freq: '', unit: 'days' }).setRefreshTrigger();
    sc.save();
    assert.strictEqual(permit(sc).off, true);
    assert.strictEqual(permit(sc).issuedFor, 'old');
    assert.deepStrictEqual(plain(sc.ex.eval(`ScheduleRefresh.current()`)), { active: false });
  });

  test('schedule: current() - a permit issued by THIS user whose trigger is gone (deleted by hand) is not set; one issued by another user (other token) or by an old version (no token) and used lately is "foreign"', () => {
    const lately = Date.now();
    const base = { issuedFor: 'gone', lastRefresh: lately, lastRun: lately, intervalHours: 24 };
    const mine = scenario({ settings: { refreshPermit: Object.assign({ issuedBy: 'me' }, base) } });
    mine.p.props.user.refreshOwnerToken = 'me';
    assert.deepStrictEqual(plain(mine.ex.eval(`ScheduleRefresh.current()`)), { active: false });
    const other = scenario({ settings: { refreshPermit: Object.assign({ issuedBy: 'someone-else' }, base) } });
    other.p.props.user.refreshOwnerToken = 'me';
    assert.strictEqual(other.ex.eval(`ScheduleRefresh.current().foreign`), true);
    const legacy = scenario({ settings: { refreshPermit: base } });
    assert.strictEqual(legacy.ex.eval(`ScheduleRefresh.current().foreign`), true);
  });

  test('schedule: a set-up stores who issued the permit (a token kept in the user properties); a second set-up by the same user keeps the token', () => {
    const sc = scenario();
    sc.settingsSheet({ freq: 2, unit: 'days' }).setRefreshTrigger();
    sc.save();
    const token = sc.p.props.user.refreshOwnerToken;
    assert.ok(token);
    assert.strictEqual(permit(sc).issuedBy, token);
    sc.settingsSheet({ freq: 3, unit: 'days' }).setRefreshTrigger();
    assert.strictEqual(sc.p.props.user.refreshOwnerToken, token);
  });

  test('schedule: the refresh triggers of OTHER documents are no longer removed (bugs-fixed #5): only the one this document\'s permit names', () => {
    const sc = scenario({ settings: PERMIT('mine') });
    sc.p.triggers.push(Object.assign({}, OTHER, { source: 'another-document' }), NAMED('mine'), NAMED('theirs-legacy', 'autoRefresh'));
    sc.settingsSheet({ freq: 1, unit: 'hrs' }).setRefreshTrigger();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['other-doc-trigger', 'theirs-legacy', 'trig-1']);
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

  // ---- the two jobs of the time trigger, announced to the live check (Controller.intent) before the work --------------------------------
  const withIntents = sc => { sc.ex.ctx.liveCheckIntent = (n, d) => sc.log.push(['intent', n, d]); return sc; };
  test('jobs: a trigger with its own permit announces "refresh.scheduled" BEFORE it refreshes', () => {
    const sc = withIntents(scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6 } } }));
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    assert.deepStrictEqual(sc.calls()[0], ['intent', 'refresh.scheduled', { sheet: null, changeType: null }]);
    assert.deepStrictEqual(sc.calls()[1], ['refresh', 'K1']);
  });

  test('jobs: a trigger the permit does not name (or no permit) announces "refresh.retired" BEFORE it deletes itself, and refreshes nothing', () => {
    const other = withIntents(scenario({ settings: { refreshPermit: { issuedFor: 'trig-B', lastRefresh: 1, intervalHours: 6 } } }));
    other.p.triggers.push(NAMED('trig-A'), NAMED('trig-B'));
    other.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    assert.deepStrictEqual(other.calls(), [['intent', 'refresh.retired', { sheet: null, changeType: null }]]);
    const none = withIntents(scenario());
    none.p.triggers.push(NAMED('trig-A'));
    none.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    assert.deepStrictEqual(none.calls().map(c => c[1]), ['refresh.retired']);
    assert.deepStrictEqual(triggers(none.p), [], 'it is gone');
  });

  test('jobs: the legacy handler announces the same jobs - "refresh.scheduled" when it adopts a document without a permit or holds the permit, "refresh.retired" otherwise', () => {
    const adopt = withIntents(scenario());
    adopt.p.triggers.push(NAMED('old-legacy', 'autoRefresh'));
    adopt.ex.eval(`autoRefresh(${event('old-legacy')})`);
    assert.deepStrictEqual(adopt.calls().filter(c => c[0] === 'intent').map(c => c[1]), ['refresh.scheduled']);
    const late = withIntents(scenario({ settings: { refreshPermit: { issuedFor: 'trig-B', lastRefresh: 1, intervalHours: 6 } } }));
    late.p.triggers.push(NAMED('old-legacy', 'autoRefresh'), NAMED('trig-B'));
    late.ex.eval(`autoRefresh(${event('old-legacy')})`);
    assert.deepStrictEqual(late.calls().filter(c => c[0] === 'intent').map(c => c[1]), ['refresh.retired']);
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
  // ---- the status message after a scheduled refresh ---------------------------------------------------------------------------------------
  const MSG = `globalThis.__msgs = []; getMainSettings = (g => () => Object.assign(g(), { setRefreshMessage: r => { if (globalThis.__msgFails) throw new Error('no message'); __msgs.push(r); } }))(getMainSettings);`;
  const HOUR_MS = 3600000;

  test('trigger: after a scheduled refresh the status message is written again - green, the same frequency, "set" time of the set-up, the next refresh moved on by an interval', () => {
    const issued = Date.now() - 30 * HOUR_MS, planned = Date.now() - 60000;
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: issued, intervalHours: 24, nextRefresh: planned, startAt: '17:30' } } });
    sc.p.triggers.push(NAMED('trig-A'));
    sc.ex.eval(MSG);
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    sc.save();
    const m = plain(sc.ex.eval(`__msgs`));
    assert.strictEqual(m.length, 1);
    assert.deepStrictEqual([m[0].ok, m[0].frequency, Date.parse(m[0].when), Date.parse(m[0].next)], [true, { freq: 1, unit: 'days' }, issued, planned + 24 * HOUR_MS]);
    assert.strictEqual(permit(sc).nextRefresh, planned + 24 * HOUR_MS, 'the permit remembers it too (no drift by the time the run took)');
  });

  test('trigger: the next planned run after a run = the planned time moved on until it is more than half an interval after the start (a run does not count itself)', () => {
    const sc = scenario();
    const next = (permit, started) => sc.ex.eval(`ScheduleRefresh.nextAfterRun_(${JSON.stringify(permit)}, ${started})`);
    const t = 1_800_000_000_000;
    assert.strictEqual(next({ intervalHours: 1, nextRefresh: t }, t + 10 * 60000), t + HOUR_MS, 'hourly, 10 minutes late');
    assert.strictEqual(next({ intervalHours: 1, nextRefresh: t }, t - 5 * 60000), t + HOUR_MS, 'hourly, 5 minutes early');
    assert.strictEqual(next({ intervalHours: 24, nextRefresh: t }, t + 7 * 60000), t + 24 * HOUR_MS);
    assert.strictEqual(next({ intervalHours: 24, nextRefresh: t - 3 * 24 * HOUR_MS }, t), t + 24 * HOUR_MS, 'a stale plan is moved on');
    assert.strictEqual(next({ intervalHours: 6, lastRefresh: t }, t + 6 * HOUR_MS), t + 12 * HOUR_MS, 'no plan remembered: from the set-up time');
    assert.strictEqual(next({}, t), 0, 'no interval: unknown');
  });

  test('trigger: a refresh that fails writes no message; a message that cannot be written does not fail the run (the permit still records it)', () => {
    const failing = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6, nextRefresh: Date.now() } } });
    failing.ex.eval(MSG);
    failing.ex.eval(`RefreshAll.scheduled = () => { throw new Error('BC down'); }`);
    assert.throws(() => failing.ex.eval(`autoRefreshHandler(${event('trig-A')})`), /BC down/);
    assert.deepStrictEqual(plain(failing.ex.eval(`__msgs`)), []);
    const noMessage = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6, nextRefresh: Date.now() } } });
    noMessage.ex.eval(MSG);
    noMessage.ex.eval(`globalThis.__msgFails = true`);
    noMessage.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    noMessage.save();
    assert.strictEqual(typeof permit(noMessage).lastRun, 'number');
  });

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
  test('refresh loops: refreshAll() = every pair of the settings sheet in order, RefreshAll.ticked() = only the ticked ones, nothing ticked = nothing', () => {
    const a = scenario(); a.ex.eval(`refreshAll()`);
    assert.deepStrictEqual(a.calls(), [['refresh', 'K1'], ['refresh', 'K2'], ['refresh', 'K3']]);
    const b = scenario(); b.ex.eval(`RefreshAll.ticked()`);
    assert.deepStrictEqual(b.calls(), [['refresh', 'K1'], ['refresh', 'K3']]);
    const c = scenario({ sheetList: [{ configSheet: 'K2', resultSheet: 'R2', refresh: false }] }); c.ex.eval(`RefreshAll.ticked()`);
    assert.deepStrictEqual(c.calls(), []);
  });

  test('refresh loops: autoRefreshFunction() = the ticked ones, then the time is noted on the settings sheet', () => {
    const sc = scenario();
    sc.ex.eval(`autoRefreshFunction()`);
    assert.deepStrictEqual(sc.calls(), [['refresh', 'K1'], ['refresh', 'K3'], ['lastRefresh', true]]);
  });

  test('refresh loops: the first failing sheet stops the loop (later sheets are not refreshed)', () => {
    const sc = scenario({ refreshError: 'boom' });
    assert.throws(() => sc.ex.eval(`RefreshAll.ticked()`), /boom/);
    assert.deepStrictEqual(sc.calls(), [['refresh', 'K1']]);
  });


  // ---- start time and the message area (ScheduleRefresh.apply) -------------------------------------------------------------------------------
  test('schedule: a start time -> days: atHour + nearMinute; hours: nearMinute only', () => {
    const sc = scenario();
    sc.ex.eval(`ScheduleRefresh.setUp({ freq: 2, unit: 'days' }, { hour: 17, minute: 30 })`);
    sc.ex.eval(`ScheduleRefresh.setUp({ freq: 6, unit: 'hrs' }, { hour: 17, minute: 30 })`);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.params), [{ everyHours: 6, nearMinute: 30 }]);       // the second set-up replaced the first
    sc.ex.eval(`ScheduleRefresh.setUp({ freq: 2, unit: 'days' }, { hour: 17, minute: 30 })`);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.params), [{ everyDays: 2, atHour: 17, nearMinute: 30 }]);
  });

  test('schedule: the next refresh is an estimate: days -> the next HH:mm ahead (today or tomorrow); hours -> the next time the clock shows the asked minute, else now + interval', () => {
    const sc = scenario();
    const next = (now, unit, n, at) => sc.ex.eval(`ScheduleRefresh.nextRefresh(new Date(${now}), '${unit}', ${n}, ${JSON.stringify(at)}).getTime()`);
    const t = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).getTime();
    assert.strictEqual(next(t(2026, 10, 1, 10, 0), 'days', 1, { hour: 17, minute: 0 }), t(2026, 10, 1, 17, 0));
    assert.strictEqual(next(t(2026, 10, 1, 18, 0), 'days', 1, { hour: 17, minute: 0 }), t(2026, 10, 2, 17, 0));
    assert.strictEqual(next(t(2026, 10, 1, 10, 0), 'days', 3, null), t(2026, 10, 4, 10, 0));
    assert.strictEqual(next(t(2026, 10, 1, 10, 10), 'hrs', 2, null), t(2026, 10, 1, 12, 10));
    assert.strictEqual(next(t(2026, 10, 1, 10, 40), 'hrs', 2, { hour: 0, minute: 15 }), t(2026, 10, 1, 11, 15));
    assert.strictEqual(next(t(2026, 10, 2, 10, 38), 'hrs', 1, { hour: 10, minute: 45 }), t(2026, 10, 2, 10, 45), 'every hour at :45, set at 10:38 -> 10:45');
    assert.strictEqual(next(t(2026, 10, 2, 10, 50), 'hrs', 1, { hour: 10, minute: 45 }), t(2026, 10, 2, 11, 45));
  });

  test('schedule: a start time with a time zone -> inTimezone on the trigger; the next daily refresh is worked out in THAT zone', () => {
    const sc = scenario();
    // a fixed zone UTC+9 for the test
    sc.ex.eval(`Utilities.formatDate = (d, tz, p) => { const w = new Date(d.getTime() + 9 * 3600000).toISOString(); return p === 'Z' ? '+0900' : p === 'yyyy-MM-dd' ? w.slice(0, 10) : w.slice(0, 16).replace('T', ' ') }`);
    sc.ex.eval(`ScheduleRefresh.setUp({ freq: 1, unit: 'days' }, { hour: 17, minute: 30, timeZone: 'Asia/Tokyo' })`);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.params), [{ everyDays: 1, atHour: 17, nearMinute: 30, inTimezone: 'Asia/Tokyo' }]);
    const next = now => sc.ex.eval(`ScheduleRefresh.nextRefresh(new Date(${now}), 'days', 1, { hour: 17, minute: 30, timeZone: 'Asia/Tokyo' }).toISOString()`);
    assert.strictEqual(next(Date.UTC(2026, 10, 1, 3, 0)), '2026-11-01T08:30:00.000Z', '12:00 in Tokyo: 17:30 is still ahead today');
    assert.strictEqual(next(Date.UTC(2026, 10, 1, 9, 0)), '2026-11-02T08:30:00.000Z', '18:00 in Tokyo: tomorrow');
    assert.strictEqual(next(Date.UTC(2026, 10, 1, 20, 0)), '2026-11-02T08:30:00.000Z', '05:00 the next day in Tokyo: today there');
  });

  /** apply() on a settings object that records the message (the real one writes it through SettingsGrid) */
  function applyScenario(over, fail) {
    const sc = scenario(over);
    sc.ex.eval(`globalThis.__msgs = []; globalThis.__toasts = [];
      globalThis.__ss = { getRefreshFrequency: () => (${JSON.stringify(over && over.freq || { freq: 6, unit: "hrs" })}), getRefreshStartAt: () => null,
        setRefreshMessage: r => { if (${!!(fail && fail.message)}) throw new Error('no message'); __msgs.push(r); }, toastRefreshError: () => __toasts.push('toast') };`);
    return sc;
  }
  test('schedule: apply -> the trigger is set and the message reports success with the next refresh; no toast', () => {
    const sc = applyScenario();
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    const msgs = plain(sc.ex.eval(`__msgs`));
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].ok, true);
    assert.deepStrictEqual(msgs[0].frequency, { freq: 6, unit: 'hrs' });
    assert.ok(msgs[0].next);
    assert.deepStrictEqual(plain(sc.ex.eval(`__toasts`)), []);
  });

  test('schedule: apply -> no frequency: the trigger is removed and the message reports "off" (not a failure, no toast)', () => {
    const sc = applyScenario({ settings: PERMIT('old'), freq: { freq: '', unit: 'hrs' } });
    sc.p.triggers.push(NAMED('old'));
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.deepStrictEqual(triggers(sc.p), []);
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => [m.ok, m.off, m.next])`)), [[true, true, null]]);
    assert.deepStrictEqual(plain(sc.ex.eval(`__toasts`)), []);
  });

  test('schedule: apply -> setting the trigger fails: the message reports the failure, a toast tells too, the error goes on', () => {
    const sc = applyScenario({ freq: { freq: 3, unit: null } });
    sc.ex.eval(`__ss.getRefreshFrequency = () => null`);
    assert.throws(() => sc.ex.eval(`ScheduleRefresh.apply(__ss)`), /Cannot read properties of null/);
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => m.ok)`)), [false]);
    assert.deepStrictEqual(plain(sc.ex.eval(`__toasts`)), ['toast']);
  });

  test('schedule: current -> what is really set: a trigger the permit names + its interval (days when a whole number of days) + the next run rolled forward; no trigger / no permit -> not active', () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const cur = sc => plain(sc.ex.eval(`(() => { const c = ScheduleRefresh.current(new Date(${now})); return c && { active: c.active, frequency: c.frequency, next: c.next && c.next.getTime() }; })()`));
    let sc = scenario({ settings: { refreshPermit: { issuedFor: 't1', lastRefresh: now - 5 * 3600000, intervalHours: 24 } } });
    sc.p.triggers.push(NAMED('t1'));
    assert.deepStrictEqual(cur(sc), { active: true, frequency: { freq: 1, unit: 'days' }, next: now - 5 * 3600000 + 24 * 3600000 });
    sc = scenario({ settings: { refreshPermit: { issuedFor: 't1', lastRefresh: 0, lastRun: now - 7 * 3600000, intervalHours: 3 } } });
    sc.p.triggers.push(NAMED('t1'));
    assert.deepStrictEqual(cur(sc), { active: true, frequency: { freq: 3, unit: 'hrs' }, next: now - 7 * 3600000 + 9 * 3600000 });     // 3 h steps: +3, +6 passed, +9 ahead
    sc = scenario({ settings: { refreshPermit: { issuedFor: 't1', lastRefresh: 0, intervalHours: 3 } } });                                // the trigger is gone
    assert.deepStrictEqual(cur(sc), { active: false });
    assert.deepStrictEqual(cur(scenario()), { active: false });
  });

  test('schedule: the trigger list of a sidebar call is not reliable - an incomplete list on one look, or on all looks within two minutes of a sighting, does not make a trigger "gone"', () => {
    const now = Date.UTC(2026, 10, 2, 15, 0, 0);
    const mk = () => {
      const sc = scenario({ settings: { refreshPermit: { issuedFor: 't1', issuedBy: 'me', lastRefresh: now, intervalHours: 120 } } });
      sc.p.props.user.refreshOwnerToken = 'me';
      sc.p.triggers.push(NAMED('t1'), NAMED('x'));
      return sc;
    };
    const lists = (sc, seq) => sc.ex.eval(`{ const real = ScriptApp.getProjectTriggers; let i = 0; const seq = ${JSON.stringify(seq)}; globalThis.__calls = 0;
      ScriptApp.getProjectTriggers = () => { __calls++; const all = real(); const keep = seq[Math.min(i++, seq.length - 1)]; return keep === null ? all : all.filter(t => keep.includes(t.getUniqueId())); }; }`);
    const active = sc => sc.ex.eval(`ScheduleRefresh.current(new Date(${now})).active`);
    // one incomplete list, then a complete one: found on the second look
    let sc = mk(); lists(sc, [['x'], null]);
    assert.strictEqual(active(sc), true);
    assert.strictEqual(sc.ex.eval(`__calls`), 2);
    // complete lists keep the sighting; later every list lacks the trigger -> still there (seen a moment ago)
    sc = mk(); lists(sc, [null]); assert.strictEqual(active(sc), true);
    sc.ex.eval(`ScriptApp.getProjectTriggers = () => []`);
    assert.strictEqual(active(sc), true, 'seen within the last two minutes');
    // never seen, lists lack it: gone (the permit is this user\'s, so the trigger was deleted)
    sc = mk(); lists(sc, [['x']]); assert.strictEqual(active(sc), false);
    assert.strictEqual(sc.ex.eval(`__calls`), 3, 'three looks before giving up');
    // the sighting is forgotten when the add-on removes the trigger itself
    sc = mk(); lists(sc, [null]); active(sc);
    sc.ex.eval(`ScheduleRefresh.removeRefreshTrigger_('t1')`);
    sc.ex.eval(`ScriptApp.getProjectTriggers = () => []`);
    assert.strictEqual(active(sc), false);
  });

  test('schedule: replacing the old trigger finds it even when one look at the trigger list does not show it', () => {
    const sc = scenario({ settings: PERMIT('old') });
    sc.p.triggers.push(NAMED('old'));
    sc.ex.eval(`{ const real = ScriptApp.getProjectTriggers; let i = 0; ScriptApp.getProjectTriggers = () => (i++ == 0 ? [] : real()); }`);
    sc.settingsSheet({ freq: 2, unit: 'days' }).setRefreshTrigger();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['trig-1']);
  });

  test('schedule: apply -> a failure reports the state that is really there (current)', () => {
    const sc = applyScenario({ settings: PERMIT('old') });
    sc.ex.eval(`__ss.getRefreshFrequency = () => null`);
    assert.throws(() => sc.ex.eval(`ScheduleRefresh.apply(__ss)`));
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs[0].current`)), { active: false });
  });

  test('schedule: apply -> the message cannot be written: a toast is the only report; a toast that fails too is swallowed', () => {
    const sc = applyScenario(null, { message: true });
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.deepStrictEqual(plain(sc.ex.eval(`__toasts`)), ['toast']);
    sc.ex.eval(`__ss.toastRefreshError = () => { throw new Error('no toast') }`);
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
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
    assert.ok(/setRefreshTrigger\(\)\{\s*ScheduleRefresh\.apply\(this\);\s*\}/.test(ss));
    assert.ok(/function autoRefreshFunction\(e\)\{\s*RefreshAll\.scheduled\(\);\s*\}/.test(ss));
    assert.ok(/function autoRefreshContent\(e\) \{\s*ScheduleRefresh\.run\(e\);\s*\}/.test(ss));
    assert.ok(/function autoRefreshContentOld\(e\) \{\s*ScheduleRefresh\.runLegacy\(e\);\s*\}/.test(ss));
    assert.ok(!/refreshAllTrue/.test(menu));
    assert.ok(/Controller\.run\("menuRefreshAll",\(\) => RefreshAll\.all\(\)\)/.test(menu));
    assert.ok(!/ScriptApp\.newTrigger\('autoRefreshHandler'\)/.test(ss));
  });

  test('rule: the new files load alone, in any order (nothing is used at load time)', () => {
    const vm = require('vm');
    ['RefreshAll.js', 'Refresh Registry.js', 'ScheduleRefresh.js'].forEach(f => vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), {}));
  });
};
