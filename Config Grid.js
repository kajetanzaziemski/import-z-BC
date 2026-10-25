// ---------------------------------------------------------------------------
// CONFIG GRID: the only place that knows the LAYOUT of an import configuration sheet ("Konfiguracja n").
//
//   rows 1-4   header block (title, status cells row 2, column labels, line descriptions) - see CONFIG_HEADER_
//   row 2      status cells B2 (reading), C2 (connection), D2 (writing); E2:F2 "estimated rows" label + number
//   row 6 ...  query lines (startRow / startCol), read and written by SheetCoeditor
//
// Query lines are reached through ConfigGrid.lines(): the model of the sheet (SheetCoeditor / Content Tracker.js) never sees a range.
// It talks to the sheet through Grid (Grid.js) only. SheetCoeditor keeps its public methods (switchReadingControl, ...)
// and forwards to this file. The pre-Grid code is frozen in tests/golden/legacy-config-header.js; tests/run.js checks
// that this file produces the same sheet.
// ---------------------------------------------------------------------------

const CONFIG_LAYOUT = {
  startRow: 6,
  startCol: 2,
  queryCols: 5,                           // columns of a query line (B..F)
  headerRows: 4,
  headerCols: 7,
  statusRow: 2,
  status: {                               // column of the status cell, and the look when it is on
    reading:    { col: 2, onColor: 'green' },
    connection: { col: 3, onColor: 'red' },
    writing:    { col: 4, onColor: 'red' }
  },
  statusOffColor: '#cccccc',
  statusOffText: '#999999',
  estimateCol: 5,                          // E2: label, F2: the number (E2:F2 is greyed out / blacked together)
  totalRowsCol: 6,
  totalRowsFormat: '#,##0',
  window: 6                                // rows a status grid reads: the header block and a little more
};

/** The header block as data: [row][col], 4 x 7. Same values the old SheetCoeditor.setupConfigHeader wrote. */
const CONFIG_HEADER_ = {
  fontWeights: [["normal","bold","normal","normal","normal","normal","normal"],["normal","normal","normal","normal","normal","normal","normal"],["normal","bold","bold","normal","normal","normal","normal"],["normal","bold","bold","bold","bold","bold","normal"]],
  backgrounds: [["#cccccc","#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"],["#cccccc","#cccccc","#cccccc","#cccccc","#cccccc","#cccccc","#cccccc"],["#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"],["#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"]],
  fontSizes: [[10,10,10,10,10,10,10],[10,8,8,8,8,10,10],[10,8,8,10,10,10,10],[10,8,8,8,8,8,10]],
  horizontalAlignments: [["general","center","general","general","general","general","general"],["general","center","center","center","general-left","general-right","general"],["general","general-left","general-left","general","general","general","general"],["general","general-left","general-right","general-right","general-right","general-right","general"]],
  merges: [[1, 2, 1, 5], [3, 3, 1, 4]],   // [row, col, rows, cols]: B1:F1, C3:F3
  notes: [["","","","","","",""],["","","","","","",""],["","","","","","",""],["","Skrypt czyta tylko linie z poprawnym opisem. Musi być jedną z wartości: \"table\", \"queryOption\", \"extend\", \"extendOption\". Linie z pustą lub błędną wartością opisu są pomijane.","","","","",""]],
  values: [["","Zapytanie do bazy danych BC","","","","",""],["","Analiza zapytania","Pobieranie z bazy danych","Wstawianie danych do arkusza","Szacowana liczba wierszy:","",""],["","Linie zapytania","Kolejne składowe linii zapytania","","","",""],["","Opis linii",1,2,3,4,""]],
  verticalAlignments: [["bottom","bottom","bottom","bottom","bottom","bottom","bottom"],["bottom","middle","middle","bottom","bottom","bottom","bottom"],["bottom","bottom","bottom","bottom","bottom","bottom","bottom"],["bottom","bottom","bottom","bottom","bottom","bottom","bottom"]],
  wrapStrategies: [['OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW'], ['WRAP', 'WRAP', 'WRAP', 'WRAP', 'WRAP', 'WRAP', 'WRAP'], ['OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW'], ['OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW', 'OVERFLOW']],
  fontColors: [["#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#808080"],["#ff000000","#999999","#999999","#999999","#999999","#999999","#ff000000"],["#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#808080"],["#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#ff000000","#808080"]]
};

