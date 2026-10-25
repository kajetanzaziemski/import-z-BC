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

  test('controller: registerClosingOnce registers a flag once per EXECUTION (one run per execution; the saves of the settings and logs and the status check rely on it)', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.run('requestA', () => { Controller.registerClosingOnce(() => __log.push('once'), 'f'); Controller.registerClosingOnce(() => __log.push('twice'), 'f'); });
             Controller.run('requestB', () => { Controller.registerClosingOnce(() => __log.push('later'), 'f'); });`);
    assert.deepStrictEqual(plain(log), ['once']);
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

  // ---- no nested runs, nothing is lost in the closing phase (bugs-todo #2) ---------------------------------------------------------------
  const AGENT_FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
    'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js'];

  test('controller: turning the add-on ON repairs the agents (edit + change trigger) and the logs and the agent pair are SAVED (bugs-todo #2: they were lost)', () => {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: false, importSheetName: 'Ustawienia' });
    const ex = p.execution(AGENT_FILES);
    ex.eval(`Controller.run('menuSomething', () => 'ok')`);          // a menu action: switches ON, the status check at the end installs the agents
    assert.deepStrictEqual(p.triggers.map(x => [x.fn, x.type]), [['sheetEdit', 'ON_EDIT'], ['sheetChange', 'ON_CHANGE']]);
    const ids = p.triggers.map(x => x.id);
    const doc = JSON.parse(p.props.document.docTriggerArray), usr = JSON.parse(p.props.user.usrTriggerArray), pairs = JSON.parse(p.props.user.agentArray);
    assert.deepStrictEqual(doc.map(x => [x.triggerId, x.powerOn]), ids.map(id => [id, true]), 'document log');
    assert.deepStrictEqual(usr.map(x => x.triggerId), ids, 'user log');
    assert.deepStrictEqual(pairs, [ids], 'agent array');
    assert.strictEqual(JSON.parse(p.props.document.importSettingsArray).addonStatus, true);
    assert.deepStrictEqual(p.consoleErrors, [], 'and no nested run was needed');
  });

  test('controller: closing actions registered while the closing actions run are executed too (in order, after the ones already queued)', () => {
    const { ex, log } = setup();
    ex.eval(`Controller.run('requestA', () => {
      Controller.registerClosing(() => { __log.push('c1'); Controller.registerClosing(() => __log.push('late')); });
      Controller.registerClosing(() => __log.push('c2'));
    })`);
    assert.deepStrictEqual(plain(log), ['c1', 'c2', 'late']);
  });

  test('controller: a closing action that keeps registering itself cannot loop forever (the closing phase gives up and says so)', () => {
    const { p, ex, log } = setup();
    ex.eval(`const again = () => { __log.push('x'); Controller.registerClosing(again); };
             Controller.run('requestA', () => { Controller.registerClosing(again); })`);
    assert.ok(log.length >= 100 && log.length <= 10000, 'ran ' + log.length + ' times');
    assert.ok(p.consoleErrors.some(m => /closing actions/i.test(m)));
  });

  test('controller: a run started inside a run is a mistake: the work is done inline (nothing breaks), it is reported loudly, and it has no gate / closing list / live-check frame of its own', () => {
    const { p, ex, log } = setup();
    const r = ex.eval(`Controller.run('requestOuter', () => {
      const inner = Controller.run('requestInner', () => { Controller.registerClosing(() => __log.push('inner-closing')); __log.push('inner-action'); return 42; });
      __log.push('outer-after:' + inner);
      return 'outer';
    })`);
    assert.strictEqual(r, 'outer');
    assert.deepStrictEqual(plain(log), ['inner-action', 'outer-after:42', 'inner-closing'], 'the inner closing action belongs to the outer run');
    assert.ok(p.consoleErrors.some(m => /NESTED RUN/.test(m) && /requestInner/.test(m) && /requestOuter/.test(m)), p.consoleErrors.join('|'));
  });

  test('controller: a nested run started from a closing action is reported the same way', () => {
    const { p, ex, log } = setup();
    ex.eval(`Controller.run('requestOuter', () => { Controller.registerClosing(() => { Controller.run('requestInner', () => __log.push('inner')); }); })`);
    assert.deepStrictEqual(plain(log), ['inner']);
    assert.ok(p.consoleErrors.some(m => /NESTED RUN/.test(m)));
  });

  test('controller: an error in a nested (inline) action reaches the outer run, which still runs its closing actions and rethrows', () => {
    const { ex, log } = setup();
    assert.throws(() => ex.eval(`Controller.run('requestOuter', () => { Controller.registerClosing(() => __log.push('closing')); Controller.run('requestInner', () => { throw new Error('inner boom'); }); })`), /inner boom/);
    assert.deepStrictEqual(plain(log), ['closing']);
  });

  // ---- every platform entry goes through the Controller; nothing else does ------------------------------------------------------------------
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  // the add-on's code (the live check framework and verifiers are not entry points; its sidebar server file has the menu item liveCheckSidebar)
  const SOURCES = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^(Live Check\.js|Live Check Verifiers\.js|Test Functions|Grid)/.test(f) && f !== 'Controller.js');

  /** The body of a top-level `function name(...) { ... }` (braces counted), or null. */
  function functionBody(name) {
    for (const f of SOURCES) {
      const text = strip(read(f));
      const m = text.match(new RegExp('(?:^|\\n)function ' + name + '\\s*\\('));
      if (!m) continue;
      let i = text.indexOf('{', m.index + m[0].length), depth = 0;
      for (let j = i; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}' && --depth === 0) return { file: f, body: text.slice(i, j + 1) }; }
    }
    return null;
  }

  /** What the platform calls: triggers, menu items, sidebar server calls, the OAuth callback. */
  function platformEntries() {
    const names = new Set(['onOpen', 'onEdit', 'sheetEdit', 'sheetChange', 'autoRefreshHandler', 'autoRefresh', 'authCallback']);
    (strip(read('Menu.js')).match(/addItem\('[^']*',\s*'(\w+)'\)/g) || []).forEach(m => names.add(m.match(/'(\w+)'\)$/)[1]));
    // sidebar calls: a method call `.name(` in a page that uses google.script.run, where `name` is a function the code defines
    const defined = new Set();
    SOURCES.forEach(f => (strip(read(f)).match(/(?:^|\n)function (\w+)\s*\(/g) || []).forEach(m => defined.add(m.match(/function (\w+)/)[1])));
    fs.readdirSync(ROOT).filter(f => /\.html$/.test(f) && !/^Live Check/.test(f)).forEach(f => {
      const text = read(f);
      if (!/google\.script\.run/.test(text)) return;
      (text.match(/\.(\w+)\s*\(/g) || []).forEach(m => { const n = m.match(/\.(\w+)/)[1]; if (defined.has(n)) names.add(n); });
    });
    return [...names].filter(n => !/^with/.test(n)).sort();
  }

  test('rule: every function the platform calls (triggers, menu items, sidebar calls, the OAuth callback) goes through Controller.run', () => {
    const entries = platformEntries();
    assert.ok(entries.length >= 25, 'found ' + entries.length + ' entries: ' + entries.join(', '));
    const missing = [], notFound = [];
    entries.forEach(n => {
      const f = functionBody(n);
      if (!f) return notFound.push(n);
      if (!/Controller\.run\(/.test(f.body)) missing.push(n + ' (' + f.file + ')');
    });
    assert.deepStrictEqual(notFound, [], 'entry points that are not top-level functions (renamed?)');
    assert.deepStrictEqual(missing, [], 'entry points that bypass the Controller');
  });

  test('rule: onOpen is the one exception - the menu is built first, outside the Controller, in every auth mode; the rest is an ordinary run', () => {
    const f = functionBody('onOpen');
    assert.ok(/menuSelector\(\);[\s\S]*Controller\.run\("onOpen"/.test(f.body), f.body);
    assert.ok(/e\.authMode != ScriptApp\.AuthMode\.NONE\)\s*Controller\.run\("onOpen"/.test(f.body), 'the run only where the script is authorised');
  });

  test('rule: Controller.run is called only from entry points (no helper wraps itself) and Controller.checked is gone', () => {
    const entries = new Set(platformEntries());
    const offenders = [];
    SOURCES.forEach(f => {
      const text = strip(read(f));
      let at = -1;
      while ((at = text.indexOf('Controller.run(', at + 1)) >= 0) {
        const before = text.slice(0, at);
        const m = [...before.matchAll(/(?:^|\n)function (\w+)\s*\(/g)].pop();
        const inFunction = m ? m[1] : '(class or top level)';
        if (!entries.has(inFunction)) offenders.push(f + ': ' + inFunction);
      }
    });
    assert.deepStrictEqual(offenders, [], 'Controller.run inside a function that is not an entry point');
    assert.ok(!/function checked\(/.test(read('Controller.js')) && !/\bchecked\b[,\s}]/.test(read('Controller.js').match(/return \{[^}]*\}/)[0]));
    SOURCES.forEach(f => assert.ok(!/Controller\.checked/.test(strip(read(f))), f));
  });

  test('rule: the only server functions outside the Controller are the three the live check sidebar polls every few seconds (they would fill their own list)', () => {
    const html = read('Live Check Sidebar.html');
    const polled = ['liveCheckSidebarData', 'liveCheckSidebarDetail', 'liveCheckSidebarSetEnabled'];
    polled.forEach(n => assert.ok(new RegExp('\\.' + n + '\\s*\\(').test(html), n + ' is called by the sidebar'));
    const server = strip(read('Live Check Sidebar Server.js'));
    polled.forEach(n => {
      const m = server.match(new RegExp('(?:^|\\n)function ' + n + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
      assert.ok(m && !/Controller\./.test(m[0]), n);
    });
  });


  // ---- UnknownError: the caller gets the original error ----------------------------------------------------------------------------------------
  test('controller: an UnknownError thrown by the action is replaced by the original error it wraps; the wrapper is logged whole; closing actions still run', () => {
    const { p, ex, log } = setup();
    ex.eval(`globalThis.__inner = new TypeError('the original');
             globalThis.__thrown = null;
             try { Controller.run('requestA', () => { Controller.registerClosing(() => __log.push('closing')); throw new UnknownError('while creating the trigger', __inner); }); }
             catch (err) { __thrown = err; }`);
    assert.strictEqual(ex.eval(`__thrown === __inner`), true, 'the very same original error object');
    assert.deepStrictEqual(plain(log), ['closing']);
    assert.ok(p.consoleErrors.some(m => /\[requestA\]/.test(m) && /while creating the trigger/.test(m)), 'the wrapper with its context message is in the log: ' + p.consoleErrors.join('|'));
  });

  test('controller: an UnknownError without an original error gives a SimpleError with its message; other errors are passed on as they are', () => {
    const { ex } = setup();
    ex.eval(`globalThis.__t = null; try { Controller.run('requestA', () => { throw new UnknownError('no inner'); }); } catch (err) { __t = err; }`);
    assert.deepStrictEqual(plain(ex.eval(`[__t instanceof SimpleError, __t.message]`)), [true, 'no inner']);
    const ordinary = setup();
    ordinary.ex.eval(`globalThis.__same = new RangeError('plain'); globalThis.__t = null; try { Controller.run('requestA', () => { throw __same; }); } catch (err) { __t = err; }`);
    assert.strictEqual(ordinary.ex.eval(`__t === __same`), true);
  });

  test('controller: an UnknownError from a closing-phase-free action also reaches the live check as the original error (the check sees what the caller gets)', () => {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: 'Ustawienia' });
    const seen = [];
    const ex = p.execution(FILES, { __seen: seen });
    ex.eval(`globalThis.liveCheckBegin = () => ({}); globalThis.liveCheckEnd = (frame, error) => __seen.push(error && error.message);
             try { Controller.run('requestA', () => { throw new UnknownError('wrapper', new Error('inner message')); }); } catch (err) {}`);
    assert.deepStrictEqual(plain(seen), ['inner message']);
  });
};
