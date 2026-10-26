// Tests of the state layer: HelperDataStore / Store, MainSettings / Settings, GlobalSettings, StorageObject, the agent detection's use of
// cache and properties, runLatestOnly (the co-edit lock). Registered by tests/run.js.
//
// Every test builds a FRESH execution (all project files loaded into a new global scope, like a new Apps Script run) on a FakePlatform
// that keeps the stored data. Two executions on one platform model two concurrent / consecutive runs.
//
// Part 1 (CHARACTERISATION) pins what the code did BEFORE the Store / Settings facade existed, through the old names.
// The facade and the moved callers must keep all of it green.
'use strict';
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

// Order does not matter (Apps Script gives no promise either); nothing may be used at load time.
const BASE_FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js'];

const LIVE_CHECK_FILES = ['Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js'];

/**
 * t.suffix / t.extraFiles: the suite is registered a second time with the live check helpers loaded (switch off): they must not change
 * anything the add-on does. File-scanning rules are registered once (no suffix).
 */
module.exports = function register(t) {
  const suffix = t.suffix || '';
  const test = (name, fn) => t.test(name + suffix, fn);
  const rulesOnly = fn => { if (!suffix) fn(); };
  const FILES = [...BASE_FILES, ...(t.extraFiles || [])];

  /** platform + one execution; `ex.eval('MainSettings.getAddonStatus()')` runs code inside it. */
  function setup(platform) {
    const p = platform || new FakePlatform();
    const ex = p.execution(FILES);
    ex.eval('Agents.ensureActive = () => { globalThis.__statusChecks = (globalThis.__statusChecks || 0) + 1; }');   // not under test
    ex.eval('var __statusChecks = 0');
    return { p, ex, next: () => setup(p) };
  }
  const json = v => JSON.stringify(v);
  const plain = v => JSON.parse(JSON.stringify(v));            // values made inside an execution live in another realm: compare them as plain data
  const stored = (p, scope, key) => (p.props[scope][key] === undefined ? undefined : JSON.parse(p.props[scope][key]));

  // ---- HelperDataStore (properties and cache by scope) --------------------------------------------------------------------
  test('state: properties are kept per scope; null deletes; only strings are accepted', () => {
    const { p, ex } = setup();
    ex.eval(`HelperDataStore.setPropertyValue('document','k','d'); HelperDataStore.setPropertyValue('user','k','u'); HelperDataStore.setPropertyValue('script','k','s')`);
    assert.deepStrictEqual(['document', 'user', 'script'].map(s => ex.eval(`HelperDataStore.getPropertyValue('${s}','k')`)), ['d', 'u', 's']);
    ex.eval(`HelperDataStore.setPropertyValue('user','k',null)`);
    assert.strictEqual(ex.eval(`HelperDataStore.getPropertyValue('user','k')`), null);
    assert.strictEqual(ex.eval(`HelperDataStore.getPropertyValue('document','k')`), 'd');
    assert.throws(() => ex.eval(`HelperDataStore.setPropertyValue('document','k',5)`), /Param value must be string or null/);
    assert.throws(() => ex.eval(`HelperDataStore.getPropertyValue('nowhere','k')`), /Param scope can only be/);
    assert.throws(() => ex.eval(`HelperDataStore.getPropertyValue('document',7)`), /Param key must be string/);
  });

  test('state: cache values expire; the lifetime is passed to the service; null deletes', () => {
    const { p, ex } = setup();
    ex.eval(`HelperDataStore.setDocumentCacheValue('c','v',30)`);
    assert.ok(p.calls.includes('cache.put document c ttl=30'));
    assert.strictEqual(ex.eval(`HelperDataStore.getDocumentCacheValue('c')`), 'v');
    p.advance(31);
    assert.strictEqual(ex.eval(`HelperDataStore.getDocumentCacheValue('c')`), null);
    ex.eval(`HelperDataStore.setCacheValue('user','c','v')`); ex.eval(`HelperDataStore.setCacheValue('user','c',null)`);
    assert.strictEqual(ex.eval(`HelperDataStore.getUserCacheValue('c')`), null);
  });

  test('state: a service that is missing in this scope fails loudly in HelperDataStore and silently in OptionalDataStore', () => {
    const { p, ex } = setup();
    p.broken['cache.document'] = 'null';
    assert.throws(() => ex.eval(`HelperDataStore.getDocumentCacheValue('c')`), /CacheService returned empty result/);
    assert.strictEqual(ex.eval(`OptionalDataStore.getDocumentCacheValue('c')`), null);
    assert.doesNotThrow(() => ex.eval(`OptionalDataStore.setDocumentCacheValue('c','v')`));
    p.broken['cache.document'] = 'throw';
    assert.strictEqual(ex.eval(`OptionalDataStore.getDocumentCacheValue('c')`), null);
    assert.strictEqual(ex.eval(`HelperDataStore.checkAvailability('cache','document')`), false);
    delete p.broken['cache.document'];
    assert.strictEqual(ex.eval(`HelperDataStore.checkAvailability()`), true);
  });

  // ---- StorageObject (the CLAUDE.md invariant) ------------------------------------------------------------------------------
  test('state: StorageObject saves only the keys it changed, merged into what is stored now (two concurrent runs both keep their key)', () => {
    const { p, ex } = setup();
    const a = p.execution(FILES), b = p.execution(FILES);
    a.eval(`var so = new StorageObject('settings','document')`); b.eval(`var so = new StorageObject('settings','document')`);   // both read the (empty) store
    a.eval(`so.setProperty('x', 1)`); b.eval(`so.setProperty('y', 2)`);
    a.eval(`so.saveArray()`); b.eval(`so.saveArray()`);
    assert.deepStrictEqual(stored(p, 'document', 'settings'), { x: 1, y: 2 });
    assert.ok(p.calls.includes('lock.acquired') && p.calls.includes('lock.released'), 'under a lock');
  });

  test('state: StorageObject never reverts a key it did not change (a stale snapshot is not written back)', () => {
    const p = new FakePlatform();
    p.props.document.settings = json({ q: 'old', keep: 1 });
    const a = p.execution(FILES), b = p.execution(FILES);
    a.eval(`var so = new StorageObject('settings','document')`);                 // A's snapshot: q = old
    b.eval(`var so = new StorageObject('settings','document'); so.setProperty('q','new'); so.saveArray()`);
    a.eval(`so.setProperty('x', 1); so.saveArray()`);
    assert.deepStrictEqual(stored(p, 'document', 'settings'), { q: 'new', keep: 1, x: 1 });
    assert.strictEqual(a.eval(`so.getProperty('q')`), 'new', 'and A\'s own view is refreshed by the save');
  });

  test('state: StorageObject without changes does not write or lock; getFreshProperty ignores the snapshot', () => {
    const { p, ex } = setup();
    ex.eval(`var so = new StorageObject('settings','document')`);
    ex.eval(`so.saveArray()`);
    assert.deepStrictEqual(p.calls.filter(c => /^properties\.set|^lock/.test(c)), []);
    p.props.document.settings = json({ q: 'new' });
    assert.strictEqual(ex.eval(`so.getProperty('q')`), undefined, 'snapshot taken at construction');
    assert.strictEqual(ex.eval(`so.getFreshProperty('q')`), 'new');
  });

  test('state: StorageObject saves anyway (unlocked) when the lock cannot be had', () => {
    const { p, ex } = setup();
    p.lockHeld = true;
    ex.eval(`var so = new StorageObject('settings','document'); so.setProperty('x', 1); so.saveArray()`);
    assert.deepStrictEqual(stored(p, 'document', 'settings'), { x: 1 });
  });

  test('state: StorageObject saves when the run closes (Controller closing action), once', () => {
    const { p, ex } = setup();
    p.props.document.importSettingsArray = json({ addonStatus: true });
    ex.eval(`Controller.run('requestX', () => { var so = new StorageObject('k1','document'); so.setProperty('a', 1); var so2 = new StorageObject('k1','document'); })`);
    assert.deepStrictEqual(stored(p, 'document', 'k1'), { a: 1 });
  });

  // ---- MainSettings -------------------------------------------------------------------------------------------------------------
  test('state: MainSettings keeps its values in the document property "importSettingsArray" (one JSON object)', () => {
    const { p, ex } = setup();
    ex.eval(`MainSettings.setProperty('importSheetName','Ustawienia'); getImportSettings().saveArray()`);
    assert.deepStrictEqual(stored(p, 'document', 'importSettingsArray'), { importSheetName: 'Ustawienia' });
    assert.strictEqual(ex.eval(`MainSettings.getSettingsSheetName()`), 'Ustawienia');
    const ex2 = p.execution(FILES);
    assert.strictEqual(ex2.eval(`MainSettings.getSettingsSheetName()`), 'Ustawienia', 'a later run sees it');
  });

  test('state: the add-on status is OFF by default; "on"/"off"/"ON"/"OFF" are understood; ON also registers one status check for the end of the run', () => {
    const { p, ex } = setup();
    assert.strictEqual(ex.eval(`MainSettings.getAddonStatus()`), false);
    ex.eval(`MainSettings.setProperty('importSheetName','S')`);
    ex.eval(`Controller.run('requestOn', () => { MainSettings.setAddonStatus('on'); MainSettings.setAddonStatus('ON'); })`);
    assert.strictEqual(ex.eval(`MainSettings.getAddonStatus()`), true);
    assert.strictEqual(ex.eval(`__statusChecks`), 1, 'registerClosingOnce');
    ex.eval(`MainSettings.setAddonStatus('OFF')`);
    assert.strictEqual(ex.eval(`MainSettings.getAddonStatus()`), false);
    ex.eval(`MainSettings.setAddonStatus('off'); MainSettings.setAddonStatus(true)`);
    assert.strictEqual(ex.eval(`MainSettings.getAddonStatus()`), true);
  });

  test('state: turning the add-on on without a settings sheet name asks for a valid one', () => {
    const { p, ex } = setup();
    ex.eval(`globalThis.__asked = 0; getValidImportSettingsSheet = () => { __asked++; return 'Ustawienia 7'; }`);
    ex.eval(`MainSettings.setAddonStatus(true)`);
    assert.strictEqual(ex.eval(`__asked`), 1);
    assert.strictEqual(ex.eval(`MainSettings.getSettingsSheetName()`), 'Ustawienia 7');
  });

  test('state: Controller.run does nothing while the add-on is OFF, except "request..." actions; "menu..." turns it ON first', () => {
    const { p, ex } = setup();
    ex.eval(`MainSettings.setProperty('importSheetName','S')`);
    assert.strictEqual(ex.eval(`Controller.run('someAction', () => 'ran')`), null);
    assert.strictEqual(ex.eval(`Controller.run('requestThing', () => 'ran')`), 'ran');
    assert.strictEqual(ex.eval(`Controller.run('menuThing', () => 'ran')`), 'ran');
    assert.strictEqual(ex.eval(`MainSettings.getAddonStatus()`), true);
  });

  test('state: refresh permit: issue, read, update; touch only while it is still issued for the trigger (re-read from the store)', () => {
    const { p, ex } = setup();
    ex.eval(`MainSettings.setRefreshPermit('trigA', 6)`);
    const permit = ex.eval(`MainSettings.getRefreshPermit()`);
    assert.deepStrictEqual([permit.issuedFor, permit.intervalHours, typeof permit.lastRefresh], ['trigA', 6, 'number']);
    ex.eval(`getImportSettings().saveArray()`);
    assert.strictEqual(stored(p, 'document', 'importSettingsArray').refreshPermit.issuedFor, 'trigA');

    // another run reissues the permit while this one still holds its snapshot
    const other = p.execution(FILES);
    other.eval(`MainSettings.setRefreshPermit('trigB', 12); getImportSettings().saveArray()`);
    assert.strictEqual(ex.eval(`MainSettings.touchRefreshPermit('trigA')`), false, 'not issued for A any more');
    assert.strictEqual(stored(p, 'document', 'importSettingsArray').refreshPermit.lastRun, undefined);
    assert.strictEqual(ex.eval(`MainSettings.touchRefreshPermit('trigB')`), true);
    ex.eval(`getImportSettings().saveArray()`);
    assert.strictEqual(typeof stored(p, 'document', 'importSettingsArray').refreshPermit.lastRun, 'number');
  });

  test('state: two runs changing different settings do not undo each other (the CLAUDE.md rule, through MainSettings)', () => {
    const p = new FakePlatform();
    const a = p.execution(FILES), b = p.execution(FILES);
    a.eval(`MainSettings.getProperty('addonStatus')`); b.eval(`MainSettings.getProperty('addonStatus')`);   // both snapshots taken
    a.eval(`MainSettings.setProperty('addonStatus', true)`);
    b.eval(`MainSettings.setRefreshPermit('trigB', 4)`);
    a.eval(`getImportSettings().saveArray()`); b.eval(`getImportSettings().saveArray()`);
    const s = stored(p, 'document', 'importSettingsArray');
    assert.strictEqual(s.addonStatus, true);
    assert.strictEqual(s.refreshPermit.issuedFor, 'trigB');
  });

  // ---- GlobalSettings (tenant / environment / company) ----------------------------------------------------------------------
  test('state: GlobalSettings: stored per scope under bc-tenant-id / bc-environment / bc-company; the active value is document, then user, then script', () => {
    const { p, ex } = setup();
    ex.eval(`getGlobalSettings().setAllPropertiesForScope('script','tenant-s','env-s','Company S')`);
    ex.eval(`getGlobalSettings().setTenantId('tenant-u','user')`);
    assert.deepStrictEqual([p.props.script['bc-tenant-id'], p.props.script['bc-environment'], p.props.script['bc-company'], p.props.user['bc-tenant-id']], ['tenant-s', 'env-s', 'Company S', 'tenant-u']);
    assert.strictEqual(ex.eval(`getGlobalSettings().getTenantId()`), 'tenant-u');
    assert.strictEqual(ex.eval(`getGlobalSettings().getBCEnvironment()`), 'env-s');
    ex.eval(`getGlobalSettings().setTenantId('tenant-d','document')`);
    assert.strictEqual(ex.eval(`getGlobalSettings().getTenantId()`), 'tenant-d');
    assert.strictEqual(ex.eval(`getGlobalSettings().getActiveScope()`), 'document');
    assert.strictEqual(ex.eval(`getGlobalSettings().getServiceName()`), 'tenant-d');
  });

  test('state: GlobalSettings: an empty value deletes the stored property; URLs are built from tenant and environment', () => {
    const { p, ex } = setup();
    ex.eval(`getGlobalSettings().setAllPropertiesForScope('document','T1','Sandbox','Firma')`);
    assert.strictEqual(ex.eval(`getGlobalSettings().getAuthURL()`), 'https://login.microsoftonline.com/T1/oauth2/v2.0/authorize');
    assert.strictEqual(ex.eval(`getGlobalSettings().getTokenURL()`), 'https://login.microsoftonline.com/T1/oauth2/v2.0/token');
    assert.strictEqual(ex.eval(`getGlobalSettings().getODataURL()`), 'https://api.businesscentral.dynamics.com/v2.0/T1/Sandbox/ODataV4/');
    ex.eval(`getGlobalSettings().setCompany('', 'document')`);
    assert.strictEqual(p.props.document['bc-company'], undefined);
    assert.strictEqual(ex.eval(`getGlobalSettings().getCompany('document')`), '', 'the cache of this run keeps what was set');
    assert.strictEqual(p.execution(FILES).eval(`getGlobalSettings().getCompany('document')`), null, 'a later run reads nothing');
  });

  // ---- trigger logs and agent storage (state kept as JSON arrays) -------------------------------------------------------------
  test('state: the trigger logs are kept as JSON arrays in the document / user properties and saved when the run closes', () => {
    const { p, ex } = setup();
    p.props.document.importSettingsArray = json({ addonStatus: true });
    ex.eval(`
      const fake = id => ({ getUniqueId: () => id, getEventType: () => 'ON_EDIT', getHandlerFunction: () => 'sheetEdit' });
      Controller.run('requestLog', () => { getDocumentTriggerLog().logNewTrigger(fake('t-doc')); getUserTriggerLog().logNewTrigger(fake('t-usr')); });`);
    assert.deepStrictEqual(stored(p, 'document', 'docTriggerArray').map(e => e.triggerId), ['t-doc']);
    assert.deepStrictEqual(stored(p, 'user', 'usrTriggerArray').map(e => e.triggerId), ['t-usr']);
    assert.strictEqual(stored(p, 'document', 'docTriggerArray')[0].powerOn, true);
    const later = p.execution(FILES);
    assert.deepStrictEqual(plain(later.eval(`getDocumentTriggerLog().getTriggerArray().map(e => e.triggerId)`)), ['t-doc']);
    assert.strictEqual(later.eval(`StatusManager.checkTriggerPower('t-doc')`), true);
    assert.strictEqual(later.eval(`StatusManager.checkTriggerPower('nope')`), false);
  });

  test('state: StorageArray (the agent pairs) keeps a JSON array in its scope and writes the WHOLE array back (known hazard, see docs/agent-service.md)', () => {
    const { p, ex } = setup();
    p.props.user.agentArray = json([['e1', 'c1']]);
    ex.eval(`var sa = new StorageArray('agentArray','user'); sa.getArray().push(['e2','c2']); sa.saveArray()`);
    assert.deepStrictEqual(stored(p, 'user', 'agentArray'), [['e1', 'c1'], ['e2', 'c2']]);
    // the hazard, pinned so that fixing it is a conscious change: a second run with an older snapshot overwrites the first one's push
    const a = p.execution(FILES), b = p.execution(FILES);
    a.eval(`var sa = new StorageArray('agentArray','user')`); b.eval(`var sa = new StorageArray('agentArray','user')`);
    a.eval(`sa.getArray().push(['e3','c3']); sa.saveArray()`); b.eval(`sa.getArray().push(['e4','c4']); sa.saveArray()`);
    assert.deepStrictEqual(stored(p, 'user', 'agentArray').map(x => x[0]), ['e1', 'e2', 'e4'], 'e3 is lost');
  });

  // ---- the agent detection (document cache with a lifetime, document property) and the lock-flag helper ---------------------------
  const EDIT = `({ range: { getSheet: () => ({ getName: () => 'S' }), getA1Notation: () => 'B2' }, triggerUid: 't1' })`;
  test('state: agent detection: the installable run leaves a counter in the document cache (30 s), the simple run consumes it', () => {
    const { p, ex } = setup();
    ex.eval(`recordInstallableSeen(${EDIT}); recordInstallableSeen(${EDIT});`);
    assert.strictEqual(p.cache.document['edit:S!B2instalTraceKey_'].value, '2');
    assert.ok(p.calls.includes('cache.put document edit:S!B2instalTraceKey_ ttl=30'));
    assert.strictEqual(ex.eval(`waitForInstallable('S!B2', 1000)`), true);
    assert.strictEqual(p.cache.document['edit:S!B2instalTraceKey_'].value, '1');
    assert.strictEqual(ex.eval(`waitForInstallable('S!B2', 1000)`), true);
    assert.strictEqual(p.cache.document['edit:S!B2instalTraceKey_'], undefined, 'deleted when the last one is consumed');
  });

  test('state: agent detection: with no record the simple run waits the whole time and gives up', () => {
    const { p, ex } = setup();
    const before = p.now;
    assert.strictEqual(ex.eval(`waitForInstallable('S!B2', 2000)`), false);
    assert.ok(p.now - before >= 2000, 'it waited (fake sleep advanced the clock): ' + (p.now - before));
  });

  test('state: agent detection: the suspect flag lives in the document property "agentSuspect" and is cleared by an installable run', () => {
    const { p, ex } = setup();
    ex.eval(`setAgentSuspect('S!B2')`);
    assert.strictEqual(stored(p, 'document', 'agentSuspect').fp, 'S!B2');
    assert.strictEqual(ex.eval(`getAgentSuspect().fp`), 'S!B2');
    ex.eval(`recordInstallableSeen(${EDIT})`);
    assert.strictEqual(p.props.document.agentSuspect, undefined, 'recordInstallableSeen clears it');
    assert.strictEqual(ex.eval(`getAgentSuspect()`), null);
  });

  // Only the LAST co-edit to start may complete: every run writes its own ticket to the document property <sheet>_coedit when it starts; the action gets
  // isLatest() and drops out (returns false) at its checkpoints as soon as a newer ticket is there; a run that waits for the lock gives up as soon as it is
  // not the latest any more. (Before: a request made during a pass was served by another pass of the holder; the user wants the newest only.)

  test('state: runLatestOnly: runs the action under the script lock, hands it isLatest(), leaves its own ticket in the flag, returns "completed"', () => {
    const { p, ex } = setup();
    const r = ex.eval(`globalThis.__n = 0; globalThis.__sawLatest = null; const r = runLatestOnly(isLatest => { __n++; __sawLatest = isLatest(); }, 'flagA'); r`);
    assert.strictEqual(r, 'completed');
    assert.strictEqual(ex.eval(`__n`), 1);
    assert.strictEqual(ex.eval(`__sawLatest`), true);
    assert.ok(/^[0-9a-z]+-[0-9a-z]+$/.test(p.props.document.flagA), 'a ticket, not yes/no: ' + p.props.document.flagA);
    assert.ok(p.calls.includes('lock.acquired') && p.calls.includes('lock.released'));
  });

  test('state: runLatestOnly: a run that starts while another works takes over - the one working finds out at its next checkpoint and drops out (returns "dropped"), the newer one gets its turn', () => {
    const { p, ex, next } = setup();
    ex.ctx.__newerStarts = () => {
      p.lockHeld = true;                                          // the newer run cannot get the lock while this one works
      const y = next();
      y.ex.eval(`globalThis.__yRan = 0; globalThis.__yOutcome = runLatestOnly(() => { __yRan++; }, 'flagB')`);
      p.lockHeld = false;
      return [y.ex.eval(`__yRan`), y.ex.eval(`__yOutcome`)];
    };
    const out = ex.eval(`globalThis.__log = []; const r = runLatestOnly(isLatest => {
      __log.push('checkpoint 1: ' + isLatest());
      __yStatus = __newerStarts();
      __log.push('checkpoint 2: ' + isLatest());
      return isLatest() ? undefined : false;
    }, 'flagB'); [r, __log, __yStatus]`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), ['dropped', ['checkpoint 1: true', 'checkpoint 2: false'], [0, 'timeout']]);
  });

  test('rule: the co-edit lock is the SCRIPT lock - the document lock belongs to the agent detection, which waits for it only 5 s', () => {
    const fs = require('fs'), path = require('path');
    const text = fs.readFileSync(path.join(__dirname, '..', 'functions.js'), 'utf8');
    const body = text.slice(text.indexOf('function runLatestOnly'), text.indexOf('function average'));
    assert.ok(/getScriptLock\(\)/.test(body) && !/getDocumentLock/.test(body));
  });

  test('state: runLatestOnly: a run that waits for the lock and finds a newer ticket meanwhile gives up at once ("dropped"), without running', () => {
    const { p, ex } = setup();
    let attempts = 0;
    ex.ctx.LockService = { getScriptLock: () => ({ tryLock: () => { attempts++; if (attempts === 3) p.props.document.flagC = 'newer-ticket'; return false; }, hasLock: () => false, releaseLock() {} }) };
    const r = ex.eval(`globalThis.__n = 0; runLatestOnly(() => { __n++; }, 'flagC')`);
    assert.strictEqual(r, 'dropped');
    assert.strictEqual(ex.eval(`__n`), 0);
    assert.ok(attempts <= 4, 'it did not go on waiting: ' + attempts);
  });

  test('state: runLatestOnly: it waits for the lock (a few tries) and then runs; a lock that never frees gives "timeout" after about 90 s of tries and the action does not run', () => {
    const { p, ex } = setup();
    p.lockHeld = true; p.lockFreesAfter = 4;                      // the 5th try gets it
    assert.strictEqual(ex.eval(`globalThis.__n = 0; runLatestOnly(() => { __n++; }, 'flagD')`), 'completed');
    assert.strictEqual(ex.eval(`__n`), 1);
    const q = setup();
    q.p.lockHeld = true;                                          // never
    assert.strictEqual(q.ex.eval(`globalThis.__n = 0; runLatestOnly(() => { __n++; }, 'flagE')`), 'timeout');
    assert.strictEqual(q.ex.eval(`__n`), 0);
    assert.ok(q.p.tryLockAttempts >= 40 && q.p.tryLockAttempts <= 50, 'tries: ' + q.p.tryLockAttempts);
  });

  test('state: runLatestOnly: a run that gets the lock but is no longer the latest does not run the action', () => {
    const { p, ex } = setup();
    let has = false;
    ex.ctx.LockService = { getScriptLock: () => ({ tryLock: () => { p.props.document.flagF = 'newer-ticket'; has = true; return true; }, hasLock: () => has, releaseLock() { has = false; p.calls.push('lock.released'); } }) };
    assert.strictEqual(ex.eval(`globalThis.__n = 0; runLatestOnly(() => { __n++; }, 'flagF')`), 'dropped');
    assert.strictEqual(ex.eval(`__n`), 0);
    assert.ok(p.calls.includes('lock.released'));
  });

  test('state: runLatestOnly: the lock is released after the action, also when it throws (the error goes on); finishing as the latest is "completed", being overtaken at the very end is "dropped"', () => {
    const { p, ex } = setup();
    assert.throws(() => ex.eval(`runLatestOnly(() => { throw new Error('boom'); }, 'flagG')`), /boom/);
    assert.ok(p.calls.includes('lock.released'));
    assert.strictEqual(ex.eval(`runLatestOnly(isLatest => { Store.set('document', 'flagH', 'someone-newer'); }, 'flagH')`), 'dropped');
  });

  // =====================================================================================================================
  // Part 2: the Store / Settings facade, and the callers that were moved onto it
  // =====================================================================================================================
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const codeOnly = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');   // no comments
  // Exempt from the rules below: Test Functions.js (manual tests run by hand in the editor) and Live Check*.js. The live check verifiers read the
  // stored data DIRECTLY (PropertiesService / CacheService, literal keys) on purpose: they are the independent judge of what the add-on stored,
  // so they must not go through Store / Settings - that would make the refactor check itself. See docs/testing.md.
  const ALL_JS = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && f !== 'Test Functions.js' && !/^Live Check/.test(f));

  test('store: get / set / remove per scope; null removes; getJson / setJson round trip with a fallback', () => {
    const { p, ex } = setup();
    ex.eval(`Store.set('document','a','1'); Store.set('user','a','2'); Store.set('script','a','3')`);
    assert.deepStrictEqual(['document', 'user', 'script'].map(s => ex.eval(`Store.get('${s}','a')`)), ['1', '2', '3']);
    assert.strictEqual(p.props.user.a, '2');
    ex.eval(`Store.set('user','a',null)`); ex.eval(`Store.remove('script','a')`);
    assert.deepStrictEqual([ex.eval(`Store.get('user','a')`), ex.eval(`Store.get('script','a')`), ex.eval(`Store.get('document','a')`)], [null, null, '1']);
    assert.deepStrictEqual(plain(ex.eval(`Store.getJson('document','missing',[])`)), []);
    assert.strictEqual(ex.eval(`Store.getJson('document','missing',null)`), null);
    ex.eval(`Store.setJson('document','j',{ x: [1, 2] })`);
    assert.strictEqual(p.props.document.j, '{"x":[1,2]}');
    assert.deepStrictEqual(plain(ex.eval(`Store.getJson('document','j',null)`)), { x: [1, 2] });
    assert.throws(() => ex.eval(`Store.get('nowhere','a')`), /Param scope can only be/);
    assert.throws(() => ex.eval(`Store.set('document','a',5)`), /Param value must be string or null/);
  });

  test('store: cache get / set with a lifetime / remove; optional cache never throws', () => {
    const { p, ex } = setup();
    ex.eval(`Store.cache.set('document','c','v',20)`);
    assert.ok(p.calls.includes('cache.put document c ttl=20'));
    assert.strictEqual(ex.eval(`Store.cache.get('document','c')`), 'v');
    p.advance(21);
    assert.strictEqual(ex.eval(`Store.cache.get('document','c')`), null);
    ex.eval(`Store.cache.set('user','c','v')`); ex.eval(`Store.cache.remove('user','c')`);
    assert.strictEqual(ex.eval(`Store.cache.get('user','c')`), null);
    p.broken['cache.document'] = 'null';
    assert.throws(() => ex.eval(`Store.cache.get('document','c')`), /CacheService returned empty result/);
    assert.strictEqual(ex.eval(`Store.optional.getCache('document','c')`), null);
    assert.doesNotThrow(() => ex.eval(`Store.optional.setCache('document','c','v')`));
    assert.strictEqual(ex.eval(`Store.available('cache','document')`), false);
  });

  test('store: object() is one StorageObject per key and scope in a run; array() is a new StorageArray', () => {
    const { p, ex } = setup();
    assert.strictEqual(ex.eval(`Store.object('k','document') === Store.object('k','document')`), true);
    assert.strictEqual(ex.eval(`Store.object('k','document') === Store.object('k','user')`), false);
    assert.strictEqual(ex.eval(`Store.object('k','document') instanceof StorageObject`), true);
    assert.strictEqual(ex.eval(`Store.array('a','user') === Store.array('a','user')`), false);
    ex.eval(`Store.object('k','document').setProperty('x', 1); Store.object('k','document').saveArray()`);
    assert.deepStrictEqual(stored(p, 'document', 'k'), { x: 1 });
  });

  test('store: service() gives the platform service of the scope (for the OAuth2 library)', () => {
    const { p, ex } = setup();
    ex.eval(`Store.service('user','properties').setProperty('tok','abc')`);
    assert.strictEqual(p.props.user.tok, 'abc');
    ex.eval(`Store.service('user','cache').put('ck','cv',10)`);
    assert.strictEqual(p.cache.user.ck.value, 'cv');
    assert.throws(() => (p.broken['properties.user'] = 'null', ex.eval(`Store.service('user','properties')`)), /PropertiesService returned empty result/);
  });

  test('settings: the typed accessors read and write exactly what MainSettings does (same key, same JSON), in both directions, across runs', () => {
    const p = new FakePlatform();
    const a = p.execution(FILES), b = p.execution(FILES);
    a.eval(`Settings.setAddonStatus(true); Settings.setSettingsSheetName('Ustawienia'); Settings.issueRefreshPermit('trigA', 6); getImportSettings().saveArray()`);
    assert.deepStrictEqual([b.eval(`MainSettings.getAddonStatus()`), b.eval(`MainSettings.getSettingsSheetName()`), b.eval(`MainSettings.getRefreshPermit().issuedFor`)], [true, 'Ustawienia', 'trigA']);
    b.eval(`MainSettings.setProperty('addonStatus', false); MainSettings.setRefreshPermit('trigB', 3); getImportSettings().saveArray()`);
    const c = p.execution(FILES);
    assert.deepStrictEqual([c.eval(`Settings.addonStatus()`), c.eval(`Settings.refreshPermit().issuedFor`), c.eval(`Settings.refreshPermit().intervalHours`)], [false, 'trigB', 3]);
    assert.deepStrictEqual(Object.keys(stored(p, 'document', 'importSettingsArray')).sort(), ['addonStatus', 'importSheetName', 'refreshPermit']);
  });

  test('settings: getImportSettings() is Settings.store() (one object per run); get / set cover the other keys', () => {
    const { p, ex } = setup();
    assert.strictEqual(ex.eval(`getImportSettings() === Settings.store()`), true);
    ex.eval(`Settings.set('custom', { n: 1 })`);
    assert.deepStrictEqual(plain(ex.eval(`MainSettings.getProperty('custom')`)), { n: 1 });
    assert.strictEqual(ex.eval(`Settings.addonStatus()`), false, 'default off');
  });

  test('settings: touchRefreshPermit through Settings is the same guarded re-read as before', () => {
    const { p, ex } = setup();
    ex.eval(`Settings.issueRefreshPermit('A', 1); getImportSettings().saveArray()`);
    p.execution(FILES).eval(`Settings.issueRefreshPermit('B', 2); getImportSettings().saveArray()`);
    assert.strictEqual(ex.eval(`Settings.touchRefreshPermit('A')`), false);
    assert.strictEqual(ex.eval(`Settings.touchRefreshPermit('B')`), true);
    assert.strictEqual(ex.eval(`Settings.refreshPermit().lastRun > 0`), true);
  });

  test('settings: bc() is the one GlobalSettings of the run, and getGlobalSettings() returns it', () => {
    const { p, ex } = setup();
    assert.strictEqual(ex.eval(`Settings.bc() === getGlobalSettings()`), true);
    assert.strictEqual(ex.eval(`Settings.bc() instanceof GlobalSettings`), true);
    ex.eval(`Settings.bc().setAllPropertiesForScope('document','T','E','C')`);
    assert.strictEqual(p.props.document['bc-tenant-id'], 'T');
    assert.strictEqual(ex.eval(`getGlobalSettings().getODataURL()`), 'https://api.businesscentral.dynamics.com/v2.0/T/E/ODataV4/');
  });

  test('moved callers: the BC metadata cache goes through the optional document cache, and works without it', () => {
    const p = new FakePlatform();
    const ex = p.execution([...FILES, 'BC Metadata.js', 'Edmx.js', 'BC Connection.js', 'BC Auth.js']);
    ex.eval(`getGlobalSettings().setAllPropertiesForScope('document','T','E','C');
      globalThis.__downloads = 0;
      BCMetadata.prototype.getEdmxDocument = function () { __downloads++; return { listEntityTypes: () => ['Customers', 'Items'] }; };`);
    assert.deepStrictEqual(plain(ex.eval(`new BCMetadata().getTables()`)), ['Customers', 'Items']);
    assert.deepStrictEqual(plain(ex.eval(`new BCMetadata().getTables()`)), ['Customers', 'Items']);
    assert.strictEqual(ex.eval(`__downloads`), 1, 'second time from the document cache');
    assert.ok(Object.keys(p.cache.document).some(k => /_tables$/.test(k)));
    p.broken['cache.document'] = 'null';
    assert.deepStrictEqual(plain(ex.eval(`new BCMetadata().getTables()`)), ['Customers', 'Items']);
    assert.strictEqual(ex.eval(`__downloads`), 2, 'no cache: it downloads again instead of failing');
  });

  test('moved callers: the OAuth2 service keeps its tokens in the USER properties and user cache, under the BC tenant name', () => {
    const p = new FakePlatform();
    const ex = p.execution([...FILES, 'BC Auth.js']);
    ex.eval(`globalThis.CLIENT_ID_ = 'id'; globalThis.CLIENT_SECRET_ = 'secret'; globalThis.SCOPE_ = 'scope';
      globalThis.__oauth = {};
      const chain = new Proxy({}, { get: (t, name) => (name === 'then' ? undefined : (...args) => { __oauth[name] = args; return chain; }) });
      globalThis.OAuth2 = { createService: name => { __oauth.createService = name; return chain; } };
      getGlobalSettings().setAllPropertiesForScope('document','tenant-1','Env','Firma');
      BCAuth.service();`);
    assert.strictEqual(ex.eval(`__oauth.createService`), 'tenant-1');
    ex.eval(`__oauth.setPropertyStore[0].setProperty('oauth2.tenant-1', 'token')`);
    assert.strictEqual(p.props.user['oauth2.tenant-1'], 'token', 'tokens are in the user properties, not the document ones');
    assert.strictEqual(p.props.document['oauth2.tenant-1'], undefined);
    ex.eval(`__oauth.setCache[0].put('ck', 'cv', 10)`);
    assert.strictEqual(p.cache.user.ck.value, 'cv');
    assert.strictEqual(ex.eval(`__oauth.setAuthorizationBaseUrl[0]`), 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize');
    assert.strictEqual(ex.eval(`__oauth.setTokenUrl[0]`), 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
  });

  test('moved callers: the agent pairs (AgentManager) are kept in the user property "agentArray" and saved when the run closes', () => {
    const { p, ex } = setup();
    ex.eval(`MainSettings.setProperty('addonStatus', true)`);
    ex.eval(`Controller.run('requestAgent', () => { getAgentManager().saveToStorageArray('e1','c1'); })`);
    assert.deepStrictEqual(stored(p, 'user', 'agentArray'), [['e1', 'c1']]);
    assert.deepStrictEqual(plain(p.execution(FILES).eval(`getAgentManager().agentStorage.getArray()`)), [['e1', 'c1']]);
  });

  rulesOnly(() => {
  // ---- rules --------------------------------------------------------------------------------------------------------------------
    test('rule: only Store.js calls HelperDataStore / OptionalDataStore (Test Functions.js, the manual tests, is exempt)', () => {
      const offenders = ALL_JS.filter(f => !/^(Helper Data Store|Store)\.js$/.test(f) && /\b(HelperDataStore|OptionalDataStore)\b/.test(codeOnly(f)));
      assert.deepStrictEqual(offenders, []);
    });
  
    test('rule: PropertiesService and CacheService are only used by Helper Data Store.js', () => {
      const offenders = ALL_JS.filter(f => f !== 'Helper Data Store.js' && /\b(PropertiesService|CacheService)\b/.test(codeOnly(f)));
      assert.deepStrictEqual(offenders, []);
    });
  
    test('rule: StorageObject / StorageArray are created only by Store.js (everybody else asks Store.object / Store.array)', () => {
      const offenders = ALL_JS.filter(f => f !== 'Store.js' && /new\s+Storage(Object|Array)\s*\(/.test(codeOnly(f)));
      assert.deepStrictEqual(offenders, []);
    });
  
    test('rule: Settings.js is the only place that knows the key of the import settings; MainSettings has no storage of its own', () => {
      const offenders = ALL_JS.filter(f => f !== 'Settings.js' && /importSettingsArray|IMPORT_SETTINGS_KEY/.test(codeOnly(f)));
      assert.deepStrictEqual(offenders, []);
      assert.ok(!/Store\./.test(codeOnly('Main Settings.js')) && !/getFreshProperty/.test(codeOnly('Main Settings.js')));
    });
  
    test('rule: Store.js and Settings.js load alone, in any order (nothing is used at load time)', () => {
      const vm = require('vm');
      [['Store.js', 'Settings.js'], ['Settings.js', 'Store.js']].forEach(order => {
        const ctx = vm.createContext({});
        order.forEach(f => new vm.Script(read(f), { filename: f }).runInContext(ctx));
      });
    });
  });

};
