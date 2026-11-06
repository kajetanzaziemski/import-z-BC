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
const USE_CASE_FILES = ['Import Query.js', 'BulkSheet.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js', 'RefreshAll.js', 'Refresh Registry.js', 'Refresh Log.js', 'Refresh Log Grid.js', 'Auto Refresh Panel.js', 'ScheduleRefresh.js', 'Grid.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

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
    ex.eval(`globalThis.__logged = []; RefreshLogGrid.append = (name, e) => __logged.push(Object.assign({ name }, e));`);
    ex.eval(`globalThis.__noted = 0; { const g = getMainSettings; getMainSettings = () => Object.assign(g(), { markLastRefreshAttemptFailed: () => { if (__cfgNoteFails) throw new Error('note failed'); __noted++; } }); }; globalThis.__cfgNoteFails = false;`);
    const stored = () => JSON.parse(p.props.document.importSettingsArray);
    return { p, ex, log, cfg, calls: () => plain(log), stored,
      save: () => ex.eval(`getImportSettings().saveArray()`),
      /** the settings sheet object with a given refresh frequency, without reading any sheet */
      settingsSheet: freq => ex.eval(`(() => { const s = Object.create(SettingsSheet.prototype); s.reloadRefreshSettings = () => {}; s.sheet = { getParent: () => ({}) }; s.settings = []; s.refreshFrequency = ${JSON.stringify(freq)}; return s; })()`) };
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

  test('trigger: a trigger the permit names but marks OFF (the refresh was switched off) does not refresh - it deletes itself (both handlers)', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6, off: true } } });
    sc.p.triggers.push(NAMED('trig-A'));
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    assert.deepStrictEqual(sc.calls(), []);
    assert.deepStrictEqual(triggers(sc.p), []);
    const legacy = scenario({ settings: { refreshPermit: { issuedFor: 'trig-L', lastRefresh: 1, intervalHours: 6, off: true } } });
    legacy.p.triggers.push(NAMED('trig-L', 'autoRefresh'));
    legacy.ex.eval(`autoRefresh(${event('trig-L')})`);
    assert.deepStrictEqual(legacy.calls(), []);
    assert.deepStrictEqual(triggers(legacy.p), []);
  });

  // ---- many edits at once: only the newest sets up, and makes sure ------------------------------------------------------------------------------------
  /** A settings object for apply(): what it reads when it starts (freq, startAt) and what the sheet says when it is read again under the lock (fresh) */
  function applySettings(sc, first, fresh, hooks) {
    sc.ex.eval(`globalThis.__reads = 0; globalThis.__msgs = []; globalThis.__notes = []; Controller.checkNote = n => __notes.push(n);
      globalThis.__st = { freq: ${JSON.stringify(first)}, at: null, fresh: ${JSON.stringify(fresh || null)} };
      globalThis.__ss = { getRefreshFrequency: () => __st.freq, getRefreshStartAt: () => __st.at,
        reloadRefreshSettings: () => { __reads++; if (__st.fresh) __st.freq = __st.fresh; ${hooks && hooks.onReload || ''} },
        setRefreshMessage: r => __msgs.push(r), toastRefreshError() {} };`);
  }

  test('set-up: runs under the newest-only lock "refreshSetup" and re-reads the sheet under the lock - what the sheet says NOW is set up, not what this run read when it started', () => {
    const sc = scenario();
    applySettings(sc, { freq: 2, unit: 'hrs' }, { freq: 6, unit: 'hrs' });
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.strictEqual(sc.ex.eval(`__reads`), 1);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.params), [{ everyHours: 6 }]);
    assert.ok(sc.p.props.document.refreshSetup, 'the ticket of the newest run is in the document properties');
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => [m.ok, m.frequency.freq])`)), [[true, 6]]);
  });

  test('set-up: an older run that finds a newer one when it has the lock drops out - nothing changed, no message, a note for the live check', () => {
    const sc = scenario({ settings: PERMIT('old') });
    sc.p.triggers.push(NAMED('old'));
    applySettings(sc, { freq: 2, unit: 'hrs' }, null, { onReload: `Store.set('document', 'refreshSetup', 'a-newer-run');` });      // a newer edit starts while this one reads
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['old'], 'the trigger that was there is untouched');
    sc.save();
    assert.strictEqual(permit(sc).issuedFor, 'old');
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs`)), []);
    assert.deepStrictEqual(plain(sc.ex.eval(`__notes`)), ['refresh set-up dropped: a newer edit took over']);
  });

  test('set-up: a run that cannot get the lock in time reports a failure (red message, error) - nobody else will set up for it', () => {
    const sc = scenario();
    sc.p.lockHeld = true;
    applySettings(sc, { freq: 2, unit: 'hrs' });
    assert.throws(() => sc.ex.eval(`ScheduleRefresh.apply(__ss)`), /poprzednia zmiana ustawień trwa zbyt długo/);
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => m.ok)`)), [false]);
    assert.deepStrictEqual(triggers(sc.p), []);
  });

  const DOC_REC = (over) => JSON.stringify(Object.assign({ docId: 'ss-1', docName: 'Faktury', intervalHours: 6, setAt: 1 }, over));

  test('set-up: the newest run leaves ONE time trigger for this document - the triggers the records say are this document\'s (left by earlier runs) are deleted with their records; other documents\' and unknown triggers stay', () => {
    const sc = scenario({ settings: PERMIT('t-old') });
    ['t-old', 't-orphan1', 't-orphan2', 't-otherdoc', 't-unknown'].forEach(id => sc.p.triggers.push(NAMED(id)));
    sc.p.props.user['refreshTrigger:t-old'] = DOC_REC();
    sc.p.props.user['refreshTrigger:t-orphan1'] = DOC_REC();
    sc.p.props.user['refreshTrigger:t-orphan2'] = DOC_REC({ setAt: 2 });
    sc.p.props.user['refreshTrigger:t-otherdoc'] = DOC_REC({ docId: 'doc-B' });
    applySettings(sc, { freq: 6, unit: 'hrs' });
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    sc.save();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id).sort(), ['t-otherdoc', 't-unknown', 'trig-1']);
    assert.deepStrictEqual(Object.keys(sc.p.props.user).filter(k => k.startsWith('refreshTrigger:')).sort(), ['refreshTrigger:t-otherdoc', 'refreshTrigger:trig-1']);
    assert.strictEqual(permit(sc).issuedFor, 'trig-1');
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => m.ok)`)), [true]);
  });

  test('set-up error: a failed set-up keeps the platform\'s error (message and stack, cut to 1200 characters), when, whether it was the trigger limit, and what was set at that moment; the next set-up that goes right clears it', () => {
    const sc = scenario({ settings: { refreshPermit: Object.assign({}, PERMIT('t1').refreshPermit, { nextRefresh: Date.now() + 3600000 }) } });
    sc.p.triggers.push(NAMED('t1'));
    applySettings(sc, { freq: 'x', unit: 'days' });
    assert.throws(() => sc.ex.eval(`ScheduleRefresh.apply(__ss)`), /Nieprawidłowa częstotliwość/);
    sc.save();
    const e = sc.stored().refreshSetupError;
    assert.ok(/Nieprawidłowa częstotliwość odświeżania: "x"/.test(e.details) && e.details.length <= 1200);
    assert.deepStrictEqual([typeof e.at, e.limit, e.current.active, e.current.frequency], ['number', false, true, { freq: 3, unit: 'hrs' }]);
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => m.ok)`)), [false]);
    // the next set-up goes right
    applySettings(sc, { freq: 2, unit: 'hrs' });
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    sc.save();
    assert.strictEqual(sc.stored().refreshSetupError, null);
  });

  test('set-up error: a long error is cut; a run that drops out for a newer edit neither records nor clears; the lock timeout is recorded', () => {
    const sc = scenario();
    applySettings(sc, { freq: 2, unit: 'hrs' });
    sc.ex.eval(`ScheduleRefresh.recordSetupError_(new Error('x'.repeat(5000)), null, false)`);
    sc.save();
    assert.strictEqual(sc.stored().refreshSetupError.details.length, 1200);
    const keep = scenario({ settings: { refreshSetupError: { at: 1, details: 'older', limit: false, current: null } } });
    applySettings(keep, { freq: 2, unit: 'hrs' }, null, { onReload: `Store.set('document', 'refreshSetup', 'a-newer-run');` });
    keep.ex.eval(`ScheduleRefresh.apply(__ss)`);
    keep.save();
    assert.strictEqual(keep.stored().refreshSetupError.details, 'older', 'the dropped run leaves the error as it was');
    const locked = scenario(); locked.p.lockHeld = true;
    applySettings(locked, { freq: 2, unit: 'hrs' });
    assert.throws(() => locked.ex.eval(`ScheduleRefresh.apply(__ss)`), /trwa zbyt długo/);
    locked.save();
    assert.ok(/trwa zbyt długo/.test(locked.stored().refreshSetupError.details));
  });

  test('set-up error: the limit of clock triggers is told by the platform\'s message (Polish or English) - or by a trigger-related error while the user already has 5 clock triggers; other errors are not the limit', () => {
    const sc = scenario();
    const lim = (msg, n = 0) => { sc.p.triggers.length = 0; for (let i = 0; i < n; i++) sc.p.triggers.push(NAMED('t' + i)); return sc.ex.eval(`ScheduleRefresh.isTriggerLimit_(new Error(${JSON.stringify(msg)}))`); };
    assert.strictEqual(lim('Ten dodatek utworzył zbyt wiele wyzwalaczy o nazwie time-based w tym dokumencie dla tego konta użytkownika Google.'), true);
    assert.strictEqual(lim('This add-on has created too many triggers named time-based in this document for this Google user account.'), true);
    assert.strictEqual(lim('Service invoked too many times in a short time'), false);
    assert.strictEqual(lim('Nie można utworzyć wyzwalacza', 5), true);
    assert.strictEqual(lim('Nie można utworzyć wyzwalacza', 2), false);
    assert.strictEqual(lim('TypeError: Cannot read properties of null', 6), false);
  });

  test('set-up error: the limit of triggers is in the red message of the sheet and in what is kept for the sidebar', () => {
    const sc = scenario();
    applySettings(sc, { freq: 3, unit: 'hrs' });
    sc.ex.eval(`{ const n0 = ScriptApp.newTrigger; ScriptApp.newTrigger = fn => { const b = n0(fn); b.create = () => { throw new Error('Ten dodatek utworzył zbyt wiele wyzwalaczy o nazwie time-based'); }; return b; }; }`);
    assert.throws(() => sc.ex.eval(`ScheduleRefresh.apply(__ss)`), /zbyt wiele wyzwalaczy/);
    sc.save();
    assert.strictEqual(sc.stored().refreshSetupError.limit, true);
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => [m.ok, m.limit])`)), [[false, true]]);
  });

  // ---- the limit of 5 clock triggers per user --------------------------------------------------------------------------------------------------
  const clockIds = (sc, n, prefix = 'c') => { for (let i = 0; i < n; i++) sc.p.triggers.push(NAMED(prefix + i)); };

  test('limit: with 5 other clock triggers (any document) a set-up is REFUSED before anything is removed - the old trigger and the permit stay, the error is the limit, the message is red, the error is kept for the sidebar', () => {
    const sc = scenario({ settings: PERMIT('t-old') });
    sc.p.triggers.push(NAMED('t-old'));
    clockIds(sc, 5);
    sc.p.triggers.push({ id: 'agent', fn: 'sheetEdit', type: 'ON_EDIT', source: 'ss-1', params: {} });      // an agent is no clock trigger
    applySettings(sc, { freq: 4, unit: 'hrs' });
    assert.throws(() => sc.ex.eval(`ScheduleRefresh.apply(__ss)`), /Nie utworzono triggera: masz już 5 wyzwalaczy czasowych/);
    sc.save();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id).sort(), ['agent', 'c0', 'c1', 'c2', 'c3', 'c4', 't-old'], 'nothing removed, nothing created');
    assert.strictEqual(permit(sc).issuedFor, 't-old');
    assert.strictEqual(sc.stored().refreshSetupError.limit, true);
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => [m.ok, m.limit])`)), [[false, true]]);
    assert.ok(/c0, c1, c2, c3, c4/.test(sc.stored().refreshSetupError.details), 'the details name the triggers that fill the limit');
  });

  test('limit: the trigger the set-up replaces does not count - 4 others + the old one is fine (5 afterwards); with no old trigger 4 others is fine too, 5 is not', () => {
    const replace = scenario({ settings: PERMIT('t-old') });
    replace.p.triggers.push(NAMED('t-old')); clockIds(replace, 4);
    applySettings(replace, { freq: 4, unit: 'hrs' });
    replace.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.strictEqual(triggers(replace.p).filter(x => x.type === 'CLOCK').length, 5);
    const fresh4 = scenario(); clockIds(fresh4, 4);
    applySettings(fresh4, { freq: 4, unit: 'hrs' });
    fresh4.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.strictEqual(triggers(fresh4.p).filter(x => x.type === 'CLOCK').length, 5);
    const fresh5 = scenario(); clockIds(fresh5, 5);
    applySettings(fresh5, { freq: 4, unit: 'hrs' });
    assert.throws(() => fresh5.ex.eval(`ScheduleRefresh.apply(__ss)`), /limit Apps Script: 5/);
  });

  test('limit: changing THIS document\'s trigger at exactly 5 clock triggers is allowed - the old one is removed, the new one installed, 5 again; also when the list does not show the old one (its record and the permit name it)', () => {
    const now = Date.now();
    const shown = scenario({ settings: PERMIT('t-old') });
    shown.p.triggers.push(NAMED('t-old')); clockIds(shown, 4);                                   // 5 in all, one of them this document's
    shown.p.props.user['refreshTrigger:t-old'] = DOC_REC({ seenAt: now - 1000 });
    applySettings(shown, { freq: 4, unit: 'hrs' });
    shown.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.deepStrictEqual(triggers(shown.p).map(x => x.id).sort(), ['c0', 'c1', 'c2', 'c3', 'trig-1'], 'the old one is gone, the new one is there: 5');

    const hidden = scenario({ settings: PERMIT('t-old') });                                         // the old trigger is not in the list at all, but its record is recent
    clockIds(hidden, 4);
    hidden.p.props.user['refreshTrigger:t-old'] = DOC_REC({ seenAt: now - 1000 });
    applySettings(hidden, { freq: 4, unit: 'hrs' });
    hidden.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.strictEqual(triggers(hidden.p).filter(x => x.id === 'trig-1').length, 1);

    const other = scenario({ settings: PERMIT('t-old') });                                          // 5 in all but NONE of them this document's: a new one is too many
    other.p.triggers.push(NAMED('t-old')); clockIds(other, 4);
    other.ex.eval(`MainSettings.setRefreshPermit('t-not-there', 4)`);
    applySettings(other, { freq: 4, unit: 'hrs' });
    assert.throws(() => other.ex.eval(`ScheduleRefresh.apply(__ss)`), /masz już 5 wyzwalaczy/);
  });

  test('limit: triggers the list does not show still count when the user\'s records saw or made them in the last ten minutes; older records do not', () => {
    const now = Date.now();
    const sc = scenario();
    clockIds(sc, 3);
    sc.p.props.user['refreshTrigger:hidden1'] = JSON.stringify({ docId: 'doc-B', seenAt: now - 60000 });
    sc.p.props.user['refreshTrigger:hidden2'] = JSON.stringify({ docId: 'doc-C', setAt: now - 5 * 60000 });
    sc.p.props.user['refreshTrigger:stale'] = JSON.stringify({ docId: 'doc-D', seenAt: now - 2 * 3600000, setAt: now - 5 * 3600000 });
    assert.deepStrictEqual(plain(sc.ex.eval(`ScheduleRefresh.clockTriggerIds_().sort()`)), ['c0', 'c1', 'c2', 'hidden1', 'hidden2']);
    applySettings(sc, { freq: 4, unit: 'hrs' });
    assert.throws(() => sc.ex.eval(`ScheduleRefresh.apply(__ss)`), /hidden1, hidden2/, 'the two hidden ones make 5: refused');
    sc.p.props.user['refreshTrigger:hidden2'] = JSON.stringify({ docId: 'doc-C', setAt: now - 30 * 60000 });          // it is a long time since it was seen
    applySettings(sc, { freq: 4, unit: 'hrs' });
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.strictEqual(triggers(sc.p).filter(x => x.id === 'trig-1').length, 1, 'with 4 counted there is room');
  });

  test('limit: the leftovers of THIS document (its records, not the permit\'s) are removed before the count - they would take places of the limit for nothing', () => {
    const sc = scenario({ settings: PERMIT('t-old') });
    sc.p.triggers.push(NAMED('t-old')); clockIds(sc, 3);
    ['o1', 'o2'].forEach(id => { sc.p.triggers.push(NAMED(id)); sc.p.props.user['refreshTrigger:' + id] = DOC_REC(); });
    applySettings(sc, { freq: 4, unit: 'hrs' });
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id).sort(), ['c0', 'c1', 'c2', 'trig-1']);
  });

  test('limit: every way to a new trigger passes the check - createTrigger_ (also the restoring of an old trigger) refuses at the limit; the error says it is the limit', () => {
    const sc = scenario(); clockIds(sc, 5);
    const err = plain(sc.ex.eval(`(() => { try { ScheduleRefresh.createTrigger_('days', 1, null); } catch (e) { return { limit: e.triggerLimit, limitByRule: ScheduleRefresh.isTriggerLimit_(e), message: e.message }; } return null; })()`));
    assert.deepStrictEqual([err.limit, err.limitByRule], [true, true]);
    assert.strictEqual(triggers(sc.p).length, 5, 'nothing created');
    // restoring: the old trigger cannot be put back when the places are taken - the permit is marked off, as for any failed restore
    const restore = scenario({ settings: { refreshPermit: { issuedFor: 'gone', issuedBy: 'me', lastRefresh: 1, intervalHours: 24 } } }); clockIds(restore, 5);
    restore.ex.eval(`ScheduleRefresh.restoreAfterFailure_(MainSettings.getRefreshPermit())`);
    restore.save();
    assert.strictEqual(restore.stored().refreshPermit.off, true);
  });

  test('set-up: with the refresh switched off none of this document\'s refresh triggers is left (the permit is marked off)', () => {
    const sc = scenario({ settings: PERMIT('t-old') });
    ['t-old', 't-orphan', 't-otherdoc'].forEach(id => sc.p.triggers.push(NAMED(id)));
    sc.p.props.user['refreshTrigger:t-old'] = DOC_REC();
    sc.p.props.user['refreshTrigger:t-orphan'] = DOC_REC();
    sc.p.props.user['refreshTrigger:t-otherdoc'] = DOC_REC({ docId: 'doc-B' });
    applySettings(sc, { freq: '', unit: 'hrs' });
    sc.ex.eval(`ScheduleRefresh.apply(__ss)`);
    sc.save();
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['t-otherdoc']);
    assert.strictEqual(permit(sc).off, true);
    assert.deepStrictEqual(plain(sc.ex.eval(`__msgs.map(m => [m.ok, m.off])`)), [[true, true]]);
  });

  test('set-up: the result is checked - a trigger that vanished right after it was made is made again (once); a set-up that cannot be made right is an error with the reasons, and a red message', () => {
    const flaky = scenario();
    applySettings(flaky, { freq: 3, unit: 'hrs' });
    flaky.ex.eval(`{ const real = ScheduleRefresh.setUp; let n = 0; ScheduleRefresh.setUp = function (...a) { const r = real.apply(this, a); if (++n == 1) ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t)); return r; }; }`);
    flaky.ex.eval(`ScheduleRefresh.apply(__ss)`);
    flaky.save();
    assert.deepStrictEqual(triggers(flaky.p).map(x => x.params), [{ everyHours: 3 }], 'one trigger in the end');
    assert.strictEqual(permit(flaky).issuedFor, triggers(flaky.p)[0].id);
    assert.deepStrictEqual(plain(flaky.ex.eval(`__msgs.map(m => m.ok)`)), [true]);

    const broken = scenario();
    applySettings(broken, { freq: 3, unit: 'hrs' });
    broken.ex.eval(`{ const real = ScheduleRefresh.setUp; ScheduleRefresh.setUp = function (...a) { const r = real.apply(this, a); ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t)); return r; }; }`);
    assert.throws(() => broken.ex.eval(`ScheduleRefresh.apply(__ss)`), /nie zostało ustawione poprawnie \(brak triggera czasowego\)/);
    assert.deepStrictEqual(plain(broken.ex.eval(`__msgs.map(m => m.ok)`)), [false]);
  });

  test('set-up: the permit must match the settings (interval, time of day) - checked by wanted_ / reconcile_; a record is written at once after the trigger is made', () => {
    const sc = scenario();
    const w = (f, at) => plain(sc.ex.eval(`ScheduleRefresh.wanted_(${JSON.stringify(f)}, ${JSON.stringify(at)})`));
    assert.deepStrictEqual(w({ freq: 2, unit: 'days' }, { hour: 9, minute: 5 }), { hours: 48, startAt: '9:05' });
    assert.deepStrictEqual(w({ freq: '3', unit: 'hrs' }, null), { hours: 3, startAt: null });
    assert.strictEqual(w({ freq: '', unit: 'hrs' }, null), null);
    assert.strictEqual(w({ freq: 3, unit: null }, null), null);
    const text = fs.readFileSync(path.join(ROOT, 'ScheduleRefresh.js'), 'utf8');
    assert.ok(/newTrigger = ScheduleRefresh\.createTrigger_[\s\S]*?ScheduleRefresh\.register_\(newTrigger\.getUniqueId\(\)[\s\S]*?MainSettings\.setRefreshPermit\(newTrigger/.test(text), 'the record before the permit');
    sc.settingsSheet({ freq: 3, unit: 'hrs' }).setRefreshTrigger();
    assert.ok(sc.p.props.user['refreshTrigger:trig-1'], 'the record of the trigger');
  });

  // ---- the spreadsheet's time zone changes (onOpen) -------------------------------------------------------------------------------------------
  const ZONES = `{ const off = { 'Europe/Warsaw': 60, 'UTC': 0, 'Asia/Tokyo': 540 };
    Utilities.formatDate = (d, tz, p) => { const m = off[tz]; const w = new Date(d.getTime() + m * 60000).toISOString();
      return p === 'Z' ? (m < 0 ? '-' : '+') + String(Math.floor(Math.abs(m) / 60)).padStart(2, '0') + String(Math.abs(m) % 60).padStart(2, '0') : p === 'yyyy-MM-dd' ? w.slice(0, 10) : p === 'HH:mm' ? w.slice(11, 16) : w.slice(0, 19).replace('T', ' '); }; }`;

  test('time zone: a time of day is converted so that it stays the same moment (17:30 in Warsaw = 16:30 in UTC = 02:30 the next day in Tokyo)', () => {
    const sc = scenario(); sc.ex.eval(ZONES);
    const conv = (at, from, to) => plain(sc.ex.eval(`ScheduleRefresh.convertTimeOfDay(${JSON.stringify(at)}, '${from}', '${to}', new Date(Date.UTC(2026, 10, 2, 10, 0)))`));
    assert.deepStrictEqual(conv({ hour: 17, minute: 30 }, 'Europe/Warsaw', 'UTC'), { hour: 16, minute: 30 });
    assert.deepStrictEqual(conv({ hour: 17, minute: 30 }, 'Europe/Warsaw', 'Asia/Tokyo'), { hour: 1, minute: 30 });
    assert.deepStrictEqual(conv({ hour: 0, minute: 15 }, 'Asia/Tokyo', 'UTC'), { hour: 15, minute: 15 });
    assert.deepStrictEqual(conv({ hour: 9, minute: 0 }, 'UTC', 'UTC'), { hour: 9, minute: 0 });
  });

  /** The settings object of the time zone tests: the sheet exists; adoptTimeZone gets the plan and is told what the SHEET says (cfg: the info the grid would give, and the answer) */
  function tzScenario(over, sheetSays) {
    const sc = scenario(Object.assign({ settings: {} }, over));
    sc.ex.eval(ZONES);
    sc.ex.eval(`globalThis.__tz = 'UTC'; globalThis.__sheet = true; globalThis.__adopt = []; globalThis.__says = ${JSON.stringify(sheetSays || { changed: false })};
      activeSpreadsheetTimeZone = () => __tz; settingsSheetExists = () => __sheet;
      getMainSettings = () => ({ adoptTimeZone: plan => { globalThis.__serviceOnlyDuring = gridServiceOnly_; const s = __says; if (!s.changed) { __adopt.push(['unchanged']); return { changed: false }; }
          const convert = plan(s.info); const from = { hour: 17, minute: 30 }; const to = convert ? convert(from) : null; __adopt.push([!!convert, to]);
          return { changed: true, zoneChanged: s.info.zoneChanged, from, to }; },
        setRefreshMessage: r => __adopt.push(['message', r.ok]), getSheetListWithRefreshTrue: () => [] });`);
    return sc;
  }
  const PERMIT_WARSAW = { issuedFor: 't1', lastRefresh: Date.now(), intervalHours: 24, nextRefresh: Date.now() + 3600000, startAt: '17:30', timeZone: 'Europe/Warsaw' };

  test('time zone: the sheet says the zone changed - the time of day is converted by the remembered zone (exact); the permit and the user record follow, the status message is written again, the zone is remembered; the trigger is left alone', () => {
    const sc = tzScenario({ settings: { timeZone: 'Europe/Warsaw', refreshPermit: PERMIT_WARSAW } }, { changed: true, info: { zoneChanged: true, lastKnown: true, fromOffset: 60, toOffset: 0 } });
    sc.p.triggers.push(NAMED('t1'));
    assert.strictEqual(sc.ex.eval(`ScheduleRefresh.syncTimeZone()`), true);
    sc.save();
    assert.deepStrictEqual(plain(sc.ex.eval(`__adopt`)), [[true, { hour: 16, minute: 30 }], ['message', true]]);
    assert.deepStrictEqual([permit(sc).startAt, permit(sc).timeZone, sc.stored().timeZone], ['16:30', 'UTC', 'UTC']);
    assert.deepStrictEqual(triggers(sc.p).map(x => x.id), ['t1'], 'the trigger keeps its own zone and fires at the same moment');
    const rec = JSON.parse(sc.p.props.user['refreshTrigger:t1'] || '{}');
    assert.deepStrictEqual([rec.startAt, rec.timeZone, rec.docTz], ['16:30', 'UTC', 'UTC']);
  });

  test('time zone: the sheet is read and written through the Spreadsheet service only (onOpen may run where the Sheets advanced service cannot be called), and only for the time of the check', () => {
    const sc = tzScenario({ settings: { timeZone: 'Europe/Warsaw', refreshPermit: PERMIT_WARSAW } }, { changed: true, info: { zoneChanged: true, lastKnown: true, fromOffset: 60, toOffset: 0 } });
    assert.strictEqual(sc.ex.eval(`gridServiceOnly_`), false);
    sc.ex.eval(`ScheduleRefresh.syncTimeZone()`);
    assert.strictEqual(sc.ex.eval(`__serviceOnlyDuring`), true);
    assert.strictEqual(sc.ex.eval(`gridServiceOnly_`), false, 'restored, also when the check fails');
    const failing = tzScenario({ settings: { timeZone: 'Europe/Warsaw' } }, { changed: true, info: { zoneChanged: true, lastKnown: true, fromOffset: 60, toOffset: 0 } });
    failing.ex.eval(`getMainSettings = () => ({ adoptTimeZone: () => { throw new Error('Sheets API not available'); } })`);
    assert.doesNotThrow(() => failing.ex.eval(`ScheduleRefresh.syncTimeZone()`));
    assert.strictEqual(failing.ex.eval(`gridServiceOnly_`), false);
    assert.ok(failing.p.consoleErrors.some(m => /Time zone of the spreadsheet not synchronised/.test(m) && /Sheets API not available/.test(m)), 'a failure is not silent: ' + failing.p.consoleErrors.join('|'));
  });

  test('time zone: the sheet is the judge - no zone remembered anywhere: the offset in the label gives the conversion (UTC+1 -> UTC+0 is an hour back; across midnight too)', () => {
    const sc = tzScenario({}, { changed: true, info: { zoneChanged: true, lastKnown: true, fromOffset: 60, toOffset: 0 } });
    sc.ex.eval(`ScheduleRefresh.syncTimeZone()`);
    assert.deepStrictEqual(plain(sc.ex.eval(`__adopt[0]`)), [true, { hour: 16, minute: 30 }]);
    const wrap = tzScenario({}, { changed: true, info: { zoneChanged: true, lastKnown: true, fromOffset: 60, toOffset: 540 } });
    wrap.ex.eval(`ScheduleRefresh.syncTimeZone()`);
    assert.deepStrictEqual(plain(wrap.ex.eval(`__adopt[0]`)), [true, { hour: 1, minute: 30 }]);
    const none = tzScenario({}, { changed: true, info: { zoneChanged: true, lastKnown: true, fromOffset: null, toOffset: 0 } });
    none.ex.eval(`ScheduleRefresh.syncTimeZone()`);
    assert.deepStrictEqual(plain(none.ex.eval(`__adopt[0]`)), [false, null], 'an unreadable label: no conversion');
  });

  test('time zone: only the refreshTime label differs (the daylight saving time) - relabelled, the time of day is NOT converted, the permit and the message are left alone, whatever the properties remember', () => {
    const sc = tzScenario({ settings: { timeZone: 'Europe/Warsaw', refreshPermit: PERMIT_WARSAW } }, { changed: true, info: { zoneChanged: false, lastKnown: true, fromOffset: 60, toOffset: 120 } });
    assert.strictEqual(sc.ex.eval(`ScheduleRefresh.syncTimeZone()`), true);
    sc.save();
    assert.deepStrictEqual(plain(sc.ex.eval(`__adopt`)), [[false, null]]);
    assert.strictEqual(permit(sc).startAt, '17:30');
  });

  test('time zone: no last refresh in the sheet to tell by - the remembered zone decides (differs: converted; same or none: left)', () => {
    const differs = tzScenario({ settings: { timeZone: 'Europe/Warsaw' } }, { changed: true, info: { zoneChanged: false, lastKnown: false, fromOffset: 60, toOffset: 0 } });
    differs.ex.eval(`ScheduleRefresh.syncTimeZone()`);
    assert.deepStrictEqual(plain(differs.ex.eval(`__adopt[0]`)), [true, { hour: 16, minute: 30 }]);
    const same = tzScenario({ settings: { timeZone: 'UTC' } }, { changed: true, info: { zoneChanged: false, lastKnown: false, fromOffset: 0, toOffset: 0 } });
    same.ex.eval(`ScheduleRefresh.syncTimeZone()`);
    assert.deepStrictEqual(plain(same.ex.eval(`__adopt[0]`)), [false, null]);
  });

  test('time zone: the sheet already reads the right zone - nothing is written, even when the properties are out of date (they are brought up to date); no settings sheet - nothing is built', () => {
    const sc = tzScenario({ settings: { timeZone: 'Europe/Warsaw', refreshPermit: PERMIT_WARSAW } }, { changed: false });
    assert.strictEqual(sc.ex.eval(`ScheduleRefresh.syncTimeZone()`), false);
    sc.save();
    assert.deepStrictEqual(plain(sc.ex.eval(`__adopt`)), [['unchanged']]);
    assert.deepStrictEqual([sc.stored().timeZone, permit(sc).startAt], ['UTC', '17:30'], 'the saved zone follows; the permit is not touched');
    const none = tzScenario({ settings: { timeZone: 'Europe/Warsaw' } }, { changed: false });
    none.ex.eval(`__sheet = false`);
    assert.strictEqual(none.ex.eval(`ScheduleRefresh.syncTimeZone()`), false);
    assert.deepStrictEqual(plain(none.ex.eval(`__adopt`)), []);
  });

  test('time zone: a failure never breaks the open; a refresh that is off keeps its permit', () => {
    const broken = tzScenario({ settings: { timeZone: 'Europe/Warsaw' } });
    broken.ex.eval(`getMainSettings = () => { throw new Error('sheet unreadable'); }`);
    assert.doesNotThrow(() => broken.ex.eval(`ScheduleRefresh.syncTimeZone()`));
    const off = tzScenario({ settings: { timeZone: 'Europe/Warsaw', refreshPermit: Object.assign({}, PERMIT_WARSAW, { off: true }) } }, { changed: true, info: { zoneChanged: true, lastKnown: true, fromOffset: 60, toOffset: 0 } });
    off.ex.eval(`ScheduleRefresh.syncTimeZone()`);
    off.save();
    assert.deepStrictEqual([permit(off).startAt, permit(off).timeZone], ['17:30', 'Europe/Warsaw']);
  });

  test('time zone: onOpen runs the check (an authorised, ordinary run)', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Quick Start.js'), 'utf8');
    assert.ok(/Controller\.run\("onOpen",\(\) => \{ ManagedSheets\.warmUp\(\); ScheduleRefresh\.syncTimeZone\(\);/.test(text));
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

  // ---- the download log (Refresh Log.js) ------------------------------------------------------------------------------------------------------
  test('log: a scheduled refresh writes ONE entry "Autoodświeżanie" - the clock trigger in the technical text, the ticked sheets and what the add-on handled itself as the status; the legacy handler says so', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6 } } });
    sc.p.triggers.push(NAMED('trig-A'));
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    const logged = plain(sc.ex.eval(`__logged`));
    assert.strictEqual(logged.length, 1);
    // the fake config sheets here have no table: a failure the add-on handles itself is the status, and no sheet counts as refreshed
    assert.deepStrictEqual([logged[0].name, logged[0].source, logged[0].status, logged[0].sheets, logged[0].technical],
      ['Dziennik pobrań', 'Autoodświeżanie', 'Brak tabeli w arkuszu konfiguracji „K1”; Brak tabeli w arkuszu konfiguracji „K3”', '0 arkuszy', 'Clock trigger trig-A']);
    const legacy = scenario({ settings: { refreshPermit: { issuedFor: 'trig-L', lastRefresh: 1, intervalHours: 6 } } });
    legacy.p.triggers.push(NAMED('trig-L', 'autoRefresh'));
    legacy.ex.eval(`autoRefresh(${event('trig-L')})`);
    assert.strictEqual(plain(legacy.ex.eval(`__logged[0].technical`)), 'Clock trigger trig-L (old version: autoRefresh function)');
  });

  test('last refresh: a scheduled refresh that failed leaves the time alone and puts a note on it; a fully correct one does not (the note is removed by setLastRefresh); a note that cannot be written never hides the error', () => {
    const failed = scenario({ refreshError: 'boom' });
    assert.throws(() => failed.ex.eval(`RefreshAll.scheduled()`), /boom/);
    assert.strictEqual(failed.ex.eval(`__noted`), 1, 'noted once');
    assert.ok(!failed.calls().some(c => c[0] === 'lastRefresh'), 'the time is not written');
    const fine = scenario();
    fine.ex.eval(`RefreshAll.scheduled()`);
    assert.strictEqual(fine.ex.eval(`__noted`), 0);
    assert.ok(fine.calls().some(c => c[0] === 'lastRefresh'));
    const noteFails = scenario({ refreshError: 'boom' });
    noteFails.ex.eval(`__cfgNoteFails = true`);
    assert.throws(() => noteFails.ex.eval(`RefreshAll.scheduled()`), /boom/, 'the refresh error, not the note\'s');
    // the menu refreshes do not touch the time of the last refresh
    const menu = scenario({ refreshError: 'boom' });
    assert.throws(() => menu.ex.eval(`refreshAll()`), /boom/);
    assert.strictEqual(menu.ex.eval(`__noted`), 0);
  });

  test('log: a scheduled refresh that fails writes the entry with the error as the status, and the error goes on', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6 } }, refreshError: 'BC down' });
    sc.p.triggers.push(NAMED('trig-A'));
    assert.throws(() => sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`), /BC down/);
    // the error came while the data of a sheet was pulled: the status says for which sheet, the error itself is in the technical column
    assert.deepStrictEqual(plain(sc.ex.eval(`__logged.map(e => [e.source, e.status, e.technical])`)),
      [['Autoodświeżanie', 'Błąd ❗️ Przy pobieraniu danych dla arkuszy: R1, R3.', 'Clock trigger trig-A. Errors: R1: BC down | R3: BC down']]);       // both ticked sheets were tried
  });

  test('log: a trigger that does not hold the permit deletes itself and writes an entry that says so - technical: the trigger and that it was deleted, status: nothing was refreshed (both handlers)', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-B', lastRefresh: 1, intervalHours: 6 } } });
    sc.p.triggers.push(NAMED('trig-A'));
    sc.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    const [e] = plain(sc.ex.eval(`__logged`));
    assert.deepStrictEqual([e.source, e.status, e.sheets], ['Autoodświeżanie', 'Odświeżanie nie zostało wykonane', '0 arkuszy']);
    assert.ok(/^Clock trigger trig-A\./.test(e.technical) && /trigger was deleted/.test(e.technical) && /no refresh was performed/.test(e.technical), e.technical);
    assert.deepStrictEqual(sc.calls(), [], 'nothing was refreshed');
    const off = scenario({ settings: { refreshPermit: { issuedFor: 'trig-L', lastRefresh: 1, intervalHours: 6, off: true } } });
    off.p.triggers.push(NAMED('trig-L', 'autoRefresh'));
    off.ex.eval(`autoRefresh(${event('trig-L')})`);
    assert.ok(/old version/.test(plain(off.ex.eval(`__logged[0].technical`))));
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

  test('last refresh: a sheet BC answered with an error document (nothing thrown) is a failed attempt too - the note, no time, the run is not recorded on the permit', () => {
    const sc = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6, nextRefresh: Date.now() } } });
    sc.ex.eval(`RefreshAll.ticked = () => { RefreshLog.noteFailedSheet('Dane K1', 'BC BadRequest: zle'); }`);
    assert.strictEqual(sc.ex.eval(`RefreshAll.scheduled()`), false);
    assert.strictEqual(sc.ex.eval(`__noted`), 1, 'noted once');
    assert.ok(!sc.calls().some(c => c[0] === 'lastRefresh'), 'the time is not written');
    const run = scenario({ settings: { refreshPermit: { issuedFor: 'trig-A', lastRefresh: 1, intervalHours: 6, nextRefresh: Date.now() } } });
    run.ex.eval(`RefreshAll.ticked = () => { RefreshLog.noteFailedSheet('Dane K1', 'BC BadRequest: zle'); }`);
    run.ex.eval(`autoRefreshHandler(${event('trig-A')})`);
    run.save();
    assert.strictEqual(permit(run).lastRun, undefined, 'not recorded');
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

  test('refresh loops: a failing sheet does NOT stop the loop - every sheet is tried, then the FIRST error goes on to the caller; a scheduled refresh that failed does not note the time', () => {
    const sc = scenario({ refreshError: 'boom' });
    assert.throws(() => sc.ex.eval(`RefreshAll.ticked()`), /boom/);
    assert.deepStrictEqual(sc.calls(), [['refresh', 'K1'], ['refresh', 'K3']]);
    const all = scenario({ refreshError: 'boom' });
    assert.throws(() => all.ex.eval(`refreshAll()`), /boom/);
    assert.deepStrictEqual(all.calls(), [['refresh', 'K1'], ['refresh', 'K2'], ['refresh', 'K3']]);
    const scheduled = scenario({ refreshError: 'boom' });
    assert.throws(() => scheduled.ex.eval(`RefreshAll.scheduled()`), /boom/);
    assert.ok(!scheduled.calls().some(c => c[0] === 'lastRefresh'), 'the time is not noted after a failure');
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
    ['RefreshAll.js', 'Refresh Registry.js', 'Refresh Log.js', 'Refresh Log Grid.js', 'Auto Refresh Panel.js', 'ScheduleRefresh.js'].forEach(f => vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), {}));
  });
};
