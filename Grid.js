// Copied from kajetanzaziemski/wyceny (grid.js @ e042de5). See docs/grid/ for the reference and docs/architecture-proposal.md for the plan.
// ---------------------------------------------------------------------------
// GRID: an in-memory copy of the top rows of ONE sheet, behind a small Sheet-like interface.
//
// This file knows nothing about the pricing project (no header names, price rows, notes...): it is the one place
// that talks to the Sheets API / Spreadsheet service for editing a sheet, and it could serve another project.
//   1. Grid.open(spec)       - ONE read: values, formulas, merges (and, for a reset, the template to paste)
//   2. run an operation on the grid instead of the sheet (cells, structure, merges, borders, notes, checkboxes...)
//   3. grid.commit()         - ONE write: a single batchUpdate with the reset, inserts / deletes, merges, cells,
//                              alignment, borders, freeze. Without the Sheets advanced service the same grid falls
//                              back to the Spreadsheet service (a handful of batched calls).
// The one project-shaped idea is the ANCHOR ROW: a row that follows row inserts above it (for the report it is the
// first price row: the headers are the rows above it). The freeze follows the anchor, see _frozenPlan.
// A project adapter (reportGrid.js) supplies sheet names and the anchor; it also adds the project's own names.
//
// Additions for import-z-BC (everything else is as in wyceny):
//   - Grid.create(spec): a grid for a sheet that does not exist yet; the sheet is inserted by commit()
//   - commit() can be called more than once: after a commit the pending changes are cleared and the grid goes on
//   - the window grows instead of being cut: with the rows inserted, and with writes past it (rows up to the sheet's size,
//     columns are appended to the sheet); notes and validations reach their cells too
//   - cell formats: font weight / size / colour, vertical alignment, wrap, number format (+ the array forms)
//   - data validation: lists and dates (plain specs, or a SpreadsheetApp DataValidation), notes in the array form
//   - Date values are read and written in both paths (the API path converts to / from serial numbers)
//   - autoResizeColumns
//   - grid.setFormulaFontColors(range, rules, ownedFormulas): conditional formats (custom formula -> font colour), replacing the caller's own rules and no others
//   - grid.getFormulaSeparator(): "," or ";" (the locale of the spreadsheet) for the formulas given to setFormulaFontColors
//   - grid.getTimeZone(): the spreadsheet's time zone
//   - Grid.exists(sheetName): whether the sheet is there, without reading it
// The wyceny "reset from a template" path is kept but nothing in import-z-BC uses it and it has no tests here.
// ---------------------------------------------------------------------------

const USE_SHEETS_API = true;   // false = always use the Spreadsheet service path

const MODEL_ROWS = 20;      // window: at least rows 1..20; always reaches 3 rows past the anchor row

const NEW_SHEET_ROWS = 1000;    // size of a sheet inserted by SpreadsheetApp (Grid.create counts on it)
const NEW_SHEET_COLS = 26;

const MODEL_MAX_ROWS = 3000;   // the window never grows past this (it covers every price line, see below)

/**
 * Rows of the model window: the rows around the anchor at least, and
 * everything the sheet uses (`lastRow`) so that operations reach every price line; a few spare rows
 * keep the last lines inside the window when an operation inserts a header row.
 */
function modelRows_(anchorRow, lastRow) {
  return Math.min(MODEL_MAX_ROWS, Math.max(MODEL_ROWS, anchorRow + 3, (lastRow || 0) + 5));
}

class Grid {
  /** init = { source, sheetName, maxRows, anchorRow, rows, cols, v, f, merges, frozenRows } - see Grid.open at the bottom. */
  constructor(init) {
    this.source = init.source;                   // { kind: 'service', sheet } | { kind: 'api', ... }
    this.maxRows = init.maxRows;
    this.sheetName = init.sheetName;
    this.anchorRow = init.anchorRow;             // follows row inserts above it (see the header comment)
    this.rows = init.rows;
    this.cols = init.cols;
    this.v = init.v;                             // [row - 1][col - 1]
    this.f = init.f;                             // '' for cells without a formula
    this.merges = init.merges;                   // [{ r1, c1, r2, c2 }]
    this.frozenRows = init.frozenRows || 0;      // frozen rows of the sheet when the model was read (see _frozenPlan)
    this.anchorRow0 = init.anchorRow;            // the anchor the grid started with (a reset starts as the template)
    this.sheetAnchorRow = init.sheetAnchorRow !== undefined ? init.sheetAnchorRow : init.anchorRow;   // the anchor of the SHEET as it stands now

    this.ops = [];                               // structural changes, in order
    this.dirty = {};                             // 'row,col' -> true: cells written by the operation
    this.notes = {};                             // 'row,col' -> text: cell notes set by the operation ('' = remove the note)
    this.checks = {};                            // 'row,col' -> true (a checkbox) / false (no checkbox any more): set by the operation
    this.aligns = [];                            // [{ a, r1, c1, r2, c2 }]
    this.rowSizes = {};                          // row -> pixels: heights set by the operation
    this.fitRows = [];                           // rows (final numbers) fitted to their content at the end of the commit (inserted with opts.fit)
    this.fills = [];                             // [{ color, r1, c1, r2, c2 }]: background colours set by the operation (color null = no fill)
    this.borders = [];                           // [{ a1: [...], args: [...] }]
    this.afterOps = [];                          // [{ api: sheetId => requests, service: sheet => void }]: run right after the structural changes
    this.rowFormats = [];                        // [{ row, spec: { size, color, clearTop, clearBottom } }]: whole rows
    this.active = null;                          // [row, col] to select after the commit
    this.scratch = {};                           // free storage for the services during one session (not written anywhere)
    this.formats = [];                           // [{ r1, c1, r2, c2, props: { bold, size, color, vAlign, wrap, numFmt } }]
    this.validations = {};                       // 'row,col' -> spec ({ list, strict, dropdown } / { date: true }) or null (= remove the validation)
    this.colFits = [];                           // [{ first, count }]: columns fitted to their content at the end of the commit
    this.condSets = [];                          // [{ range: { r1, c1, r2?, c2 }, rules: [{ formula, fontColor }], owned: [formula] }]: conditional formats set by the operation
    this.tz = init.tz || null;                   // the spreadsheet's time zone (Date <-> serial number); read lazily when needed
    this.maxCols = init.maxCols || init.cols;    // columns of the sheet (grows with inserts and with writes past the last column)
  }

  /**
   * Conditional formats: for `range` ({ r1, c1, r2, c2 }; r2 missing = down to the last row of the sheet) the rules `[{ formula, fontColor }]` (a custom
   * formula, written for the top-left cell of the range, that turns the font to a colour). `ownedFormulas` are the formulas the caller manages: the
   * sheet's custom-formula rules with one of them are replaced by `rules` wherever they are (a paste splits a rule into pieces); every other rule is
   * left as it is, in its place. When the sheet already has exactly these rules nothing is written.
   */
  setFormulaFontColors(range, rules, ownedFormulas) {
    rules.forEach(x => colorToApi_(x.fontColor));              // a bad colour fails now, not at the commit
    this.condSets.push({ range: { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 }, rules: rules.map(x => ({ formula: x.formula, fontColor: x.fontColor })), owned: ownedFormulas.slice() });
  }

  // --- the Sheet API slice ---------------------------------------------------
  getName() { return this.sheetName; }
  getMaxRows() { return this.maxRows; }
  getLastColumn() { return this.cols; }
  getLastRow() { return this.rows; }              // the window reaches past the last used row
  getAnchorRow() { return this.anchorRow; }
  getRange(r, c, nr, nc) { return new GridRange(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc); }
  /** Sets the height of row `r` in pixels (committed with the rest, after the structural changes). */
  setRowHeight(r, px) { this.rowSizes[r] = px; return this; }
  formatRow(row, spec) { this.rowFormats.push({ row: row, spec: spec }); }
  /** The note look for ONE cell (a used note row: the other cells of the row are the user's); borders are left alone. */
  formatCell(row, col, spec) { this.rowFormats.push({ row: row, col: col, spec: spec }); }
  setActiveRange(range) { this.active = [range.getRow(), range.getColumn()]; }

  /** Fits the columns `from`..`from + n - 1` to their content (at the end of the commit; final column numbers). */
  autoResizeColumns(from, n) { this.colFits.push({ first: from, count: n }); }
  getMaxColumns() { return this.maxCols; }
  /**
   * The separator of formula arguments to write formulas with: the one of the spreadsheet's locale (";" for Polish ...), on the Sheets API path too (its
   * conditional format rules are parsed in the spreadsheet's locale: a "," formula in a Polish sheet is rejected as an invalid CUSTOM_FORMULA).
   * Formulas given to setFormulaFontColors have to be written with it.
   */
  getFormulaSeparator() {
    if (!this.locale) this.locale = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale();
    return formulaArgSeparator_(this.locale);
  }

  /** The spreadsheet's time zone (read once). */
  getTimeZone() { return this._tz(); }

  getRangeList(a1List) {
    const self = this;
    return {
      setBorder() { self.borders.push({ a1: a1List.slice(), args: Array.prototype.slice.call(arguments) }); },
      getRanges() { return a1List.map(a => { const x = parseA1_(a); return self.getRange(x.r1, x.c1, x.r2 - x.r1 + 1, x.c2 - x.c1 + 1); }); }
    };
  }

