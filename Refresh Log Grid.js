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
//   E Status            "OK", the message of a failure the add-on handled, or the error the platform threw
//   F Odświeżone arkusze  how many sheets ("2 arkusze:"), and each with its number of rows (one cell, a line per sheet)
//   G Dane techniczne   what fired it (the clock trigger and its id, the menu item); for a trigger that deleted itself: that, and that nothing was refreshed
//
// Look: the headers grey like the headers of a config sheet, bold, centred, wrapped, and frozen (the first row stays in view); the entries wrap (the technical column
// is cut at the edge of the cell instead), are top aligned and left aligned; the technical column is Courier New 8 pt; the columns fit their content, except
// "Źródło" (200 px) and "Odświeżone arkusze" (300 px). The row of a new entry is fitted to its content (the Sheets API does not grow a row for wrapped text by itself).
// One read of the first rows only (the log grows; the entries below are not needed to insert above them) and one commit per entry.
// ---------------------------------------------------------------------------

const REFRESH_LOG_LAYOUT = {
  headers: ["Źródło","Początek","Koniec","Czas trwania","Status","Odświeżone arkusze","Dane techniczne"],
  headerRow: 1,
  firstEntryRow: 2,
  timeFormat: "yyyy-mm-dd hh:mm:ss",
  headerBackground: "#cccccc",          // the grey of the headers of a config sheet (CONFIG_HEADER_)
  sourceCol: 1,
  sourceWidth: 200,
  sheetsCol: 6,
  sheetsWidth: 300,
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
    if (!grid) {
      grid = Grid.create({ sheetName: sheetName, rows: L.headerRow, cols: cols });
      const head = grid.getRange(L.headerRow, 1, 1, cols);
      head.setValues([L.headers]);
      head.setFontWeight("bold");
      head.setBackground(L.headerBackground);
      head.setHorizontalAlignment("center");
      head.setWrapStrategy("WRAP");
      grid.freezeRows(L.headerRow);
      grid.setColumnWidth(L.sourceCol, L.sourceWidth);
      grid.setColumnWidth(L.sheetsCol, L.sheetsWidth);
    }
    grid.insertRowsAfter(L.headerRow, 1, { plain: true, fit: true });      // the new row takes the look of the header above it: put right below
    const row = grid.getRange(L.firstEntryRow, 1, 1, cols);
    row.setValues([[entry.source, entry.start, entry.end, entry.duration, entry.status, entry.sheets, entry.technical]]);
    row.setFontWeight("normal");
    row.setBackground(null);
    row.setHorizontalAlignment("left");
    row.setVerticalAlignment("top");
    row.setWrapStrategy("WRAP");
    // the time and the zone it is in: the cell keeps the wall clock of the spreadsheet's zone, so the zone (as UTC+N, the offset at that moment) is part of its format -
    // it stays true for an old entry when the zone of the spreadsheet is changed later
    const tz = grid.getTimeZone();
    grid.getRange(L.firstEntryRow, 2).setNumberFormat(`${L.timeFormat} "${SettingsGrid.offsetName(entry.start, tz)}"`);
    grid.getRange(L.firstEntryRow, 3).setNumberFormat(`${L.timeFormat} "${SettingsGrid.offsetName(entry.end, tz)}"`);
    const technical = grid.getRange(L.firstEntryRow, L.technicalCol);
    technical.setFontFamily(L.technicalFont);
    technical.setFontSize(L.technicalSize);
    technical.setWrapStrategy("CLIP");                                      // the technical text is cut at the edge of the cell, not wrapped
    grid.autoResizeColumns(L.sourceCol + 1, L.sheetsCol - L.sourceCol - 1);     // every column but "Źródło" and "Odświeżone arkusze" (fixed widths) fits its content
    grid.autoResizeColumns(L.technicalCol, 1);
    grid.commit();
  }
};
