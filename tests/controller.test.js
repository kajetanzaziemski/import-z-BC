// Tests of Controller.run's closing actions: what registered before a run, during it, and in nested runs does at the end. Registered by tests/run.js.
//
// Background (docs/bugs-todo.md #1): the installable edit trigger evaluates MainSettings.getAddonStatus() for its log line BEFORE Controller.run().
// That builds the import settings StorageObject, which registers its save as a closing action; run() then threw the list away, so every setting changed in
// that execution (the refresh permit of a new time trigger!) was never saved.
'use strict';
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'functions.js'];

module.exports = function register(t) {
  const { test } = t;
  const plain = v => JSON.parse(JSON.stringify(v));
  function setup(addonOn) {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: addonOn !== false, importSheetName: 'Ustawienia' });
    const log = [];
    const ex = p.execution(FILES, { __log: log });
    return { p, ex, log };
  }
  const stored = p => JSON.parse(p.props.document.importSettingsArray);

  // ---- the bug ------------------------------------------------------------------------------------------------------------
  test('controller: a closing action registered BEFORE the run belongs to that run and is executed at its end (bugs-todo #1)', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.registerClosing(() => __log.push('closing'));
             Controller.run('requestA', () => { __log.push('action'); })`);
    assert.deepStrictEqual(plain(log), ['action', 'closing']);
  });

  test('controller: the import settings touched before the run (the trigger\'s log line) are saved when the run changed them', () => {
    const { p, ex } = setup();
    ex.eval(`MainSettings.getAddonStatus();                                      // what sheetEdit's first line does
             Controller.run('requestA', () => { MainSettings.setRefreshPermit('trig-1', 6); })`);
    assert.strictEqual(stored(p).refreshPermit.issuedFor, 'trig-1');
    assert.strictEqual(stored(p).addonStatus, true, 'the rest is intact');
  });

  test('controller: sheetEdit-style entry (log line first, then run) keeps a setting written inside the run', () => {
    const { p, ex } = setup();
    ex.eval(`function entry() { MainSettings.getAddonStatus(); Controller.registerInit(() => {}); Controller.run('requestB', () => { Settings.set('custom', { n: 1 }); }); }
             entry()`);
    assert.deepStrictEqual(stored(p).custom, { n: 1 });
  });

  // ---- what must stay as it is ------------------------------------------------------------------------------------------------
  test('controller: closing actions registered during the run run once, after the action, in order, also when the action fails', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.run('requestA', () => { Controller.registerClosing(() => __log.push('c1')); Controller.registerClosing(() => __log.push('c2')); __log.push('action'); })`);
    assert.deepStrictEqual(plain(log), ['action', 'c1', 'c2']);
    const f = setup();
    assert.throws(() => f.ex.eval(`Controller.run('requestA', () => { Controller.registerClosing(() => __log.push('c1')); throw new Error('boom'); })`), /boom/);
    assert.deepStrictEqual(plain(f.log), ['c1']);
  });

  test('controller: a second run in the same execution does not repeat the first run\'s closing actions', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.run('requestA', () => { Controller.registerClosing(() => __log.push('first')); });
             Controller.run('requestB', () => { Controller.registerClosing(() => __log.push('second')); });`);
    assert.deepStrictEqual(plain(log), ['first', 'second']);
  });

  test('controller: a failing closing action does not stop the others', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.run('requestA', () => { Controller.registerClosing(() => { throw new Error('x'); }); Controller.registerClosing(() => __log.push('after')); })`);
    assert.deepStrictEqual(plain(log), ['after']);
  });

  test('controller: registerClosingOnce registers a flag once per execution (the status check after turning the add-on on relies on it)', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.run('requestA', () => { Controller.registerClosingOnce(() => __log.push('once'), 'f'); Controller.registerClosingOnce(() => __log.push('twice'), 'f'); });
             Controller.run('requestB', () => { Controller.registerClosingOnce(() => __log.push('later'), 'f'); });`);
    assert.deepStrictEqual(plain(log), ['once']);
  });

  test('controller: a run started from a closing action (nested) has its own closing actions; the outer run\'s remaining ones still run', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.run('requestOuter', () => {
      Controller.registerClosing(() => { __log.push('outer-1'); Controller.run('requestInner', () => { Controller.registerClosing(() => __log.push('inner-closing')); __log.push('inner-action'); }); });
      Controller.registerClosing(() => __log.push('outer-2'));
    })`);
    assert.deepStrictEqual(plain(log), ['outer-1', 'inner-action', 'inner-closing', 'outer-2']);
  });

  test('controller: with the add-on OFF an ordinary action is not run (null) and its closing actions are not either; "request..." actions run; "menu..." turns the add-on ON', () => {
    const { p, ex, log } = setup(false);
    assert.strictEqual(ex.eval(`Controller.run('someAction', () => { Controller.registerClosing(() => __log.push('closing')); __log.push('action'); return 1; })`), null);
    assert.deepStrictEqual(plain(log), []);
    assert.strictEqual(ex.eval(`Controller.run('requestX', () => 'ran')`), 'ran');
    assert.strictEqual(ex.eval(`Controller.run('menuX', () => 'ran')`), 'ran');
    ex.eval(`getImportSettings().saveArray()`);
    assert.strictEqual(stored(p).addonStatus, true);
  });

  test('controller: what an OFF run was handed before it started does not leak into the next run', () => {
    const { ex, log } = setup(false);
    ex.eval(`Controller.registerClosing(() => __log.push('stale'));
             Controller.run('someAction', () => 1);               // OFF: skipped
             MainSettings.setAddonStatus(true);
             Controller.run('requestA', () => { __log.push('action'); });`);
    assert.deepStrictEqual(plain(log), ['action']);
  });

  test('controller: the initial actions run before every action, with the run\'s context', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.registerInit(ctx => __log.push('init:' + ctx.actionName));
             Controller.run('requestA', () => __log.push('action'));
             Controller.run('requestB', () => __log.push('action'));`);
    assert.deepStrictEqual(plain(log), ['init:requestA', 'action', 'init:requestB', 'action'], 'a registered initial action runs before every action, with that run\'s context');
  });
};
