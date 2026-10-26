// The cache of the sheets the add-on manages (Managed Sheets.js): which sheet is a config sheet, answered without building the settings sheet object
// (bugs-todo #10). Filled when the document opens, refreshed whenever the settings sheet or its edits change the list, expires after an hour.
// Real: Router.js, Managed Sheets.js, Quick Start.js, Controller, Settings / Store. Faked (counting): the settings sheet object and the co-editor.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js',
  'Managed Sheets.js', 'AnalyseConfig.js', 'Router.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

module.exports = function register(t) {
  const { test } = t;
  const plain = v => JSON.parse(JSON.stringify(v));

  const FAKES = `
    globalThis.SheetCoeditor = class {
      constructor(name) { __log.push(['coed.new', name]); }
      sheetEdit() {}
      switchReadingControl() {}
    };
    getMainSettings = () => {
      __cfg.builds++;
      return {
        getConfigSheetNames: () => __cfg.configSheets.slice(),
        isConfigSheet: name => __cfg.configSheets.includes(name),
        isRefreshFrequencyCell: () => !!__cfg.freqCell,
        setRefreshTrigger: () => __log.push(['setRefreshTrigger'])
      };
    };`;

  /** One platform (documents properties and cache live on); every call of run() is a fresh execution. */
  function world(over) {
    const cfg = Object.assign({ configSheets: ['Konfiguracja 1'], builds: 0, settingsSheet: 'Ustawienia', freqCell: false, settingsExists: true }, over || {});
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: cfg.settingsSheet });
    p.props.document.docTriggerArray = JSON.stringify([{ triggerId: 't1', trigEventType: 'ON_EDIT', trigFunction: 'sheetEdit', dateCreated: '2020-01-01', lastUsed: '2020-01-01', SsId: 'ss-1', powerOn: true }]);
    const log = [];
    const w = { p, cfg, log, calls: () => plain(log) };
    w.execute = (code, extra) => {
      const ex = p.execution(FILES, Object.assign({ __cfg: w.cfg, __log: log }, extra || {}));
      ex.eval(`Agents.ensureActive = () => {}; globalThis.Grid = { exists: () => __cfg.settingsExists }; globalThis.menuSelector = () => {};`);
      ex.eval(FAKES);
      return ex.eval(code);
    };
    const event = (active, type) => ({ triggerUid: 't1', changeType: type, range: { getSheet: () => ({ getName: () => active }), getA1Notation: () => 'B2', getRow: () => 2, getLastRow: () => 2, getColumn: () => 2, getLastColumn: () => 2 },
      source: { getActiveSheet: () => ({ getName: () => active }) } });
    w.edit = (active) => w.execute(`sheetEdit(__e)`, { __e: event(active) });
    w.change = (active, type = 'INSERT_ROW') => w.execute(`sheetChange(__e)`, { __e: event(active, type) });
    w.cached = () => { const x = p.cache.document.managedSheets; return x ? JSON.parse(x.value) : null; };
    w.intents = () => log.filter(c => c[0] === 'intent').map(c => c[1]);
    return w;
  }
  
  test('managed sheets: the first edit of a document builds the settings sheet object once and caches the list; every later edit answers from the cache', () => {
    const w = world();
    w.edit('Arkusz1');
    assert.strictEqual(w.cfg.builds, 1);
    assert.deepStrictEqual(w.cached(), { settings: 'Ustawienia', configs: ['Konfiguracja 1'] });
    w.edit('Arkusz1'); w.edit('Arkusz2'); w.change('Arkusz1', 'INSERT_GRID');
    assert.strictEqual(w.cfg.builds, 1, 'three more events, no build');
  });

  test('managed sheets: from the cache an edit in a config sheet is still config.coedit and anywhere else sheet.ignored - decided without the settings sheet', () => {
    const w = world();
    w.execute(`ManagedSheets.rebuild()`);
    w.cfg.builds = 0;
    const run = (active, kind = 'edit') => { w.log.length = 0; w.execute(`liveCheckIntent = (n) => __log.push(['intent', n]); ${kind === 'edit' ? 'sheetEdit' : 'sheetChange'}(__e)`, { __e: kind === 'edit' ? { triggerUid: 't1', range: { getSheet: () => ({ getName: () => active }), getRow: () => 2, getLastRow: () => 2, getColumn: () => 2, getLastColumn: () => 2, getA1Notation: () => 'B2' }, source: { getActiveSheet: () => ({ getName: () => active }) } } : { triggerUid: 't1', changeType: 'INSERT_ROW', source: { getActiveSheet: () => ({ getName: () => active }) } } }); return w.intents(); };
    assert.deepStrictEqual(run('Konfiguracja 1'), ['config.coedit']);
    assert.deepStrictEqual(run('Arkusz1'), ['sheet.ignored']);
    assert.deepStrictEqual(run('Konfiguracja 1', 'change'), ['config.coedit']);
    assert.deepStrictEqual(run('Arkusz1', 'change'), ['sheet.ignored']);
    assert.strictEqual(w.cfg.builds, 0, 'the settings sheet object was never built');
  });

  test('managed sheets: an edit in the settings sheet builds it (it needs the refresh frequency cell) and stores the list the sheet has NOW', () => {
    const w = world();
    w.edit('Arkusz1');
    w.cfg.configSheets = ['Konfiguracja 1', 'Konfiguracja 2'];          // the user typed a new config line in the settings sheet
    w.edit('Ustawienia');
    assert.deepStrictEqual(w.cached().configs, ['Konfiguracja 1', 'Konfiguracja 2']);
    const builds = w.cfg.builds;
    assert.strictEqual(plain(w.execute(`Router.routeEdit(__e).intent`, { __e: { range: {}, source: { getActiveSheet: () => ({ getName: () => 'Konfiguracja 2' }) } } })), 'config.coedit');
    assert.strictEqual(w.cfg.builds, builds, 'the new config sheet is recognised from the cache');
  });

  test('managed sheets: a structure change in the settings sheet (a line inserted or deleted by hand) refreshes the list too, and stays sheet.ignored', () => {
    const w = world();
    w.edit('Arkusz1');
    w.cfg.configSheets = [];
    assert.strictEqual(plain(w.execute(`Router.routeChange({ changeType: 'REMOVE_ROW', source: { getActiveSheet: () => ({ getName: () => 'Ustawienia' }) } }).intent`)), 'sheet.ignored');
    assert.deepStrictEqual(w.cached().configs, []);
  });

  test('managed sheets: the entry expires after about an hour - the next event builds the settings sheet object again and caches anew', () => {
    const w = world();
    w.edit('Arkusz1');
    assert.ok(w.p.calls.some(c => /^cache\.put document managedSheets ttl=3600$/.test(c)), w.p.calls.join('\n'));
    w.p.advance(3599); w.edit('Arkusz1');
    assert.strictEqual(w.cfg.builds, 1, 'still cached');
    w.p.advance(2); w.edit('Arkusz1');
    assert.strictEqual(w.cfg.builds, 2, 'expired: built again');
  });

  test('managed sheets: a cached list from before the settings sheet was renamed is not used (the entry carries the name of the settings sheet)', () => {
    const w = world();
    w.edit('Arkusz1');
    w.p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: 'Inne ustawienia' });
    w.edit('Arkusz1');
    assert.strictEqual(w.cfg.builds, 2);
    assert.strictEqual(w.cached().settings, 'Inne ustawienia');
  });

  test('managed sheets: no cache service (broken / null) - the router still works, it just builds the settings sheet object every time', () => {
    const ev = { __e: { range: {}, source: { getActiveSheet: () => ({ getName: () => 'Konfiguracja 1' }) } } };
    ['null', 'throw'].forEach(kind => {
      const w = world(); w.p.broken['cache.document'] = kind;
      assert.strictEqual(plain(w.execute(`Router.routeEdit(__e).intent`, ev)), 'config.coedit');
      assert.strictEqual(plain(w.execute(`Router.routeEdit(__e).intent`, ev)), 'config.coedit');
      assert.strictEqual(w.cfg.builds, 2, kind);
    });
  });

  test('managed sheets: opening the document fills the cache; with no settings sheet it creates nothing and caches nothing; it never breaks the open', () => {
    const w = world();
    w.execute(`onOpen({ authMode: 'FULL' })`);
    assert.deepStrictEqual(w.cached(), { settings: 'Ustawienia', configs: ['Konfiguracja 1'] });
    const none = world({ settingsExists: false });
    none.execute(`onOpen({ authMode: 'FULL' })`);
    assert.strictEqual(none.cached(), null);
    assert.strictEqual(none.cfg.builds, 0, 'the settings sheet object (which would create the sheet) is not built');
    const bad = world(); bad.cfg.configSheets = null;                    // the build fails
    assert.doesNotThrow(() => bad.execute(`onOpen({ authMode: 'FULL' })`));
    const unauthorised = world();
    unauthorised.execute(`onOpen({ authMode: ScriptApp.AuthMode.NONE })`);
    assert.strictEqual(unauthorised.cached(), null, 'where the script is not authorised nothing is read');
  });

  test('managed sheets: the add-on OFF - onOpen does nothing (the gate), so nothing is cached', () => {
    const w = world();
    w.p.props.document.importSettingsArray = JSON.stringify({ addonStatus: false, importSheetName: 'Ustawienia' });
    w.execute(`onOpen({ authMode: 'FULL' })`);
    assert.strictEqual(w.cached(), null);
  });

  test('rule: the router and the entry points ask ManagedSheets; getMainSettings() is built there only for the settings sheet itself', () => {
    const code = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const router = code('Router.js');
    assert.ok(/ManagedSheets\.isConfigSheet\(sheet\)/.test(router));
    assert.ok(!/getMainSettings\(\)\.isConfigSheet/.test(router));
    assert.ok(/ManagedSheets\.warmUp\(\)/.test(code('Quick Start.js')));
  });
};
