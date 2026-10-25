// ---------------------------------------------------------------------------
// BULK SHEET: writes a whole table to a sheet, however tall it is. Generic: no project words, no layout.
//
// Grid (Grid.js) keeps an in-memory window of the top rows (at most 3000) and is meant for small, structured sheets; a result table can have
// many times that. This writer works on the Spreadsheet service only, in this order: ensure the sheet and its size, clear its data range, one number format
// per column, then the values in chunks of whole rows (a chunk is at most `chunkCells` cells, so that no single call carries the whole table).
// The Sheets advanced service is not used: it is off in this add-on (appsscript.json) and a second path would have nothing to be checked against.
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
  }
};
