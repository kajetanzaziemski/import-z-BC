// Fakes of the Apps Script platform services the state code uses (PropertiesService, CacheService, LockService, Logger ...)
// and a loader that puts the project's real files into a FRESH global scope, the way Apps Script starts an execution.
//
// One FakePlatform = one document/user/script with its stored data. Several executions (`platform.execution(files)`) can share it,
// which models concurrent or consecutive runs: the data survives, every global (memoised settings, Controller flags ...) starts new.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

class FakePlatform {
  constructor() {
    this.now = 1700000000000;                              // ms, the clock of the fake cache / Date.now for the tests that need it
    this.props = { document: {}, user: {}, script: {} };
    this.cache = { document: {}, user: {}, script: {} };   // key -> { value, expires }
    this.calls = [];                                       // ['properties.set document key', ...] for the tests that count
    this.lockHeld = false;                                 // somebody else holds every lock
    this.lockFreesAfter = Infinity;                        // the lock becomes free after this many tryLock attempts
    this.tryLockAttempts = 0;
    this.triggers = [];                                    // the project's triggers: { id, fn, type, source, params }
    this.triggerSeq = 0;
    this.consoleErrors = [];                               // everything the code wrote with console.error
    this.broken = {};                                      // { 'cache.document': 'null' | 'throw' }
  }
  advance(seconds) { this.now += seconds * 1000; }

  propertiesService(scope) {
    const p = this, store = this.props[scope];
    return {
      getProperty: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setProperty: (k, v) => { p.calls.push('properties.set ' + scope + ' ' + k); store[k] = String(v); },
      deleteProperty: k => { p.calls.push('properties.delete ' + scope + ' ' + k); delete store[k]; },
      getProperties: () => Object.assign({}, store),
      getKeys: () => Object.keys(store)
    };
  }
  cacheService(scope) {
    const p = this, store = this.cache[scope];
    return {
      get: k => { const x = store[k]; if (!x) return null; if (x.expires <= p.now) { delete store[k]; return null; } return x.value; },
      put: (k, v, ttl) => { p.calls.push('cache.put ' + scope + ' ' + k + ' ttl=' + ttl); store[k] = { value: String(v), expires: p.now + (ttl === undefined ? 600 : ttl) * 1000 }; },
      remove: k => { p.calls.push('cache.remove ' + scope + ' ' + k); delete store[k]; }
    };
  }
  lock() {
    const p = this; let mine = false;
    return {
      tryLock: ms => {
        p.tryLockAttempts++;
        if (p.lockHeld && p.tryLockAttempts <= p.lockFreesAfter) return false;
        mine = true; p.calls.push('lock.acquired'); return true;
      },
      hasLock: () => mine,
      releaseLock: () => { if (mine) p.calls.push('lock.released'); mine = false; }
    };
  }
  /**
   * ScriptApp with real bookkeeping: newTrigger(fn).timeBased().everyHours(n) / .forSpreadsheet(ss).onEdit() ... .create(), getProjectTriggers(),
   * getUserTriggers(ss) (as in Apps Script: time-based triggers are NOT listed there), deleteTrigger(t).
   */
  scriptApp() {
    const p = this;
    const wrap = rec => ({ getUniqueId: () => rec.id, getHandlerFunction: () => rec.fn, getEventType: () => rec.type, getTriggerSourceId: () => rec.source, __rec: rec });
    const builder = fn => {
      const t = { fn, type: null, source: null, params: {} };
      const b = {
        timeBased: () => { t.type = 'CLOCK'; return b; },
        everyHours: n => { t.params.everyHours = n; return b; },
        everyDays: n => { t.params.everyDays = n; return b; },
        forSpreadsheet: ss => { t.source = typeof ss === 'string' ? ss : ss.getId(); return b; },
        onEdit: () => { t.type = 'ON_EDIT'; return b; },
        onChange: () => { t.type = 'ON_CHANGE'; return b; },
        create: () => {
          const rec = { id: 'trig-' + (++p.triggerSeq), fn: t.fn, type: t.type, source: t.source, params: t.params };
          p.triggers.push(rec); p.calls.push('trigger.create ' + t.fn + ' ' + t.type);
          return wrap(rec);
        }
      };
      return b;
    };
    return {
      AuthMode: { NONE: 'NONE' }, EventType: { CLOCK: 'CLOCK', ON_EDIT: 'ON_EDIT', ON_CHANGE: 'ON_CHANGE' },
      newTrigger: builder,
      getProjectTriggers: () => p.triggers.map(wrap),
      getUserTriggers: () => p.triggers.filter(x => x.type !== 'CLOCK').map(wrap),
      deleteTrigger: t => { p.calls.push('trigger.delete ' + t.getUniqueId()); p.triggers = p.triggers.filter(x => x.id !== t.getUniqueId()); }
    };
  }

  /** What a service getter returns when it is broken on purpose: null ("no document in this scope") or an exception. */
  guard(kind, scope, make) {
    const mode = this.broken[kind + '.' + scope];
    if (mode === 'null') return null;
    if (mode === 'throw') throw new Error('Simulated ' + kind + ' failure in scope ' + scope);
    return make();
  }

  /** The global names a fresh execution gets. */
  globals() {
    const p = this;
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const g = { Logger: { log() {} }, console: { log() {}, error: (...a) => { p.consoleErrors.push(a.join(' ')); } } };
    g.PropertiesService = {}; g.CacheService = {};
    ['document', 'user', 'script'].forEach(scope => {
      g.PropertiesService['get' + cap(scope) + 'Properties'] = () => p.guard('properties', scope, () => p.propertiesService(scope));
      g.CacheService['get' + cap(scope) + 'Cache'] = () => p.guard('cache', scope, () => p.cacheService(scope));
    });
    g.LockService = { getScriptLock: () => p.lock(), getDocumentLock: () => p.lock(), getUserLock: () => p.lock() };
    g.Utilities = { sleep: ms => { p.advance(ms / 1000); } };
    g.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => 'ss-1', getSheetByName: () => null }), getUi: () => ({ alert() {} }), flush() {} };
    g.XmlService = { getNamespace: () => ({}) };            // Metadata.js calls it at load time (allowed by Apps Script, noted in docs)
    g.ScriptApp = this.scriptApp();
    return g;
  }

  /**
   * A fresh global scope with the project's files loaded (names relative to the repository root).
   * Returns { ctx, eval(code), get(name) }. Loading fails the test if any file does something at load time that needs more than these fakes.
   */
  execution(files, extraGlobals) {
    const ctx = vm.createContext(Object.assign(this.globals(), extraGlobals || {}));
    files.forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    return { ctx, eval: code => vm.runInContext(code, ctx), get: name => vm.runInContext(name, ctx) };
  }
}

module.exports = { FakePlatform };
