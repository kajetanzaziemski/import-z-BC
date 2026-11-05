// ---------------------------------------------------------------------------
// SETTINGS GRID: the only place that knows the LAYOUT of the import settings sheet ("Ustawienia importu") and touches it.
//
//   row 2      column labels (B..E)
//   row 3 ...  configSheet lines: B "configSheet", C config sheet, D result sheet, E checkbox "refresh automatically".
//              The list STARTS at row 3: a new line is inserted after the last configSheet line (after row 2 while there is none), so
//              the first one takes row 3 and everything that stood below moves down. Row 3 of a freshly made sheet is the empty slot for it.
//   below the list (rows 4-8 of a sheet with no config line yet; they move down with every config line added):
//              headerGeneralSettings
//              lastRefresh: D = time of the last refresh (date format), E = the time zone's name
//              refreshFrequency: D = number, E = unit (godzin / dni, a dropdown)
//              refreshTime: D = the time of day to refresh at ("17:30" / "5:30 PM"), E = the time zone it is in (the spreadsheet's, as UTC+2)
//              refreshStatus: C:E merged = the message about the last change of the refresh settings (green / red)
//
// Rows are NEVER addressed by number outside a fresh sheet: every line is found by the key in column B (SettingsSheet.readSheetList, keyRow below).
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
  header: [                                // rows 2-8, from column B: the column labels, the empty slot for the first configSheet line (row 3), the general settings block
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
  timeRow: 7,
  units: ["godzin","dni"],
  lastRefreshFormat: "yyyy-mm-dd hh:mm",
  messageStyle: {
    ok:   { background: "#d9ead3", border: "#38761d" },     // light green, green thick border
    off:  { background: "#fff2cc", border: "#f1c232" },     // light yellow, yellow thick border: the trigger is not there
    fail: { background: "#f4cccc", border: "#cc0000" }      // light red, red thick border
  },
  addedLastRefreshLabel: "Ostatnie odświeżone o:"    // the label of a lastRefresh line added later (differs from the header's, as it always did)
};