const ConfigGrid = {
  layout: CONFIG_LAYOUT,

  /** Writes the header block into a grid (new or existing sheet). Nothing is committed here. */
  writeHeader(grid) {
    const L = CONFIG_LAYOUT, H = CONFIG_HEADER_;
    const block = grid.getRange(1, 1, L.headerRows, L.headerCols);
    block.setFontWeights(H.fontWeights);
    block.setBackgrounds(H.backgrounds);
    block.setFontSizes(H.fontSizes);
    block.setHorizontalAlignments(H.horizontalAlignments);
    H.merges.forEach(m => grid.getRange(m[0], m[1], m[2], m[3]).merge());
    block.setNotes(H.notes);
    block.setValues(H.values);
    block.setVerticalAlignments(H.verticalAlignments);
    block.setWrapStrategies(H.wrapStrategies);
    block.setFontColors(H.fontColors);
    return grid;
  },

  /** Inserts a new configuration sheet with its header (one commit). The new sheet becomes the active one, as insertSheet does. */
  create(sheetName) {
    const grid = Grid.create({ sheetName: sheetName, rows: CONFIG_LAYOUT.headerRows, cols: CONFIG_LAYOUT.headerCols });
    ConfigGrid.writeHeader(grid).commit();
  },

  /** Rewrites the header block of an existing sheet (one read of a few rows, one commit). Returns false when the sheet is missing. */
  resetHeader(sheetName) {
    const grid = Grid.open({ sheetName: sheetName, window: CONFIG_LAYOUT.window });
    if (!grid) return false;
    ConfigGrid.writeHeader(grid).commit();
    return true;
  },

  /** Whether the sheet exists (one cheap call, nothing is read). */
  exists(sheetName) {
    return Grid.exists(sheetName);
  },

  /**
   * The query lines of one configuration sheet: one read (the window reaches every used row), changes in the model, one commit per save().
   * Returns null when the sheet does not exist.
   *   values()                    the lines as the model reads them: B6.. five columns, down to the last row with anything in B-F (at least one
   *                               row), the sheet as it stands after the inserts of this handle
   *   insertRowAfter(after, row)  a new line after the line `after` (0 = the first), `row` is written from column B; takes effect at save()
   *   setDropdowns(validations, notes)   a SpreadsheetApp DataValidation (or null) and a note (or null) for every cell from B6; at save()
   *   save()                      commits, then SpreadsheetApp.flush()
   */
  lines(sheetName) {
    const L = CONFIG_LAYOUT;
    const grid = Grid.open({ sheetName: sheetName });
    if (!grid) return null;
    // the last row from the first line down that has anything in B-F (L.startRow - 1 when there is nothing)
    const lastLineRow = () => {
      for (let r = grid.getLastRow(); r >= L.startRow; r--) {
        if (grid.getRange(r, L.startCol, 1, L.queryCols).getValues()[0].some(x => x !== '' && x !== null)) return r;
      }
      return L.startRow - 1;
    };
    return {
      values() {
        return grid.getRange(L.startRow, L.startCol, Math.max(lastLineRow() - L.startRow + 1, 1), L.queryCols).getValues();
      },
      insertRowAfter(after, row) {
        grid.insertRowsAfter(after + L.startRow, 1);
        grid.getRange(after + L.startRow + 1, L.startCol, 1, row.length).setValues([row]);
      },
      setDropdowns(validations, notes) {
        grid.getRange(L.startRow, L.startCol, validations.length, validations[0].length).setDataValidations(validations).setNotes(notes);
      },
      save() {
        grid.commit();
        SpreadsheetApp.flush();
      }
    };
  },

  /**
   * The status cells of one configuration sheet. Reads a few rows once; every call changes the cells and commits right away
   * (the user watches the colours while the script runs), so the handle can be kept for the whole execution.
   * Returns null when the sheet does not exist.
   */
  status(sheetName) {
    const L = CONFIG_LAYOUT;
    const grid = Grid.open({ sheetName: sheetName, window: L.window });
    if (!grid) return null;
    const show = () => { grid.commit(); SpreadsheetApp.flush(); };
    return {
      /** kind: 'reading' | 'connection' | 'writing' */
      set(kind, active) {
        const cell = L.status[kind];
        if (!cell) throw new Error('ConfigGrid: unknown status cell "' + kind + '".');
        grid.getRange(L.statusRow, cell.col)
          .setFontColor(active ? 'black' : L.statusOffText)
          .setBackground(active ? cell.onColor : L.statusOffColor);
        show();
      },
      /** The "estimated rows" label and number: black when active, grey when not. */
      setEstimateActive(active) {
        grid.getRange(L.statusRow, L.estimateCol, 1, 2).setFontColor(active ? 'black' : L.statusOffText);
        show();
      },
      /** Writes the estimated number of rows and lights the label up. */
      setTotalRows(n) {
        grid.getRange(L.statusRow, L.totalRowsCol).setValue(n).setNumberFormat(L.totalRowsFormat);
        grid.getRange(L.statusRow, L.estimateCol, 1, 2).setFontColor('black');
        show();
      }
    };
  }
};
