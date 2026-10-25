// Build version shown in the developer tools sidebars (Version.js, tools/stamp-version.sh), reportFailedChecks, and the sidebar's scroll handling.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

module.exports = function register(t) {
  const { test } = t;
  const LABEL = /^[0-9a-f]{7,}\+? \(\d{4}-\d{2}-\d{2}, [^)]+\)$/;

  test('version: Version.js gives a label "<commit>[+] (<date>, <branch>)"', () => {
    const ctx = vm.createContext({});
    vm.runInContext(read('Version.js'), ctx);
    assert.ok(LABEL.test(vm.runInContext('buildVersionLabel()', ctx)), vm.runInContext('buildVersionLabel()', ctx));
  });

  test('version: the stamp script writes the commit it runs on; "+" appears when the tree has changes other than Version.js', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'topic'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'n');
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.copyFileSync(path.join(ROOT, 'tools/stamp-version.sh'), path.join(dir, 'tools/stamp-version.sh'));
    fs.writeFileSync(path.join(dir, 'a.js'), '1');
    git('add', '-A'); git('commit', '-q', '-m', 'one');
    const head = git('rev-parse', '--short', 'HEAD');
    const stamp = () => { execFileSync('sh', ['tools/stamp-version.sh'], { cwd: dir }); const c = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(dir, 'Version.js'), 'utf8'), c); return vm.runInContext('buildVersionLabel()', c); };
    let label = stamp();
    assert.ok(label.startsWith(head + ' ') && LABEL.test(label) && /, topic\)$/.test(label), label);       // Version.js itself is untracked/new: not a change
    fs.writeFileSync(path.join(dir, 'a.js'), '2');
    label = stamp();
    assert.ok(label.startsWith(head + '+ '), label);
    git('add', '-A'); git('commit', '-q', '-m', 'two');
    label = stamp();
    assert.ok(label.startsWith(git('rev-parse', '--short', 'HEAD') + ' '), 'clean tree after the commit (only Version.js differs): ' + label);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('version: both developer tools sidebars show it (live check data + page, trigger table page)', () => {
    const ex = new FakePlatform().execution(['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Controller.js', 'Version.js', 'Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js']);
    const data = JSON.parse(ex.eval(`JSON.stringify(liveCheckSidebarData(null))`));
    assert.ok(LABEL.test(data.version), data.version);
    assert.ok(/getElementById\("version"\)\.textContent = data\.version/.test(read('Live Check Sidebar.html')));
    assert.ok(/<\?= typeof buildVersionLabel === "function" \? buildVersionLabel\(\) : "\?" \?>/.test(read('Trigger Table.html')));
    const without = new FakePlatform().execution(['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Controller.js', 'Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js']);
    assert.strictEqual(JSON.parse(without.eval(`JSON.stringify(liveCheckSidebarData(null))`)).version, null, 'no Version.js: no label, no error');
  });

  test('reportFailedChecks: runs from the editor without arguments and reports only FAIL / WARN runs', () => {
    const p = new FakePlatform();
    const ex = p.execution(['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Controller.js', 'Live Check.js', 'Live Check Verifiers.js', 'Live Check Sidebar Server.js']);
    const put = (n, s) => ex.eval(`PropertiesService.getDocumentProperties().setProperty(LIVE_CHECK_RESULT_PREFIX + "${n}", JSON.stringify({t: "2026-10-25T10:0${n}:00.000Z", a: "act${n}", s: "${s}", ms: 5, c: [["${s}", "a check", "why"]]}))`);
    put(1, 'PASS'); put(2, 'FAIL'); put(3, 'WARN'); put(4, 'SKIP');
    const text = ex.eval(`reportFailedChecks()`);
    assert.ok(/act2/.test(text) && /act3/.test(text) && !/act1/.test(text) && !/act4/.test(text), text);
    assert.strictEqual(ex.eval(`reportFailedChecks.length`), 0);
  });

  test('sidebar: the page is not rebuilt every second (only the clock text changes) and a rebuild keeps the sideways scroll of the open details and the page', () => {
    const html = read('Live Check Sidebar.html');
    const timer = html.match(/setInterval\(function \(\) \{([\s\S]*?)\}, 1000\);/)[1];
    assert.ok(!/\brender\(\)/.test(timer), 'the 1 s timer must not call render()');
    assert.ok(/scrollLeft/.test(html) && /window\.scrollTo\(pageLeft, pageTop\)/.test(html));
  });
};
