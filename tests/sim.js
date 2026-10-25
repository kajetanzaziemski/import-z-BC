// A small in-memory Google spreadsheet for testing Grid.js offline.
//
// It implements the slice of the Sheets API (spreadsheets.get / batchUpdate) and of the Spreadsheet service that Grid.js uses,
// both on ONE store, so a test can run the same scenario through either commit path and compare the sheets (`snapshot()`).
// A request or a method the simulation does not know throws: Grid.js must not start using a call nobody has checked.
//
// Not simulated: formula evaluation (a formula cell keeps the value the test gave it), row groups, borders (only recorded),
// freeze/merge interplay, limits and quotas. Everything verified here is verified against THIS simulation, not a real spreadsheet.
'use strict';

const colNum = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const key = (r, c) => r + ',' + c;
const unkey = k => k.split(',').map(Number);

const COLORS = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000' };
const hex2 = n => ('0' + Math.round(n * 255).toString(16)).slice(-2);
const apiColor = c => '#' + hex2(c.red || 0) + hex2(c.green || 0) + hex2(c.blue || 0);
const serviceColor = c => {
  c = COLORS[c] || c;
  if (/^#[0-9a-f]{8}$/i.test(c)) c = '#' + c.slice(3);
  return c.toLowerCase();
};
/** 'general', 'general-left', 'general-right' are "no explicit alignment" (the general alignment renders text left, numbers right). */
const alignCanon = a => (a === null || a === undefined || /^(general(-left|-right)?|normal)$/.test(String(a)) ? null : String(a).toLowerCase());
const isDateFormat = p => /[yd]/i.test(String(p).replace(/"[^"]*"/g, '')) || /[hs]/i.test(String(p).replace(/"[^"]*"/g, ''));

/** Offset of a time zone at a moment, minutes (Intl based, so a zone with a daylight saving time is simulated for real). */
function offsetMinutes(date, tz) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(date).find(p => p.type === 'timeZoneName').value;
  const m = part.match(/GMT([+-])(\d\d):(\d\d)/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

class SimSheet {
  constructor(book, id, title, rows, cols) {
    this.book = book; this.id = id; this.title = title; this.rowCount = rows; this.colCount = cols;
    this.cells = {};              // 'r,c' -> { v, f, note, dv, fmt }   v: string | number | boolean (a date is its serial number, the format says so)
    this.merges = [];             // { r1, c1, r2, c2 }
    this.frozen = 0;
    this.rowPx = {};
    this.fitted = { rows: [], columns: [] };    // what autoResize was asked for
    this.borders = [];
    this.active = null;
    this.condRules = [];          // conditional formats: { formula, color, ranges: [{ r1, c1, r2, c2 }] } (custom formula rules, font colour)
  }
  cell(r, c, create) {
    const k = key(r, c);
    if (!this.cells[k] && create) this.cells[k] = { v: '', f: '', note: '', dv: null, fmt: {} };
    return this.cells[k];
  }
  prune(r, c) {
    const x = this.cells[key(r, c)];
    if (x && x.v === '' && !x.f && !x.note && !x.dv && !Object.keys(x.fmt).length) delete this.cells[key(r, c)];
  }
  lastRow() { let l = 0; Object.keys(this.cells).forEach(k => { const x = this.cells[k]; if (x.v !== '' || x.f) l = Math.max(l, unkey(k)[0]); }); return l; }
  lastCol() { let l = 0; Object.keys(this.cells).forEach(k => { const x = this.cells[k]; if (x.v !== '' || x.f) l = Math.max(l, unkey(k)[1]); }); this.merges.forEach(m => { l = Math.max(l, m.c2); }); return l; }

  setValue(r, c, v, f) {
    if (r > this.rowCount || c > this.colCount) throw new Error('SimSheet: cell (' + r + ',' + c + ') is outside the ' + this.rowCount + 'x' + this.colCount + ' sheet');
    const x = this.cell(r, c, true);
    x.v = v === undefined || v === null ? '' : v; x.f = f || '';
    this.prune(r, c);
  }

  /** New rows after row `after` (1-based), formats and validation inherited from that row, like inheritFromBefore. */
  insertRows(after, n) {
    const moved = {};
    Object.keys(this.cells).forEach(k => { const [r, c] = unkey(k); moved[key(r > after ? r + n : r, c)] = this.cells[k]; });
    this.cells = moved; this.rowCount += n;
    Object.keys(moved).forEach(k => {
      const [r, c] = unkey(k);
      if (r !== after) return;
      for (let i = 1; i <= n; i++) {
        const x = moved[k], y = this.cell(after + i, c, true);
        y.fmt = Object.assign({}, x.fmt); y.dv = x.dv;
      }
    });
    this.merges.forEach(m => { if (m.r1 > after) { m.r1 += n; m.r2 += n; } else if (m.r2 > after) m.r2 += n; });
    Object.keys(this.rowPx).slice().forEach(r => { if (Number(r) > after) { this.rowPx[Number(r) + n] = this.rowPx[r]; delete this.rowPx[r]; } });
    if (this.frozen > after) this.frozen += n;
  }
  insertCols(after, n) {
    const moved = {};
    Object.keys(this.cells).forEach(k => { const [r, c] = unkey(k); moved[key(r, c > after ? c + n : c)] = this.cells[k]; });
    this.cells = moved; this.colCount += n;
    this.merges.forEach(m => { if (m.c1 > after) { m.c1 += n; m.c2 += n; } else if (m.c2 > after) m.c2 += n; });
  }
  deleteCols(from, n) {
    const out = {};
    Object.keys(this.cells).forEach(k => { const [r, c] = unkey(k); if (c >= from && c < from + n) return; out[key(r, c >= from + n ? c - n : c)] = this.cells[k]; });
    this.cells = out; this.colCount -= n;
    this.merges = this.merges.map(m => {
      if (m.c1 >= from + n) { m.c1 -= n; m.c2 -= n; return m; }
      if (m.c2 < from) return m;
      m.c2 -= Math.min(m.c2, from + n - 1) - Math.max(m.c1, from) + 1;
      if (m.c1 >= from) m.c1 = from;
      return m.c2 >= m.c1 ? m : null;
    }).filter(Boolean);
  }
  unmerge(r1, c1, r2, c2) { this.merges = this.merges.filter(m => !(m.r1 <= r2 && m.r2 >= r1 && m.c1 <= c2 && m.c2 >= c1)); }
  merge(r1, c1, r2, c2) {
    if (this.frozen && r1 <= this.frozen && this.frozen < r2) throw new Error('You must unfreeze rows before merging cells across the frozen boundary.');
    if (r1 === r2 && c1 === c2) return;
    this.merges.forEach(m => { if (m.r1 <= r2 && m.r2 >= r1 && m.c1 <= c2 && m.c2 >= c1) throw new Error('SimSheet: merge overlaps an existing merge'); });
    this.merges.push({ r1, c1, r2, c2 });
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) { const x = this.cell(r, c); if (x) { x.v = ''; x.f = ''; this.prune(r, c); } }
  }

  /** Canonical, comparable content of the sheet (what a parity test compares between the two commit paths). */
  snapshot() {
    const out = this.snapshot_();
    if (this.condRules.length) out.condRules = this.snapshotCond_();
    return out;
  }
  snapshot_() {
    const cells = {};
    Object.keys(this.cells).sort((a, b) => { const p = unkey(a), q = unkey(b); return p[0] - q[0] || p[1] - q[1]; }).forEach(k => {
      const x = this.cells[k];
      cells[k] = { v: x.v, f: x.f, note: x.note, dv: x.dv, fmt: Object.assign({}, x.fmt) };
    });
    return {
      size: [this.rowCount, this.colCount], frozen: this.frozen,
      merges: this.merges.map(m => [m.r1, m.c1, m.r2, m.c2].join()).sort(), cells,
      rowPx: Object.assign({}, this.rowPx),
      fitted: { rows: this.fitted.rows.slice(), columns: this.fitted.columns.slice() }
    };
  }
  snapshotCond_() {
    return this.condRules.map(x => ({ formula: x.formula, color: x.color, ranges: x.ranges.map(g => [g.r1, g.c1, g.r2, g.c2].join()) }));
  }
}

class SimBook {
  /** opts.tz: the spreadsheet's time zone; opts.api: the Sheets advanced service is enabled. */
  constructor(opts) {
    this.condWrites = 0;                         // conditional format writes (setConditionalFormatRules calls / add + delete requests)
    opts = opts || {};
    this.tz = opts.tz || 'Asia/Tokyo';
    this.locale = opts.locale || 'en_US';
    this.api = opts.api !== false;
    this.sheets = {}; this.nextId = 1;
    this.requests = [];             // every batchUpdate (arrays of requests)
    this.gets = [];                 // every spreadsheets.get (its options)
    this.alignLog = [];             // every value the Spreadsheet service was given for a horizontal alignment
    this.serviceCalls = 0;          // calls made through the Spreadsheet service on ranges / sheets (a rough cost)
    this.build();
  }
  add(title, rows, cols) {
    const s = new SimSheet(this, this.nextId++, title, rows === undefined ? 1000 : rows, cols === undefined ? 26 : cols);
    this.sheets[title] = s; return s;
  }
  byId(id) { return Object.values(this.sheets).find(s => s.id === id); }

  // ---- serial numbers <-> moments --------------------------------------------------------------------------------
  toSerial(date) { return (date.getTime() + offsetMinutes(date, this.tz) * 60000) / 86400000 + 25569; }
  toDate(serial) {
    const wall = Math.round((serial - 25569) * 86400000);
    const d = new Date(wall - offsetMinutes(new Date(wall), this.tz) * 60000);
    const again = new Date(wall - offsetMinutes(d, this.tz) * 60000);
    return again.getTime() === d.getTime() ? d : again;
  }

  /** Installs the globals Grid.js expects: SpreadsheetApp, Utilities and (if the advanced service is enabled) Sheets. */
  install(target) {
    target.SpreadsheetApp = this.SpreadsheetApp;
    target.Utilities = this.Utilities;
    if (this.api) target.Sheets = this.Sheets; else delete target.Sheets;
  }

  build() {
    const book = this;
    this.Utilities = { formatDate: (date, tz, pattern) => {
      if (pattern !== 'Z') throw new Error('SimBook: formatDate supports only "Z"');
      const m = offsetMinutes(date, tz);
      return (m < 0 ? '-' : '+') + ('0' + Math.floor(Math.abs(m) / 60)).slice(-2) + ('0' + Math.abs(m) % 60).slice(-2);
    } };
    this.Sheets = { Spreadsheets: {
      get: (id, o) => book.apiGet(o),
      batchUpdate: (b, id) => { book.requests.push(b.requests); book.apply(b.requests); }
    } };
    this.SpreadsheetApp = {
      WrapStrategy: { WRAP: 'WRAP', OVERFLOW: 'OVERFLOW', CLIP: 'CLIP' },
      DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST', DATE_IS_VALID_DATE: 'DATE_IS_VALID_DATE' },
      BooleanCriteria: { CUSTOM_FORMULA: 'CUSTOM_FORMULA' },
      newConditionalFormatRule: () => book.ruleBuilder(),
      getActiveSpreadsheet: () => book.spreadsheet(),
      newDataValidation: () => book.dvBuilder(),
      flush() {}
    };
  }

  // ---- the Spreadsheet service ---------------------------------------------------------------------------------
  spreadsheet() {
    const book = this;
    return {
      getId: () => 'ss', getSpreadsheetTimeZone: () => book.tz, getSpreadsheetLocale: () => book.locale,
      getSheets: () => Object.values(book.sheets).map(x => book.sheetObj(x)),
      getActiveSheet: () => book.sheetObj(book.sheets[book.activeName] || Object.values(book.sheets)[0]),
      getSheetByName: n => (book.sheets[n] ? book.sheetObj(book.sheets[n]) : null),
      insertSheet: n => {
        if (book.sheets[n]) throw new Error('A sheet with the name "' + n + '" already exists. Please enter another name.');
        return book.sheetObj(book.add(n));
      }
    };
  }
  /** SpreadsheetApp.newConditionalFormatRule(): custom formula + font colour + ranges, the only kind the Grid makes. */
  ruleBuilder() {
    const spec = { formula: null, color: null, ranges: [] };
    const b = {
      whenFormulaSatisfied: f => { spec.formula = f; return b; },
      setFontColor: c => { spec.color = c; return b; },
      setRanges: rs => { spec.ranges = rs.map(x => ({ r1: x.getRow(), c1: x.getColumn(), r2: x.getLastRow(), c2: x.getLastColumn() })); return b; },
      build: () => this.ruleObj(spec)
    };
    return b;
  }
  ruleObj(spec) {
    return { __spec: spec,
      getBooleanCondition: () => ({ getCriteriaType: () => 'CUSTOM_FORMULA', getCriteriaValues: () => [spec.formula], getFontColor: () => spec.color }),
      getRanges: () => spec.ranges.map(g => ({ getRow: () => g.r1, getColumn: () => g.c1, getLastRow: () => g.r2, getLastColumn: () => g.c2, getNumRows: () => g.r2 - g.r1 + 1, getNumColumns: () => g.c2 - g.c1 + 1 })) };
  }
  dvBuilder() {
    const spec = { allowInvalid: true };      // the platform default for a new rule: a warning, not a rejection
    const b = {
      requireValueInList: (list, dropdown) => { spec.type = 'VALUE_IN_LIST'; spec.list = list.slice(); spec.dropdown = dropdown !== false; return b; },
      withCriteria: (type, args) => {            // the form MyDataValidation uses: (criteria, [list, showDropdown]) / (criteria, [])
        if (type === 'VALUE_IN_LIST') { spec.type = type; spec.list = args[0].slice(); spec.dropdown = args[1] !== false; } else if (type === 'DATE_IS_VALID_DATE') spec.type = type; else throw new Error('SimBook: criteria ' + type);
        return b;
      },
      requireDate: () => { spec.type = 'DATE_IS_VALID_DATE'; return b; },
      setAllowInvalid: x => { spec.allowInvalid = !!x; return b; },
      build: () => ({
        getCriteriaType: () => spec.type,
        getCriteriaValues: () => (spec.type === 'VALUE_IN_LIST' ? [spec.list, spec.dropdown] : []),
        getAllowInvalid: () => !!spec.allowInvalid,
        __spec: spec
      })
    };
    return b;
  }
  /** The canonical form of a validation (the same for both paths). */
  dvCanon(spec) {
    if (spec.type === 'DATE_IS_VALID_DATE') return 'date';
    return 'list:' + spec.list.join('|') + ':' + (spec.allowInvalid ? 'loose' : 'strict') + ':' + (spec.dropdown ? 'dropdown' : 'plain');
  }

  sheetObj(s) {
    const book = this;
    const call = () => { book.serviceCalls++; };
    return {
      getName: () => s.title, getSheetId: () => s.id, getMaxRows: () => s.rowCount, getMaxColumns: () => s.colCount,
      getLastRow: () => s.lastRow(), getLastColumn: () => s.lastCol(), getFrozenRows: () => s.frozen,
      getDataRange: () => book.rangeObj(s, 1, 1, s.lastRow() || 1, s.lastCol() || 1),
      setFrozenRows: n => { call(); s.frozen = n; },
      getRange: (r, c, nr, nc) => {
        if (typeof r === 'string') {                                   // "B1:F1"
          const m = r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
          if (!m) throw new Error('SimBook: unsupported A1 notation ' + r);
          const c1 = colNum(m[1]), r1 = Number(m[2]);
          return book.rangeObj(s, r1, c1, (m[4] ? Number(m[4]) : r1) - r1 + 1, (m[3] ? colNum(m[3]) : c1) - c1 + 1);
        }
        return book.rangeObj(s, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
      },
      insertRowsAfter: (after, n) => { call(); s.insertRows(after, n); },
      getParent: () => book.spreadsheet(),
      getConditionalFormatRules: () => { call(); return s.condRules.map(x => book.ruleObj(JSON.parse(JSON.stringify(x)))); },
      setConditionalFormatRules: rules => { call(); book.condWrites++; s.condRules = rules.map(r => JSON.parse(JSON.stringify(r.__spec))); },
      insertRowAfter: after => { call(); s.insertRows(after, 1); },
      insertColumnsAfter: (after, n) => { call(); s.insertCols(after, n); },
      deleteColumns: (from, n) => { call(); s.deleteCols(from, n); },
      setRowHeight: (r, px) => { call(); s.rowPx[r] = px; },
      autoResizeRows: (first, n) => { call(); s.fitted.rows.push([first, n]); },
      autoResizeColumns: (first, n) => { call(); s.fitted.columns.push([first, n]); },
      setActiveRange: rng => { call(); s.active = [rng.getRow(), rng.getColumn()]; },
      getRangeList: list => {
        const each = f => list.forEach(a1 => { const m = a1.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/); const c1 = colNum(m[1]), r1 = Number(m[2]); f(book.rangeObj(s, r1, c1, (m[4] ? Number(m[4]) : r1) - r1 + 1, (m[3] ? colNum(m[3]) : c1) - c1 + 1)); });
        return {
          breakApart: () => { call(); each(r => r.breakApart()); },
          clearContent: () => { call(); each(r => r.clearContent()); },
          setHorizontalAlignment: a => { call(); each(r => r.setHorizontalAlignment(a)); },
          setBorder: (...args) => { call(); each(r => r.setBorder(...args)); }
        };
      }
    };
  }

  rangeObj(s, r, c, nr, nc) {
    const book = this;
    const call = () => { book.serviceCalls++; };
    const each = f => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) f(r + i, c + j, i, j); };
    const grid = f => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => f(r + i, c + j)));
    const fmtSet = (k, v) => { call(); each((rr, cc) => { const x = s.cell(rr, cc, true); if (v === undefined || v === null) delete x.fmt[k]; else x.fmt[k] = v; s.prune(rr, cc); }); return self; };
    const valueOf = x => {
      if (!x) return '';
      return typeof x.v === 'number' && x.fmt.numFmt && isDateFormat(x.fmt.numFmt) ? book.toDate(x.v) : x.v;
    };
    const put = (rr, cc, v) => {                       // setValues: a Date becomes a serial number (+ a date format if the cell has none)
      if (Object.prototype.toString.call(v) === '[object Date]') {          // the platform gives a cell without a number format a date-time one
        s.setValue(rr, cc, book.toSerial(v), '');
        const x = s.cell(rr, cc, true); if (!x.fmt.numFmt) x.fmt.numFmt = 'yyyy-mm-dd hh:mm:ss';
      }
      else s.setValue(rr, cc, v, '');
    };
    const rangeAt = (rr, cc) => book.rangeObj(s, rr, cc, 1, 1);
    const self = {
      getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc, getLastRow: () => r + nr - 1, getLastColumn: () => c + nc - 1,
      getA1Notation: () => colName(c) + r + (nr > 1 || nc > 1 ? ':' + colName(c + nc - 1) + (r + nr - 1) : ''),
      getValues: () => { call(); return grid((rr, cc) => valueOf(s.cell(rr, cc))); },
      getNumberFormats: () => { call(); return grid((rr, cc) => (s.cell(rr, cc) || { fmt: {} }).fmt.numFmt || 'General'); },
      getNotes: () => { call(); return grid((rr, cc) => (s.cell(rr, cc) || { note: '' }).note || ''); },
      getDataValidations: () => { call(); return grid((rr, cc) => {            // validation objects rebuilt from the canonical form
        const x = s.cell(rr, cc); if (!x || !x.dv || x.dv === 'checkbox') return null;
        if (x.dv === 'date') return { getCriteriaType: () => 'DATE_IS_VALID_DATE', getCriteriaValues: () => [], getAllowInvalid: () => false };
        const m = x.dv.match(/^list:(.*):(loose|strict):(dropdown|plain)$/);
        return { getCriteriaType: () => 'VALUE_IN_LIST', getCriteriaValues: () => [m[1] === '' ? [] : m[1].split('|'), m[3] === 'dropdown'], getAllowInvalid: () => m[2] === 'loose' };
      }); },
      getValue: () => { call(); return valueOf(s.cell(r, c)); },
      getBackground: () => { call(); const x = s.cell(r, c); return (x && x.fmt.bg) || '#ffffff'; },
      getBackgrounds: () => { call(); return grid((rr, cc) => { const x = s.cell(rr, cc); return (x && x.fmt.bg) || '#ffffff'; }); },
      getFontColor: () => { call(); const x = s.cell(r, c); return (x && x.fmt.color) || '#000000'; },
      getFontColors: () => { call(); return grid((rr, cc) => { const x = s.cell(rr, cc); return (x && x.fmt.color) || '#000000'; }); },
      getFormulas: () => { call(); return grid((rr, cc) => { const x = s.cell(rr, cc); return x ? x.f : ''; }); },
      getMergedRanges: () => { call(); return s.merges.filter(m => m.r1 <= r + nr - 1 && m.r2 >= r && m.c1 <= c + nc - 1 && m.c2 >= c)
        .map(m => ({ getA1Notation: () => colName(m.c1) + m.r1 + ':' + colName(m.c2) + m.r2 })); },
      setValues: a => { call(); each((rr, cc, i, j) => put(rr, cc, a[i][j])); return self; },
      setFormulas: a => { call(); each((rr, cc, i, j) => s.setValue(rr, cc, 'formula-result', a[i][j])); return self; },
      clear: () => { call(); each((rr, cc) => { delete s.cells[key(rr, cc)]; }); return self; },     // content, notes, validation and formats
      clearContent: () => { call(); each((rr, cc) => { const x = s.cell(rr, cc); if (x) { x.v = ''; x.f = ''; s.prune(rr, cc); } }); return self; },
      setNote: t => { call(); each((rr, cc) => { const x = s.cell(rr, cc, true); x.note = t === null ? '' : String(t); s.prune(rr, cc); }); return self; },
      insertCheckboxes: () => { call(); each((rr, cc) => { const x = s.cell(rr, cc, true); x.dv = 'checkbox'; if (x.v === '') x.v = false; }); return self; },
      removeCheckboxes: () => { call(); each((rr, cc) => { const x = s.cell(rr, cc); if (x && x.dv === 'checkbox') { x.dv = null; if (x.v === false) x.v = ''; s.prune(rr, cc); } }); return self; },
      setDataValidations: a => { call(); each((rr, cc, i, j) => { const dv = a[i][j]; const x = s.cell(rr, cc, true); x.dv = dv ? book.dvCanon(dv.__spec) : null; s.prune(rr, cc); }); return self; },
      setDataValidation: dv => { call(); each((rr, cc) => { const x = s.cell(rr, cc, true); x.dv = dv ? book.dvCanon(dv.__spec) : null; s.prune(rr, cc); }); return self; },
      clearDataValidations: () => { call(); each((rr, cc) => { const x = s.cell(rr, cc); if (x) { x.dv = null; s.prune(rr, cc); } }); return self; },
      breakApart: () => { call(); s.unmerge(r, c, r + nr - 1, c + nc - 1); return self; },
      merge: () => { call(); s.merge(r, c, r + nr - 1, c + nc - 1); return self; },
      mergeVertically: () => { call(); for (let j = 0; j < nc; j++) s.merge(r, c + j, r + nr - 1, c + j); return self; },
      setBackground: col => fmtSet('bg', col ? serviceColor(col) : null),
      setFontWeight: w => fmtSet('bold', w === 'bold'),
      setFontSize: n => fmtSet('size', n),
      setFontColor: col => fmtSet('color', serviceColor(col)),
      setVerticalAlignment: a => fmtSet('vAlign', a),
      setHorizontalAlignment: a => { book.alignLog.push(a); return fmtSet('hAlign', alignCanon(a)); },
      setWrapStrategy: w => fmtSet('wrap', w),
      setNumberFormat: p => fmtSet('numFmt', p),
      setValue: v => { call(); put(r, c, v); return self; },
      // the array forms (legacy code uses them): a[i][j] goes to cell (i, j)
      setFontWeights: a => { call(); each((rr, cc, i, j) => rangeAt(rr, cc).setFontWeight(a[i][j])); return self; },
      setBackgrounds: a => { call(); each((rr, cc, i, j) => rangeAt(rr, cc).setBackground(a[i][j])); return self; },
      setFontSizes: a => { call(); each((rr, cc, i, j) => rangeAt(rr, cc).setFontSize(a[i][j])); return self; },
      setHorizontalAlignments: a => { call(); each((rr, cc, i, j) => rangeAt(rr, cc).setHorizontalAlignment(a[i][j])); return self; },
      setVerticalAlignments: a => { call(); each((rr, cc, i, j) => rangeAt(rr, cc).setVerticalAlignment(a[i][j])); return self; },
      setWrapStrategies: a => { call(); each((rr, cc, i, j) => rangeAt(rr, cc).setWrapStrategy(a[i][j])); return self; },
      setFontColors: a => { call(); each((rr, cc, i, j) => rangeAt(rr, cc).setFontColor(a[i][j])); return self; },
      setNotes: a => { call(); each((rr, cc, i, j) => rangeAt(rr, cc).setNote(a[i][j])); return self; },
      setBorder: (...args) => { call(); s.borders.push({ r1: r, c1: c, r2: r + nr - 1, c2: c + nc - 1, args }); return self; }
    };
    return self;
  }

  // ---- the Sheets API --------------------------------------------------------------------------------------------
  apiGet(o) {
    this.gets.push(o);
    const names = (o.ranges || []).map(x => x.match(/^'(.*)'!/)[1].replace(/''/g, "'"));
    const sheets = [...new Set(names)].map(n => this.sheets[n]).filter(Boolean);
    return { properties: { timeZone: this.tz }, sheets: sheets.map(s => {
      const out = {
        properties: { sheetId: s.id, title: s.title, gridProperties: { rowCount: s.rowCount, columnCount: s.colCount, frozenRowCount: s.frozen } },
        merges: s.merges.map(m => ({ startRowIndex: m.r1 - 1, endRowIndex: m.r2, startColumnIndex: m.c1 - 1, endColumnIndex: m.c2 })), rowGroups: [],
        conditionalFormats: s.condRules.map(x => this.apiRule(s, x))
      };
      if (o.includeGridData) {
        const ref = o.ranges.find(x => x.indexOf("'" + s.title + "'!") === 0) || '';
        const range = ref.match(/!(\d+):(\d+)$/);
        if (range) {
          const rows = [], cols = s.colCount;
          for (let r = Number(range[1]); r <= Number(range[2]) && r <= s.rowCount; r++) {
            const values = [];
            for (let c = 1; c <= cols; c++) {
              const x = s.cell(r, c);
              if (!x || (x.v === '' && !x.f)) { values.push({}); continue; }
              const eff = typeof x.v === 'number' ? { numberValue: x.v } : typeof x.v === 'boolean' ? { boolValue: x.v } : { stringValue: String(x.v) };
              const v = x.f ? { userEnteredValue: { formulaValue: x.f }, effectiveValue: eff } : { userEnteredValue: eff, effectiveValue: eff };
              if (x.fmt.numFmt) {
                const p = x.fmt.numFmt;
                v.effectiveFormat = { numberFormat: { type: isDateFormat(p) ? (/[hs]/i.test(p) && /[yd]/i.test(p) ? 'DATE_TIME' : /[hs]/i.test(p) ? 'TIME' : 'DATE') : 'NUMBER' } };
              }
              values.push(v);
            }
            rows.push({ values });
          }
          out.data = [{ rowData: rows, columnMetadata: [] }];
        }
      }
      return out;
    }) };
  }

  apiRule(s, spec) {
    const f = hex => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
    return { ranges: spec.ranges.map(g => ({ sheetId: s.id, startRowIndex: g.r1 - 1, endRowIndex: g.r2, startColumnIndex: g.c1 - 1, endColumnIndex: g.c2 })),
      booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: spec.formula }] }, format: { textFormat: { foregroundColor: f(spec.color) } } } };
  }
  specOfApiRule(rule) {
    const h = x => ('0' + Math.round((x || 0) * 255).toString(16)).slice(-2);
    const c = rule.booleanRule.format.textFormat.foregroundColor || {};
    return { formula: rule.booleanRule.condition.values[0].userEnteredValue, color: '#' + h(c.red) + h(c.green) + h(c.blue),
      ranges: rule.ranges.map(g => ({ r1: g.startRowIndex + 1, c1: g.startColumnIndex + 1, r2: g.endRowIndex, c2: g.endColumnIndex })) };
  }

  apply(reqs) {
    const rect = g => {
      const s = this.byId(g.sheetId);
      return { s, r1: (g.startRowIndex === undefined ? 0 : g.startRowIndex) + 1, r2: g.endRowIndex === undefined ? s.rowCount : g.endRowIndex,
               c1: (g.startColumnIndex === undefined ? 0 : g.startColumnIndex) + 1, c2: g.endColumnIndex === undefined ? s.colCount : g.endColumnIndex };
    };
    const known = ['insertDimension', 'appendDimension', 'deleteDimension', 'unmergeCells', 'mergeCells', 'updateCells', 'repeatCell',
                   'updateBorders', 'updateSheetProperties', 'updateDimensionProperties', 'autoResizeDimensions', 'addConditionalFormatRule', 'deleteConditionalFormatRule'];
    reqs.forEach(q => {
      const k = Object.keys(q)[0], x = q[k];
      if (known.indexOf(k) < 0) throw new Error('SimBook: unsupported request ' + k);
      if (k === 'addConditionalFormatRule' || k === 'deleteConditionalFormatRule') this.condWrites++;
      if (k === 'addConditionalFormatRule') {
        const s = this.byId(x.rule.ranges[0].sheetId);
        s.condRules.splice(x.index === undefined ? s.condRules.length : x.index, 0, this.specOfApiRule(x.rule));
      } else if (k === 'deleteConditionalFormatRule') {
        this.byId(x.sheetId).condRules.splice(x.index, 1);
      } else if (k === 'insertDimension') {
        const s = this.byId(x.range.sheetId), n = x.range.endIndex - x.range.startIndex;
        if (x.range.dimension === 'ROWS') s.insertRows(x.range.startIndex, n); else s.insertCols(x.range.startIndex, n);
      } else if (k === 'appendDimension') {
        const s = this.byId(x.sheetId);
        if (x.dimension === 'ROWS') s.rowCount += x.length; else s.colCount += x.length;
      } else if (k === 'deleteDimension') {
        if (x.range.dimension !== 'COLUMNS') throw new Error('SimBook: only columns are deleted');
        this.byId(x.range.sheetId).deleteCols(x.range.startIndex + 1, x.range.endIndex - x.range.startIndex);
      } else if (k === 'unmergeCells') {
        const g = rect(x.range); g.s.unmerge(g.r1, g.c1, g.r2, g.c2);
      } else if (k === 'mergeCells') {
        const g = rect(x.range);
        if (x.mergeType === 'MERGE_COLUMNS') { for (let c = g.c1; c <= g.c2; c++) g.s.merge(g.r1, c, g.r2, c); }
        else g.s.merge(g.r1, g.c1, g.r2, g.c2);
      } else if (k === 'updateBorders') {
        const g = rect(x.range); g.s.borders.push({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2, api: x });
      } else if (k === 'updateSheetProperties') {
        this.byId(x.properties.sheetId).frozen = x.properties.gridProperties.frozenRowCount;
      } else if (k === 'updateDimensionProperties') {
        const s = this.byId(x.range.sheetId);
        if (x.range.dimension !== 'ROWS') throw new Error('SimBook: only row heights');
        for (let i = x.range.startIndex; i < x.range.endIndex; i++) s.rowPx[i + 1] = x.properties.pixelSize;
      } else if (k === 'autoResizeDimensions') {
        const g = x.dimensions, s = this.byId(g.sheetId);
        s.fitted[g.dimension === 'ROWS' ? 'rows' : 'columns'].push([g.startIndex + 1, g.endIndex - g.startIndex]);
      } else if (k === 'updateCells') {
        const s = this.byId(x.start.sheetId), fields = String(x.fields).split(',');
        (x.rows || []).forEach((row, i) => (row.values || []).forEach((cell, j) => {
          const r = x.start.rowIndex + 1 + i, c = x.start.columnIndex + 1 + j;
          if (r > s.rowCount || c > s.colCount) throw new Error('SimBook: updateCells outside the sheet at (' + r + ',' + c + ')');
          fields.forEach(f => {
            if (f === 'userEnteredValue') {
              const u = cell.userEnteredValue;
              if (!u) s.setValue(r, c, '', ''); else if (u.formulaValue !== undefined) s.setValue(r, c, 'formula-result', u.formulaValue);
              else s.setValue(r, c, u.numberValue !== undefined ? u.numberValue : u.boolValue !== undefined ? u.boolValue : u.stringValue, '');
            } else if (f === 'note') {
              const t = cell.note === undefined ? '' : cell.note; const y = s.cell(r, c, true); y.note = t; s.prune(r, c);
            } else if (f === 'dataValidation') {
              const y = s.cell(r, c, true), d = cell.dataValidation;
              y.dv = !d ? null : d.condition.type === 'BOOLEAN' ? 'checkbox' : d.condition.type === 'DATE_IS_VALID' ? 'date'
                : 'list:' + d.condition.values.map(v => v.userEnteredValue).join('|') + ':' + (d.strict ? 'strict' : 'loose') + ':' + (d.showCustomUi ? 'dropdown' : 'plain');
              if (d && d.condition.type === 'BOOLEAN' && y.v === '') y.v = false;
              s.prune(r, c);
            } else throw new Error('SimBook: unsupported updateCells field ' + f);
          });
        }));
      } else if (k === 'repeatCell') {
        const g = rect(x.range), f = (x.cell && x.cell.userEnteredFormat) || {};
        String(x.fields).split(',').forEach(field => {
          for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
            const y = g.s.cell(r, c, true);
            const set = (name, v) => { if (v === undefined) delete y.fmt[name]; else y.fmt[name] = v; };
            const t = f.textFormat || {};
            if (field === 'dataValidation') y.dv = null;
            else if (field === 'userEnteredFormat.backgroundColor') set('bg', f.backgroundColor ? apiColor(f.backgroundColor) : undefined);
            else if (field === 'userEnteredFormat.horizontalAlignment') set('hAlign', f.horizontalAlignment ? f.horizontalAlignment.toLowerCase() : undefined);
            else if (field === 'userEnteredFormat.verticalAlignment') set('vAlign', f.verticalAlignment ? f.verticalAlignment.toLowerCase() : undefined);
            else if (field === 'userEnteredFormat.wrapStrategy') set('wrap', f.wrapStrategy === 'OVERFLOW_CELL' ? 'OVERFLOW' : f.wrapStrategy);
            else if (field === 'userEnteredFormat.numberFormat') set('numFmt', f.numberFormat ? f.numberFormat.pattern : undefined);
            else if (field === 'userEnteredFormat.textFormat.bold') set('bold', t.bold);
            else if (field === 'userEnteredFormat.textFormat.fontSize') set('size', t.fontSize);
            else if (field === 'userEnteredFormat.textFormat.foregroundColor') set('color', t.foregroundColor ? apiColor(t.foregroundColor) : undefined);
            else throw new Error('SimBook: unsupported repeatCell field ' + field);
            g.s.prune(r, c);
          }
        });
      }
    });
  }
}

module.exports = { SimBook, SimSheet, colNum, colName };
