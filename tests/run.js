// Offline tests of Grid.js against the simulated spreadsheet (tests/sim.js).  Run:  node tests/run.js
// Every scenario that touches a sheet runs through BOTH commit paths (Sheets API and Spreadsheet service).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');
const SRC = { grid: 'Grid.js', util: 'Grid Util.js' };
// Apps Script loads the files in no promised order: Grid.js first, its helper file second (nothing may be used at load time).
const code = ['Grid.js', 'Grid Util.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
vm.runInThisContext(code + '\n;globalThis.__G = { Grid, GridRange, modelRows_, colorToApi_, alignOf_, numberFormatType_, dateToSerial_, serialToDate_, validationSpec_, NEW_SHEET_ROWS, NEW_SHEET_COLS };', { filename: 'Grid.js+Grid Util.js' });
const G = globalThis.__G;
const Grid = G.Grid;

// ---------------------------------------------------------------------------------------------------------------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const MODES = ['api', 'service'];
/** A test that runs once per commit path; fn(env) with env = { book, mode, sheet(title, rows, cols), open(title) }. */
function both(name, fn, bookOpts) {
  MODES.forEach(mode => test(name + ' [' + mode + ']', () => {
    const book = new SimBook(Object.assign({ api: mode === 'api' }, bookOpts));
    book.install(globalThis);
    fn({ book, mode, sheet: (t, r, c) => book.add(t, r, c), open: t => Grid.open({ sheetName: t }) });
  }));
}
/** The same scenario through both paths, the resulting sheets must be identical. */
function parity(name, scenario, bookOpts) {
  test(name + ' [parity api = service]', () => {
    const snaps = MODES.map(mode => {
      const book = new SimBook(Object.assign({ api: mode === 'api' }, bookOpts));
      book.install(globalThis);
      scenario({ book, mode, sheet: (t, r, c) => book.add(t, r, c), open: t => Grid.open({ sheetName: t }) });
      return book;
    });
    Object.keys(snaps[0].sheets).forEach(t => assert.deepStrictEqual(snaps[1].sheets[t].snapshot(), snaps[0].sheets[t].snapshot(), 'sheet "' + t + '" differs between the paths'));
    assert.deepStrictEqual(Object.keys(snaps[1].sheets), Object.keys(snaps[0].sheets));
  });
}
const cellOf = (s, r, c) => s.cell(r, c) || { v: '', f: '', note: '', dv: null, fmt: {} };
const fill = (s, rows) => rows.forEach((row, i) => row.forEach((v, j) => { if (v !== '') s.setValue(i + 1, j + 1, v, ''); }));

// ---- pure helpers ----------------------------------------------------------------------------------------------
test('colorToApi_: names, #rgb, #rrggbb and #aarrggbb', () => {
  assert.deepStrictEqual(G.colorToApi_('black'), { red: 0, green: 0, blue: 0 });
  assert.deepStrictEqual(G.colorToApi_('#ff000000'), { red: 0, green: 0, blue: 0 });     // what getFontColors returns for black
  assert.deepStrictEqual(G.colorToApi_('#999999'), { red: 0.6, green: 0.6, blue: 0.6 });
  assert.deepStrictEqual(G.colorToApi_('#fff'), { red: 1, green: 1, blue: 1 });
  assert.throws(() => G.colorToApi_('nope'), /unknown colour/);
});
test('alignOf_: general, general-left and general-right all mean "not set"', () => {
  assert.strictEqual(G.alignOf_('general'), null);
  assert.strictEqual(G.alignOf_('general-left'), null);
  assert.strictEqual(G.alignOf_('general-right'), null);
  assert.strictEqual(G.alignOf_('center'), 'CENTER');
  assert.throws(() => G.alignOf_('diagonal'), /unknown horizontal alignment/);
});
test('numberFormatType_', () => {
  const t = G.numberFormatType_;
  assert.deepStrictEqual(['#,##0', 'yyyy-mm-dd hh:mm', 'yyyy-mm-dd', 'hh:mm', '0.0%', '@'].map(t), ['NUMBER', 'DATE_TIME', 'DATE', 'TIME', 'PERCENT', 'TEXT']);
});
test('modelRows_ keeps the window between 20 and 3000 rows', () => {
  assert.strictEqual(G.modelRows_(5, 0), 20);
  assert.strictEqual(G.modelRows_(5, 100), 105);
  assert.strictEqual(G.modelRows_(5, 1e6), 3000);
});
['Asia/Tokyo', 'Europe/Warsaw', 'America/Los_Angeles'].forEach(tz => test('Date <-> serial number round trip in ' + tz, () => {
  const book = new SimBook({ tz }); book.install(globalThis);
  [new Date('2026-01-15T10:30:00Z'), new Date('2026-07-15T10:30:00Z'), new Date('2026-03-29T00:30:00Z')].forEach(d => {
    const serial = G.dateToSerial_(d, tz);
    assert.strictEqual(serial, book.toSerial(d), 'same serial as the simulated sheet');
    assert.strictEqual(G.serialToDate_(serial, tz).getTime(), d.getTime());
  });
}));
test('validationSpec_ accepts plain specs, a DataValidation, null; rejects the rest', () => {
  const book = new SimBook(); book.install(globalThis);
  assert.deepStrictEqual(G.validationSpec_({ list: ['a', 'b'] }), { list: ['a', 'b'], strict: true, dropdown: true });
  assert.deepStrictEqual(G.validationSpec_(null), null);
  const dv = SpreadsheetApp.newDataValidation().requireValueInList(['x', 'y'], true).setAllowInvalid(false).build();
  assert.deepStrictEqual(G.validationSpec_(dv), { list: ['x', 'y'], strict: true, dropdown: true });
  assert.deepStrictEqual(G.validationSpec_(SpreadsheetApp.newDataValidation().requireDate().build()), { date: true });
  assert.throws(() => G.validationSpec_({ foo: 1 }), /unsupported data validation/);
});

// ---- reading ----------------------------------------------------------------------------------------------------
both('open: a missing sheet gives null', env => { assert.strictEqual(env.open('Nie ma'), null); });

both('open reads values, formulas and merges; the window reaches past the last row', env => {
  const s = env.sheet('S', 100, 8);
  fill(s, [['a', 1, true], ['', '', 'x'], ['', '', '', 4]]);
  s.setValue(2, 1, 'formula-result', '=A1');
  s.merge(1, 5, 2, 6);
  const g = env.open('S');
  assert.strictEqual(g.getRange(1, 1).getValue(), 'a');
  assert.strictEqual(g.getRange(1, 2).getValue(), 1);
  assert.strictEqual(g.getRange(1, 3).getValue(), true);
  assert.strictEqual(g.getRange(2, 1).getFormula(), '=A1');
  assert.strictEqual(g.getRange(3, 4).getValue(), 4);
  assert.deepStrictEqual(g.getRange(1, 5, 2, 2).getMergedRanges().map(r => r.getA1Notation()), ['E1:F2']);
  assert.ok(g.getLastRow() >= 20, 'window rows ' + g.getLastRow());
  assert.strictEqual(g.getRange(50, 50).getValue(), '', 'outside the window reads as empty');
});

both('open reads Date cells as Date objects', env => {
  const s = env.sheet('S', 50, 5);
  const when = new Date('2026-10-23T05:15:00Z');
  s.setValue(1, 1, env.book.toSerial(when), ''); s.cell(1, 1).fmt.numFmt = 'yyyy-mm-dd hh:mm';
  s.setValue(2, 1, 45000, '');                                                    // a plain number stays a number
  const g = env.open('S');
  const v = g.getRange(1, 1).getValue();
  assert.strictEqual(Object.prototype.toString.call(v), '[object Date]');
  assert.strictEqual(v.getTime(), when.getTime());
  assert.strictEqual(g.getRange(2, 1).getValue(), 45000);
});

// ---- writing: values, concurrency, window ----------------------------------------------------------------------
both('commit writes only the cells the operation changed (a concurrent edit elsewhere survives)', env => {
  const s = env.sheet('S', 50, 5);
  fill(s, [['a', 'b'], ['c', 'd']]);
  const g = env.open('S');
  s.setValue(2, 2, 'EDITED BY SOMEONE ELSE', '');                                   // after the read, before the commit
  g.getRange(1, 1).setValue('A!');
  g.commit();
  assert.strictEqual(cellOf(s, 1, 1).v, 'A!');
  assert.strictEqual(cellOf(s, 2, 2).v, 'EDITED BY SOMEONE ELSE');
});

both('setValues, setFormulas, clearContent; a string starting with = is a formula', env => {
  const s = env.sheet('S', 50, 6);
  fill(s, [['x', 'y', 'z']]);
  const g = env.open('S');
  g.getRange(2, 1, 1, 3).setValues([[1, 'two', '=A2']]);
  g.getRange(3, 1).setFormula('=SUM(A2)');
  g.getRange(1, 3).clearContent();
  g.commit();
  assert.deepStrictEqual([1, 2, 3].map(c => cellOf(s, 2, c).v), [1, 'two', 'formula-result']);
  assert.strictEqual(cellOf(s, 2, 3).f, '=A2');
  assert.strictEqual(cellOf(s, 3, 1).f, '=SUM(A2)');
  assert.strictEqual(cellOf(s, 1, 3).v, '');
  assert.strictEqual(cellOf(s, 1, 1).v, 'x');
});

both('a write past the last used column grows the window and the sheet (no silent loss)', env => {
  const s = env.sheet('S', 50, 4);
  fill(s, [['a', 'b']]);
  const g = env.open('S');
  g.getRange(2, 9).setValue('far');                                            // the sheet has only 4 columns
  g.getRange(30, 2).setValue('low');
  g.commit();
  assert.strictEqual(cellOf(s, 2, 9).v, 'far');
  assert.strictEqual(cellOf(s, 30, 2).v, 'low');
  assert.strictEqual(s.colCount, 9);
});

both('a write past the end of the sheet fails loudly (insertRowsAfter first)', env => {
  const s = env.sheet('S', 30, 4);
  const g = env.open('S');
  assert.throws(() => g.getRange(31, 1).setValue('x'), /past the end of the sheet/);
  g.insertRowsAfter(30, 5);
  g.getRange(33, 1).setValue('x');
  g.commit();
  assert.strictEqual(s.rowCount, 35);
  assert.strictEqual(cellOf(s, 33, 1).v, 'x');
});

// ---- structure -------------------------------------------------------------------------------------------------
both('insertRowsAfter: later rows, merges and notes move; new rows are empty; the values written land right', env => {
  const s = env.sheet('S', 60, 5);
  fill(s, [['h1'], ['h2'], ['d1'], ['d2']]);
  s.merge(3, 2, 4, 2);
  s.cell(4, 1, true).note = 'note on d2';
  const g = env.open('S');
  g.insertRowsAfter(2, 2);
  g.getRange(3, 1, 2, 1).setValues([['n1'], ['n2']]);
  g.commit();
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(r => cellOf(s, r, 1).v), ['h1', 'h2', 'n1', 'n2', 'd1', 'd2']);
  assert.deepStrictEqual(s.merges, [{ r1: 5, c1: 2, r2: 6, c2: 2 }]);
  assert.strictEqual(cellOf(s, 6, 1).note, 'note on d2');
  assert.strictEqual(s.rowCount, 62);
});

