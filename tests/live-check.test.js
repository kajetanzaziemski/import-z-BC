// The live check helpers on this branch ("Live Check*.js", merged from live-test-helpers) are the judge of what the add-on keeps doing in a
// real spreadsheet. They were written against the add-on as it was BEFORE the refactor, so the refactor must satisfy them - they are not
// adapted to the refactored code. These tests protect that arrangement. Registered by tests/run.js.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const PIN = path.join(__dirname, 'golden', 'live-check.sha256.json');
const HELPERS = ['Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js', 'Live Check Sidebar.html'];
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');

module.exports = function register(t) {
  const { test, both } = t;
  const FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
    'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js',
    'Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js'];

  test('live check: the helper files are exactly the ones merged from live-test-helpers (pinned; they define what must not change)', () => {
    const actual = Object.fromEntries(HELPERS.map(f => [f, sha(f)]));
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(PIN, JSON.stringify(actual, null, 1) + '\n');
    const pinned = JSON.parse(fs.readFileSync(PIN, 'utf8'));
    HELPERS.forEach(f => assert.strictEqual(actual[f], pinned[f],
      f + ' was changed. The live check helpers say what the add-on is expected to do (they were written against the code before the refactor): ' +
      'change them only together with an INTENDED change of behaviour, then re-pin with UPDATE_GOLDEN=1 node tests/run.js'));
  });

  test('live check: every action name the code gives to Controller.run / Controller.checked has a verifier, and no verifier is orphaned', () => {
    const files = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^Live Check( Verifiers)?\.js$/.test(f) && f !== 'Test Functions.js');   // the framework and the verifiers only LIST the names
    const used = new Set();
    files.forEach(f => {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
      (text.match(/Controller\.(?:run|checked)\(\s*["']([^"']+)["']/g) || []).forEach(m => used.add(m.match(/["']([^"']+)["']/)[1]));
    });
    const p = new FakePlatform();
    const ex = p.execution(FILES);
    const listed = new Set(ex.eval(`LIVE_CHECK_ENTRY_POINTS.map(x => x.action)`));
    const notListed = [...used].filter(a => !listed.has(a));
    assert.deepStrictEqual(notListed, [], 'entry points in the code that the live check does not know (renamed or new?)');
    const cov = JSON.parse(JSON.stringify(ex.eval(`liveCheckCoverage()`)));
    assert.deepStrictEqual(cov.missing, [], 'entry points listed without a verifier');
    assert.deepStrictEqual(cov.unknown, [], 'verifiers for actions that are not listed');
    assert.deepStrictEqual([...listed].filter(a => !used.has(a)), [], 'listed entry points that no code calls any more (removed or renamed?)');
  });

  test('live check: switched off, the helpers do nothing (no property is written, the action runs as before)', () => {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true });
    const ex = p.execution(FILES);
    const before = JSON.stringify(p.props);
    assert.strictEqual(ex.eval(`Controller.run('requestAddonStatus', () => MainSettings.getAddonStatus())`), true);
    assert.strictEqual(JSON.stringify(p.props), before);
    assert.deepStrictEqual(p.calls.filter(c => /liveCheck/.test(c)), []);
  });

  test('live check: switched on, a check never throws into the run it checks (here the platform is too thin for the verifier: it must crash quietly)', () => {
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true });
    p.props.document.liveCheckEnabled = 'on';
    const ex = p.execution(FILES, { Session: { getActiveUser: () => ({ getEmail: () => 'u@example.com' }) } });
    assert.strictEqual(ex.eval(`Controller.run('requestAddonStatus', () => MainSettings.getAddonStatus())`), true);
    assert.strictEqual(ex.eval(`Controller.run('requestSettingsSheetName', () => 'ok')`), 'ok');
    assert.throws(() => ex.eval(`Controller.run('requestAddonStatus', () => { throw new Error('boom') })`), /boom/, 'the action\'s own error still comes through');
    assert.ok(Object.keys(p.props.document).some(k => /^liveCheck:/.test(k)), 'something was recorded: ' + Object.keys(p.props.document).join(','));
  });

  // The verifiers carry their OWN copy of the config sheet layout (LC_CONFIG_HEADER, the idle colours, the estimate format), written from
  // the code before the refactor. ConfigGrid has to produce exactly that: three independent descriptions agree (verifier, legacy golden, ConfigGrid).
  const lcConstants = () => {
    const ex = new FakePlatform().execution(FILES);
    return JSON.parse(JSON.stringify({ header: ex.eval('LC_CONFIG_HEADER'), idleBg: ex.eval('LC_IDLE_BACKGROUND'), idleFont: ex.eval('LC_IDLE_FONT') }));
  };

  both('live check: a config sheet made by ConfigGrid has the header the verifiers expect (texts, backgrounds, weights, merges)', env => {
    const { header } = lcConstants();
    globalThis.__CG.ConfigGrid.create('K');
    const s = env.book.sheets['K'];
    const cell = (r, c) => s.cell(r, c) || { v: '', fmt: {} };
    const grid = f => [1, 2, 3, 4].map(r => [1, 2, 3, 4, 5, 6, 7].map(c => f(cell(r, c))));
    assert.deepStrictEqual(grid(x => x.v), header.values, 'header texts');
    assert.deepStrictEqual(grid(x => x.fmt.bg), header.backgrounds, 'header backgrounds');
    assert.deepStrictEqual(grid(x => (x.fmt.bold ? 'bold' : 'normal')), header.fontWeights, 'header font weights');
    const colName = n => String.fromCharCode(64 + n);
    assert.deepStrictEqual(s.merges.map(m => colName(m.c1) + m.r1 + ':' + colName(m.c2) + m.r2).sort(), header.merges, 'merged ranges');
  });

  both('live check: after a whole refresh the status cells are idle as the verifiers define it, the estimate is #,##0 and black', env => {
    const { idleBg, idleFont } = lcConstants();
    const CG = globalThis.__CG.ConfigGrid;
    CG.create('K');
    const h = CG.status('K');
    ['reading', 'connection', 'writing'].forEach(kind => { h.set(kind, true); h.set(kind, false); });
    h.setTotalRows(1234567);
    const s = env.book.sheets['K'];
    ['B2', 'C2', 'D2'].forEach((a1, i) => {
      const c = s.cell(2, 2 + i);
      assert.deepStrictEqual([a1, c.fmt.bg, c.fmt.color], [a1, idleBg, idleFont]);
    });
    assert.strictEqual(s.cell(2, 6).fmt.numFmt, '#,##0');
    assert.deepStrictEqual([s.cell(2, 5).fmt.color, s.cell(2, 6).fmt.color], ['#000000', '#000000']);
  });
};
