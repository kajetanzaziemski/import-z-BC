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
  /** The menu path the failure message sends the user to; bold in the sheet (rich text) and in the sidebar. */
  messagePath: "Import z BC -> Ustawienia",

  /** The sentence for a set-up that failed because Apps Script refuses one more clock trigger (a user may have 5 of them for an add-on); the list of the files the user refreshes is in the same tab. */
  triggerLimitText: "Możesz odświeżać automatycznie najwyżej 5 plików. Zobacz listę aktualnie odświeżanych arkuszy poniżej.",

  /** What the sidebar advises first when it shows a failed set-up that was not made by its own button yet. */
  retryAdvice: "Spróbuj ponownie używając przycisku poniżej.",

  /** The same for the settings sheet, where there is no list below: it points to the menu instead (the path follows on the next line, in bold). */
  triggerLimitSheetText: "Możesz odświeżać automatycznie najwyżej 5 plików. Zobacz szczegóły w menu dodatku:",

  /**
   * The lines of the status message for a report ({ ok, off, when, frequency, next, current, limit, advise }); `stamp` writes a time. Used for the message in the settings sheet
   * and, `brief`, for the error shown in the sidebar.
   */
  messageLines(report, stamp, brief) {
    const status = c => c && c.active
      ? [`Dane będą odświeżane automatycznie co ${c.frequency.freq} ${SettingsGrid.unitName(c.frequency)}.`, `Następne odświeżenie ${stamp(c.next)}.`]
      : ["Odświeżanie automatyczne jest wyłączone."];
    if (report.off) return ["Odświeżanie automatyczne jest wyłączone.", `Odświeżanie zostało wyłączone ${stamp(report.when)}.`];
    if (report.ok) {
      return [`Dane będą odświeżane automatycznie co ${report.frequency.freq} ${SettingsGrid.unitName(report.frequency)}.`,
              `Następne odświeżenie ${stamp(report.next)}.`,
              `Odświeżanie zostało ustawione ${stamp(report.when)}.`];
    }
    // brief (the sidebar): the headline, the sentence about the limit of clock triggers when that was the cause, and the time of the attempt - nothing about what is
    // set now (the sidebar shows that itself) and no pointer to the menu (the user is looking at the add-on)
    // `advise` (the first time the sidebar shows this error): first of all, try again with the button of the sidebar; once the button was used and the error came again, the plain message
    // the sentence about the limit of clock triggers comes with the plain message (after the retry), not with the first one: that only advises to try again
    if (brief) return ["Ustawienia odświeżania nie zostały zaktualizowane!",
                       ...(report.advise ? [SettingsGrid.retryAdvice] : []),
                       ...(report.limit && !report.advise ? [SettingsGrid.triggerLimitText] : []),
                       `Próba zmiany ustawień została podjęta ${stamp(report.when)}.`];
    return ["Ustawienia odświeżania nie zostały zaktualizowane!",
            ...(report.current ? status(report.current) : []),
            // the limit of clock triggers has its own pointer to the menu in the place of the general one
            report.limit ? SettingsGrid.triggerLimitSheetText : "Zmień ustawienia, żeby spróbować ponownie lub zobacz szczegóły w menu dodatku:",
            SettingsGrid.messagePath + ".",
            `Próba zmiany ustawień została podjęta ${stamp(report.when)}.`];
  },

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

  /** The offset of the zone at that moment, in minutes (Utilities.formatDate "Z" gives "+0200"). */
  offsetMinutes(date, timeZone) {
    const z = Utilities.formatDate(date, timeZone, "Z");
    return (z[0] == "-" ? -1 : 1) * (parseInt(z.slice(1, 3), 10) * 60 + parseInt(z.slice(3), 10));
  },

  /** "UTC+5:30" -> 330; null when the text is not such a label. */
  parseOffsetName(text) {
    const m = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(String(text ?? "").trim());
    return m ? (m[1] == "-" ? -1 : 1) * (+m[2] * 60 + (m[3] ? +m[3] : 0)) : null;
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
   *   retime(plan)                  makes the zone labels of lastRefresh and refreshTime (column E) read what they should for the spreadsheet's zone now - judged from the labels in the sheet;
   *                                 plan({zoneChanged, lastKnown, fromOffset, toOffset}) may give a function that converts the time of day of refreshTime; when the zone changed the time of
   *                                 the last refresh is put right too (it is a moment: the cell kept the wall clock of the old zone); returns { changed, zoneChanged, from, to, lastRefresh }
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
      retime(plan) {
        const tz = grid.getTimeZone(), now = new Date();
        const lastRow = keyRow("lastRefresh"), timeRow = keyRow("refreshTime");
        const isDate = t => Object.prototype.toString.call(t) === "[object Date]" && !isNaN(t);
        const lastValue = lastRow ? grid.getRange(lastRow, L.valueCol).getValue() : null;
        const lastDate = isDate(lastValue) ? lastValue : null;
        const label = row => String(grid.getRange(row, L.unitCol).getValue() ?? "").trim();
        // What the SHEET says decides: the zone labels as they stand against what they should read for the zone the spreadsheet is in now.
        // lastRefresh holds a moment, so its label is the zone's offset AT THAT MOMENT: it differs only when the zone itself changed.
        // refreshTime is a time of day, labelled with the offset of now: it also differs when the daylight saving time began or ended.
        const lastLabel = lastDate ? label(lastRow) : null;
        // A lastRefresh label that is no UTC+N (an older version wrote the zone's short name, "CET", or there is none) says nothing about the zone it was written in: the line is left
        // as it is, label and time (the next refresh writes it again, in UTC+N). Only a UTC+N label that differs from the zone now is a change of the zone.
        const lastMismatch = !!lastDate && SettingsGrid.parseOffsetName(lastLabel) !== null && lastLabel !== SettingsGrid.offsetName(lastDate, tz);
        const zoneChanged = lastMismatch;
        const timeLabel = timeRow ? label(timeRow) : null;
        const timeMismatch = !!timeRow && timeLabel !== SettingsGrid.offsetName(now, tz);
        if (!lastMismatch && !timeMismatch) return { changed: false };
        // A cell keeps the wall-clock number, not the moment: after a change of the zone the time of the last refresh reads the same but is a different moment. The label says in
        // which zone it was written, so the moment is put right: the wall reading minus the old offset, written back (the sheet shows it in the new zone).
        let lastFixed = null;
        if (zoneChanged) {
          const wallMs = lastDate.getTime() + SettingsGrid.offsetMinutes(lastDate, tz) * 60000;
          lastFixed = new Date(wallMs - SettingsGrid.parseOffsetName(lastLabel) * 60000);
        }
        const at = timeRow ? SettingsGrid.parseTime(grid.getRange(timeRow, L.valueCol).getValue(), tz) : null;
        const convert = at && plan ? plan({ zoneChanged: zoneChanged, lastKnown: !!lastDate, fromOffset: SettingsGrid.parseOffsetName(timeLabel), toOffset: SettingsGrid.offsetMinutes(now, tz) }) : null;
        const to = convert ? convert(at) : null;
        if (lastFixed) grid.getRange(lastRow, L.valueCol).setValue(lastFixed);
        if (lastMismatch) grid.getRange(lastRow, L.unitCol).setValue(SettingsGrid.offsetName(lastFixed ?? lastDate, tz));
        if (timeMismatch) grid.getRange(timeRow, L.unitCol).setValue(SettingsGrid.offsetName(now, tz));
        if (to) grid.getRange(timeRow, L.valueCol).setValue((to.hour * 60 + to.minute) / 1440);     // a time of day is a fraction of a day, shown by the cell's HH:mm
        save();
        return { changed: true, zoneChanged: zoneChanged, from: at, to: to, lastRefresh: lastFixed };
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
        const where = SettingsGrid.messagePath;
        const lines = SettingsGrid.messageLines(report, d => SettingsGrid.stamp(d, grid.getTimeZone()));
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