both('insertRowsAfter with plain: true removes the inherited validation, without it it stays', env => {
  const s = env.sheet('S', 60, 5);
  fill(s, [['a'], ['b']]);
  s.cell(1, 2, true).dv = 'list:x|y:strict:dropdown';
  const g = env.open('S');
  g.insertRowsAfter(1, 1);                       // inherits
  g.insertRowsAfter(1, 1, { plain: true });      // does not
  g.commit();
  assert.strictEqual(cellOf(s, 2, 2).dv, null);
  assert.strictEqual(cellOf(s, 3, 2).dv, 'list:x|y:strict:dropdown');
});

both('insertColumnsAfter / deleteColumns move cells and the window', env => {
  const s = env.sheet('S', 50, 6);
  fill(s, [['a', 'b', 'c', 'd']]);
  const g = env.open('S');
  g.insertColumnsAfter(1, 2);
  g.getRange(1, 2, 1, 2).setValues([['n1', 'n2']]);
  g.deleteColumns(5, 1);                         // 'c' (a, n1, n2, b, c, d)
  g.commit();
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(c => cellOf(s, 1, c).v), ['a', 'n1', 'n2', 'b', 'd']);
  assert.strictEqual(s.colCount, 7);
});

both('merge, mergeVertically and breakApart', env => {
  const s = env.sheet('S', 50, 8);
  fill(s, [['t', '', '', 'u'], ['x', 'y']]);
  s.merge(1, 4, 1, 5);
  const g = env.open('S');
  g.getRange(1, 1, 1, 3).merge();
  g.getRange(2, 1, 2, 2).mergeVertically();
  g.getRange(1, 4, 1, 2).breakApart();
  g.commit();
  assert.deepStrictEqual(s.merges.map(m => [m.r1, m.c1, m.r2, m.c2].join()).sort(), ['1,1,1,3', '2,1,3,1', '2,2,3,2']);
  assert.strictEqual(cellOf(s, 1, 1).v, 't');
});

