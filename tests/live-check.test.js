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

  // ---- the indicator check (reports what it saw; another run in progress makes it a WARN) and the coloured details ------------------
  // These two are deliberate changes of the helper files (docs/testing.md); everything else in them is as merged.
  function indicatorCheck(opts) {
    const p = new FakePlatform();
    const iso = ms => new Date(Date.now() - ms).toISOString();
    (opts.running || []).forEach((r, i) => { p.props.document['liveCheck:' + iso(r.agoMs) + ':run' + i] = JSON.stringify({ t: iso(r.agoMs), a: r.action, s: r.state || 'RUN', ms: 0, c: [] }); });
    const ex = p.execution(FILES);
    if (opts.nested) ex.eval(`lcStack.push({ key: ${JSON.stringify(opts.nested)} })`);
    ex.ctx.__look = opts.look || {};
    return JSON.parse(JSON.stringify(ex.eval(`(() => {
      const out = [];
      const c = { key: 'liveCheck:own', expect: (n, ok, d) => out.push(['expect', n, ok, d]), warn: (n, d) => out.push(['warn', n, d]) };
      const sheet = { getRange: a1 => ({ getBackground: () => (__look[a1] || {}).bg || '#cccccc', getFontColor: () => (__look[a1] || {}).font || '#999999' }) };
      lcVerifyIdleIndicators_(c, sheet, '[Konfiguracja 1]');
      return out;
    })()`)));
  }

  test('live check: indicators idle -> one PASS', () => {
    const r = indicatorCheck({});
    assert.deepStrictEqual([r.length, r[0][0], r[0][1], r[0][2]], [1, 'expect', '[Konfiguracja 1] activity indicators back to idle', true]);
  });

  test('live check: a lit cell with no other run in progress is a FAIL that says what was read (colours) and that nothing else is running', () => {
    const r = indicatorCheck({ look: { D2: { bg: '#ff0000', font: '#000000' } } });
    assert.strictEqual(r.length, 1);
    assert.deepStrictEqual(r[0].slice(0, 3), ['expect', '[Konfiguracja 1] activity indicators back to idle', false]);
    assert.ok(/still showing activity: data writing \(D2: background #ff0000, font #000000\)/.test(r[0][3]), r[0][3]);
    assert.ok(/no other checked run is in progress/.test(r[0][3]));
  });

  test('live check: every lit cell is listed, with its own colours', () => {
    const r = indicatorCheck({ look: { B2: { bg: '#008000', font: '#000000' }, C2: { bg: '#cccccc', font: '#000000' } } });
    assert.ok(/reading \(B2: background #008000, font #000000\), connection \(C2: background #cccccc, font #000000\)/.test(r[0][3]), r[0][3]);
  });

  test('live check: a lit cell while ANOTHER checked run is in progress is a WARN naming that run (a refresh writing in parallel), not a FAIL', () => {
    const r = indicatorCheck({ look: { D2: { bg: '#ff0000', font: '#000000' } }, running: [{ agoMs: 20000, action: 'menuRefreshCurrentSheet' }] });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0][0], 'warn');
    assert.ok(/another run is in progress and may be lighting it: menuRefreshCurrentSheet since \d\d:\d\d:\d\d UTC/.test(r[0][2]), r[0][2]);
    assert.ok(/data writing \(D2: background #ff0000/.test(r[0][2]));
  });

  test('live check: runs that do not count as "in progress": finished ones, LOST ones, older than 10 minutes, this check\'s own run, nested runs of this execution', () => {
    const lit = { D2: { bg: '#ff0000', font: '#000000' } };
    const failed = r => r[0][0] === 'expect' && r[0][2] === false;
    assert.ok(failed(indicatorCheck({ look: lit, running: [{ agoMs: 5000, action: 'x', state: 'PASS' }] })), 'finished');
    assert.ok(failed(indicatorCheck({ look: lit, running: [{ agoMs: 11 * 60 * 1000, action: 'x' }] })), 'stale RUN is a lost run');
    assert.ok(failed(indicatorCheck({ look: lit, running: [{ agoMs: 5000, action: 'x', state: 'LOST' }] })), 'lost');
    const own = indicatorCheck({ look: lit });
    assert.ok(failed(own));
    const p = new FakePlatform();
    p.props.document['liveCheck:own'] = JSON.stringify({ t: new Date().toISOString(), a: 'menuRefreshAll', s: 'RUN', ms: 0, c: [] });
    const ex = p.execution(FILES);
    const run = () => ex.eval(`(() => { const out = []; const c = { key: 'liveCheck:own', expect: (n, ok, d) => out.push(['expect', ok]), warn: () => out.push(['warn']) };
      lcVerifyIdleIndicators_(c, { getRange: () => ({ getBackground: () => '#ff0000', getFontColor: () => '#000000' }) }, '[K]'); return out; })()`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(run())), [['expect', false]], 'its own stored RUN entry is not "another run"');
    p.props.document['liveCheck:nested'] = JSON.stringify({ t: new Date().toISOString(), a: 'forceAgentRefresh', s: 'RUN', ms: 0, c: [] });
    ex.eval(`lcStack.push({ key: 'liveCheck:nested' })`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(run())), [['expect', false]], 'a nested run of the same execution is not parallel');
    ex.eval(`lcStack.length = 0`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(run())), [['warn']], 'but the same entry from another execution is');
  });

  test('live check: the verifier cannot throw because of the progress lookup (a broken property store gives "no other run")', () => {
    const p = new FakePlatform();
    const ex = p.execution(FILES);
    p.broken['properties.document'] = 'throw';
    const out = ex.eval(`(() => { const o = []; const c = { key: 'k', expect: (n, ok, d) => o.push(ok), warn: () => o.push('warn') };
      lcVerifyIdleIndicators_(c, { getRange: () => ({ getBackground: () => '#ff0000', getFontColor: () => '#000000' }) }, '[K]'); return o; })()`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), [false]);
  });

  // The sidebar: the details are coloured line by line. The two functions are taken out of the page and run against a minimal DOM.
  function sidebarFunctions() {
    const vm = require('vm');
    const html = read('Live Check Sidebar.html');
    const grab = name => { const m = html.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}')); assert.ok(m, name + ' not found in the sidebar'); return m[0]; };
    const element = () => ({ className: '', textContent: '', children: [], appendChild(x) { this.children.push(x); } });
    const ctx = vm.createContext({ document: { createElement: element }, String });
    vm.runInContext(grab('lineStatus') + '\n' + grab('showDetail'), ctx);
    return { pre: () => element(), show: (pre, text) => vm.runInContext('showDetail', ctx)(pre, text) };
  }

  test('live check sidebar: the details show FAIL and WARN lines in colour (classes), the head line in the colour of the run, PASS and SKIP quieter', () => {
    const sb = sidebarFunctions();
    const ex = new FakePlatform().execution(FILES);
    const text = ex.eval(`lcFormat_({ s: 'FAIL', a: 'menuRefreshAll', ms: 1200, c: [['PASS','config sheet exists',''],['FAIL','[K] activity indicators back to idle','still showing activity: data writing'],['WARN','duration within limits','301000 ms'],['SKIP','alert shown','UI']] })`);
    const pre = sb.pre();
    sb.show(pre, text);
    assert.deepStrictEqual(pre.children.map(x => x.className), ['l FAIL', 'l PASS', 'l FAIL', 'l WARN', 'l SKIP']);
    assert.strictEqual(pre.children.map(x => x.textContent).join('\n'), text, 'the text itself is unchanged');
    const lost = sb.pre(); sb.show(lost, ex.eval(`lcFormat_({ s: 'LOST', a: 'x', t: '2026-01-01T00:00:00Z', ms: 0, c: [] })`));
    assert.strictEqual(lost.children[0].className, 'l LOST');
  });

  test('live check sidebar: text from a check is shown as text (nothing is interpreted as HTML) and an empty line keeps its height', () => {
    const sb = sidebarFunctions();
    const pre = sb.pre();
    sb.show(pre, '    FAIL <img src=x onerror=alert(1)> - <b>detail</b>\n\n    WARN w');
    assert.strictEqual(pre.children[0].textContent, '    FAIL <img src=x onerror=alert(1)> - <b>detail</b>');
    assert.strictEqual(pre.children[0].children.length, 0);
    assert.strictEqual(pre.children[1].textContent, ' ');
    assert.deepStrictEqual(pre.children.map(x => x.className), ['l FAIL', 'l ', 'l WARN']);
  });

  test('live check sidebar: the colours exist in the stylesheet for FAIL and WARN lines (red / amber)', () => {
    const html = read('Live Check Sidebar.html');
    assert.ok(/\.detail \.l\.FAIL\s*\{[^}]*color: #a50e0e[^}]*background: #fce8e6/.test(html));
    assert.ok(/\.detail \.l\.WARN\s*\{[^}]*color: #7a4f01[^}]*background: #fef3c7/.test(html));
  });
};
