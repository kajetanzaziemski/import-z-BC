// ---------------------------------------------------------------------------
// SETTINGS GRID: the only place that knows the LAYOUT of the import settings sheet ("Ustawienia importu") and touches it.
//
//   row 2      column labels (B..E)
//   row 4      headerGeneralSettings
//   row 5      lastRefresh: D = time of the last refresh (date format), E = the time zone's name
//   row 6      refreshFrequency: D = number, E = unit (godzin / dni, a dropdown)
//   row 7 ...  configSheet lines: B "configSheet", C config sheet, D result sheet, E checkbox "refresh automatically"
//
// It talks to the sheet through Grid (Grid.js) only. SettingsSheet (Settings Sheet.js) keeps the meaning of the lines (which row
// is what, the sheet list, the refresh frequency) and asks this file for cell values and for writes. The pre-Grid code is frozen in
// tests/golden/legacy-settings-sheet.js; tests/settings-sheet.test.js checks that the sheet comes out the same.
// ---------------------------------------------------------------------------

const SETTINGS_LAYOUT = {
  firstCol: 2,                             // column B: the line key ("configSheet", "lastRefresh" ...)
  cols: 4,                                 // B..E
  valueCol: 4,                             // D
  unitCol: 5,                              // E
  header: [                                // rows 2-6, from column B
    ["Opis linii","Arkusz konfiguracji","Arkusz docelowy         .","Odświeżanie automatyczne"],
    ["","","",""],
    ["headerGeneralSettings","Ustawienia odświeżania automatycznego","",""],
    ["lastRefresh","Ostatnio odświeżone o:","",""],
    ["refreshFrequency","Odświeżaj co:","","godzin"]
  ],
  headerRow: 2,
  lastRefreshRow: 5,
  frequencyRow: 6,
  units: ["godzin","dni"],
  lastRefreshFormat: "yyyy-mm-dd hh:mm",
  addedLastRefreshLabel: "Ostatnie odświeżone o:"    // the label of a lastRefresh line added later (differs from the header's, as it always did)
};

const SettingsGrid = {
  exists(sheetName) {
    return Grid.exists(sheetName);
  },

  /** Inserts the settings sheet with its header block (one commit). The new sheet becomes the active one, as insertSheet does. */
  create(sheetName) {
    const L = SETTINGS_LAYOUT;
    const grid = Grid.create({ sheetName: sheetName, rows: L.frequencyRow, cols: L.firstCol + L.cols - 1 });
    grid.getRange(L.headerRow, L.firstCol, L.header.length, L.cols).setValues(L.header);
    grid.getRange(L.frequencyRow, L.unitCol).setDataValidation({ list: L.units, strict: false, dropdown: true });
    grid.getRange(L.lastRefreshRow, L.valueCol).setNumberFormat(L.lastRefreshFormat);
    grid.autoResizeColumns(L.firstCol, L.cols + 1);
    grid.commit();
  },

  /**
   * The settings sheet for reading and writing: one read now, then the handle works on what it read (and on its own writes);
   * every write is one commit. Returns null when the sheet does not exist.
   *   rows()                        rows 1..last used, columns B..E
   *   frequency(row)                [number, unit] of the refreshFrequency line at `row`
   *   lastRefresh(row)              the time (D) of the lastRefresh line at `row`
   *   addLastRefreshRow()           a lastRefresh line after the last row; returns its row number
   *   writeLastRefresh(row, time)   time into D, the time zone's name into E
   *   addConfigRow(after, config, result, refresh)   a configSheet line after row `after`, E a checkbox; returns its row number
   */
  open(sheetName) {
    const L = SETTINGS_LAYOUT;
    const grid = Grid.open({ sheetName: sheetName });
    if (!grid) return null;
    const lastUsedRow = () => {
      for (let r = grid.getLastRow(); r >= 1; r--) {
        if (grid.getRange(r, 1, 1, grid.getLastColumn()).getValues()[0].some(x => x !== '' && x !== null)) return r;
      }
      return 0;
    };
    const save = () => { grid.commit(); SpreadsheetApp.flush(); };
    return {
      rows() {
        return grid.getRange(1, L.firstCol, Math.max(lastUsedRow(), 1), L.cols).getValues();
      },
      frequency(row) {
        return grid.getRange(row, L.valueCol, 1, 2).getValues()[0];
      },
      lastRefresh(row) {
        return grid.getRange(row, L.valueCol).getValue();
      },
      addLastRefreshRow() {
        let row = lastUsedRow();
        grid.insertRowsAfter(row, 1);
        row++;
        grid.getRange(row, L.firstCol, 1, 2).setValues([["lastRefresh", L.addedLastRefreshLabel]]);
        return row;
      },
      writeLastRefresh(row, time) {
        const zone = Utilities.formatDate(time, grid.getTimeZone(), "z");
        grid.getRange(row, L.valueCol, 1, 2).setValues([[time, zone]]);
        save();
      },
      addConfigRow(after, config, result, refresh) {
        grid.insertRowsAfter(after, 1);
        const row = after + 1;
        grid.getRange(row, L.firstCol, 1, L.cols).setValues([["configSheet", config, result, refresh]]);
        grid.setCheckbox(row, L.unitCol, refresh);
        save();
        return row;
      }
    };
  }
};