// ---- notes, checkboxes, validations -------------------------------------------------------------------------------
both('notes: setNote, setNotes (null removes), clearNote', env => {
  const s = env.sheet('S', 50, 4);
  s.cell(1, 1, true).note = 'old'; s.cell(1, 2, true).note = 'old2'; s.cell(1, 3, true).note = 'keep';
  const g = env.open('S');
  g.getRange(1, 1, 1, 2).setNotes([['new', null]]);
  g.getRange(2, 1).setNote('second');
  g.getRange(3, 1).setNote('tmp'); g.getRange(3, 1).clearNote();
  g.commit();
  assert.deepStrictEqual([cellOf(s, 1, 1).note, cellOf(s, 1, 2).note, cellOf(s, 1, 3).note, cellOf(s, 2, 1).note, cellOf(s, 3, 1).note], ['new', '', 'keep', 'second', '']);
});

both('checkboxes: setCheckbox, clearCheckbox', env => {
  const s = env.sheet('S', 50, 4);
  const g = env.open('S');
  g.setCheckbox(2, 3, true);
  g.setCheckbox(3, 3, false);
  g.commit();
  assert.deepStrictEqual([cellOf(s, 2, 3).v, cellOf(s, 2, 3).dv, cellOf(s, 3, 3).v, cellOf(s, 3, 3).dv], [true, 'checkbox', false, 'checkbox']);
  const g2 = env.open('S');
  g2.clearCheckbox(2, 3);
  g2.commit();
  assert.deepStrictEqual([cellOf(s, 2, 3).v, cellOf(s, 2, 3).dv], ['', null]);
});

