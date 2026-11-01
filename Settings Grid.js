// ---------------------------------------------------------------------------
// SETTINGS GRID: the only place that knows the LAYOUT of the import settings sheet ("Ustawienia importu") and touches it.
//
//   row 2      column labels (B..E)
//   row 4      headerGeneralSettings
//   row 5      lastRefresh: D = time of the last refresh (date format), E = the time zone's name
//   row 6      refreshFrequency: D = number, E = unit (godzin / dni, a dropdown)
//   row 7      refreshTime: D = the time of day to refresh at ("17:30"), E empty
//   row 8      refreshStatus: C:E merged = the message about the last change of the refresh settings (green / red)
//   row 9 ...  configSheet lines: B "configSheet", C config sheet, D result sheet, E checkbox "refresh automatically"
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
    ["refreshFrequency","Odświeżaj co:","","godzin"],
    ["refreshTime","Godzina odświeżenia:","",""],
    ["refreshStatus","","",""]
  ],
  timeLine: ["refreshTime","Godzina odświeżenia:","",""],      // the lines of a sheet made before them are added when first needed (writeRefreshMessage)
  statusLine: ["refreshStatus","","",""],
  headerRow: 2,
  lastRefreshRow: 5,
  frequencyRow: 6,
  units: ["godzin","dni"],
  lastRefreshFormat: "yyyy-mm-dd hh:mm",
  messageStyle: {
    ok:   { background: "#d9ead3", border: "#38761d" },     // light green, green thick border
    fail: { background: "#f4cccc", border: "#cc0000" }      // light red, red thick border
  },
  addedLastRefreshLabel: "Ostatnie odświeżone o:"    // the label of a lastRefresh line added later (differs from the header's, as it always did)
};

const SettingsGrid = {
  /** "2026-11-29 17:00:00 UTC+2" (the zone as an offset: +2, -5, +5:30). */
  stamp(date, timeZone) {
    const off = Utilities.formatDate(date, timeZone, "Z");                         // +0200
    const h = parseInt(off.slice(1, 3), 10), m = off.slice(3);
    return `${Utilities.formatDate(date, timeZone, "yyyy-MM-dd HH:mm:ss")} UTC${off[0]}${h}${m == "00" ? "" : ":" + m}`;
  },

  /** A time of day from what a cell holds: text "17:30" / "5:30 PM", a time value (Date) or a fraction of a day; null when it is none of these. */
  parseTime(v, timeZone) {
    if (v instanceof Date) v = Utilities.formatDate(v, timeZone, "HH:mm");
    else if (typeof v === "number" && v >= 0 && v < 1) { const mins = Math.round(v * 1440); v = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`; }
    const m = /^\s*(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?\s*$/i.exec(String(v));
    if (!m) return null;
    let hour = +m[1];
    const minute = +m[2];
    if (m[3]) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (/^p/i.test(m[3]) ? 12 : 0); }
    return hour < 24 && minute < 60 ? { hour, minute } : null;
  },

  /** "dzień" / "dni" / "h" for the frequency {freq, unit}. */
  unitName(frequency) {
    return frequency.unit == "days" ? (frequency.freq == 1 ? "dzień" : "dni") : "h";
  },

  exists(sheetName) {
    return Grid.exists(sheetName);
  },

  /** Inserts the settings sheet with its header block (one commit). The new sheet becomes the active one, as insertSheet does. */
  create(sheetName) {
    const L = SETTINGS_LAYOUT;
    const grid = Grid.create({ sheetName: sheetName, rows: L.header.length + L.headerRow - 1, cols: L.firstCol + L.cols - 1 });
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
   *   refreshTime()                 {hour, minute} from the refreshTime line (D): "17:30", "5:30 PM", a time value; null when empty, not a time or no such line
   *   writeRefreshMessage(report)   the refreshStatus line (C:E merged): green when the refresh was set up, red when not (see ScheduleRefresh.apply);
   *                                 the refreshTime and refreshStatus lines are added after the refreshFrequency line when the sheet has none
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
    /** The row of the first line with this key in B (0 = none). */
    const keyRow = key => {
      const keys = grid.getRange(1, L.firstCol, Math.max(lastUsedRow(), 1), 1).getValues();
      const i = keys.findIndex(r => r[0] === key);
      return i < 0 ? 0 : i + 1;
    };
    /** A line (4 cells, B..E) after `after`; returns its row. */
    const addLine = (after, line) => {
      grid.insertRowsAfter(after, 1);
      grid.getRange(after + 1, L.firstCol, 1, L.cols).setValues([line]);
      return after + 1;
    };
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
      refreshTime() {
        const row = keyRow("refreshTime");
        return row ? SettingsGrid.parseTime(grid.getRange(row, L.valueCol).getValue(), grid.getTimeZone()) : null;
      },
      writeRefreshMessage(report) {
        const style = L.messageStyle[report.ok ? "ok" : "fail"];
        const stamp = d => SettingsGrid.stamp(d, grid.getTimeZone());
        const lines = report.ok
          ? (report.frequency?.freq && report.next
              ? [`Dane będą odświeżane automatycznie co ${report.frequency.freq} ${SettingsGrid.unitName(report.frequency)}.`,
                 `Następne odświeżenie ${stamp(report.next)}.`]
              : ["Odświeżanie automatyczne jest wyłączone."])
          : ["Ustawienia odświeżania nie zostały zaktualizowane!",
             "Zmień ustawienia, żeby spróbować ponownie lub zobacz szczegóły w menu dodatku: Import z BC -> Ustawienia."];
        lines.push(report.ok ? `Odświeżanie zostało ustawione ${stamp(report.when)}.` : `Próba zmiany ustawień została podjęta ${stamp(report.when)}.`);
        let timeRow = keyRow("refreshTime");
        if (!timeRow) timeRow = addLine(keyRow("refreshFrequency"), L.timeLine);
        let row = keyRow("refreshStatus");
        if (!row) row = addLine(timeRow, L.statusLine);
        grid.getRange(timeRow, L.valueCol).setNumberFormat("@");
        const area = grid.getRange(row, L.firstCol + 1, 1, L.cols - 1);
        area.merge();
        grid.getRange(row, L.firstCol + 1).setValue(lines.join("\n"));
        area.setBackground(style.background);
        area.setWrapStrategy("WRAP");
        area.setBorder(true, true, true, true, null, null, style.border, "SOLID_THICK");
        save();
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