  /**
   * `opts.plain`: the new rows do not inherit the look of the row above them in one respect: no data validation (checkboxes, lists).
   * `opts.fit`: the new rows do not keep the height they inherit: at the end of the commit they are fitted to their content.
   */
  insertRowsAfter(after, n, opts) {
    this.ops.push({ t: 'ir', at: after, n: n, plain: !!(opts && opts.plain) });
    this.maxRows += n;
    if (after < this.anchorRow) this.anchorRow += n;    // rows above the anchor: it moves down with them
    const blank = () => new Array(this.cols).fill('');
    // The window grows with the inserted rows (wyceny cut it back to its old height: the rows pushed past the end were dropped from
    // the model; here they are kept, which a grid made by Grid.create needs because the model is all there is of that sheet).
    while (this.rows < after) { this.v.push(blank()); this.f.push(blank()); this.rows++; }   // inserted past the window's end
    for (let i = 0; i < n; i++) { this.v.splice(after, 0, blank()); this.f.splice(after, 0, blank()); }
    this.rows += n;
    this._shift('r', after, n);
    if (opts && opts.fit) for (let i = 1; i <= n; i++) this.fitRows.push(after + i);
  }

  insertColumnsAfter(after, n) {
    this.ops.push({ t: 'ic', at: after, n: n });
    for (let r = 0; r < this.rows; r++) {
      for (let i = 0; i < n; i++) { this.v[r].splice(after, 0, ''); this.f[r].splice(after, 0, ''); }
    }
    this.cols += n;
    this.maxCols += n;
    this._shift('c', after, n);
  }

  deleteColumns(from, n) {
    this.ops.push({ t: 'dc', at: from, n: n });
    for (let r = 0; r < this.rows; r++) { this.v[r].splice(from - 1, n); this.f[r].splice(from - 1, n); }
    this.cols -= n;
    this.maxCols -= n;

    const dropCols = map => {
      const nd = {};
      Object.keys(map).forEach(k => {
        const p = k.split(',').map(Number);
        if (p[1] >= from && p[1] < from + n) return;
        nd[p[0] + ',' + (p[1] >= from + n ? p[1] - n : p[1])] = map[k];
      });
      return nd;
    };
    this.dirty = dropCols(this.dirty);
    this.notes = dropCols(this.notes);
    this.checks = dropCols(this.checks);
    this.validations = dropCols(this.validations);

    const cut = m => {                           // merges / alignment rects lose the deleted columns
      if (m.c1 >= from + n) { m.c1 -= n; m.c2 -= n; return m; }
      if (m.c2 < from) return m;
      const removed = Math.min(m.c2, from + n - 1) - Math.max(m.c1, from) + 1;
      m.c2 -= removed;
      if (m.c1 >= from) m.c1 = from;
      return m.c2 >= m.c1 ? m : null;
    };
    this.merges = this.merges.map(cut).filter(Boolean);
    this.aligns = this.aligns.map(cut).filter(Boolean);
    this.fills = this.fills.map(cut).filter(Boolean);
    this.formats = this.formats.map(cut).filter(Boolean);
  }

  // --- internals -------------------------------------------------------------------
  /** Same rule as Sheets: rects after the insertion point move, rects spanning it grow. */
  _shift(axis, after, n) {
    const lo = axis === 'r' ? 'r1' : 'c1', hi = axis === 'r' ? 'r2' : 'c2';
    const move = m => { if (m[lo] > after) { m[lo] += n; m[hi] += n; } else if (m[hi] > after) m[hi] += n; return m; };
    this.merges.forEach(move);
    this.aligns.forEach(move);
    this.fills.forEach(move);
    this.formats.forEach(move);

    const moveKeys = map => {
      const nd = {};
      Object.keys(map).forEach(k => {
        const p = k.split(',').map(Number);
        const i = axis === 'r' ? 0 : 1;
        if (p[i] > after) p[i] += n;
        nd[p[0] + ',' + p[1]] = map[k];
      });
      return nd;
    };
    this.dirty = moveKeys(this.dirty);
    this.notes = moveKeys(this.notes);
    this.checks = moveKeys(this.checks);
    this.validations = moveKeys(this.validations);
    if (axis === 'c') this.colFits = this.colFits.map(x => (x.first > after ? { first: x.first + n, count: x.count } : x));
    if (axis === 'r') {
      this.fitRows = this.fitRows.map(r => (r > after ? r + n : r));
      const sizes = {};
      Object.keys(this.rowSizes).forEach(r => { sizes[Number(r) > after ? Number(r) + n : Number(r)] = this.rowSizes[r]; });
      this.rowSizes = sizes;
    }
  }

  /** Runs of consecutive rows to fit: [{ first, count }]. */
  _fitRuns() {
    const rows = Array.from(new Set(this.fitRows)).sort((a, b) => a - b);
    const runs = [];
    rows.forEach(r => {
      const last = runs[runs.length - 1];
      if (last && last.first + last.count === r) last.count++;
      else runs.push({ first: r, count: 1 });
    });
    return runs;
  }

  /** A checkbox (a BOOLEAN validation) with the value in the cell; clearCheckbox takes it away together with the value. */
  setCheckbox(r, c, checked) { this._set(r, c, !!checked, ''); delete this.validations[r + ',' + c]; this.checks[r + ',' + c] = true; }
  clearCheckbox(r, c) { this._set(r, c, '', ''); delete this.validations[r + ',' + c]; this.checks[r + ',' + c] = false; }

  _inWindow(r, c) { return r >= 1 && r <= this.rows && c >= 1 && c <= this.cols; }
  _val(r, c) { return this._inWindow(r, c) ? this.v[r - 1][c - 1] : ''; }
  _form(r, c) { return this._inWindow(r, c) ? this.f[r - 1][c - 1] : ''; }
  /**
   * Makes room for a write at (r, c): rows grow up to the sheet's size (past it: insertRowsAfter first), columns are
   * appended to the sheet when needed. Without this a write past the window would be lost silently.
   */
  _ensure(r, c) {
    if (r < 1 || c < 1) throw new Error('Grid: cell (' + r + ', ' + c + ') does not exist.');
    if (r > this.maxRows) throw new Error('Grid: row ' + r + ' is past the end of the sheet (' + this.maxRows + ' rows); use insertRowsAfter first.');
    while (this.rows < r) { this.v.push(new Array(this.cols).fill('')); this.f.push(new Array(this.cols).fill('')); this.rows++; }
    if (c > this.cols) {
      if (c > this.maxCols) { this.ops.push({ t: 'ac', n: c - this.maxCols }); this.maxCols = c; }
      for (let i = 0; i < this.rows; i++) while (this.v[i].length < c) { this.v[i].push(''); this.f[i].push(''); }
      this.cols = c;
    }
  }
  _set(r, c, value, formula) {
    this._ensure(r, c);
    this.v[r - 1][c - 1] = value;
    this.f[r - 1][c - 1] = formula;
    this.dirty[r + ',' + c] = true;
  }

  // --- the write-out ---------------------------------------------------------------------
  /** Writes the whole operation: one batchUpdate through the Sheets API, else batched Spreadsheet-service calls. */
  /**
   * What to do about the frozen rows, decided before anything is written:
   *  - the frozen area reaches the row above the anchor (for the report: all the header rows are frozen):
   *    it grows with the rows inserted above the anchor, so the new header is frozen too and no merge crosses the boundary -> { rows: n };
   *  - the freeze cuts through the headers and a merge of this operation would cross it (Sheets refuses to merge over
   *    the boundary) -> { error } and nothing is written;
   *  - otherwise nothing to do -> { rows: null }.
   */
  _frozenPlan() {
    const F0 = this.frozenRows;
    if (!F0) return { rows: null };
    let F = F0;                                  // the boundary after the row inserts (rows inserted inside the frozen area are frozen)
    this.ops.forEach(op => { if (op.t === 'ir' && op.at < F) F += op.n; });
    if (F0 >= this.sheetAnchorRow - 1) {
      // The boundary keeps its distance from the end of the headers. After a reset the headers are the template's: they may
      // be shorter than the ones the sheet had (the freeze moves up with them), then every row inserted in the headers
      // moves it down; rows inserted below the headers but still inside the frozen part are frozen too.
      const base = F0 + (this.anchorRow0 - this.sheetAnchorRow);          // where it stands once the template's headers are in
      let pr = this.anchorRow0, B = base;
      this.ops.forEach(op => {
        if (op.t !== 'ir') return;
        if (op.at < pr) { pr += op.n; B += op.n; }
        else if (op.at < B) B += op.n;
      });
      return { rows: B, base: base };
    }
    const crossing = this._finalMerges().some(m => m.r1 <= F && F < m.r2);
    if (!crossing) return { rows: null };
    return { error: 'Zablokowane wiersze przecinają nagłówki (zablokowano ' + F0 + ', a nagłówki kończą się w wierszu ' + (this.sheetAnchorRow - 1) +
                    '), więc nie da się połączyć komórek nagłówka. Nic nie zmieniono. Zmień blokadę (Widok > Zablokuj) tak, by obejmowała '+
                    'wszystkie wiersze nagłówka albo żadnego, i spróbuj ponownie.' };
  }

