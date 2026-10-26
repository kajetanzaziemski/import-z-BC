// The login flow (BC Auth.js, BC Connection.js): how the OAuth2 service is built, who asks it for what, the authorisation sidebar, the OAuth callback, the BC fetch and logout.
// Written FIRST against the flat functions (getBCService_, showSidebar, authCallback, logout, BCConnection); the move into BCAuth must keep all of it green (the old global names are gone since the BC layer was reorganised: the tests call BCAuth).
// REAL: BC Auth.js, BC Connection.js, Controller / Settings / Store, Global Add-on Settings, Menu Actions. FAKED: the OAuth2 library (records the chain), UrlFetchApp, the UI.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js',
  'BC Auth.js', 'BC Connection.js', 'Menu.js', 'Menu Actions.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

module.exports = function register(t) {
  const { test } = t;
  const plain = v => JSON.parse(JSON.stringify(v));

  function scenario(over) {
    const cfg = Object.assign({ access: true, handle: true, fetchError: null }, over || {});
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: 'Ustawienia' });
    const log = [];
    const menu = () => ({ addItem() { return menu(); }, addSubMenu() { return menu(); }, addToUi() { log.push(['menu.built']); }, createMenu: () => menu() });
    const ui = { alert: m => log.push(['alert', m]), showSidebar: page => log.push(['sidebar', page.html]), createAddonMenu: () => menu(), createMenu: () => menu() };
    const calls = [];
    const chain = new Proxy({}, { get: (tg, name) => {
      if (name === 'then') return undefined;
      if (name === 'hasAccess') return () => { log.push(['service.hasAccess']); return cfg.access; };
      if (name === 'getAccessToken') return () => { log.push(['service.getAccessToken']); return 'TOKEN'; };
      if (name === 'getAuthorizationUrl') return () => 'https://login/authorize?x=1';
      if (name === 'handleCallback') return r => { log.push(['service.handleCallback', plain(r)]); return cfg.handle; };
      if (name === 'reset') return () => log.push(['service.reset']);
      return (...args) => { calls.push([name, ...args.map(a => (typeof a === 'object' || typeof a === 'function') ? '<' + typeof a + '>' : a)]); return chain; };
    } });
    const ex = p.execution(FILES, {
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => 'ss-1', getSheetByName: () => null }), flush() {}, getUi: () => ui },
      __log: log, __cfg: cfg, CLIENT_ID_: 'id', CLIENT_SECRET_: 'secret', SCOPE_: 'scope',
      HtmlService: {
        createTemplate: text => { const tpl = { text, evaluate: () => ({ html: text.replace('<?= authorizationUrl ?>', tpl.authorizationUrl) }) }; return tpl; },
        createHtmlOutput: text => ({ output: text })
      },
      UrlFetchApp: { fetch: (url, opts) => { log.push(['fetch', url, opts]); if (cfg.fetchError) throw new Error(cfg.fetchError); return { ok: true }; } },
      OAuth2: { createService: name => { log.push(['oauth.create', name]); return chain; } }
    });
    ex.eval(`
      Agents.ensureActive = () => {};
      getGlobalSettings().setAllPropertiesForScope('document', 'tenant-1', 'Env', 'Firma');`);
    return { p, ex, log, calls: () => plain(log), cfgCalls: () => plain(calls) };
  }

  test('login: the OAuth2 service is built with the tenant name, the BC urls, the client, the callback authCallback, user properties / cache / lock, scope and offline consent (every call, in order)', () => {
    const s = scenario();
    s.ex.eval(`BCAuth.service()`);
    assert.deepStrictEqual(s.calls(), [['oauth.create', 'tenant-1']]);
    assert.deepStrictEqual(s.cfgCalls(), [
      ['setAuthorizationBaseUrl', 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize'],
      ['setTokenUrl', 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token'],
      ['setClientId', 'id'], ['setClientSecret', 'secret'], ['setCallbackFunction', 'authCallback'],
      ['setPropertyStore', '<object>'], ['setCache', '<object>'], ['setLock', '<object>'],
      ['setScope', 'scope'], ['setParam', 'access_type', 'offline'], ['setParam', 'prompt', 'consent']]);
  });

  test('login: BCAuth.authorise - without access it shows the authorisation link in a sidebar; with access it shows nothing', () => {
    const a = scenario({ access: false });
    a.ex.eval(`BCAuth.authorise()`);
    assert.deepStrictEqual(a.calls().map(c => c[0]), ['oauth.create', 'service.hasAccess', 'sidebar']);
    assert.ok(a.calls()[2][1].includes('href="https://login/authorize?x=1"'));
    const b = scenario({ access: true });
    b.ex.eval(`BCAuth.authorise()`);
    assert.deepStrictEqual(b.calls().map(c => c[0]), ['oauth.create', 'service.hasAccess']);
  });

  test('login: authCallback - authorised: the menu is rebuilt and the page says the connection was made; denied: the menu is rebuilt too and the page says it failed', () => {
    const a = scenario({ handle: true });
    const out = plain(a.ex.eval(`authCallback({ parameter: { code: 'c' } })`));
    assert.deepStrictEqual(a.calls().map(c => c[0]), ['oauth.create', 'service.handleCallback', 'menu.built']);
    assert.deepStrictEqual(a.calls()[1][1], { parameter: { code: 'c' } });
    assert.ok(/nawiązane poprawnie/.test(out.output));
    const b = scenario({ handle: false });
    const out2 = plain(b.ex.eval(`authCallback({})`));
    assert.deepStrictEqual(b.calls().map(c => c[0]), ['oauth.create', 'service.handleCallback', 'menu.built']);
    assert.ok(/nieudane/.test(out2.output));
  });

  test('login: authCallback runs as the request "requestAuthCallback" (works with the add-on OFF) and reports its input to the live check first', () => {
    const a = scenario();
    a.p.props.document.importSettingsArray = JSON.stringify({ addonStatus: false, importSheetName: 'Ustawienia' });
    a.ex.eval(`globalThis.__inputs = []; globalThis.liveCheckInput = (n, d) => __inputs.push(n);`);
    a.ex.eval(`authCallback({})`);
    assert.deepStrictEqual(plain(a.ex.eval(`__inputs`)), ['requestAuthCallback']);
    assert.ok(a.calls().some(c => c[0] === 'service.handleCallback'), 'not gated by the OFF switch');
  });

  test('login: BCConnection.fetchURL sends the token as a Bearer header and mutes HTTP exceptions; the expired / too long errors become ConnectionError / a Polish message', () => {
    const a = scenario();
    a.ex.eval(`BCConnection.fetchURL('https://bc/x')`);
    assert.deepStrictEqual(a.calls().slice(-2), [['service.getAccessToken'], ['fetch', 'https://bc/x', { headers: { Authorization: 'Bearer TOKEN' }, muteHttpExceptions: true }]]);
    const b = scenario({ fetchError: 'Access not granted or expired.' });
    assert.strictEqual(b.ex.eval(`try { BCConnection.fetchURL('u'); 'no error' } catch (e) { e instanceof ConnectionError ? 'ConnectionError: ' + e.message : 'other ' + e }`), 'ConnectionError: Access not granted or expired.');
    const c = scenario({ fetchError: 'Limit Exceeded: URLFetch URL Length.' });
    assert.ok(/Zbyt długie zapytanie/.test(c.ex.eval(`try { BCConnection.fetchURL('u'); '' } catch (e) { e.message }`)));
    const d = scenario({ fetchError: 'boom' });
    assert.strictEqual(d.ex.eval(`try { BCConnection.fetchURL('u'); '' } catch (e) { e.message }`), 'boom');
  });

  test('login: logout resets the service (all stored tokens)', () => {
    const a = scenario();
    a.ex.eval(`BCAuth.logout()`);
    assert.deepStrictEqual(a.calls(), [['oauth.create', 'tenant-1'], ['service.reset']]);
  });

  test('login: the menu items - "Autoryzuj" checks access ONCE (hasAccess refreshes an expired token; it used to build the service and ask twice) and opens the sidebar only without it; "Wyloguj" resets', () => {
    const a = scenario({ access: false });
    a.ex.eval(`startAuthFlow()`);
    assert.deepStrictEqual(a.calls().map(c => c[0]), ['oauth.create', 'service.hasAccess', 'sidebar']);
    const b = scenario({ access: true });
    b.ex.eval(`startAuthFlow()`);
    assert.deepStrictEqual(b.calls().map(c => c[0]), ['oauth.create', 'service.hasAccess', 'alert']);
    const c = scenario();
    c.ex.eval(`logoutFlow()`);
    assert.deepStrictEqual(c.calls().map(x => x[0]), ['oauth.create', 'service.reset', 'menu.built']);
  });

  test('rule: only BC Auth.js talks to the OAuth2 library; the rest of the add-on asks BCAuth', () => {
    const offenders = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && f !== 'BC Auth.js' && !/^(Live Check|Test Functions)/.test(f))
      .filter(f => /OAuth2\.|getBCService_\(|\.getAccessToken\(|\.hasAccess\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')));
    assert.deepStrictEqual(offenders, []);
  });
};
