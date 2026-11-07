// Characterisation of the menu entry points that are not covered by tests/refresh.test.js (analyse, wizard, authorise, logout, connection settings) and of the
// "active sheet -> its config sheet" lookup the menu items share. Written FIRST against the code in Menu.js; the move into use cases must keep it green.
// REAL: Menu.js (+ the use case file once it exists), Controller / Settings / Store. FAKED: the settings sheet, AnalyseConfig, the OAuth service, the UI.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const BASE = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js',
  'BC Auth.js', 'BC Connection.js', 'Menu.js', 'Menu Actions.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

module.exports = function register(t) {
  const { test } = t;
  const plain = v => JSON.parse(JSON.stringify(v));

  function scenario(over) {
    const cfg = Object.assign({ activeSheet: 'Konfiguracja 1', configSheets: ['Konfiguracja 1'], access: true, wizard: { configSheet: 'Nowa konf' }, throwOn: null }, over || {});
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: 'Ustawienia' });
    const log = [];
    const menu = () => ({ addItem() { return menu(); }, addSubMenu() { return menu(); }, addToUi() { log.push(['menu.built']); }, createMenu: () => menu() });
    const app = {
      getActiveSpreadsheet: () => ({ getId: () => 'ss-1', getSheetByName: () => null }), flush() {},
      getActive: () => ({ getActiveSheet: () => ({ getName: () => cfg.activeSheet }) }),
      getUi: () => ({ alert: m => log.push(['alert', m]), showSidebar: h => log.push(['sidebar', h.title]), createAddonMenu: () => menu(), createMenu: () => menu() })
    };
    const ex = p.execution(['Custom errors.js', ...BASE.filter(f => f !== 'Custom errors.js')], {
      SpreadsheetApp: app, __log: log, __cfg: cfg,
      HtmlService: { createTemplateFromFile: n => ({ evaluate: () => ({ setTitle(x) { this.title = x; return this; }, file: n }) }), createTemplate: () => ({ evaluate: () => ({ title: 'auth' }) }) }
    });
    ex.eval(`
      Agents.ensureActive = () => {};
      globalThis.getMainSettings = () => ({
        getConfigSheetName: sheet => __cfg.configSheets.includes(sheet) ? sheet : null,
        isConfigSheet: sheet => __cfg.configSheets.includes(sheet) || sheet === __cfg.wizard.configSheet,
        addNewSheetInfo: () => { __log.push(['wizard.add']); return __cfg.wizard; }
      });
      globalThis.AnalyseConfig = { run: (sheet, e) => { __log.push(['analyse', sheet, e === undefined ? null : 'event']); } };
      BCAuth.authorise = () => { if (__cfg.access) return true; __log.push(['auth.sidebar']); return false; };
      BCAuth.logout = () => { __log.push(['logout']); if (__cfg.throwOn === 'logout') throw new Error('logout failed'); };
      globalThis.fullMenu = () => __log.push(['fullMenu']);`);
    return { p, ex, log, calls: () => plain(log) };
  }

  test('menu: "Analizuj zapytanie" analyses the config sheet of the active sheet; elsewhere it alerts once (and it is a request, not a menu run)', () => {
    const a = scenario();
    a.ex.eval(`checkConfigSheet()`);
    assert.deepStrictEqual(a.calls(), [['analyse', 'Konfiguracja 1', null]]);
    const b = scenario({ activeSheet: 'Arkusz1' });
    b.ex.eval(`checkConfigSheet()`);
    assert.deepStrictEqual(b.calls().map(c => c[0]), ['alert']);
    assert.ok(/nie jest arkszuem konfiguracji/.test(b.calls()[0][1]));
  });

  test('menu: the wizard adds a config sheet line and analyses the new config sheet', () => {
    const a = scenario();
    a.ex.eval(`insertImportWizard()`);
    assert.deepStrictEqual(a.calls(), [['wizard.add'], ['analyse', 'Nowa konf', null]]);
  });

  test('menu: authorise - with access it only says so; without access it opens the authorisation sidebar', () => {
    const a = scenario({ access: true });
    a.ex.eval(`startAuthFlow()`);
    assert.deepStrictEqual(a.calls(), [['alert', 'Połączenie aktywne!']]);
    const b = scenario({ access: false });
    b.ex.eval(`startAuthFlow()`);
    assert.deepStrictEqual(b.calls(), [['auth.sidebar']]);
  });

  test('menu: logout ends the connection, then rebuilds the menu when the run closes', () => {
    const a = scenario();
    a.ex.eval(`logoutFlow()`);
    assert.deepStrictEqual(a.calls(), [['logout'], ['fullMenu']]);
  });

  test('menu: a failing logout leaves the menu alone and the error reaches the caller', () => {
    const a = scenario({ throwOn: 'logout' });
    assert.throws(() => a.ex.eval(`logoutFlow()`), /logout failed/);
    assert.deepStrictEqual(a.calls(), [['logout']]);
  });

  test('menu: "Ustawienia" has three items, each opens the settings sidebar (title "Ustawienia") on its tab; the last three items are Ustawienia, Narzędzia programisty, Wyloguj', () => {
    const a = scenario();
    a.ex.eval(`globalThis.__tabs = []; { const f = StatusManager.statusSidebar; StatusManager.statusSidebar = t => { __tabs.push(t); return f.call(StatusManager, t); }; }`);
    a.ex.eval(`statusCheck()`); a.ex.eval(`connectionSetup()`); a.ex.eval(`autoRefreshSettings()`); a.ex.eval(`listAllTriggers()`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a.ex.eval(`__tabs`))), ['status', 'help', 'refresh']);
    assert.deepStrictEqual(a.calls(), [['sidebar', 'Ustawienia'], ['sidebar', 'Ustawienia'], ['sidebar', 'Ustawienia'], ['sidebar', 'Wszystkie Triggery w projekcie']]);
    const text = fs.readFileSync(path.join(ROOT, 'Menu.js'), 'utf8');
    assert.ok(/createMenu\('Ustawienia'\)\.addItem\('Ogólne','statusCheck'\)\.addItem\('Połączenie z BC','connectionSetup'\)\.addItem\('Auto-odświeżanie','autoRefreshSettings'\)/.test(text));
    const full = text.slice(text.indexOf('function fullMenu'), text.indexOf('/**', text.indexOf('function fullMenu')));
    const items = [...full.matchAll(/\.add(?:Item|SubMenu)\(([^,)]*)/g)].map(m => m[1]);
    assert.deepStrictEqual(items.slice(-3), ["settingsMenu_(ui", "devToolsMenu_(ui", "'Wyloguj'"]);
    assert.ok(!/Stan konfiguracji|Ustawienia połączenia BC/.test(text.replace(/\/\*[\s\S]*?\*\//g, '')), 'the old items are gone');
  });

  test('developer tools OFF (the version users get): no "Narzędzia programisty" in the menu, their server functions refuse to run, and the live check hooks never call into the live check', () => {
    const p = new FakePlatform(); p.developerTools = false;
    const names = [];
    const ex = p.execution(BASE, { __names: names, SpreadsheetApp: { getUi: () => { const m = n => ({ addItem: () => m(n), addSubMenu: s => { names.push(s.name); return m(n); }, addToUi() {}, name: n }); return { createAddonMenu: () => m('add-on'), createMenu: n => m(n) }; } } });
    ex.eval(`fullMenu()`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(names)), ['Ustawienia']);
    ['listAllTriggers()', 'refreshTriggersSidebar()', 'listProjectTriggers()', 'deleteAllAgents()', 'deleteAllInDocumentTriggerLog()', 'deleteAllInUserTriggerLog()']
      .forEach(call => assert.throws(() => ex.eval(call), /wyłączona/, call));
    ex.eval(`globalThis.__lc = 0; liveCheckBegin = liveCheckEnd = liveCheckInput = liveCheckNote = liveCheckIntent = () => { __lc++; };`);
    ex.eval(`Controller.run('requestAddonStatus', () => 1); Controller.checkInput('x', {}); Controller.checkNote('n'); Controller.intent('j', {})`);
    assert.strictEqual(ex.eval(`__lc`), 0, 'no hook is called');
    const text = fs.readFileSync(path.join(ROOT, 'Menu.js'), 'utf8');
    assert.ok(/if\(DeveloperTools\.enabled\) menu\.addSubMenu\(devToolsMenu_\(ui\)\)/.test(text));
  });

  test('menu: the action names the live check and the gate rely on are kept', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Menu.js'), 'utf8');
    ['requestCheckConfigSheet', 'menuSettingsConnection', 'menuSettingsGeneral', 'menuSettingsAutoRefresh', 'menuAuthFlow', 'menuInsertImportWizard', 'menuLogoutFlow', 'requestListAllTriggers']
      .forEach(a => assert.ok(text.includes('Controller.run("' + a + '"'), a));
  });

  test('rule: the menu entry points only wrap a use case in a run (no getActive / getMainSettings / RefreshSheet / OAuth calls in Menu.js, except the sidebars and the old-name forwarders)', () => {
    const entries = ['checkConfigSheet', 'refreshCurrentSheet', 'estimateForCurrentSheet', 'startAuthFlow', 'insertImportWizard', 'logoutFlow'];
    const text = fs.readFileSync(path.join(ROOT, 'Menu.js'), 'utf8');
    entries.forEach(n => {
      const body = text.slice(text.indexOf('function ' + n + '('));
      const fn = body.slice(0, body.indexOf('\n}') + 2);
      assert.ok(/Controller\.run\("(menu|request)\w+",\s*\(\)\s*=>\s*MenuActions\.\w+\(\)\)/.test(fn), n + ': ' + fn);
      assert.ok(!/getActive|getMainSettings|RefreshSheet|EstimateSheet|getBCService_/.test(fn), n);
    });
  });
};