both('data validation: list (own and from a SpreadsheetApp validation), date, removal, the array form', env => {
  const s = env.sheet('S', 50, 6);
  s.cell(1, 6, true).dv = 'list:old:strict:dropdown';
  const g = env.open('S');
  g.getRange(1, 1).setDataValidation({ list: ['godzin', 'dni'] });
  g.getRange(1, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['a', 'b'], true).setAllowInvalid(true).build());
  g.getRange(1, 3).setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build());
  g.getRange(1, 6).setDataValidation(null);
  g.getRange(2, 1, 1, 3).setDataValidations([[{ list: ['x'], dropdown: false }, null, { date: true }]]);
  g.commit();
  const dv = (r, c) => cellOf(s, r, c).dv;
  assert.deepStrictEqual([dv(1, 1), dv(1, 2), dv(1, 3), dv(1, 6)], ['list:godzin|dni:strict:dropdown', 'list:a|b:loose:dropdown', 'date', null]);
  assert.deepStrictEqual([dv(2, 1), dv(2, 2), dv(2, 3)], ['list:x:strict:plain', null, 'date']);
});

both('a checkbox and a validation on one cell: the last one wins', env => {
  const s = env.sheet('S', 50, 4);
  const g = env.open('S');
  g.setCheckbox(1, 1, true);
  g.getRange(1, 1).setDataValidation({ list: ['a'] });
  g.getRange(2, 1).setDataValidation({ list: ['a'] });
  g.setCheckbox(2, 1, false);
  g.commit();
  assert.strictEqual(cellOf(s, 1, 1).dv, 'list:a:strict:dropdown');
  assert.strictEqual(cellOf(s, 2, 1).dv, 'checkbox');
});

both('a validation moves with inserted rows', env => {
  const s = env.sheet('S', 50, 4);
  const g = env.open('S');
  g.getRange(3, 1).setDataValidation({ list: ['a'] });
  g.insertRowsAfter(1, 2);
  g.commit();
  assert.strictEqual(cellOf(s, 5, 1).dv, 'list:a:strict:dropdown');
  assert.strictEqual(cellOf(s, 3, 1).dv, null);
});