  commit() {
    this._frozen = this._frozenPlan();
    if (this._frozen.error) throw new Error(this._frozen.error);
    if (this.source.kind === 'new') this._materialize();
    if (this.source.kind === 'api') this._commitApi();
    else this._commitService();
    this._settle();
  }

  /** Grid.create: inserts the sheet (Spreadsheet service), then the grid is an ordinary one. */
  _materialize() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.insertSheet(this.sheetName);
    if (sheetsApiAvailable_()) {
      SpreadsheetApp.flush();                    // the Sheets API has to see the new sheet
      this.source = { kind: 'api', ssId: ss.getId(), sheetId: sheet.getSheetId(), rowCount: sheet.getMaxRows(), columnCount: sheet.getMaxColumns(), tpl: null, rowGroups: [], cond: [] };
    } else {
      this.source = { kind: 'service', sheet: sheet };
    }
    if (sheet.getMaxRows() !== NEW_SHEET_ROWS || sheet.getMaxColumns() !== NEW_SHEET_COLS) {   // the pending operations were counted for a default sheet
      throw new Error('Grid: the new sheet "' + this.sheetName + '" is ' + sheet.getMaxRows() + 'x' + sheet.getMaxColumns() + ', expected ' + NEW_SHEET_ROWS + 'x' + NEW_SHEET_COLS + '.');
    }
  }

  /** After a commit the grid is the sheet as it stands: nothing is pending, the next commit writes only what changes after this one. */
  _settle() {
    const S = this.source;
    if (S.kind === 'api') { S.rowCount = this.maxRows; S.columnCount = this.maxCols; S.tpl = null; S.rowGroups = []; }
    if (this._frozen && this._frozen.rows !== null && this._frozen.rows !== undefined) this.frozenRows = this._frozen.rows;
    this.ops = []; this.dirty = {}; this.notes = {}; this.checks = {}; this.validations = {};
    this.aligns = []; this.fills = []; this.borders = []; this.formats = []; this.rowFormats = []; this.afterOps = [];
    this.rowSizes = {}; this.fitRows = []; this.colFits = []; this.active = null; this.condSets = [];
    this.anchorRow0 = this.anchorRow;
    this.sheetAnchorRow = this.anchorRow;
  }

  /** The spreadsheet's time zone, read once. */
  _tz() { return this.tz || (this.tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()); }

  /** The window's final merges that are real merges (more than one cell). */
  _finalMerges() { return this.merges.filter(m => m.r2 > m.r1 || m.c2 > m.c1); }

  /** Dirty cells as horizontal runs [{ row, col, cells: [{v, f}] }]; non-top-left cells of merges are skipped. */
  _dirtyRuns() {
    const hidden = {};
    this._finalMerges().forEach(m => {
      for (let r = m.r1; r <= m.r2; r++)
        for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) hidden[r + ',' + c] = true;
    });
    const byRow = {};
    Object.keys(this.dirty).forEach(k => {
      if (hidden[k]) return;
      const p = k.split(',').map(Number);
      if (this._inWindow(p[0], p[1])) (byRow[p[0]] = byRow[p[0]] || []).push(p[1]);
    });
    const runs = [];
    Object.keys(byRow).map(Number).sort((a, b) => a - b).forEach(r => {
      const cols = byRow[r].sort((a, b) => a - b);
      let start = 0;
      for (let i = 1; i <= cols.length; i++) {
        if (i < cols.length && cols[i] === cols[i - 1] + 1) continue;
        const run = cols.slice(start, i);
        runs.push({ row: r, col: run[0], cells: run.map(c => ({ v: this.v[r - 1][c - 1], f: this.f[r - 1][c - 1] })) });
        start = i;
      }
    });
    return runs;
  }

  /** Missing merges as [{r1,c1,r2,c2,vertical}]: columns of equal vertical extent become one MERGE_COLUMNS run. */
  _mergePlan(list) {
    const singles = list.filter(m => m.c1 === m.c2).sort((a, b) => a.r1 - b.r1 || a.r2 - b.r2 || a.c1 - b.c1);
    const plan = [];
    singles.forEach(m => {
      const last = plan[plan.length - 1];
      if (last && last.vertical && last.r1 === m.r1 && last.r2 === m.r2 && last.c2 === m.c1 - 1) last.c2 = m.c1;
      else plan.push({ r1: m.r1, r2: m.r2, c1: m.c1, c2: m.c2, vertical: true });
    });
    list.filter(m => m.c1 !== m.c2).forEach(m => plan.push({ r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2, vertical: false }));
    return plan;
  }

  /** ONE batchUpdate. Nothing is read: the window is unmerged and the final merges are made again. */
  _commitApi() {
    const S = this.source;
    const sid = S.sheetId;
    const grid = (r1, c1, r2, c2, sheetId) => ({
      sheetId: sheetId === undefined ? sid : sheetId,
      startRowIndex: r1 - 1, endRowIndex: r2, startColumnIndex: c1 - 1, endColumnIndex: c2
    });
    const black = { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } };
    const req = [];

    if (S.tpl) {                                 // "Zacznij od nowa": clear the sheet, paste the template
      // Row groups first: collapsed ones are opened (so their rows are visible again), then all are removed, deepest first.
      (S.rowGroups || []).slice().sort((a, b) => (b.depth || 1) - (a.depth || 1)).forEach(g => {
        const range = { sheetId: sid, dimension: 'ROWS', startIndex: g.range.startIndex, endIndex: g.range.endIndex };
        if (g.collapsed) req.push({ updateDimensionGroup: { dimensionGroup: { range: range, depth: g.depth || 1, collapsed: false }, fields: 'collapsed' } });
        req.push({ deleteDimensionGroup: { range: range } });
      });
      req.push({ unmergeCells: { range: { sheetId: sid } } });
      req.push({ updateCells: { range: { sheetId: sid }, fields: '*' } });
      if (this._frozen && this._frozen.base !== undefined) {   // after the old merges are gone (a freeze may not cut a merge) and before the template's are pasted
        req.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: this._frozen.base } }, fields: 'gridProperties.frozenRowCount' } });
      }
      if (S.rowCount < S.tpl.rowCount) req.push({ appendDimension: { sheetId: sid, dimension: 'ROWS', length: S.tpl.rowCount - S.rowCount } });
      if (S.columnCount < S.tpl.columnCount) req.push({ appendDimension: { sheetId: sid, dimension: 'COLUMNS', length: S.tpl.columnCount - S.columnCount } });
      req.push({ copyPaste: {
        source: grid(1, 1, S.tpl.rowCount, S.tpl.columnCount, S.tpl.sheetId),
        destination: grid(1, 1, S.tpl.rowCount, S.tpl.columnCount),
        pasteType: 'PASTE_NORMAL'
      } });
      // The column widths are not part of a normal paste (and the API has no paste type for them): set one run of equal widths at a time.
      const widths = S.tpl.columnWidths || [];
      for (let i = 0; i < widths.length; ) {
        let j = i + 1;
        while (j < widths.length && widths[j] === widths[i]) j++;
        if (widths[i]) req.push({ updateDimensionProperties: {
          range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i, endIndex: j },
          properties: { pixelSize: widths[i] }, fields: 'pixelSize'
        } });
        i = j;
      }
    }

    let rowCount = Math.max(S.rowCount || 0, S.tpl ? S.tpl.rowCount : 0);
    this.ops.forEach(op => {
      if (op.t === 'ir' && op.at >= rowCount) { req.push({ appendDimension: { sheetId: sid, dimension: 'ROWS', length: op.n } }); rowCount += op.n; }   // past the last row
      else if (op.t === 'ir') {
        rowCount += op.n;
        req.push({ insertDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: op.at, endIndex: op.at + op.n }, inheritFromBefore: true } });
        if (op.plain) req.push({ repeatCell: { range: { sheetId: sid, startRowIndex: op.at, endRowIndex: op.at + op.n }, cell: {}, fields: 'dataValidation' } });
      }
      else if (op.t === 'ic') req.push({ insertDimension: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: op.at, endIndex: op.at + op.n }, inheritFromBefore: true } });
      else if (op.t === 'ac') req.push({ appendDimension: { sheetId: sid, dimension: 'COLUMNS', length: op.n } });
      else req.push({ deleteDimension: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: op.at - 1, endIndex: op.at - 1 + op.n } } });
    });

    if (this._frozen && this._frozen.rows !== null && this._frozen.rows !== undefined) {      // the freeze follows the headers, before any merge is made
      req.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: this._frozen.rows } }, fields: 'gridProperties.frozenRowCount' } });
    }

    this.afterOps.forEach(f => f.api(sid).forEach(r => req.push(r)));          // e.g. a new price line copied from the template

    req.push({ unmergeCells: { range: grid(1, 1, this.rows, this.cols) } });

    const cellData = c => {
      if (c.f !== '') return { userEnteredValue: { formulaValue: c.f } };
      if (isDate_(c.v)) return { userEnteredValue: { numberValue: dateToSerial_(c.v, this._tz()) } };
      if (typeof c.v === 'number') return { userEnteredValue: { numberValue: c.v } };
      if (typeof c.v === 'boolean') return { userEnteredValue: { boolValue: c.v } };
      if (c.v === '' || c.v === null || c.v === undefined) return {};              // clears the cell
      return { userEnteredValue: { stringValue: String(c.v) } };
    };
    this._dirtyRuns().forEach(run => {
      req.push({ updateCells: {
        rows: [{ values: run.cells.map(cellData) }],
        start: { sheetId: sid, rowIndex: run.row - 1, columnIndex: run.col - 1 },
        fields: 'userEnteredValue'
      } });
    });

    Object.keys(this.notes).forEach(k => {        // cell notes (an empty text removes the note)
      const p = k.split(',').map(Number);
      if (!this._inWindow(p[0], p[1])) return;
      req.push({ updateCells: {
        rows: [{ values: [{ note: this.notes[k] }] }],
        start: { sheetId: sid, rowIndex: p[0] - 1, columnIndex: p[1] - 1 },
        fields: 'note'
      } });
    });

    Object.keys(this.checks).forEach(k => {       // checkboxes: the validation (the value is among the written cells)
      const p = k.split(',').map(Number);
      if (!this._inWindow(p[0], p[1])) return;
      req.push({ updateCells: {
        rows: [{ values: [this.checks[k] ? { dataValidation: { condition: { type: 'BOOLEAN' } } } : {}] }],
        start: { sheetId: sid, rowIndex: p[0] - 1, columnIndex: p[1] - 1 },
        fields: 'dataValidation'
      } });
    });

    const viaService = [];                        // lists with apostrophe-prefixed items: the API reads them differently from the service, see quotedList_
    Object.keys(this.validations).forEach(k => {  // lists and dates (null removes the validation)
      const p = k.split(',').map(Number);
      if (!this._inWindow(p[0], p[1])) return;
      if (quotedList_(this.validations[k])) { viaService.push([p[0], p[1], this.validations[k]]); return; }
      req.push({ updateCells: {
        rows: [{ values: [this.validations[k] ? { dataValidation: validationToApi_(this.validations[k]) } : {}] }],
        start: { sheetId: sid, rowIndex: p[0] - 1, columnIndex: p[1] - 1 },
        fields: 'dataValidation'
      } });
    });

    this._mergePlan(this._finalMerges()).forEach(m => {
      req.push({ mergeCells: { range: grid(m.r1, m.c1, m.r2, m.c2), mergeType: m.vertical ? 'MERGE_COLUMNS' : 'MERGE_ALL' } });
    });

    this.aligns.forEach(m => {
      req.push({ repeatCell: {
        range: grid(m.r1, m.c1, m.r2, m.c2),
        cell: alignOf_(m.a) ? { userEnteredFormat: { horizontalAlignment: alignOf_(m.a) } } : {},      // 'general': an empty cell with the field in the mask clears it
        fields: 'userEnteredFormat.horizontalAlignment'
      } });
    });
    this.formats.forEach(m => {
      const f = formatToApi_(m.props);
      req.push({ repeatCell: { range: grid(m.r1, m.c1, m.r2, m.c2), cell: { userEnteredFormat: f.format }, fields: f.fields } });
    });
    this.fills.forEach(m => {
      const c = m.color ? colorToApi_(m.color) : null;
      req.push({ repeatCell: {
        range: grid(m.r1, m.c1, m.r2, m.c2),
        cell: c ? { userEnteredFormat: { backgroundColor: c } } : {},          // an empty cell with the field in the mask clears the fill
        fields: 'userEnteredFormat.backgroundColor'
      } });
    });
    this.borders.forEach(b => {
      const a = b.args;                           // top, left, bottom, right, vertical, horizontal, color, style
      b.a1.forEach(a1 => {
        const x = parseA1_(a1);
        const r = { updateBorders: { range: grid(x.r1, x.c1, x.r2, x.c2) } };
        ['top', 'left', 'bottom', 'right', 'innerVertical', 'innerHorizontal'].forEach((side, i) => {
          if (a[i]) r.updateBorders[side] = black;
          else if (a[i] === false) r.updateBorders[side] = { style: 'NONE' };      // false removes the border, null leaves it
        });
        req.push(r);
      });
    });

    this.rowFormats.forEach(f => {                // note rows: font, and no borders but the edges shared with the price rows
      const range = { sheetId: sid, startRowIndex: f.row - 1, endRowIndex: f.row };
      if (f.col) { range.startColumnIndex = f.col - 1; range.endColumnIndex = f.col; }
      const gray = parseInt(f.spec.color.slice(1, 3), 16) / 255;
      req.push({ repeatCell: {                    // first every format but the borders is cleared (an empty cell + a field mask)
        range: range,
        cell: {},
        fields: ['backgroundColor', 'backgroundColorStyle', 'textFormat', 'horizontalAlignment', 'verticalAlignment',
                 'wrapStrategy', 'numberFormat', 'textRotation', 'padding', 'hyperlinkDisplayType']
                .map(x => 'userEnteredFormat.' + x).join(',')
      } });
      req.push({ repeatCell: {
        range: range,
        cell: { userEnteredFormat: { verticalAlignment: String(f.spec.vAlign || 'top').toUpperCase(), textFormat: { fontSize: f.spec.size, foregroundColor: { red: gray, green: gray, blue: gray } } } },
        fields: 'userEnteredFormat.verticalAlignment,userEnteredFormat.textFormat.fontSize,userEnteredFormat.textFormat.foregroundColor'
      } });
      if (f.spec.wrap) req.push({ repeatCell: { range: range, cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' } });
      if (f.spec.numberFormat) req.push({ repeatCell: {
        range: range,
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: f.spec.numberFormat } } },
        fields: 'userEnteredFormat.numberFormat'
      } });
      if (f.col) return;                          // one cell: its borders are not ours to change
      const none = { style: 'NONE' };
      const b = { range: range, left: none, right: none, innerVertical: none };
      if (f.spec.clearTop) b.top = none;
      if (f.spec.clearBottom) b.bottom = none;
      req.push({ updateBorders: b });
    });

    Object.keys(this.rowSizes).forEach(r => req.push({ updateDimensionProperties: {
      range: { sheetId: sid, dimension: 'ROWS', startIndex: Number(r) - 1, endIndex: Number(r) },
      properties: { pixelSize: this.rowSizes[r] }, fields: 'pixelSize'
    } }));
    this._fitRuns().forEach(run => req.push({ autoResizeDimensions: { dimensions: { sheetId: sid, dimension: 'ROWS', startIndex: run.first - 1, endIndex: run.first - 1 + run.count } } }));   // after the content is written
    this.colFits.forEach(x => req.push({ autoResizeDimensions: { dimensions: { sheetId: sid, dimension: 'COLUMNS', startIndex: x.first - 1, endIndex: x.first - 1 + x.count } } }));

    if (S.tpl) {                                  // a reset: the rows from the anchor down (the data) fit their content again; the rows above keep the template's heights
      const from = this.anchorRow0 - 1;
      if (rowCount > from) req.push({ autoResizeDimensions: { dimensions: { sheetId: sid, dimension: 'ROWS', startIndex: from, endIndex: rowCount } } });
    }

    this._condRequestsApi(req, sid);

    Sheets.Spreadsheets.batchUpdate({ requests: req }, S.ssId);

    if (viaService.length) {                      // after the batch: the cells (and rows) they sit in exist now
      SpreadsheetApp.flush();
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(this.sheetName);
      viaService.forEach(v => sheet.getRange(v[0], v[1]).setDataValidation(validationToService_(v[2])));
    }

    if (this.active) {                            // the selection is not part of the API
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(this.sheetName);
      sheet.setActiveRange(sheet.getRange(this.active[0], this.active[1]));
    }
  }

  /** The conditional format requests (Sheets API): delete the caller's rules that differ, add the wanted ones at the end. Updates what the grid knows of the sheet's rules. */
  _condRequestsApi(req, sid) {
    const S = this.source;
    this.condSets.forEach(set => {
      const r2 = set.range.r2 || this.maxRows;
      const gridRange = { sheetId: sid, startRowIndex: set.range.r1 - 1, endRowIndex: r2, startColumnIndex: set.range.c1 - 1, endColumnIndex: set.range.c2 };
      const apiRule = x => ({ ranges: [gridRange], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: x.formula }] }, format: { textFormat: { foregroundColor: colorToApi_(x.fontColor) } } } });
      const colors = set.rules.map(x => hexOf_(x.fontColor));
      // ours: a formula we wrote - or, since the sheet may hand a formula back in its locale's function names ("LICZ.PUSTE") and then no text matches, a grey-text-only
      // custom formula inside the columns of the set (it would else be added again at every co-edit)
      const isOurs = rule => {
        const bc = rule.booleanRule;
        if (!bc || bc.condition.type !== 'CUSTOM_FORMULA') return false;
        if (set.owned.indexOf(bc.condition.values[0].userEnteredValue) >= 0) return true;
        const fmt = bc.format || {}, fc = fmt.textFormat && fmt.textFormat.foregroundColor;
        return !!fc && colors.indexOf(hexOf_(fc)) >= 0 && !fmt.backgroundColor && !fmt.backgroundColorStyle && !fmt.textFormat.bold && !fmt.textFormat.italic
          && (rule.ranges || []).length > 0 && rule.ranges.every(g => (g.startColumnIndex || 0) + 1 >= set.range.c1 && g.endColumnIndex <= set.range.c2 && (g.startRowIndex || 0) + 1 >= set.range.r1);
      };
      const sig = (formula, color, ranges) => formula + '|' + hexOf_(color) + '|' + ranges.slice().sort().join(';');
      const rangeKey = g => [g.startRowIndex, g.startColumnIndex, g.endRowIndex, g.endColumnIndex].join(',');
      const existing = (S.cond || []).filter(isOurs).map(rule => sig(rule.booleanRule.condition.values[0].userEnteredValue, rule.booleanRule.format.textFormat.foregroundColor, rule.ranges.map(rangeKey))).sort();
      const wanted = set.rules.map(x => sig(x.formula, x.fontColor, [rangeKey(gridRange)])).sort();
      if (JSON.stringify(existing) === JSON.stringify(wanted)) return;
      const list = (S.cond || []).slice();
      for (let i = list.length - 1; i >= 0; i--) {                    // from the end: the indexes of the rules before stay valid
        if (isOurs(list[i])) { req.push({ deleteConditionalFormatRule: { sheetId: sid, index: i } }); list.splice(i, 1); }
      }
      set.rules.forEach(x => { const rule = apiRule(x); req.push({ addConditionalFormatRule: { rule: rule, index: list.length } }); list.push(rule); });
      S.cond = list;
    });
  }

  /** The conditional formats (Spreadsheet service): the same rule as for the API, in two calls (read the rules, set them) - none when nothing changes. */
  _condServiceCommit(sheet) {
    if (!this.condSets.length) return;
    let rules = sheet.getConditionalFormatRules();
    let changed = false;
    this.condSets.forEach(set => {
      const r2 = set.range.r2 || this.maxRows;
      const rangeKey = rg => [rg.getRow(), rg.getColumn(), rg.getLastRow(), rg.getLastColumn()].join(',');
      const sig = (formula, color, ranges) => formula + '|' + hexOf_(color) + '|' + ranges.slice().sort().join(';');
      const colors = set.rules.map(x => hexOf_(x.fontColor));
      const isOurs = rule => {                                                       // (see _condRequestsApi: by text, else by shape - the locale's function names)
        const bc = rule.getBooleanCondition();
        if (!bc || String(bc.getCriteriaType()) !== String(SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA)) return false;
        if (set.owned.indexOf(bc.getCriteriaValues()[0]) >= 0) return true;
        const fc = bc.getFontColor();
        return !!fc && colors.indexOf(hexOf_(fc)) >= 0 && !bc.getBackground() && !bc.getBold() && !bc.getItalic()
          && rule.getRanges().length > 0 && rule.getRanges().every(rg => rg.getColumn() >= set.range.c1 && rg.getLastColumn() <= set.range.c2 && rg.getRow() >= set.range.r1);
      };
      const existing = rules.filter(isOurs).map(rule => { const bc = rule.getBooleanCondition(); return sig(bc.getCriteriaValues()[0], bc.getFontColor(), rule.getRanges().map(rangeKey)); }).sort();
      const target = sheet.getRange(set.range.r1, set.range.c1, r2 - set.range.r1 + 1, set.range.c2 - set.range.c1 + 1);
      const wanted = set.rules.map(x => sig(x.formula, x.fontColor, [rangeKey(target)])).sort();
      if (JSON.stringify(existing) === JSON.stringify(wanted)) return;
      rules = rules.filter(rule => !isOurs(rule)).concat(set.rules.map(x =>
        SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(x.formula).setFontColor(x.fontColor).setRanges([target]).build()));
      changed = true;
    });
    if (changed) sheet.setConditionalFormatRules(rules);
  }

  /** Spreadsheet-service fallback: structure first, then merges, cell runs, alignment, borders. */
  _commitService() {
    const sheet = this.source.sheet;
    this.ops.forEach(op => {
      if (op.t === 'ir') { sheet.insertRowsAfter(op.at, op.n); if (op.plain) sheet.getRange(op.at + 1, 1, op.n, sheet.getMaxColumns()).clearDataValidations(); }   // the whole rows, also right of the window
      else if (op.t === 'ic') sheet.insertColumnsAfter(op.at, op.n);
      else if (op.t === 'ac') sheet.insertColumnsAfter(sheet.getMaxColumns(), op.n);
      else sheet.deleteColumns(op.at, op.n);
    });
    if (this._frozen && this._frozen.rows !== null && this._frozen.rows !== undefined) sheet.setFrozenRows(this._frozen.rows);
    this.afterOps.forEach(f => f.service(sheet));

    // Merges: leave the ones that are already right, break the stale ones, make the missing ones.
    const key = m => m.r1 + ',' + m.c1 + ',' + m.r2 + ',' + m.c2;
    const want = this.merges.filter(m => m.r2 > m.r1 || m.c2 > m.c1);
    const wantSet = {};
    want.forEach(m => { wantSet[key(m)] = true; });
    const real = sheet.getRange(1, 1, this.rows, this.cols).getMergedRanges().map(r => parseA1_(r.getA1Notation()));
    const realSet = {};
    real.forEach(m => { realSet[key(m)] = true; });
    const stale = real.filter(m => !wantSet[key(m)]);
    const missing = want.filter(m => !realSet[key(m)]);
    if (stale.length) sheet.getRangeList(stale.map(rectA1_)).breakApart();

    // Cell contents: written cells only, as horizontal runs.
    const hidden = {};                           // non-top-left cells of merges stay untouched
    want.forEach(m => {
      for (let r = m.r1; r <= m.r2; r++)
        for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) hidden[r + ',' + c] = true;
    });
    const byRow = {};
    const blanks = [];                           // cells the operation emptied: one clearContent call
    Object.keys(this.dirty).forEach(k => {
      if (hidden[k]) return;
      const p = k.split(',').map(Number);
      if (!this._inWindow(p[0], p[1])) return;
      const v = this.v[p[0] - 1][p[1] - 1], f = this.f[p[0] - 1][p[1] - 1];
      if (f === '' && (v === '' || v === null)) blanks.push(rectA1_({ r1: p[0], c1: p[1], r2: p[0], c2: p[1] }));
      else (byRow[p[0]] = byRow[p[0]] || []).push(p[1]);
    });
    if (blanks.length) sheet.getRangeList(blanks).clearContent();
    Object.keys(byRow).map(Number).sort((a, b) => a - b).forEach(r => {
      const cols = byRow[r].sort((a, b) => a - b);
      const isF = c => this.f[r - 1][c - 1] !== '';
      let start = 0;
      for (let i = 1; i <= cols.length; i++) {      // a run = adjacent cells of the same kind (formula / value)
        if (i < cols.length && cols[i] === cols[i - 1] + 1 && isF(cols[i]) === isF(cols[start])) continue;
        const run = cols.slice(start, i);
        const rng = sheet.getRange(r, run[0], 1, run.length);
        if (isF(run[0])) rng.setFormulas([run.map(c => this.f[r - 1][c - 1])]);
        else rng.setValues([run.map(c => this.v[r - 1][c - 1])]);
        start = i;
      }
    });

    Object.keys(this.notes).forEach(k => {
      const p = k.split(',').map(Number);
      if (this._inWindow(p[0], p[1])) sheet.getRange(p[0], p[1]).setNote(this.notes[k]);
    });

    Object.keys(this.checks).forEach(k => {
      const p = k.split(',').map(Number);
      if (!this._inWindow(p[0], p[1])) return;
      const cell = sheet.getRange(p[0], p[1]);
      if (this.checks[k]) cell.insertCheckboxes(); else cell.removeCheckboxes();
    });

    Object.keys(this.validations).forEach(k => {
      const p = k.split(',').map(Number);
      if (!this._inWindow(p[0], p[1])) return;
      sheet.getRange(p[0], p[1]).setDataValidation(this.validations[k] ? validationToService_(this.validations[k]) : null);
    });

    // Missing merges: columns of equal vertical extent go in one call.
    const singles = missing.filter(m => m.c1 === m.c2).sort((a, b) => a.r1 - b.r1 || a.r2 - b.r2 || a.c1 - b.c1);
    const runs = [];
    singles.forEach(m => {
      const last = runs[runs.length - 1];
      if (last && last.r1 === m.r1 && last.r2 === m.r2 && last.c2 === m.c1 - 1) last.c2 = m.c1;
      else runs.push({ r1: m.r1, r2: m.r2, c1: m.c1, c2: m.c2 });
    });
    runs.forEach(m => sheet.getRange(m.r1, m.c1, m.r2 - m.r1 + 1, m.c2 - m.c1 + 1).mergeVertically());
    missing.filter(m => m.c1 !== m.c2).forEach(m =>
      sheet.getRange(m.r1, m.c1, m.r2 - m.r1 + 1, m.c2 - m.c1 + 1).merge());

    // Alignment, borders: one call each.
    const aligns = {};
    this.aligns.forEach(m => { const k = m.a === null || m.a === undefined ? '' : String(m.a); (aligns[k] = aligns[k] || []).push(rectA1_(m)); });
    Object.keys(aligns).forEach(a => {
      // left / center / right as the service names them; the 'general...' names are passed on as they came (the old code did exactly that and
      // Sheets keeps them as an explicit "general" alignment); '' = null clears the alignment
      const al = alignOf_(a) ? alignOf_(a).toLowerCase() : (a === '' ? null : a);
      const list = sheet.getRangeList(aligns[a]);
      if (typeof list.setHorizontalAlignment === 'function') list.setHorizontalAlignment(al);
      else list.getRanges().forEach(r => r.setHorizontalAlignment(al));
    });
    this.formats.forEach(m => {
      const rng = sheet.getRange(m.r1, m.c1, m.r2 - m.r1 + 1, m.c2 - m.c1 + 1), p = m.props;
      if (p.bold !== undefined) rng.setFontWeight(p.bold ? 'bold' : 'normal');
      if (p.size !== undefined) rng.setFontSize(p.size);
      if (p.color !== undefined) rng.setFontColor(p.color);
      if (p.vAlign !== undefined) rng.setVerticalAlignment(p.vAlign);
      if (p.wrap !== undefined) rng.setWrapStrategy(SpreadsheetApp.WrapStrategy[p.wrap]);
      if (p.numFmt !== undefined) rng.setNumberFormat(p.numFmt);
    });
    this.fills.forEach(m => sheet.getRange(m.r1, m.c1, m.r2 - m.r1 + 1, m.c2 - m.c1 + 1).setBackground(m.color));
    this.borders.forEach(b => {
      const list = sheet.getRangeList(b.a1);
      if (typeof list.setBorder === 'function') list.setBorder.apply(list, b.args);
      else list.getRanges().forEach(r => r.setBorder.apply(r, b.args));
    });
    this.rowFormats.forEach(f => {
      if (f.col) {                                  // one cell: the look only, no borders
        const cell = sheet.getRange(f.row, f.col).clearFormat().setFontSize(f.spec.size).setFontColor(f.spec.color).setVerticalAlignment(f.spec.vAlign || 'top');
        if (f.spec.wrap) cell.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
        if (f.spec.numberFormat) cell.setNumberFormat(f.spec.numberFormat);
        return;
      }
      sheet.getRange(f.row + ':' + f.row).clearFormat().setFontSize(f.spec.size).setFontColor(f.spec.color).setVerticalAlignment(f.spec.vAlign || 'top')
        .setBorder(f.spec.clearTop ? false : null, false, f.spec.clearBottom ? false : null, false, false, false);
      if (f.spec.wrap) sheet.getRange(f.row + ':' + f.row).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
      if (f.spec.numberFormat) sheet.getRange(f.row + ':' + f.row).setNumberFormat(f.spec.numberFormat);
    });

    Object.keys(this.rowSizes).forEach(r => sheet.setRowHeight(Number(r), this.rowSizes[r]));
    this.colFits.forEach(x => sheet.autoResizeColumns(x.first, x.count));
    if (typeof sheet.autoResizeRows === 'function') this._fitRuns().forEach(run => sheet.autoResizeRows(run.first, run.count));

    this._condServiceCommit(sheet);

    if (this.active) sheet.setActiveRange(sheet.getRange(this.active[0], this.active[1]));
  }
}

