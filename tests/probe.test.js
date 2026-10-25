// The concurrency probes ("Concurrency Probe.js") and their reports. They are meant for a real spreadsheet; here: that they run, write only what they say, and that the
// reports read the stored samples right (stale / not stale, lock overlap / no overlap).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FakePlatform } = require('./platform-fakes');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');
const FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Concurrency Probe.js'];

module.exports = function register(t) {
  const { test } = t;
  function scope() {
    const book = new SimBook({ api: false });
    const p = new FakePlatform();
    let now = 1.7e12;
    const app = Object.assign({}, book.SpreadsheetApp, { openById: () => book.spreadsheet() });
    const ex = p.execution(FILES, { SpreadsheetApp: app, Utilities: { sleep: ms => { now += ms; } } });
    ex.eval(`{ const D = Date; globalThis.Date = class extends D { constructor(...a) { if (a.length) super(...a); else super(__now()); } static now() { return __now(); } }; }`);
    ex.ctx.__now = () => now;
    return { book, p, ex, advance: ms => { now += ms; } };
  }

  test('probes: the writer and the reader run, touch only the sheet "_probe" and the properties "probe:*", and the report of a quiet document finds nothing stale', () => {
    const s = scope();
    s.ex.eval(`probeWriter()`);
    s.advance(3000);
    s.ex.eval(`probeReader()`);
    assert.deepStrictEqual(Object.keys(s.book.sheets), ['_probe']);
    assert.deepStrictEqual(Object.keys(s.p.props.document).sort(), ['probe:counter', 'probe:reader', 'probe:writer']);
    const r = JSON.parse(JSON.stringify(s.ex.eval(`probeReport()`)));
    assert.strictEqual(r.of, 15);
    assert.deepStrictEqual(Object.values(r.stale), [0, 0, 0, 0, 0]);
    s.ex.eval(`probeClear()`);
    assert.deepStrictEqual(Object.keys(s.p.props.document), []);
  });

  test('probes: the report marks a reading that is older than 2 s as STALE, per way of reading', () => {
    const s = scope();
    const t0 = 1.7e12;
    s.p.props.document['probe:writer'] = JSON.stringify([1, 2, 3, 4].map(i => ({ i, t: t0 + i * 1500 })));
    const at = (n, v) => ({ t: t0 + 6000 + n * 1000, same: v, refetched: 4, afterFlush: 4, reopened: 4, property: '4' });
    s.p.props.document['probe:reader'] = JSON.stringify([at(0, 1), at(1, 1), at(2, 4)]);
    const r = JSON.parse(JSON.stringify(s.ex.eval(`probeReport()`)));
    assert.deepStrictEqual(r.stale, { same: 2, refetched: 0, afterFlush: 0, reopened: 0, property: 0 });
    assert.ok(/same=1 STALE/.test(r.text) && /summary|stale readings \(older than 2 s\): same 2\/3, refetched 0\/3/.test(r.text), r.text);
  });

  test('probes: the lock report says OVERLAP when the waiter got the lock before the holder released it, OK when after', () => {
    const s = scope();
    const set = (h, w) => { s.p.props.document['probe:lockHolder'] = JSON.stringify(h); s.p.props.document['probe:lockWaiter'] = JSON.stringify(w); };
    set({ got: true, acquired: 1000, released: 11000 }, { asked: 2000, got: true, acquired: 11050 });
    assert.strictEqual(s.ex.eval(`probeLockReport().overlap`), false);
    set({ got: true, acquired: 1000, released: 11000 }, { asked: 2000, got: true, acquired: 5000 });
    assert.strictEqual(s.ex.eval(`probeLockReport().overlap`), true);
    set({ got: true, acquired: 1000, released: 11000 }, { asked: 2000, got: false, acquired: 27000 });
    assert.strictEqual(s.ex.eval(`probeLockReport().overlap`), false, 'a waiter that never got it is not an overlap');
    assert.strictEqual(s.ex.eval(`probeLockHolder(), JSON.parse(Store.get('document', 'probe:lockHolder')).got`), true);
  });

  test('rule: Concurrency Probe.js loads alone and its entry points are plain functions for the editor (no arguments)', () => {
    const vm = require('vm');
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'Concurrency Probe.js'), 'utf8') + ';globalThis.__fns = [probeWriter, probeReader, probeReport, probeLockHolder, probeLockWaiter, probeLockReport, probeClear];', ctx);
    ctx.__fns.forEach(f => assert.strictEqual(f.length, 0, f.name));
  });
};
