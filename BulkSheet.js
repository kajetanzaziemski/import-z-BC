// ---------------------------------------------------------------------------
// BULK SHEET: writes a whole table to a sheet, however tall it is. Generic: no project words, no layout.
//
// Grid (Grid.js) keeps an in-memory window of the top rows (at most 3000) and is meant for small, structured sheets; a result table can have
// many times that. This writer works in this order: ensure the sheet and its size, clear it, one number format per column, then the values in chunks of
// whole rows (a chunk is at most `chunkCells` cells, so that no single call carries the whole table).
//
// Two paths, the same result:
//   - the Spreadsheet service (always works): getDataRange().clear(), insertRowsAfter / insertColumnsAfter, setNumberFormat, setValues per chunk;
//   - the Sheets advanced service (when it is enabled in the project and Grid.js's USE_SHEETS_API is not false): ONE spreadsheets.batchUpdate for clear, growth
//     and number formats, then spreadsheets.values.batchUpdate per chunk with USER_ENTERED - strings are read as if typed in, like setValues does.
//     The service is used only to create a missing sheet. The advanced service is OFF in this add-on's manifest today (appsscript.json), so the service
//     path is the one in production; the API path is tested against the simulated spreadsheet only (tests/bulk-sheet.test.js) and has to be tried on a
//     real one before the service is switched on. Differences: the API path clears the whole sheet, the service path only its data range.
// ---------------------------------------------------------------------------

const BULK_CHUNK_CELLS = 50000;

const BulkSheet = {
  /**
   * Replaces the content of the sheet (created when missing) with `table`, starting at A1.
   * @param sheetName {String}
   * @param table {Array[]} Rows of equal length; at least one row with at least one cell. Checked before anything is touched.
   * @param options {{columnFormats: String[], chunkCells: Number}} columnFormats[i]: number format of column i + 1 for the whole table height
   *        (missing / null / undefined: the column keeps what clearing left); chunkCells: cells per write call (default BULK_CHUNK_CELLS).
   * @returns {{rows: Number, cols: Number, chunks: Number}}
   */
  writeTable(sheetName, table, options) {
    options = options || {};
    const formats = options.columnFormats || [];
    if (!Array.isArray(table) || table.length === 0 || !Array.isArray(table[0]) || table[0].length === 0) {
      throw new Error('BulkSheet.writeTable: nothing to write to "' + sheetName + '" (the table has no rows or no columns).');
    }
    const rows = table.length, cols = table[0].length;
    for (let i = 1; i < rows; i++) {
      if (!Array.isArray(table[i]) || table[i].length !== cols) {
        throw new Error('BulkSheet.writeTable: row ' + (i + 1) + ' has ' + (Array.isArray(table[i]) ? table[i].length : 'no') + ' cells, the first row has ' + cols + '.');
      }
    }

    if (bulkSheetsApiAvailable_()) return BulkSheet.writeTableViaApi_(sheetName, table, formats, options);
    return BulkSheet.writeTableViaService_(sheetName, table, formats, options);
  },

  writeTableViaService_(sheetName, table, formats, options) {
    const rows = table.length, cols = table[0].length;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.getDataRange().clear();
    // A new sheet has 1000 rows; a tall table needs the rows to exist (and so do columns for formats past the data).
    const needCols = Math.max(cols, formats.length);
    if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
    if (sheet.getMaxColumns() < needCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols - sheet.getMaxColumns());
    formats.forEach((format, index) => {
      if (format !== undefined && format !== null) sheet.getRange(1, index + 1, rows, 1).setNumberFormat(format);
    });

    const perChunk = Math.max(1, Math.floor((options.chunkCells || BULK_CHUNK_CELLS) / cols));
    let chunks = 0;
    for (let first = 0; first < rows; first += perChunk) {
      const part = table.slice(first, first + perChunk);
      sheet.getRange(first + 1, 1, part.length, cols).setValues(part);
      chunks++;
    }
    SpreadsheetApp.flush();
    return { rows: rows, cols: cols, chunks: chunks };
  },

  writeTableViaApi_(sheetName, table, formats, options) {
    const rows = table.length, cols = table[0].length;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss.getSheetByName(sheetName)) ss.insertSheet(sheetName);
    SpreadsheetApp.flush();                                     // the API has to see the new sheet and the last writes of the service
    const quoted = "'" + sheetName.replace(/'/g, "''") + "'";
    const info = Sheets.Spreadsheets.get(ss.getId(), { ranges: [quoted + '!A1'], fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))' });
    const props = info.sheets.find(sh => sh.properties.title === sheetName).properties;
    const sheetId = props.sheetId, maxRows = props.gridProperties.rowCount, maxCols = props.gridProperties.columnCount;
    const needCols = Math.max(cols, formats.length);

    const requests = [{ updateCells: { range: { sheetId: sheetId }, fields: 'userEnteredValue,userEnteredFormat,dataValidation,note' } }];
    if (maxRows < rows) requests.push({ appendDimension: { sheetId: sheetId, dimension: 'ROWS', length: rows - maxRows } });
    if (maxCols < needCols) requests.push({ appendDimension: { sheetId: sheetId, dimension: 'COLUMNS', length: needCols - maxCols } });
    formats.forEach((format, index) => {
      if (format === undefined || format === null) return;
      requests.push({ repeatCell: {
        range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: rows, startColumnIndex: index, endColumnIndex: index + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: bulkNumberFormatType_(format), pattern: format } } },
        fields: 'userEnteredFormat.numberFormat'
      } });
    });
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());

    const tz = ss.getSpreadsheetTimeZone();
    const cell = v => v === undefined || v === null ? '' : (v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss') : v);
    const perChunk = Math.max(1, Math.floor((options.chunkCells || BULK_CHUNK_CELLS) / cols));
    let chunks = 0;
    for (let first = 0; first < rows; first += perChunk) {
      const part = table.slice(first, first + perChunk).map(row => row.map(cell));
      Sheets.Spreadsheets.Values.batchUpdate({
        valueInputOption: 'USER_ENTERED',
        data: [{ range: quoted + '!A' + (first + 1), values: part }]
      }, ss.getId());
      chunks++;
    }
    return { rows: rows, cols: cols, chunks: chunks };
  }
};

/** Is the Sheets advanced service usable (and not switched off by USE_SHEETS_API in Grid.js)? */
function bulkSheetsApiAvailable_() {
  return (typeof USE_SHEETS_API === 'undefined' || !!USE_SHEETS_API)
    && typeof Sheets !== 'undefined' && !!Sheets && !!Sheets.Spreadsheets && !!Sheets.Spreadsheets.Values;
}

/** The API's number format type for a pattern ("#,##0" NUMBER, "yyyy-mm-dd hh:mm" DATE_TIME, "0%" PERCENT, "@" TEXT ...); the same rule as Grid.js (numberFormatType_). */
function bulkNumberFormatType_(pattern) {
  const p = String(pattern).replace(/"[^"]*"|\[[^\]]*\]/g, '');
  const date = /[yd]/i.test(p), time = /[hs]/i.test(p);
  if (p === '@') return 'TEXT';
  if (date && time) return 'DATE_TIME';
  if (date) return 'DATE';
  if (time) return 'TIME';
  if (p.indexOf('%') >= 0) return 'PERCENT';
  return 'NUMBER';
}