class GridRange {
  constructor(model, r, c, nr, nc) { this.m = model; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }

  getSheet() { return this.m; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getLastRow() { return this.r + this.nr - 1; }
  getLastColumn() { return this.c + this.nc - 1; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getCell(i, j) { return new GridRange(this.m, this.r + i - 1, this.c + j - 1, 1, 1); }
  getA1Notation() { return rectA1_({ r1: this.r, c1: this.c, r2: this.getLastRow(), c2: this.getLastColumn() }); }

  _map(f) {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      out.push([]);
      for (let j = 0; j < this.nc; j++) out[i].push(f(this.r + i, this.c + j));
    }
    return out;
  }
  _each(f) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) f(this.r + i, this.c + j, i, j); }
  _hits() {
    return this.m.merges.filter(x =>
      x.r1 <= this.getLastRow() && x.r2 >= this.r && x.c1 <= this.getLastColumn() && x.c2 >= this.c);
  }

  getValues() { return this._map((r, c) => this.m._val(r, c)); }
  getDisplayValues() { return this._map((r, c) => String(this.m._val(r, c))); }
  getFormulas() { return this._map((r, c) => this.m._form(r, c)); }
  getValue() { return this.m._val(this.r, this.c); }
  getDisplayValue() { return String(this.m._val(this.r, this.c)); }
  getFormula() { return this.m._form(this.r, this.c); }

  setValue(x) { this._assign(this.r, this.c, x); return this; }
  setValues(a) { this._each((r, c, i, j) => this._assign(r, c, a[i][j])); return this; }
  setFormula(f) { this.m._set(this.r, this.c, '', f); return this; }
  setFormulas(a) { this._each((r, c, i, j) => this.m._set(r, c, '', a[i][j])); return this; }
  clearContent() { this._each((r, c) => this.m._set(r, c, '', '')); return this; }
  /** Notes and validations are no cell contents: the window is made to reach them (else they would be dropped at the commit). */
  _reach() { this.m._ensure(this.getLastRow(), this.getLastColumn()); }
  setNote(text) { this._reach(); this._each((r, c) => { this.m.notes[r + ',' + c] = String(text === null || text === undefined ? '' : text); }); return this; }
  clearNote() { return this.setNote(''); }
  _assign(r, c, x) {                              // a string starting with '=' is a formula, like in setValues
    if (typeof x === 'string' && x.charAt(0) === '=') this.m._set(r, c, '', x);
    else this.m._set(r, c, x === null || x === undefined ? '' : x, '');
  }

  setNotes(a) { this._reach(); this._each((r, c, i, j) => { this.m.notes[r + ',' + c] = a[i][j] === null || a[i][j] === undefined ? '' : String(a[i][j]); }); return this; }

  // --- formats: queued like the fills, written with the commit (a grid does not read formats) ---
  /** One property for the whole range; entries on the same rectangle are merged. */
  _fmt(props) {
    const r1 = this.r, c1 = this.c, r2 = this.getLastRow(), c2 = this.getLastColumn();
    let e = this.m.formats.find(x => x.r1 === r1 && x.c1 === c1 && x.r2 === r2 && x.c2 === c2);
    if (!e) { e = { r1: r1, c1: c1, r2: r2, c2: c2, props: {} }; this.m.formats.push(e); }
    Object.assign(e.props, props);
    return this;
  }
  /** The array form: `a[i][j]` goes to cell (i, j) of the range. */
  _fmtEach(a, f) { this._each((r, c, i, j) => f(this.getCell(i + 1, j + 1), a[i][j])); return this; }

  setFontWeight(w) { return this._fmt({ bold: String(w).toLowerCase() === 'bold' }); }
  setFontSize(n) { return this._fmt({ size: n }); }
  setFontColor(c) { colorToApi_(c); return this._fmt({ color: c }); }       // a bad colour fails now, not at the commit
  setVerticalAlignment(a) { return this._fmt({ vAlign: String(a).toLowerCase() }); }
  setWrapStrategy(s) { return this._fmt({ wrap: wrapOf_(s) }); }
  setNumberFormat(f) { return this._fmt({ numFmt: String(f) }); }
  setFontWeights(a) { return this._fmtEach(a, (cell, x) => cell.setFontWeight(x)); }
  setFontSizes(a) { return this._fmtEach(a, (cell, x) => cell.setFontSize(x)); }
  setFontColors(a) { return this._fmtEach(a, (cell, x) => cell.setFontColor(x)); }
  setVerticalAlignments(a) { return this._fmtEach(a, (cell, x) => cell.setVerticalAlignment(x)); }
  setWrapStrategies(a) { return this._fmtEach(a, (cell, x) => cell.setWrapStrategy(x)); }
  setNumberFormats(a) { return this._fmtEach(a, (cell, x) => cell.setNumberFormat(x)); }
  setBackgrounds(a) { return this._fmtEach(a, (cell, x) => cell.setBackground(x)); }
  setHorizontalAlignments(a) { return this._fmtEach(a, (cell, x) => cell.setHorizontalAlignment(x)); }

  /**
   * A validation for every cell of the range: { list: [...], strict = true, dropdown = true } / { date: true } /
   * null (removes it) / a SpreadsheetApp DataValidation of the kinds VALUE_IN_LIST and DATE_IS_VALID_DATE.
   * Checkboxes are set with Grid.setCheckbox.
   */
  setDataValidation(dv) {
    const spec = validationSpec_(dv);
    this._reach();
    this._each((r, c) => { delete this.m.checks[r + ',' + c]; this.m.validations[r + ',' + c] = spec; });
    return this;
  }
  setDataValidations(a) { return this._fmtEach(a, (cell, x) => cell.setDataValidation(x)); }
  clearDataValidations() { return this.setDataValidation(null); }

  getMergedRanges() {
    return this._hits().map(x => new GridRange(this.m, x.r1, x.c1, x.r2 - x.r1 + 1, x.c2 - x.c1 + 1));
  }
  breakApart() {
    const hits = this._hits();
    this.m.merges = this.m.merges.filter(x => hits.indexOf(x) < 0);
    return this;
  }
  merge() {                                       // keeps the upper-left value
    this.breakApart();
    if (this.nr * this.nc > 1) {
      this.m.merges.push({ r1: this.r, c1: this.c, r2: this.getLastRow(), c2: this.getLastColumn() });
      this._each((r, c) => { if (r !== this.r || c !== this.c) this.m._set(r, c, '', ''); });
    }
    return this;
  }
  mergeVertically() {                             // every column on its own
    for (let j = 0; j < this.nc; j++) this.m.getRange(this.r, this.c + j, this.nr, 1).merge();
    return this;
  }

  /** Background colour "#rrggbb" (null = no fill), written with the commit. A grid does not read colours: there is no getBackground. */
  setBackground(color) {
    if (color) colorToApi_(color);
    this.m.fills = this.m.fills.filter(f => !(f.r1 === this.r && f.c1 === this.c && f.r2 === this.getLastRow() && f.c2 === this.getLastColumn()));
    this.m.fills.push({ color: color, r1: this.r, c1: this.c, r2: this.getLastRow(), c2: this.getLastColumn() });
    return this;
  }

  setHorizontalAlignment(a) {
    alignOf_(a);                                  // a bad name fails now, not at the commit
    this.m.aligns.push({ a: a, r1: this.r, c1: this.c, r2: this.getLastRow(), c2: this.getLastColumn() });
    return this;
  }
  setBorder() {
    this.m.borders.push({ a1: [this.getA1Notation()], args: Array.prototype.slice.call(arguments) });
    return this;
  }
}

