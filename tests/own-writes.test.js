// The add-on's own writes and the on-change trigger (docs/bugs-todo.md "Edits and structure changes"). A script write to the spreadsheet fires the installable on-change
// trigger a moment later (sheet inserted, rows added): routed by the ACTIVE sheet it started a second co-edit of the sheet the add-on had just created or analysed -
// the wizard's own analysis was dropped for it and the live check found the reading light on. Every commit of the Grid and every BulkSheet write notes "the add-on wrote just now"
// in the document cache (Own Writes.js); for OWN_WRITE_WINDOW seconds a structure change is not a user's: the job is "change.own" and nothing is done.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');

module.exports = function register(t) {
  const { test } = t;

  function scope(mode) {
    const p = new FakePlatform();
    const book = new SimBook({ api: mode === 'api' });
    const ex = p.execution(['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Own Writes.js', 'Grid.js', 'Grid Util.js', 'BulkSheet.js'], { SpreadsheetApp: book.SpreadsheetApp, Utilities: book.Utilities, Sheets: mode === 'api' ? book.Sheets : undefined });
    ex.eval(`globalThis.dbgLog = () => {};`);
    return { p, book, ex };
  }
  const noted = s => !!s.p.cache.document.ownWrite;

  ['api', 'service'].forEach(mode => {
    test(`own writes: a Grid commit notes it (also the creation of a sheet); a read does not [${mode}]`, () => {
      const s = scope(mode);
      s.book.add('K', 20, 8);
      s.ex.eval(`Grid.open({ sheetName: 'K' })`);
      assert.strictEqual(noted(s), false, 'opening only reads');
      s.ex.eval(`(() => { const g = Grid.open({ sheetName: 'K' }); g.getRange(1, 1).setValue('x'); g.commit(); })()`);
      assert.strictEqual(noted(s), true);
      const t2 = scope(mode);
      t2.ex.eval(`(() => { const g = Grid.create({ sheetName: 'Nowy' }); g.getRange(1, 1).setValue('x'); g.commit(); })()`);
      assert.strictEqual(noted(t2), true, 'a sheet created by the Grid');
    });

    test(`own writes: BulkSheet.writeTable notes it [${mode}]`, () => {
      const s = scope(mode);
      s.ex.eval(`BulkSheet.writeTable('W', [['a'], [1]], {})`);
      assert.strictEqual(noted(s), true);
    });
  });

  test('own writes: the note lasts OWN_WRITE_WINDOW seconds, a new write extends it; no cache service: nothing is noted and nothing breaks', () => {
    const s = scope('service');
    const w = s.ex.eval(`OWN_WRITE_WINDOW`);
    assert.ok(w >= 10 && w <= 60, 'a short window: ' + w);
    s.ex.eval(`OwnWrites.note()`);
    assert.strictEqual(s.ex.eval(`OwnWrites.recent()`), true);
    s.p.advance(w - 1);
    assert.strictEqual(s.ex.eval(`OwnWrites.recent()`), true);
    s.p.advance(2);
    assert.strictEqual(s.ex.eval(`OwnWrites.recent()`), false);
    s.ex.eval(`OwnWrites.note()`); s.p.advance(w - 1); s.ex.eval(`OwnWrites.note()`); s.p.advance(w - 1);
    assert.strictEqual(s.ex.eval(`OwnWrites.recent()`), true, 'extended by the second write');
    const b = scope('service'); b.p.broken['cache.document'] = 'null';
    assert.strictEqual(b.ex.eval(`OwnWrites.note(); OwnWrites.recent()`), false);
    const c = scope('service'); c.p.broken['cache.document'] = 'throw';
    assert.strictEqual(c.ex.eval(`OwnWrites.note(); OwnWrites.recent()`), false);
  });

  test('rule: the Grid and BulkSheet call the hook after a write, and the hook is the only thing they know about it', () => {
    ['Grid.js', 'BulkSheet.js'].forEach(f => {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(/typeof ownWriteHook === 'function'/.test(text), f);
      assert.ok(!/OwnWrites/.test(text), f + ' does not know the project object');
    });
  });
};