// ---- formats ------------------------------------------------------------------------------------------------------
both('formats: weight, size, colour (name, hex, #aarrggbb), alignments, wrap, number format, backgrounds', env => {
  const s = env.sheet('S', 50, 6);
  const g = env.open('S');
  const r = g.getRange(1, 1, 1, 3);
  r.setFontWeights([['bold', 'normal', 'bold']]).setFontSizes([[10, 8, 8]]).setFontColors([['#ff000000', '#999999', 'green']]);
  r.setHorizontalAlignments([['general', 'center', 'general-left']]).setVerticalAlignments([['bottom', 'middle', 'bottom']]);
  r.setWrapStrategies([['OVERFLOW', SpreadsheetApp.WrapStrategy.WRAP, 'CLIP']]);
  r.setBackgrounds([['#cccccc', '#ffffff', 'red']]);
  g.getRange(2, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  g.getRange(2, 2, 1, 2).setNumberFormat('#,##0');
  g.commit();
  assert.deepStrictEqual(cellOf(s, 1, 1).fmt, { bold: true, size: 10, color: '#000000', vAlign: 'bottom', wrap: 'OVERFLOW', bg: '#cccccc' });
  assert.deepStrictEqual(cellOf(s, 1, 2).fmt, { bold: false, size: 8, color: '#999999', hAlign: 'center', vAlign: 'middle', wrap: 'WRAP', bg: '#ffffff' });
  assert.deepStrictEqual(cellOf(s, 1, 3).fmt, { bold: true, size: 8, color: '#008000', vAlign: 'bottom', wrap: 'CLIP', bg: '#ff0000' });
  assert.deepStrictEqual([cellOf(s, 2, 1).fmt.numFmt, cellOf(s, 2, 3).fmt.numFmt], ['yyyy-mm-dd hh:mm', '#,##0']);
});

both('formats: a bad colour / alignment / wrap fails at the call, not at the commit', env => {
  env.sheet('S', 50, 4);
  const g = env.open('S');
  assert.throws(() => g.getRange(1, 1).setFontColor('plum-ish'), /unknown colour/);
  assert.throws(() => g.getRange(1, 1).setBackground('#12'), /unknown colour/);
  assert.throws(() => g.getRange(1, 1).setHorizontalAlignment('diagonal'), /unknown horizontal alignment/);
  assert.throws(() => g.getRange(1, 1).setWrapStrategy('SOMETIMES'), /unknown wrap strategy/);
});

both('formats move with inserted rows and columns', env => {
  const s = env.sheet('S', 50, 6);
  const g = env.open('S');
  g.getRange(3, 3).setFontWeight('bold').setBackground('#cccccc');
  g.insertRowsAfter(1, 2);
  g.insertColumnsAfter(1, 1);
  g.commit();
  assert.deepStrictEqual([cellOf(s, 5, 4).fmt.bold, cellOf(s, 5, 4).fmt.bg, cellOf(s, 3, 3).fmt.bold], [true, '#cccccc', undefined]);
});

// ---- dates ----------------------------------------------------------------------------------------------------------
['Asia/Tokyo', 'Europe/Warsaw'].forEach(tz => both('a Date written with a number format is the same moment when read back (' + tz + ')', env => {
  const s = env.sheet('S', 50, 6);
  const when = new Date('2026-10-23T05:15:00Z');
  const g = env.open('S');
  g.getRange(2, 4).setValue(when).setNumberFormat('yyyy-mm-dd hh:mm');
  g.commit();
  assert.strictEqual(g.getRange(2, 4).getValue().getTime(), when.getTime(), 'in the grid after the commit');
  const again = env.open('S').getRange(2, 4).getValue();
  assert.strictEqual(again.getTime(), when.getTime(), 'read from the sheet');
  assert.ok(Math.abs(cellOf(s, 2, 4).v - env.book.toSerial(when)) < 1e-9, 'stored as the sheet\'s serial number');
}, { tz }));

// ---- widths, new sheets, repeated commits ------------------------------------------------------------------------
both('autoResizeColumns and row heights are passed on', env => {
  const s = env.sheet('S', 50, 6);
  const g = env.open('S');
  g.autoResizeColumns(2, 4);
  g.setRowHeight(3, 40);
  g.commit();
  assert.deepStrictEqual(s.fitted.columns, [[2, 4]]);
  assert.strictEqual(s.rowPx[3], 40);
});

both('autoResizeColumns follows inserted columns', env => {
  const s = env.sheet('S', 50, 6);
  const g = env.open('S');
  g.autoResizeColumns(3, 2);
  g.insertColumnsAfter(1, 2);
  g.commit();
  assert.deepStrictEqual(s.fitted.columns, [[5, 2]]);
});

both('Grid.create: the sheet is inserted by the commit, with everything written', env => {
  const g = Grid.create({ sheetName: 'Nowy', rows: 4, cols: 7 });
  assert.strictEqual(env.book.sheets['Nowy'], undefined, 'nothing is created before the commit');
  g.getRange(2, 2, 1, 2).setValues([['Opis linii', 'Arkusz']]);
  g.getRange(1, 2, 1, 5).merge();
  g.getRange(1, 2).setValue('Zapytanie').setFontWeight('bold');
  g.getRange(3, 5).setDataValidation({ list: ['godzin', 'dni'] });
  g.getRange(4, 8).setValue('past the window');
  g.commit();
  const s = env.book.sheets['Nowy'];
  assert.ok(s, 'created');
  assert.deepStrictEqual([cellOf(s, 1, 2).v, cellOf(s, 2, 2).v, cellOf(s, 2, 3).v, cellOf(s, 4, 8).v], ['Zapytanie', 'Opis linii', 'Arkusz', 'past the window']);
  assert.deepStrictEqual(s.merges, [{ r1: 1, c1: 2, r2: 1, c2: 6 }]);
  assert.strictEqual(cellOf(s, 1, 2).fmt.bold, true);
  assert.strictEqual(cellOf(s, 3, 5).dv, 'list:godzin|dni:strict:dropdown');
});

both('Grid.create: inserting rows and columns before the commit', env => {
  const g = Grid.create({ sheetName: 'Nowy', rows: 3, cols: 3 });
  g.getRange(1, 1, 3, 1).setValues([['a'], ['b'], ['c']]);
  g.insertRowsAfter(1, 2);
  g.getRange(2, 1, 2, 1).setValues([['n1'], ['n2']]);
  g.insertColumnsAfter(1, 1);
  g.getRange(1, 2).setValue('col');
  g.commit();
  const s = env.book.sheets['Nowy'];
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(r => cellOf(s, r, 1).v), ['a', 'n1', 'n2', 'b', 'c']);
  assert.strictEqual(cellOf(s, 1, 2).v, 'col');
  assert.strictEqual(s.rowCount, NEW_SHEET_ROWS_ + 2);
});
const NEW_SHEET_ROWS_ = 1000;