// --- helpers of the format / validation / date operations (no spreadsheet access) ----------------------------------

const COLOR_NAMES_ = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', cyan: '#00ffff', magenta: '#ff00ff'
};

/** "#rrggbb" / "#rgb" / "#aarrggbb" (what getFontColors returns; the alpha is dropped) / a basic colour name -> API colour. */
/** A colour in either form (the name / hex the service gives, or the API's { red, green, blue } fractions) as "#rrggbb", for comparing. */
function hexOf_(color) {
  const c = typeof color === 'object' && color !== null ? color : colorToApi_(color);
  return '#' + ['red', 'green', 'blue'].map(k => ('0' + Math.round((c[k] || 0) * 255).toString(16)).slice(-2)).join('');
}

function colorToApi_(color) {
  let h = COLOR_NAMES_[String(color).toLowerCase()] || String(color);
  if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h.slice(1).split('').map(x => x + x).join('');
  if (/^#[0-9a-f]{8}$/i.test(h)) h = '#' + h.slice(3);
  if (!/^#[0-9a-f]{6}$/i.test(h)) throw new Error('Grid: unknown colour "' + color + '".');
  return { red: parseInt(h.slice(1, 3), 16) / 255, green: parseInt(h.slice(3, 5), 16) / 255, blue: parseInt(h.slice(5, 7), 16) / 255 };
}

/**
 * Horizontal alignment as the API names it. 'general', 'general-left' and 'general-right' (what getHorizontalAlignments returns for a
 * cell without an explicit alignment: text shows left, numbers right) are all "not set" = null: that IS the general alignment,
 * and it renders the same, so a header read with getHorizontalAlignments can be written back as it was.
 */
function alignOf_(a) {
  if (a === null || a === undefined || a === '') return null;
  const x = String(a).toLowerCase();
  if (x === 'normal' || /^general(-left|-right)?$/.test(x)) return null;
  if (x !== 'left' && x !== 'center' && x !== 'right') throw new Error('Grid: unknown horizontal alignment "' + a + '".');
  return x.toUpperCase();
}

/** SpreadsheetApp.WrapStrategy (or its name) -> 'WRAP' | 'OVERFLOW' | 'CLIP'. */
function wrapOf_(s) {
  const x = String(s).toUpperCase();
  if (x !== 'WRAP' && x !== 'OVERFLOW' && x !== 'CLIP') throw new Error('Grid: unknown wrap strategy "' + s + '".');
  return x;
}

/** The API's number format type for a pattern ("#,##0" NUMBER, "yyyy-mm-dd hh:mm" DATE_TIME, "0%" PERCENT, "@" TEXT ...). */
function numberFormatType_(pattern) {
  const p = String(pattern).replace(/"[^"]*"|\[[^\]]*\]/g, '');
  const date = /[yd]/i.test(p), time = /[hs]/i.test(p);
  if (p === '@') return 'TEXT';
  if (date && time) return 'DATE_TIME';
  if (date) return 'DATE';
  if (time) return 'TIME';
  if (p.indexOf('%') >= 0) return 'PERCENT';
  return 'NUMBER';
}

/** One format entry's props -> { format: userEnteredFormat, fields: mask } for repeatCell. */
function formatToApi_(p) {
  const format = {}, fields = [];
  const text = {};
  if (p.bold !== undefined) { text.bold = !!p.bold; fields.push('userEnteredFormat.textFormat.bold'); }
  if (p.size !== undefined) { text.fontSize = p.size; fields.push('userEnteredFormat.textFormat.fontSize'); }
  if (p.color !== undefined) { text.foregroundColor = colorToApi_(p.color); fields.push('userEnteredFormat.textFormat.foregroundColor'); }
  if (fields.length) format.textFormat = text;
  if (p.vAlign !== undefined) { format.verticalAlignment = String(p.vAlign).toUpperCase(); fields.push('userEnteredFormat.verticalAlignment'); }
  if (p.wrap !== undefined) { format.wrapStrategy = p.wrap === 'OVERFLOW' ? 'OVERFLOW_CELL' : p.wrap; fields.push('userEnteredFormat.wrapStrategy'); }
  if (p.numFmt !== undefined) { format.numberFormat = { type: numberFormatType_(p.numFmt), pattern: p.numFmt }; fields.push('userEnteredFormat.numberFormat'); }
  return { format: format, fields: fields.join(',') };
}

/** A validation as the Grid stores it: { list, strict, dropdown } | { date: true } | null. Accepts a SpreadsheetApp DataValidation. */
function validationSpec_(dv) {
  if (dv === null || dv === undefined) return null;
  if (typeof dv.getCriteriaType !== 'function') {
    if (Array.isArray(dv.list)) return { list: dv.list.map(String), strict: dv.strict !== false, dropdown: dv.dropdown !== false };
    if (dv.date) return { date: true };
    throw new Error('Grid: unsupported data validation ' + JSON.stringify(dv) + '.');
  }
  const type = String(dv.getCriteriaType()), vals = dv.getCriteriaValues();
  if (type === 'VALUE_IN_LIST') return { list: (vals[0] || []).map(String), strict: !dv.getAllowInvalid(), dropdown: vals[1] !== false };
  if (type === 'DATE_IS_VALID_DATE') return { date: true };
  throw new Error('Grid: unsupported data validation type ' + type + '.');
}

function validationToApi_(spec) {
  if (spec.date) return { condition: { type: 'DATE_IS_VALID' }, strict: true };
  return { condition: { type: 'ONE_OF_LIST', values: spec.list.map(x => ({ userEnteredValue: x })) }, strict: spec.strict, showCustomUi: spec.dropdown };
}

/**
 * A list with an item that begins with an apostrophe ("'<", "'=": the quote prefix that makes the picked value plain text, so a lone "=" is not a formula).
 * Written through the Sheets API such a validation rejected the very value picked from it (real sheet: "podana wartość musi należeć do zakresu", gone when the same
 * list was written by the Spreadsheet service), so these are written by the service also when the grid commits through the API.
 */
function quotedList_(spec) {
  return !!spec && !spec.date && Array.isArray(spec.list) && spec.list.some(x => String(x).charAt(0) === "'");
}

function validationToService_(spec) {
  const b = SpreadsheetApp.newDataValidation();
  if (spec.date) return b.requireDate().build();
  return b.requireValueInList(spec.list, spec.dropdown).setAllowInvalid(!spec.strict).build();
}

function isDate_(x) { return Object.prototype.toString.call(x) === '[object Date]'; }

/** Offset of the time zone from UTC at the given moment, in minutes (Utilities.formatDate "Z" gives "+0900"). */
function tzOffsetMinutes_(date, tz) {
  const m = Utilities.formatDate(date, tz, 'Z').match(/^([+-])(\d\d)(\d\d)$/);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** A moment -> the sheet's serial number (days since 1899-12-30, wall-clock time of the spreadsheet's time zone). */
function dateToSerial_(date, tz) {
  return (date.getTime() + tzOffsetMinutes_(date, tz) * 60000) / 86400000 + 25569;
}

/** The sheet's serial number -> the moment (inverse of dateToSerial_, also around a change of offset). */
function serialToDate_(serial, tz) {
  const wall = Math.round((serial - 25569) * 86400000);
  const d = new Date(wall - tzOffsetMinutes_(new Date(wall), tz) * 60000);
  const again = new Date(wall - tzOffsetMinutes_(d, tz) * 60000);
  return again.getTime() === d.getTime() ? d : again;
}

function sheetsApiAvailable_() {
  return USE_SHEETS_API && typeof Sheets !== 'undefined' && !!Sheets && !!Sheets.Spreadsheets;
}

/**
 * Opens a grid on a sheet, or returns null when the sheet is missing. One read either way.
 *   spec = { sheetName,             the sheet to edit
 *            anchor: fn(sheet?),    the anchor row (see the header comment); given the sheet on the service path
 *            reset: bool,           the grid starts as the template the sheet is reset from; with the Sheets API the
 *            templateName,          reset is part of the commit's batchUpdate, without it `resetFallback()` resets the
 *            templateAnchor: fn(),  sheet right here and the grid is read afterwards
 *            window: n,             (optional) read only the first n rows (default: the rows around the anchor and every used row)
 *            sheetAnchor: fn(),     (reset only) the anchor of the sheet as it stands, before the reset
 *            resetFallback: fn }
 */
Grid.open = function (spec) {
  const fresh = !!spec.reset;
  // An execution sees the spreadsheet as of its start or its last flush, not as other executions left it (real trace: docs/coedit-tracking.md). The service path
  // reads that view, so it flushes first; the Sheets API reads the server and needs nothing.
  if (!sheetsApiAvailable_()) SpreadsheetApp.flush();
  if (!fresh && !SpreadsheetApp.getActiveSpreadsheet().getSheetByName(spec.sheetName)) return null;   // both paths: a missing sheet is null
  if (sheetsApiAvailable_()) return loadGridViaApi_(spec, fresh);

  if (fresh && spec.resetFallback) spec.resetFallback();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(spec.sheetName);
  return sheet ? loadGridViaService_(spec, sheet) : null;
};

/** Whether the spreadsheet has a sheet of this name (no read of its content). */
Grid.exists = function (sheetName) {
  return !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
};

/**
 * A grid for a sheet that does not exist yet: `spec = { sheetName, rows = 20, cols = 1 }` (the window; it grows with the writes).
 * commit() inserts the sheet (a default sheet of NEW_SHEET_ROWS x NEW_SHEET_COLS) and writes everything.
 */
Grid.create = function (spec) {
  const rows = spec.rows || 20, cols = spec.cols || 1;
  const blank = () => Array.from({ length: rows }, () => new Array(cols).fill(''));
  return new Grid({
    source: { kind: 'new' }, sheetName: spec.sheetName, maxRows: NEW_SHEET_ROWS, maxCols: NEW_SHEET_COLS,
    anchorRow: 1, rows: rows, cols: cols, v: blank(), f: blank(), merges: []
  });
};

function anchorOf_(spec, sheet) { return spec.anchor ? spec.anchor(sheet) : 1; }       // the anchor is optional

function loadGridViaService_(spec, sheet) {
  const anchorRow = anchorOf_(spec, sheet);
  const maxRows = sheet.getMaxRows();
  const rows = Math.min(spec.window || modelRows_(anchorRow, sheet.getLastRow()), maxRows);
  const cols = Math.max(1, sheet.getLastColumn());
  const rng = sheet.getRange(1, 1, rows, cols);
  return new Grid({
    source: { kind: 'service', sheet: sheet }, sheetName: spec.sheetName,
    maxRows: maxRows, maxCols: sheet.getMaxColumns(), anchorRow: anchorRow, rows: rows, cols: cols,
    v: rng.getValues(),
    f: rng.getFormulas(),
    merges: rng.getMergedRanges().map(m => parseA1_(m.getA1Notation())),
    frozenRows: typeof sheet.getFrozenRows === 'function' ? sheet.getFrozenRows() : 0
  });
}

/**
 * One spreadsheets.get: the window of the sheet (or of the template), all merges, sheet ids, row groups, column widths.
 * With `ranges` the API returns only the sheets those ranges point at, so the edited sheet gets a tiny range when the
 * template is the window.
 */
function loadGridViaApi_(spec, fresh) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssId = ss.getId();
  const from = fresh ? spec.templateName : spec.sheetName;
  const sheetAnchor = fresh ? spec.sheetAnchor() : 0;                   // before the reset: the anchor the sheet has now
  const anchorRow = fresh ? spec.templateAnchor() : anchorOf_(spec);      // the template's when the grid starts as the template
  const q = name => "'" + name.replace(/'/g, "''") + "'";
  // The window has to reach every row of the sheet that can hold data. The size comes from the API itself: the
  // Spreadsheet service can still report the sizes from before an earlier batch update of the same run
  // (several assortments are loaded one after another) and a window that is too short cuts the lines off.
  let rowsHint = 0;
  if (!fresh && !spec.window) {
    try {
      const dims = Sheets.Spreadsheets.get(ssId, { ranges: [q(spec.sheetName) + '!A1'], fields: 'sheets(properties(title,gridProperties(rowCount)))' });
      rowsHint = dims.sheets[0].properties.gridProperties.rowCount;
    } catch (err) {
      const now = ss.getSheetByName(spec.sheetName);
      rowsHint = now ? now.getMaxRows() : 0;
    }
  }
  const windowRows = spec.window || modelRows_(anchorRow, rowsHint);
  const ranges = [q(from) + '!1:' + windowRows];
  if (fresh) ranges.push(q(spec.sheetName) + '!A1');
  const fields = 'properties(timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount,frozenRowCount)),merges,rowGroups,' +
                 'data(rowData(values(userEnteredValue,effectiveValue,effectiveFormat(numberFormat(type)))),columnMetadata(pixelSize)),conditionalFormats)';
  const res = Sheets.Spreadsheets.get(ssId, { includeGridData: true, ranges: ranges, fields: fields });

  const byTitle = {};
  (res.sheets || []).forEach(sh => { byTitle[sh.properties.title] = sh; });
  const edited = byTitle[spec.sheetName];
  const src = byTitle[from];
  if (!edited) throw new Error('Brak arkusza "' + spec.sheetName + '" (API zwróciło: ' + Object.keys(byTitle).join(', ') + ').');
  if (!src) throw new Error('Brak arkusza "' + from + '" (API zwróciło: ' + Object.keys(byTitle).join(', ') + ').');

  const rowData = (src.data && src.data[0] && src.data[0].rowData) || [];
  const rows = Math.min(windowRows, src.properties.gridProperties.rowCount);
  const tz = (res.properties && res.properties.timeZone) || null;
  const isDateFormat = c => { const t = c.effectiveFormat && c.effectiveFormat.numberFormat && c.effectiveFormat.numberFormat.type; return t === 'DATE' || t === 'TIME' || t === 'DATE_TIME'; };
  const numberOf = (c, n) => (tz && isDateFormat(c) ? serialToDate_(n, tz) : n);       // dates come back as Date objects, like from the Spreadsheet service
  const cellOf = c => {
    const u = c && c.userEnteredValue;
    if (!u) return { v: '', f: '' };
    if (u.formulaValue !== undefined) {
      const e = c.effectiveValue || {};
      const v = e.numberValue !== undefined ? numberOf(c, e.numberValue) : e.stringValue !== undefined ? e.stringValue : e.boolValue !== undefined ? e.boolValue : '';
      return { v: v, f: u.formulaValue };
    }
    if (u.numberValue !== undefined) return { v: numberOf(c, u.numberValue), f: '' };
    if (u.stringValue !== undefined) return { v: u.stringValue, f: '' };
    if (u.boolValue !== undefined) return { v: u.boolValue, f: '' };
    return { v: '', f: '' };
  };

  const merges = (src.merges || []).map(m => ({
    r1: m.startRowIndex + 1, c1: m.startColumnIndex + 1, r2: m.endRowIndex, c2: m.endColumnIndex
  }));
  let cols = 1;
  for (let r = 0; r < rows; r++) {
    const vals = (rowData[r] && rowData[r].values) || [];
    vals.forEach((c, i) => { const x = cellOf(c); if (x.v !== '' || x.f !== '') cols = Math.max(cols, i + 1); });
  }
  merges.forEach(m => { if (m.r1 <= rows) cols = Math.max(cols, m.c2); });

  const v = [], f = [];
  for (let r = 0; r < rows; r++) {
    const vals = (rowData[r] && rowData[r].values) || [];
    v.push([]); f.push([]);
    for (let c = 0; c < cols; c++) {
      const x = cellOf(vals[c]);
      v[r].push(x.v); f[r].push(x.f);
    }
  }

  const gp = edited.properties.gridProperties;
  return new Grid({
    source: {
      kind: 'api', ssId: ssId, sheetId: edited.properties.sheetId,
      rowCount: gp.rowCount, columnCount: gp.columnCount,
      tpl: fresh ? { sheetId: src.properties.sheetId, rowCount: src.properties.gridProperties.rowCount, columnCount: src.properties.gridProperties.columnCount,
                     columnWidths: ((src.data && src.data[0] && src.data[0].columnMetadata) || []).map(c => (c && c.pixelSize) || 0) } : null,
      rowGroups: fresh ? (edited.rowGroups || []) : [],          // the groups of the sheet that is being reset: they are removed with it
      cond: edited.conditionalFormats || []                      // the conditional formats of the sheet (setFormulaFontColors replaces the caller's own)
    },
    sheetName: spec.sheetName,
    maxRows: Math.max(gp.rowCount, fresh ? src.properties.gridProperties.rowCount : 0), maxCols: gp.columnCount, tz: tz,
    anchorRow: anchorRow, rows: rows, cols: cols, v: v, f: f, merges: merges,
    frozenRows: gp.frozenRowCount || 0,
    sheetAnchorRow: fresh ? sheetAnchor : anchorRow              // a reset: the anchor the sheet has now, not the template's
  });
}
