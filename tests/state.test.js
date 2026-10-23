// Tests of the state layer: HelperDataStore / Store, MainSettings / Settings, GlobalSettings, StorageObject, the agent detection's use of
// cache and properties, runFunctionWithLock. Registered by tests/run.js.
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
const BASE_FILES = ['Custom errors.js', 'Helper Data Store.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js'];

module.exports = function register(t) {
  const { test } = t;
  const FILES = t.stateFiles || BASE_FILES;

  /** platform + one execution; `ex.eval('MainSettings.getAddonStatus()')` runs code inside it. */
  function setup(platform) {
    const p = platform || new FakePlatform();
    const ex = p.execution(FILES);
    ex.eval('StatusManager.fullStatusCheck = () => { globalThis.__statusChecks = (globalThis.__statusChecks || 0) + 1; }');   // not under test
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

  test('state: runFunctionWithLock: runs the action under the lock and leaves the flag "no"', () => {
    const { p, ex } = setup();
    ex.eval(`globalThis.__n = 0; runFunctionWithLock(() => { __n++; }, 'flagA')`);
    assert.strictEqual(ex.eval(`__n`), 1);
    assert.strictEqual(p.props.document.flagA, 'no');
  });

  test('state: runFunctionWithLock: when the lock is busy it asks for a re-run ("yes"), and runs once if the lock frees up while waiting', () => {
    const { p, ex } = setup();
    p.lockHeld = true; p.lockFreesAfter = 1;                       // the first tryLock fails, the second succeeds
    ex.eval(`globalThis.__n = 0; runFunctionWithLock(() => { __n++; }, 'flagB')`);
    assert.strictEqual(ex.eval(`__n`), 1);
    assert.strictEqual(p.props.document.flagB, 'no');
    const q = setup();
    q.p.lockHeld = true;                                           // never frees
    q.ex.eval(`globalThis.__n = 0; runFunctionWithLock(() => { __n++; }, 'flagC')`);
    assert.strictEqual(q.ex.eval(`__n`), 0);
    assert.strictEqual(q.p.props.document.flagC, 'yes', 'whoever holds the lock sees that a re-run is needed');
  });
};