both('Grid.create: an existing sheet name fails at the commit', env => {
  env.sheet('Jest');
  const g = Grid.create({ sheetName: 'Jest' });
  assert.throws(() => g.commit(), /already exists/);
});

both('commit twice: the second writes only what changed after the first, structure included', env => {
  const s = env.sheet('S', 50, 5);
  fill(s, [['a'], ['b']]);
  const g = env.open('S');
  g.getRange(1, 1).setValue('A');
  g.insertRowsAfter(1, 1);
  g.getRange(2, 1).setValue('new');
  g.commit();
  env.book.requests.length = 0;
  const calls = env.book.serviceCalls;
  g.getRange(4, 1).setValue('c');                                            // the grid knows the sheet now has one more row
  g.commit();
  assert.deepStrictEqual([1, 2, 3, 4].map(r => cellOf(s, r, 1).v), ['A', 'new', 'b', 'c']);
  assert.strictEqual(s.rowCount, 51, 'the first insert is not repeated');
  if (env.mode === 'api') {
    const writes = [].concat(...env.book.requests).filter(r => r.updateCells && r.updateCells.fields === 'userEnteredValue');
    assert.strictEqual(writes.length, 1, 'only the new cell is written: ' + JSON.stringify(writes));
    assert.ok(![].concat(...env.book.requests).some(r => r.insertDimension || r.appendDimension));
  }
});

both('commit twice: nothing from the first commit is written again', env => {
  const s = env.sheet('S', 50, 5);
  const g = env.open('S');
  g.getRange(1, 1).setValue('v').setNote('n').setFontWeight('bold').setBackground('#cccccc').setDataValidation({ list: ['a'] });
  g.getRange(2, 1).setHorizontalAlignment('center');
  g.setCheckbox(3, 1, true);
  g.getRange(4, 1, 1, 2).merge();
  g.autoResizeColumns(1, 1);
  g.setRowHeight(5, 33);
  g.commit();
  const clean = () => { s.cells = {}; s.rowPx = {}; s.fitted = { rows: [], columns: [] }; };      // someone clears the sheet
  clean();
  g.getRange(10, 1).setValue('later');
  g.commit();
  assert.deepStrictEqual(Object.keys(s.cells), ['10,1'], 'only the later cell: ' + JSON.stringify(s.cells));
  assert.deepStrictEqual([s.fitted.columns.length, Object.keys(s.rowPx).length], [0, 0]);
});

both('commit twice: the row count is tracked (a middle insert after an append is an insert)', env => {
  const s = env.sheet('S', 30, 4);
  const g = env.open('S');
  g.insertRowsAfter(30, 5);                         // appended at the end
  g.commit();
  s.setValue(34, 1, 'x', '');                       // a line below the future insert
  const g2 = env.open('S');
  g.insertRowsAfter(33, 1);
  g.commit();
  assert.strictEqual(s.rowCount, 36);
  assert.strictEqual(cellOf(s, 35, 1).v, 'x', 'shifted down by the insert, not appended past it');
});

both('commit twice: a status colour switched on and off (the use case of the config sheet)', env => {
  const s = env.sheet('S', 50, 6);
  const g = env.open('S');
  g.getRange(2, 2).setFontColor('black').setBackground('green');
  g.commit();
  assert.deepStrictEqual([cellOf(s, 2, 2).fmt.color, cellOf(s, 2, 2).fmt.bg], ['#000000', '#008000']);
  g.getRange(2, 2).setFontColor('#999999').setBackground('#cccccc');
  g.commit();
  assert.deepStrictEqual([cellOf(s, 2, 2).fmt.color, cellOf(s, 2, 2).fmt.bg], ['#999999', '#cccccc']);
});

