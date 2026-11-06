// ---------------------------------------------------------------------------
// REFRESH LOG GRID: the only place that knows the LAYOUT of the sheet of the download log ("Dziennik pobrań") and touches it. It talks to the sheet through Grid
// (Grid.js) only; RefreshLog (Refresh Log.js) decides what an entry says.
//
//   row 1     the headers (the sheet is made with them the first time an entry is written)
//   row 2 ... the entries, NEWEST FIRST: a new entry is inserted as row 2, above the previous ones and below the headers
//
//   A Źródło            where the refresh came from (Autoodświeżanie / Odświeżanie jednego arkusza / Odświeżanie wszystkich arkuszy)
//   B Początek          start of the refresh (date, time and the zone: "2026-11-05 10:01:00 UTC+1")
//   C Koniec            end of the refresh (the same)
//   D Czas trwania      "27 m 11 s"
//   E Status            "OK ✅", the message of a failure the add-on handled, or the error the platform threw
//   F Odświeżone arkusze  how many sheets ("2 arkusze:"), and each with its number of rows (one cell, a line per sheet)
//   G Dane techniczne   what fired it (the clock trigger and its id, the menu item); for a trigger that deleted itself: that, and that nothing was refreshed
//
// Look: the headers grey like the headers of a config sheet, bold, centred, and frozen (the first row stays in view); the entries are top and left aligned; the technical
// column is Courier New 8 pt. FIXED widths and wrapping, per column, set ONCE when the sheet is made (what the user changes afterwards stays); a new entry is inserted as
// "a row above" the first entry, so the sheet itself gives it the look of the entries:
//   Źródło 200 px wrap | Początek 200 px wrap | Koniec 200 px wrap | Czas trwania 100 px wrap | Status 200 px wrap | Odświeżone arkusze 300 px wrap | Dane techniczne 200 px cut
// ("cut" = the text is cut at the edge of its cell). The row of a new entry is fitted to its content (the Sheets API does not grow a row for wrapped text by itself).
// One read of the first rows only (the log grows; the entries below are not needed to insert above them) and one commit per entry.
// ---------------------------------------------------------------------------

const REFRESH_LOG_LAYOUT = {
  headers: ["Źródło","Początek","Koniec","Czas trwania","Status","Odświeżone arkusze","Dane techniczne"],
  headerRow: 1,
  firstEntryRow: 2,
  timeFormat: "yyyy-mm-dd hh:mm:ss",
  headerBackground: "#cccccc",          // the grey of the headers of a config sheet (CONFIG_HEADER_)
  widths: [200, 200, 200, 100, 200, 300, 200],           // px, per column
  wraps: ["WRAP", "WRAP", "WRAP", "WRAP", "WRAP", "WRAP", "CLIP"],       // WRAP = wrapped, CLIP = cut
  technicalCol: 7,
  technicalFont: "Courier New",
  technicalSize: 8
};

const RefreshLogGrid = {
  /**
   * Inserts one entry as the first row under the headers. The sheet is made (with its headers) when it is not there.
   * @param sheetName {String}
   * @param entry {{source: String, start: Date, end: Date, duration: String, status: String, sheets: String, technical: String}}
   */
  append(sheetName, entry) {
    const L = REFRESH_LOG_LAYOUT;
    const cols = L.headers.length;
    let grid = Grid.open({ sheetName: sheetName, window: 3 });
    const created = !grid;
    if (created) {
      grid = Grid.create({ sheetName: sheetName, rows: L.headerRow, cols: cols });
      const head = grid.getRange(L.headerRow, 1, 1, cols);
      head.setValues([L.headers]);
      head.setFontWeight("bold");
      head.setBackground(L.headerBackground);
      head.setHorizontalAlignment("center");
      head.setWrapStrategy("WRAP");
      grid.freezeRows(L.headerRow);
      L.widths.forEach((px, i) => grid.setColumnWidth(i + 1, px));
    }
    // The new entry goes in as "insert a row above" the first entry: the sheet gives it the look of the entries (formats, row height), whatever the user has done to them.
    grid.insertRowsAfter(L.headerRow, 1, { plain: true, fit: true, fromBelow: true });
    RefreshLogGrid.writeEntry_(grid, L.firstEntryRow, entry);
    if (created) {
      // The look of the entries, set ONCE for the rows under the headers when the sheet is made (the rows after it take it from the entries below them)
      const dataRows = Math.max(grid.maxRows - L.headerRow, 1);
      const column = (col) => grid.getRange(L.firstEntryRow, col, dataRows, 1);
      L.wraps.forEach((strategy, i) => column(i + 1).setWrapStrategy(strategy));
      grid.getRange(L.firstEntryRow, 1, dataRows, cols).setVerticalAlignment("top");
      grid.getRange(L.firstEntryRow, 1, dataRows, cols).setHorizontalAlignment("left");
      column(L.technicalCol).setFontFamily(L.technicalFont);
      column(L.technicalCol).setFontSize(L.technicalSize);
    }
    grid.commit();
  },

  /**
   * Writes the entry into the row. The time and the zone it is in: the cell keeps the wall clock of the spreadsheet's zone, so the zone (as UTC+N, the offset at that
   * moment) is part of its format - it stays true for an old entry when the zone of the spreadsheet is changed later. This differs from entry to entry.
   * An entry that has no end yet (the one opened when a run starts) leaves the cell empty.
   */
  writeEntry_(grid, rowNumber, entry) {
    const L = REFRESH_LOG_LAYOUT;
    grid.getRange(rowNumber, 1, 1, L.headers.length).setValues([[entry.source, entry.start, entry.end ?? "", entry.duration ?? "", entry.status, entry.sheets ?? "", entry.technical]]);
    const tz = grid.getTimeZone();
    grid.getRange(rowNumber, 2).setNumberFormat(`${L.timeFormat} "${SettingsGrid.offsetName(entry.start, tz)}"`);
    if (entry.end) grid.getRange(rowNumber, 3).setNumberFormat(`${L.timeFormat} "${SettingsGrid.offsetName(entry.end, tz)}"`);
  },

  /**
   * Completes the entry that was opened when the run started (`opened`: the entry as it was written then): the row is found among the first rows by its status
   * (REFRESH_LOG_UNKNOWN), its start (to the second) and the technical text; other runs may have put entries above it meanwhile. The row is fitted to its content.
   * When the row cannot be found (the sheet was cleared, renamed ...) the entry is added as a new one, so nothing is lost.
   */
  update(sheetName, opened, entry) {
    const L = REFRESH_LOG_LAYOUT;
    const grid = Grid.open({ sheetName: sheetName, window: REFRESH_LOG_LOOKUP_ROWS });
    if (!grid) return RefreshLogGrid.append(sheetName, entry);
    let found = 0;
    for (let r = L.firstEntryRow; r <= grid.rows && !found; r++) {
      const v = grid.getRange(r, 1, 1, L.headers.length).getValues()[0];
      const at = v[1] && typeof v[1].getTime == "function" ? v[1].getTime() : NaN;
      if (v[4] === opened.status && v[6] === opened.technical && v[0] === opened.source && Math.abs(at - opened.start.getTime()) < 1000) found = r;
    }
    if (!found) return RefreshLogGrid.append(sheetName, entry);
    RefreshLogGrid.writeEntry_(grid, found, entry);
    grid.fitRows.push(found);
    grid.commit();
  }
};

const REFRESH_LOG_LOOKUP_ROWS = 30;        // how far down the opened entry is looked for (the newest entries are on top)
