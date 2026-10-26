// "Pobierz dane dla wszystkich arkuszy" / "dla tego arkusza" with no connection to BC (not authorised, logged out): the run ends with the connection error and the
// activity lights of every config sheet are back to idle. REAL: SheetCoeditor, ConfigGrid, the query model, the use cases, ODataConnection, BCConnection's error.
// FAKED: the metadata (answers or fails like BC), the settings sheet object (the list of sheets), the OAuth service (no token).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');
const FILES = ['Grid.js', 'Grid Util.js', 'Config Grid.js', 'Custom errors.js', 'functions.js', 'OData Query.js', 'Fix Register.js', 'Data Validations.js', 'Content Tracker.js',
  'Sheet Coeditor.js', 'Data Type.js', 'BC Connection.js', 'OData Connection.js', 'OData Response.js', 'Import Query.js', 'BulkSheet.js', 'ResultSheet.js', 'RefreshSheet.js', 'RefreshAll.js'];

module.exports = function register(t) {
  const { test } = t;

  function scope(mode, metadataOffline) {
    const book = new SimBook({ api: mode === 'api' });
    const ctx = vm.createContext({ console: { log() {}, error() {} } });
    book.install(ctx);
    FILES.forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    vm.runInContext(`
      globalThis.dbgLog = () => {};
      globalThis.getGlobalSettings = () => ({ getODataURL: () => 'https://bc/', getCompany: () => 'Firma' });
      globalThis.BCAuth = { accessToken: () => { throw new Error('Access not granted or expired.'); } };
      globalThis.UrlFetchApp = { fetch: () => { throw new Error('should not be reached'); } };
      globalThis.__metaOffline = ${!!metadataOffline};
      globalThis.getMetadata = () => ({
        listTables: () => { if (__metaOffline) throw new ConnectionError('offline'); return ['Customers']; },
        listProperties: () => { if (__metaOffline) throw new ConnectionError('offline'); return ['No', 'Name']; },
        listNavProperties: () => { if (__metaOffline) throw new ConnectionError('offline'); return []; },
        getDataType: () => { if (__metaOffline) throw new ConnectionError('offline'); return 'Edm.String'; }
      });
      globalThis.getMainSettings = () => ({
        getSheetList: () => [{ configSheet: 'K', resultSheet: 'RK', refresh: true }, { configSheet: 'L', resultSheet: 'RL', refresh: true }],
        getSheetListWithRefreshTrue: () => [{ configSheet: 'K', resultSheet: 'RK', refresh: true }, { configSheet: 'L', resultSheet: 'RL', refresh: true }],
        getConfigSheetNames: () => ['K', 'L'], getResultSheetName: n => 'R' + n, setLastRefresh() {}
      });`, ctx);
    ['K', 'L'].forEach(n => {
      vm.runInContext(`ConfigGrid.create('${n}')`, ctx);
      const s = book.sheets[n];
      [['table', 'Customers'], ['queryOption', 'select'], ['select', 'No']].forEach((row, i) => row.forEach((v, j) => s.setValue(6 + i, 2 + j, v, '')));
    });
    return { book, ctx, run: code => vm.runInContext(code, ctx) };
  }
  const lights = (book, n) => [2, 3, 4].map(c => book.sheets[n].cell(2, c).fmt.bg);
  const IDLE = ['#cccccc', '#cccccc', '#cccccc'];

  ['service', 'api'].forEach(mode => [false, true].forEach(metadataOffline => {
    const what = metadataOffline ? 'the metadata is not cached either' : 'the metadata is cached, the fetch is refused';
    test(`offline: refresh of all sheets fails with the connection error and every light of every config sheet is idle (${what}) [${mode}]`, () => {
      const s = scope(mode, metadataOffline);
      assert.throws(() => s.run(`RefreshAll.all()`), /offline|Access not granted/);
      assert.deepStrictEqual(lights(s.book, 'K'), IDLE, 'K');
      assert.deepStrictEqual(lights(s.book, 'L'), IDLE, 'L');
    });

    test(`offline: refresh of one sheet - lights idle, the error is a ConnectionError (${what}) [${mode}]`, () => {
      const s = scope(mode, metadataOffline);
      const kind = s.run(`try { RefreshSheet.run('K'); 'no error' } catch (e) { e instanceof ConnectionError ? 'ConnectionError' : String(e) }`);
      assert.strictEqual(kind, 'ConnectionError');
      assert.deepStrictEqual(lights(s.book, 'K'), IDLE);
    });
  }));

  // BC answers with an error document instead of failing the call (an HTTP error is muted by BCConnection.fetchURL): an expired / unaccepted token is answered this way.
  ['service', 'api'].forEach(mode => {
    const refused = `BCConnection.fetchURL = () => ({ getContentText: () => JSON.stringify({ error: { code: 'Authentication_InvalidCredentials', message: 'The server has rejected the client credentials.' } }) });`;
    test(`offline: BC answers with an error document - the connection light is put back to idle by the read itself [${mode}]`, () => {
      const s = scope(mode, false);
      s.run(refused);
      s.run(`globalThis.__c = new ODataConnection().setODataQuery('Customers', [['select', 'No']], {}).setupConnection(); globalThis.__sc = new SheetCoeditor('K', false); __c.readAllPages(__sc);`);
      assert.deepStrictEqual(lights(s.book, 'K'), IDLE);
      assert.deepStrictEqual(JSON.parse(s.run('JSON.stringify(__c.getDataArray())')), [['code', 'Authentication_InvalidCredentials'], ['message', 'The server has rejected the client credentials.']]);
    });

    test(`offline: refresh of all sheets when BC answers with an error document - every sheet ends with idle lights, the error is shown in its result sheet [${mode}]`, () => {
      const s = scope(mode, false);
      s.run(refused);
      s.run(`RefreshAll.all()`);
      assert.deepStrictEqual(lights(s.book, 'K'), IDLE, 'K');
      assert.deepStrictEqual(lights(s.book, 'L'), IDLE, 'L');
      assert.strictEqual(s.book.sheets['RK'].cell(1, 1).v, 'code');
    });
  });
};
