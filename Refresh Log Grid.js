// ---------------------------------------------------------------------------
// REFRESH LOG GRID: the only place that knows the LAYOUT of the sheet of the download log ("Dziennik pobrań") and touches it. It talks to the sheet through Grid
// (Grid.js) only; RefreshLog (Refresh Log.js) decides what an entry says.
//
//   row 1     the headers (the sheet is made with them the first time an entry is written)
//   row 2 ... the entries, NEWEST FIRST: a new entry is inserted as row 2, above the previous ones and below the headers
//
//   A Źródło            where the refresh came from (Autoodświeżanie / Odświeżanie jednego arkusza / Odświeżanie wszystkich arkuszy)
//   B Początek          start of the refresh (date and time)
//   C Koniec            end of the refresh
//   D Czas trwania      "27 m 11 s"
//   E Status            "OK", the message of a failure the add-on handled, or the error the platform threw
//   F Odświeżone arkusze  how many sheets, and each with its number of rows (one cell, a line per sheet)
//   G Dane techniczne   what fired it (the clock trigger and its id, the menu item); for a trigger that deleted itself: that, and that nothing was refreshed
//
// One read of the first rows only (the log grows; the entries below are not needed to insert above them) and one commit per entry.
// ---------------------------------------------------------------------------

const REFRESH_LOG_LAYOUT = {
  headers: ["Źródło","Początek","Koniec","Czas trwania","Status","Odświeżone arkusze","Dane techniczne"],
  headerRow: 1,
  firstEntryRow: 2,
  timeFormat: "yyyy-mm-dd hh:mm:ss",
  headerBackground: "#f1f3f4"
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
      grid.autoResizeColumns(1, cols);
    }
    grid.insertRowsAfter(L.headerRow, 1, { plain: true });         // the new row takes the look of the header above it: put right below
    const row = grid.getRange(L.firstEntryRow, 1, 1, cols);
    row.setValues([[entry.source, entry.start, entry.end, entry.duration, entry.status, entry.sheets, entry.technical]]);
    row.setFontWeight("normal");
    row.setBackground(null);
    row.setVerticalAlignment("top");
    row.setWrapStrategy("WRAP");
    grid.getRange(L.firstEntryRow, 2, 1, 2).setNumberFormat(L.timeFormat);
    grid.commit();
  }
};
