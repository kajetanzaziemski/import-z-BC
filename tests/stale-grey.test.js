// The greying of stale cells on a config sheet (conditional formatting), and its use by the co-edit.
//
// A config line is made of a fixed number of cells (QUERY_OPTION_WIDTHS / LINE_WIDTH_TABLE in Content Tracker.js, counted from column B). Anything to the right of
// them, and anything to the right of a gap in a line that is not finished, is grey: it is not part of the query (tests/query-lines.test.js). The greying is a set
// of conditional format rules (Config Grid.js builds them from the widths) - it needs no run of the co-edit and takes the colour away the moment the cell
// stands in its place. The Spreadsheet formulas cannot run here: a small evaluator for exactly the functions the rules use checks them against the rules in words.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { SimBook } = require('./sim');

const ROOT = path.join(__dirname, '..');
const FILES = ['Grid.js', 'Grid Util.js', 'Config Grid.js', 'Custom errors.js', 'functions.js', 'OData Query.js', 'Fix Register.js', 'Data Validations.js', 'Content Tracker.js', 'Sheet Coeditor.js'];

module.exports = function register(t) {
  const { test } = t;
  function scope(mode) {
    const book = new SimBook({ api: mode === 'api' });
    const ctx = vm.createContext({ console: { log() {}, error() {} } });
    book.install(ctx);
    FILES.forEach(f => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(ctx));
    vm.runInContext(`globalThis.dbgLog = () => {}; globalThis.coeditNote_ = () => {}; globalThis.coeditHash_ = () => null; globalThis.coeditMarkerGet_ = () => null; globalThis.coeditMarkerSet_ = () => {};
      globalThis.getMetadata = () => ({ listTables: () => ['Customers'], listProperties: () => ['No', 'Name'], listNavProperties: () => ['Lines'], getDataType: () => 'Edm.String' });`, ctx);
    return { book, ctx, run: code => vm.runInContext(code, ctx) };
  }
  const formulas = () => { const s = scope('service'); return JSON.parse(s.run(`JSON.stringify(ConfigGrid.greyRules(QUERY_OPTION_WIDTHS, LINE_WIDTH_TABLE))`)); };

  // ---- the rules in words (independent of the formulas) -----------------------------------------------------------------------------------------
  const OPTION_WIDTH = { select: 3, limit: 3, filterLogic: 4, orderBy: 4, filter: 5 };
  /** Is the cell in column col (2 = B ... 6 = F) of a line [B, C, D, E, F] grey? */
  function expectGrey(cells, col) {
    const label = cells[0], opt = cells[1];
    if (label === 'table' || label === 'extend') return col > 3;
    if (label !== 'queryOption' && label !== 'extendOption') return false;
    if (col <= 3) return false;
    const blankBefore = cells.slice(1, col - 2).some(v => v === '' || v === null);      // cells C .. the one left of this
    if (blankBefore) return true;
    const width = OPTION_WIDTH[opt] ?? 2;
    return col > 1 + width;
  }

  // ---- a small evaluator for the functions the rules use ------------------------------------------------------------------------------------------
  function evalFormula(formula, cells, col) {
    const letters = { B: 0, C: 1, D: 2, E: 3, F: 4 };
    const cell = L => cells[letters[L]];
    const lc = v => String(v ?? '').toLowerCase();
    let js = formula.slice(1);
    js = js.replace(/COUNTBLANK\(\$([A-Z])6:INDEX\(\$([A-Z])6:\$([A-Z])6,COLUMN\(\)-(\d+)\)\)/g, (m, a, from, to, k) => `COUNTBLANK(RANGE("${a}",INDEXCOL("${from}",COLUMN()-${k})))`);
    js = js.replace(/\$([A-Z])6<>"([^"]*)"/g, (m, L, v) => `NEQ(REF("${L}"),"${v}")`);
    js = js.replace(/\$([A-Z])6="([^"]*)"/g, (m, L, v) => `EQ(REF("${L}"),"${v}")`);
    js = js.replace(/COLUMN\(\)/g, 'COL');
    const env = {
      AND: (...a) => a.every(Boolean), OR: (...a) => a.some(Boolean), COL: col,
      REF: L => cell(L), EQ: (a, b) => lc(a) === lc(b), NEQ: (a, b) => lc(a) !== lc(b),
      INDEXCOL: (from, n) => String.fromCharCode(from.charCodeAt(0) + n - 1),
      RANGE: (a, b) => { const out = []; for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) out.push(cells[c - 66]); return out; },
      COUNTBLANK: r => r.filter(v => v === '' || v === null || v === undefined).length
    };
    return vm.runInNewContext(js, env);
  }
  const greyBy = (rules, cells, col) => rules.some(r => evalFormula(r.formula, cells, col));

  const OPTIONS = ['queryOption', 'extendOption'];
  const WORDS = ['select', 'limit', 'filterLogic', 'orderBy', 'filter', '', 'selekt'];
  const VALUES = ['', 'x'];
  const lines = [];
  ['table', 'extend'].forEach(l => VALUES.forEach(a => VALUES.forEach(b => lines.push([l, a, b, 'stale', '']))));
  OPTIONS.forEach(l => WORDS.forEach(w => VALUES.forEach(a => VALUES.forEach(b => VALUES.forEach(c => VALUES.forEach(d => lines.push([l, w, a, b, c, d].slice(0, 5))))))));
  ['header', '', 'select'].forEach(l => lines.push([l, 'select', 'a', 'b', 'c']));

  test('grey rules: for every kind of line, with every combination of filled and empty cells, the formulas grey exactly the cells the rules in words say (' + lines.length + ' lines x 5 columns)', () => {
    const rules = formulas();
    const wrong = [];
    lines.forEach(cells => { for (let col = 2; col <= 6; col++) if (greyBy(rules, cells, col) !== expectGrey(cells, col)) wrong.push(JSON.stringify(cells) + ' col ' + col + ' expected ' + expectGrey(cells, col)); });
    assert.deepStrictEqual(wrong.slice(0, 5), [], wrong.length + ' cells differ');
  });

  test('grey rules: the formulas themselves (what is written to the sheet), pinned', () => {
    assert.deepStrictEqual(formulas().map(r => r.formula), [
      '=AND(OR($B6="table",$B6="extend"),COLUMN()>3)',
      '=AND(OR($B6="queryOption",$B6="extendOption"),OR($C6="select",$C6="limit"),COLUMN()>4)',
      '=AND(OR($B6="queryOption",$B6="extendOption"),OR($C6="filterLogic",$C6="orderBy"),COLUMN()>5)',
      '=AND(OR($B6="queryOption",$B6="extendOption"),$C6<>"",$C6<>"select",$C6<>"limit",$C6<>"filterLogic",$C6<>"orderBy",$C6<>"filter",COLUMN()>3)',
      '=AND(OR($B6="queryOption",$B6="extendOption"),COLUMN()>3,COUNTBLANK($C6:INDEX($C6:$F6,COLUMN()-3))>0)'
    ]);
    assert.ok(formulas().every(r => r.fontColor === '#999999'));
  });

  test('grey rules: they follow the widths - a table with other widths gives other rules (one source of truth)', () => {
    const s = scope('service');
    const r = JSON.parse(s.run(`JSON.stringify(ConfigGrid.greyRules({ select: 4, limit: 3 }, 3).map(x => x.formula))`));
    assert.ok(r.some(f => /OR\(\$C6="select"\),COLUMN\(\)>5/.test(f)) && r.some(f => /OR\(\$C6="limit"\),COLUMN\(\)>4/.test(f)), r.join('\n'));
    assert.ok(r[0].endsWith('COLUMN()>4)'), 'the table width 3 greys from column E: ' + r[0]);
  });

  // ---- on the sheet --------------------------------------------------------------------------------------------------------------------------------
  ['api', 'service'].forEach(mode => {
    test(`the co-edit puts the grey rules on the config sheet (B6 down, columns B-F), once - the next co-edit writes no rule [${mode}]`, () => {
      const s = scope(mode);
      s.run(`ConfigGrid.create('K')`);
      const sh = s.book.sheets['K'];
      [['table', 'Customers'], ['queryOption', 'select', 'No', 'stale']].forEach((r, i) => r.forEach((v, j) => sh.setValue(6 + i, 2 + j, v, '')));
      s.run(`new SheetCoeditor('K', false).sheetEdit({})`);
      const rules = sh.snapshot().condRules;
      assert.strictEqual(rules.length, 5);
      assert.ok(rules.every(r => r.color === '#999999' && r.ranges.length === 1 && /^6,2,\d+,6$/.test(r.ranges[0])), JSON.stringify(rules));
      const writes = s.book.condWrites;
      s.run(`new SheetCoeditor('K', false).sheetEdit({})`);
      assert.strictEqual(s.book.condWrites, writes, 'nothing new to write');
      assert.strictEqual(sh.snapshot().condRules.length, 5);
    });

    test(`a rule list from an older version, or one split by a paste, is replaced by the current one; other rules of the sheet stay [${mode}]`, () => {
      const s = scope(mode);
      s.run(`ConfigGrid.create('K')`);
      const sh = s.book.sheets['K'];
      const f = JSON.parse(s.run(`JSON.stringify(ConfigGrid.greyRules(QUERY_OPTION_WIDTHS, LINE_WIDTH_TABLE))`));
      sh.condRules.push({ formula: '=$D1>5', color: '#ff0000', ranges: [{ r1: 1, c1: 4, r2: 50, c2: 4 }] });
      sh.condRules.push({ formula: f[0].formula, color: '#999999', ranges: [{ r1: 6, c1: 2, r2: 9, c2: 6 }] }, { formula: f[0].formula, color: '#999999', ranges: [{ r1: 12, c1: 2, r2: 1000, c2: 6 }] });
      s.run(`new SheetCoeditor('K', false).sheetEdit({})`);
      const rules = sh.snapshot().condRules;
      assert.strictEqual(rules[0].formula, '=$D1>5', 'the foreign rule keeps its place');
      assert.strictEqual(rules.filter(r => r.formula === f[0].formula).length, 1);
      assert.strictEqual(rules.length, 6);
    });
  });

  test('rule: the grey rules are built in Config Grid.js only; the co-edit just asks for them (Sheet Coeditor.js knows no formula)', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Sheet Coeditor.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/COUNTBLANK|COLUMN\(\)|ConditionalFormat/.test(text));
    assert.ok(/setLineFormats\(/.test(text));
  });
};