const SettingsGrid = {
  /** The look of the cell the refresh time is typed in (D of the refreshTime line): HH:mm, right aligned. Set when the line is made and left to the user after. */
  styleTime(range) {
    range.setNumberFormat("HH:mm");
    range.setHorizontalAlignment("right");
  },

  /** A time zone as it is shown everywhere in the settings sheet: UTC+2, UTC-5, UTC+5:30, UTC+0 (the offset at that moment). */
  offsetName(date, timeZone) {
    const off = Utilities.formatDate(date, timeZone, "Z");                         // +0200
    const h = parseInt(off.slice(1, 3), 10), m = off.slice(3);
    return `UTC${off[0]}${h}${m == "00" ? "" : ":" + m}`;
  },

  /** "2026-11-29 17:00:00 UTC+2" */
  stamp(date, timeZone) {
    return `${Utilities.formatDate(date, timeZone, "yyyy-MM-dd HH:mm:ss")} ${SettingsGrid.offsetName(date, timeZone)}`;
  },

  /**
   * A time of day from what a cell holds. Text: "17:30", "17", "5:30 PM", "5 pm". A time value (Date, what a cell in HH:mm gives); a fraction of a day.
   * A bare whole number 0..23 is the hour: typed "17" into a cell in HH:mm the sheet stores 17 (days), which reads back as the 17th day after the
   * zero date at midnight (or the number 17). null when it is none of these.
   */
  parseTime(v, timeZone) {
    if (Object.prototype.toString.call(v) === "[object Date]") {
      const days = Math.round((Date.parse(Utilities.formatDate(v, timeZone, "yyyy-MM-dd") + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000);
      const hhmm = Utilities.formatDate(v, timeZone, "HH:mm");
      v = days === 0 ? hhmm : (hhmm === "00:00" ? days : null);
    }
    if (typeof v === "number") {
      if (v >= 0 && v < 1) { const mins = Math.round(v * 1440); v = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`; }
      else v = Number.isInteger(v) && v < 24 ? `${v}:00` : null;
    }
    const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?\s*$/i.exec(String(v ?? ""));
    if (!m) return null;
    let hour = +m[1];
    const minute = m[2] ? +m[2] : 0;
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
    SettingsGrid.styleTime(grid.getRange(L.timeRow, L.valueCol));
    grid.getRange(L.timeRow, L.unitCol).setValue(SettingsGrid.offsetName(new Date(), grid.getTimeZone()));
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
   *   refreshTime()                 {hour, minute, timeZone} from the refreshTime line (D): "17:30", "5:30 PM", a time value; null when empty, not a time or no such line
   *   clearRefreshSettings()        the frequency number and the time of day cleared (D of refreshFrequency and refreshTime; the unit and the zone label stay)
   *   restoreTimeZoneLabel(previous)  the zone label (E of refreshTime) back to `previous`, or to the zone as it is now when that is null
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
      if (!after) throw new Error("Settings sheet: no line to put the new one under");
      grid.insertRowsAfter(after, 1, { plain: true });         // no data validation from the line above (the godzin / dni list of refreshFrequency)
      grid.getRange(after + 1, L.firstCol, 1, L.cols).setValues([line]);
      if (line[0] === "refreshTime") SettingsGrid.styleTime(grid.getRange(after + 1, L.valueCol));     // once, when the line is made; never touched again
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
        const at = row ? SettingsGrid.parseTime(grid.getRange(row, L.valueCol).getValue(), grid.getTimeZone()) : null;
        return at && { hour: at.hour, minute: at.minute, timeZone: grid.getTimeZone() };      // the time is in the spreadsheet's time zone
      },
      clearRefreshSettings() {
        ["refreshFrequency", "refreshTime"].forEach(key => { const row = keyRow(key); if (row) grid.getRange(row, L.valueCol).setValue(""); });
        save();
      },
      restoreTimeZoneLabel(previous) {
        const row = keyRow("refreshTime");
        if (!row) return;
        grid.getRange(row, L.unitCol).setValue(previous ?? SettingsGrid.offsetName(new Date(), grid.getTimeZone()));
        save();
      },
      writeRefreshMessage(report) {
        const style = L.messageStyle[report.off ? "off" : report.ok ? "ok" : "fail"];
        const stamp = d => SettingsGrid.stamp(d, grid.getTimeZone());
        const status = c => c && c.active
          ? [`Dane będą odświeżane automatycznie co ${c.frequency.freq} ${SettingsGrid.unitName(c.frequency)}.`, `Następne odświeżenie ${stamp(c.next)}.`]
          : ["Odświeżanie automatyczne jest wyłączone."];
        const where = "Import z BC -> Ustawienia";
        const lines = report.off
          ? ["Odświeżanie automatyczne jest wyłączone.", `Odświeżanie zostało wyłączone ${stamp(report.when)}.`]
          : report.ok
          ? [`Dane będą odświeżane automatycznie co ${report.frequency.freq} ${SettingsGrid.unitName(report.frequency)}.`,
             `Następne odświeżenie ${stamp(report.next)}.`,
             `Odświeżanie zostało ustawione ${stamp(report.when)}.`]
          : ["Ustawienia odświeżania nie zostały zaktualizowane!",
             ...(report.current ? status(report.current) : []),
             "Zmień ustawienia, żeby spróbować ponownie lub zobacz szczegóły w menu dodatku:",
             where + ".",
             `Próba zmiany ustawień została podjęta ${stamp(report.when)}.`];
        const text = lines.join("\n");
        const at = text.indexOf(where);
        const bold = !report.ok && at >= 0 ? [[at, at + where.length]] : [];
        let timeRow = keyRow("refreshTime");
        if (!timeRow) timeRow = addLine(keyRow("refreshFrequency"), L.timeLine);
        let row = keyRow("refreshStatus");
        if (!row) row = addLine(timeRow, L.statusLine);
        grid.getRange(timeRow, L.unitCol).setValue(SettingsGrid.offsetName(report.when, grid.getTimeZone()));     // the zone the time is in (E of refreshTime)
        const area = grid.getRange(row, L.firstCol + 1, 1, L.cols - 1);
        area.merge();
        grid.getRange(row, L.firstCol + 1).setBoldRuns(text, bold);
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
        const zone = SettingsGrid.offsetName(time, grid.getTimeZone());
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