both('the API path reads the sheet once and writes once; one commit = one batchUpdate', env => {
  if (env.mode !== 'api') return;
  const s = env.sheet('S', 50, 6);
  fill(s, [['a']]);
  const g = env.open('S');
  g.getRange(1, 1, 3, 3).setValues([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  g.getRange(1, 1).setNote('n').setFontWeight('bold');
  g.insertRowsAfter(1, 1);
  g.commit();
  assert.strictEqual(env.book.gets.filter(o => o.includeGridData).length, 1, 'one data read');
  assert.strictEqual(env.book.requests.length, 1, 'one batchUpdate');
});

// ---- parity: a bigger scenario, both paths must give the same sheet -------------------------------------------------
function configSheetScenario(env) {
  // the shape of SheetCoeditor.insertNewConfigSheet + setupConfigHeader + a few rows + status switches
  const g = Grid.create({ sheetName: 'Konfiguracja 1', rows: 6, cols: 7 });
  const R = g.getRange(1, 1, 4, 7);
  R.setFontWeights([['normal', 'bold', 'normal', 'normal', 'normal', 'normal', 'normal'], ['normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal'], ['normal', 'bold', 'bold', 'normal', 'normal', 'normal', 'normal'], ['normal', 'bold', 'bold', 'bold', 'bold', 'bold', 'normal']]);
  R.setBackgrounds([['#cccccc', '#cccccc', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#cccccc'], Array(7).fill('#cccccc'), ['#cccccc', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#cccccc'], ['#cccccc', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#cccccc']]);
  R.setFontSizes([Array(7).fill(10), [10, 8, 8, 8, 8, 10, 10], [10, 8, 8, 10, 10, 10, 10], [10, 8, 8, 8, 8, 8, 10]]);
  R.setHorizontalAlignments([['general', 'center', 'general', 'general', 'general', 'general', 'general'], ['general', 'center', 'center', 'center', 'general-left', 'general-right', 'general'], ['general', 'general-left', 'general-left', 'general', 'general', 'general', 'general'], ['general', 'general-left', 'general-right', 'general-right', 'general-right', 'general-right', 'general']]);
  g.getRange(1, 2, 1, 5).merge();
  g.getRange(3, 3, 1, 4).merge();
  R.setNotes([Array(7).fill(''), Array(7).fill(''), Array(7).fill(''), ['', 'Skrypt czyta tylko linie z poprawnym opisem.', '', '', '', '', '']]);
  R.setValues([['', 'Zapytanie do bazy danych BC', '', '', '', '', ''], ['', 'Analiza zapytania', 'Pobieranie z bazy danych', 'Wstawianie danych do arkusza', 'Szacowana liczba wierszy:', '', ''], ['', 'Linie zapytania', 'Kolejne składowe linii zapytania', '', '', '', ''], ['', 'Opis linii', 1, 2, 3, 4, '']]);
  R.setVerticalAlignments(Array(4).fill(Array(7).fill('bottom')));
  R.setWrapStrategies(Array(4).fill(Array(7).fill('OVERFLOW')));
  R.setFontColors([Array(7).fill('#ff000000'), ['#ff000000', '#999999', '#999999', '#999999', '#999999', '#999999', '#ff000000'], Array(7).fill('#ff000000'), Array(7).fill('#ff000000')]);
  g.commit();

  const c = Grid.open({ sheetName: 'Konfiguracja 1' });
  c.getRange(5, 2, 2, 5).setValues([['table', 'Customers', '', '', ''], ['queryOption', 'select', '', '', '']]);
  c.getRange(5, 3).setDataValidation({ list: ['Customers', 'Items'] });
  c.getRange(6, 3).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['select', 'filter'], true).build());
  c.getRange(6, 3).setNote('Pusta lista może wynikać z braku połączenia z BC.');
  c.insertRowsAfter(5, 1);
  c.getRange(6, 2, 1, 3).setValues([['queryOption', 'filter', 'Name']]);
  c.getRange(2, 6).setValue(12345).setNumberFormat('#,##0');
  c.getRange(2, 2).setFontColor('black').setBackground('green');
  c.commit();
  c.getRange(2, 2).setFontColor('#999999').setBackground('#cccccc');
  c.getRange(2, 5, 1, 2).setFontColor('black');
  c.commit();
}
parity('config sheet: create the header, fill rows, insert a row, switch status colours', configSheetScenario);

parity('settings sheet: the table, a checkbox row, a refresh time', env => {
  const g = Grid.create({ sheetName: 'Ustawienia', rows: 8, cols: 6 });
  g.getRange(2, 2, 5, 4).setValues([['Opis linii', 'Arkusz konfiguracji', 'Arkusz docelowy', 'Odświeżanie automatyczne'], ['', '', '', ''], ['headerGeneralSettings', 'Ustawienia odświeżania automatycznego', '', ''], ['lastRefresh', 'Ostatnio odświeżone o:', '', ''], ['refreshFrequency', 'Odświeżaj co:', '', 'godzin']]);
  g.getRange(6, 5).setDataValidation({ list: ['godzin', 'dni'] });
  g.getRange(5, 4).setNumberFormat('yyyy-mm-dd hh:mm');
  g.autoResizeColumns(2, 5);
  g.commit();
  const s = Grid.open({ sheetName: 'Ustawienia' });
  s.insertRowsAfter(6, 1);
  s.getRange(7, 2, 1, 4).setValues([['configSheet', 'Konfiguracja 1', 'Dane wg. Konfiguracja 1', false]]);
  s.setCheckbox(7, 5, false);
  s.getRange(5, 4).setValue(new Date('2026-10-23T05:15:00Z'));
  s.commit();
});

parity('structure: inserts, column deletes, merges, notes and validation around them', env => {
  const s = env.sheet('S', 60, 8);
  fill(s, [['h', 'i', 'j'], ['k'], ['l', 'm']]);
  s.merge(1, 5, 2, 5);
  s.cell(3, 1, true).note = 'n3';
  s.cell(3, 2, true).dv = 'list:q:strict:dropdown';
  const g = env.open('S');
  g.insertRowsAfter(1, 2);
  g.getRange(2, 1, 2, 2).setValues([[1, 2], [3, 4]]);
  g.insertColumnsAfter(2, 1);
  g.deleteColumns(1, 1);
  g.getRange(5, 1, 1, 2).merge();
  g.breakApart && g.getRange(1, 5, 4, 1).breakApart();
  g.setCheckbox(6, 1, true);
  g.commit();
});

// ---- architecture rules ----------------------------------------------------------------------------------------------
test('rule: Grid.js and Grid Util.js contain no project words', () => {
  const words = /Konfiguracja|Ustawienia|OData|\bBC\b|Coeditor|SettingsSheet|CoedOption|getMainSettings|getImportSettings|StorageObject|PropertiesService|ScriptApp|UrlFetchApp|LockService/;
  [SRC.grid, SRC.util].forEach(f => {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!words.test(text), f + ' mentions a project word: ' + (text.match(words) || [])[0]);
  });
});

test('rule: the helpers Grid.js calls are defined in Grid.js or Grid Util.js (the files are alone in the project)', () => {
  const text = code.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const defined = new Set((text.match(/function\s+([A-Za-z0-9_]+_)\s*\(/g) || []).map(x => x.replace(/function\s+|\s*\(/g, '')));
  const called = new Set((text.match(/(?<![.\w])[A-Za-z][A-Za-z0-9]*_\(/g) || []).map(x => x.slice(0, -1)));
  const missing = [...called].filter(x => !defined.has(x));
  assert.deepStrictEqual(missing, []);
});

test('rule: nothing is used at load time (the files load in any order)', () => {
  const ctx = vm.createContext({});
  const a = fs.readFileSync(path.join(ROOT, 'Grid Util.js'), 'utf8'), b = fs.readFileSync(path.join(ROOT, 'Grid.js'), 'utf8');
  vm.runInContext(a + '\n' + b, ctx);                  // utilities first, then the grid: no globals of the platform exist at all
  const ctx2 = vm.createContext({});
  vm.runInContext(b + '\n' + a, ctx2);                 // the other order
});

test('rule: no other platform globals than SpreadsheetApp, Sheets and Utilities', () => {
  const text = code.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const found = new Set((text.match(/\b(SpreadsheetApp|Sheets|Utilities|PropertiesService|CacheService|ScriptApp|Session|Logger|HtmlService|UrlFetchApp|LockService|DriveApp|console)\b/g) || []));
  assert.deepStrictEqual([...found].sort(), ['Sheets', 'SpreadsheetApp', 'Utilities']);
});

// ---- ConfigGrid and SheetCoeditor (golden tests against the frozen legacy code) ------------------------------------------
require('./config-grid.test.js')({ test, both, parity, MODES, Grid });

// ---- state layer: stores, settings, locks, agent detection state (fresh Apps Script executions on fake platform services) ----------
require('./state.test.js')({ test });

// ---- runner -----------------------------------------------------------------------------------------------------------
let failed = 0;
tests.forEach(t => {
  try { t.fn(); console.log('ok   ' + t.name); }
  catch (e) { failed++; console.log('FAIL ' + t.name + '\n       ' + String(e.stack || e).split("\n").slice(0, 16).join('\n       ')); }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
