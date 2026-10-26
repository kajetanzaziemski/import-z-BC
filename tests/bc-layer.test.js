// The BC layer (login: BC Auth.js; fetch: BC Connection.js; reads: OData Connection.js / OData Response.js / OData Query.js; catalogue: BC Metadata.js / Edmx.js).
// Structure and the paging / response table, with a fake BCConnection.fetchURL. Registered by tests/run.js.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Global Add-on Settings.js', 'Quick Start.js', 'Trigger Manager.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js', 'functions.js',
  'Fix Register.js', 'Data Type.js', 'OData Query.js', 'OData Response.js', 'OData Connection.js'];

module.exports = function register(t) {
  const { test } = t;
  const plain = v => JSON.parse(JSON.stringify(v));

  test('bc layer: every file declares what its name says - and the dead test-only code is gone', () => {
    const declares = { 'BC Auth.js': ['BCAuth', 'authCallback'], 'BC Connection.js': ['BCConnection'], 'OData Connection.js': ['ODataConnection'], 'OData Response.js': ['ODataResponseTable'],
      'OData Query.js': ['ODataQuery'], 'BC Metadata.js': ['BCMetadata'], 'Edmx.js': ['EdmxDocument', 'EdmxElement'] };
    Object.entries(declares).forEach(([f, names]) => {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      names.forEach(n => assert.ok(new RegExp('(class|const|function)\\s+' + n + '\\b').test(text), f + ' declares ' + n));
    });
    const prod = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^(Test Functions)/.test(f)).map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    ['readAllPages_test', 'readPage_test', 'getTableWithRequest', 'ODATA_URL_', 'userSafe', 'getBCService_', 'basicMenu', 'postAuthorizationFlow'].forEach(n => assert.ok(!prod.includes(n), n));
  });

  function scenario(pages) {
    const p = new FakePlatform();
    const log = [];
    const ex = p.execution(FILES, { __log: log, __pages: pages });
    ex.eval(`getGlobalSettings().setAllPropertiesForScope('document','tenant-1','Env','Firma');
      globalThis.BCConnection = { fetchURL: url => { __log.push(['fetch', url]); return { getContentText: () => JSON.stringify(__pages.shift()) }; } };`);
    return { ex, log, calls: () => plain(log) };
  }
  const page = (rows, extra) => Object.assign({ '@odata.count': 3, value: rows }, extra || {});

  test('bc layer: ODataConnection reads every page by the next link, collects header + rows once, remembers the columns and switches the connection light around the reads', () => {
    const { ex, calls } = scenario([
      page([{ No: 'C1', Name: 'A' }, { No: 'C2', Name: 'B' }], { '@odata.nextLink': 'https://bc/next' }),
      page([{ No: 'C3', Name: 'C' }])]);
    ex.eval(`globalThis.__sw = []; const co = { switchConnectionControl: a => __sw.push(['conn', a]), setTotRowsInfo: n => __sw.push(['tot', n]) };
      globalThis.__c = new ODataConnection().setODataQuery('Customer', [['select', 'No']], { No: 'Edm.String' }).setupConnection(); __c.readAllPages(co);`);
    assert.deepStrictEqual(plain(ex.eval('__c.getDataArray()')), [['No', 'Name'], ['C1', 'A'], ['C2', 'B'], ['C3', 'C']]);
    assert.deepStrictEqual(calls().map(c => c[1]).slice(1), ['https://bc/next']);
    assert.ok(calls()[0][1].startsWith("https://login.microsoftonline.com") === false && /Customer\?/.test(calls()[0][1]) && /\$count=true/.test(calls()[0][1]), calls()[0][1]);
    assert.deepStrictEqual(plain(ex.eval('__sw')), [['conn', true], ['tot', 3], ['conn', true], ['conn', false]], 'light on before each page, the total right after the first page, off at the end');
    assert.deepStrictEqual(plain(ex.eval('__c.getColumnInfo()')), [{ table: null, field: 'No' }, { table: null, field: 'Name' }]);
  });

  test('bc layer: no rows gives the "no data" line; a BC error answers with the error entries', () => {
    const a = scenario([{ '@odata.count': 0, value: [] }]);
    a.ex.eval(`globalThis.__c = new ODataConnection().setODataQuery('Customer', [['select', 'No']], {}).setupConnection(); __c.readAllPages({ switchConnectionControl() {}, setTotRowsInfo() {} });`);
    assert.deepStrictEqual(plain(a.ex.eval('__c.getDataArray()')), [['Brak danych spełniających zadane kryteria.']]);
    const b = scenario([{ error: { code: 'X', message: 'bad' } }]);
    b.ex.eval(`globalThis.__c = new ODataConnection().setODataQuery('Customer', [['select', 'No']], {}).setupConnection(); __c.readAllPages({ switchConnectionControl() {}, setTotRowsInfo() {} });`);
    assert.deepStrictEqual(plain(b.ex.eval('__c.getDataArray()')), [['code', 'X'], ['message', 'bad']]);
  });

  test('bc layer: ODataResponseTable expands extended lines into rows with dotted headers and tells table / field of a column', () => {
    const { ex } = scenario([]);
    ex.eval(`globalThis.__t = new ODataResponseTable(JSON.stringify({ '@odata.count': 1, value: [{ No: 'C1', Lines: [{ Qty: 1 }, { Qty: 2 }] }] }));`);
    assert.deepStrictEqual(plain(ex.eval('__t.getDataArray()')), [['No', 'Lines.Qty'], ['C1', 1], ['C1', 2]]);
    assert.deepStrictEqual(plain(ex.eval(`__t.getColumnInfo('Lines.Qty')`)), { field: 'Qty', table: 'Lines' });
    assert.strictEqual(ex.eval('__t.getResponseRowCount()'), 1);
  });

  test('bc layer: readAllPages without a co-editor reads and returns the data, and a failing read gives the ORIGINAL error back (bugs-todo #6)', () => {
    const a = scenario([page([{ No: 'C1' }])]);
    a.ex.eval(`globalThis.__c = new ODataConnection().setODataQuery('Customer', [['select', 'No']], {}).setupConnection(); __c.readAllPages();`);
    assert.deepStrictEqual(plain(a.ex.eval('__c.getDataArray()')), [['No'], ['C1']]);
    const b = scenario([]);
    b.ex.eval(`BCConnection.fetchURL = () => { throw new Error('BC down'); }`);
    assert.strictEqual(b.ex.eval(`try { new ODataConnection().setODataQuery('Customer', [['select', 'No']], {}).setupConnection().readAllPages(); 'no error' } catch (e) { e.message }`), 'BC down');
  });
};
