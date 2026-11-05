// ---------------------------------------------------------------------------
// AUTO REFRESH PANEL (use case): what the "Auto-odświeżanie" tab of the configuration sidebar shows and does.
//
//   AutoRefreshPanel.info(now)   everything the tab shows, as plain text / numbers (the page only puts it on the screen):
//                                current   what is really set: the trigger the refresh permit names (ScheduleRefresh.current); `foreign` when the permit
//                                          names a trigger that is not among this user's but was used lately (another user's trigger, the numbers are the permit's)
//                                last      the last scheduled run the permit remembers: time, how long it took, the result sheets it refreshed
//                                sheet     what the settings sheet says (frequency, time of day) and what setting it up would give; `differs` when that is not what is set
//   AutoRefreshPanel.apply()     sets the trigger up from the settings sheet, as editing the frequency there does (ScheduleRefresh.apply)
//
// The page calls getAutoRefreshInfo() when the tab is opened, when its refresh button is pressed and after the settings were applied (no polling: a poll
// every couple of seconds cost an execution each and a Sheets API read each, and the trigger list of such calls was seen to be incomplete). Both entry points
// are ordinary runs; getAutoRefreshInfo only reads.
// ---------------------------------------------------------------------------

const AutoRefreshPanel = {
  info(now = new Date()){
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const stamp = ms => ms ? SettingsGrid.stamp(new Date(ms), tz) : null;
    const permit = MainSettings.getRefreshPermit();
    const current = ScheduleRefresh.current(now);

    const out = {zone: SettingsGrid.offsetName(now, tz), current: null, last: null, sheet: null, error: current === null, diag: ScheduleRefresh.explain(now)};
    if(current?.active){
      out.current = {
        foreign: current.foreign,
        every: `${current.frequency.freq} ${SettingsGrid.unitName(current.frequency)}`,
        startAt: current.startAt,
        next: stamp(current.next.getTime())
      };
    }
    if(permit?.lastRun){
      out.last = {
        at: stamp(permit.lastRun),
        duration: AutoRefreshPanel.duration(permit.lastDurationMs),
        sheets: Array.isArray(permit.lastSheets) ? permit.lastSheets : null
      };
    }
    out.sheet = AutoRefreshPanel.fromSheet_(now, tz, current, stamp);
    out.triggers = AutoRefreshPanel.triggerList_(now, tz, permit, current);
    return out;
  },

  /**
   * ALL of the user's time triggers (clock triggers of every document the add-on is used in), each with what is known about it: the registry's record
   * (Refresh Registry.js) or, for any other trigger, only what the trigger itself says (its id and handler: ScriptApp gives a time trigger no interval, no
   * document, no last run). For THIS document the document's permit (document properties) fills in what the user's record lacks and brings it up to date.
   * What the record and the permit leave empty is read from the spreadsheet itself (readSpreadsheet_): the last refresh and the frequency / time of day as its
   * settings sheet has them. That is the last resort, used field by field only where the other sources have nothing (the sheet says what is wanted, not what is set).
   * A trigger of ANOTHER user that refreshes this document is not listed (it is not this user's): the tab says so in a note with a dialog (REFRESH_WHY_MESSAGE).
   * Sorted: known by document name, unknown last.
   * @returns {{items: Array, error: string|null}}
   */
  triggerList_(now, tz, permit, current){
    try{
      const seen = ScheduleRefresh.triggersSeen_().filter(t => String(t.getEventType()) == "CLOCK");
      const ids = seen.map(t => t.getUniqueId());
      const own = !!permit?.issuedFor && ids.includes(permit.issuedFor);
      try{ if(own) RefreshRegistry.syncFromPermit(permit); RefreshRegistry.markSeen(ids,now.getTime()); }
      catch(err){ dbgLog(`Refresh trigger records not kept up to date: ${err}`); }
      const doc = RefreshRegistry.document_();
      const item = (id, handler, rec, fill) => {
        const hours = rec?.intervalHours ?? fill?.intervalHours, days = hours && hours % 24 === 0;
        const startAt = rec?.intervalHours ? rec.startAt : fill?.startAt;
        const zone = rec?.docTz || fill?.tz || tz;
        const every = !hours ? null : `${days ? hours / 24 : hours} ${SettingsGrid.unitName({freq: days ? hours / 24 : hours, unit: days ? "days" : "hrs"})}`
          + (startAt ? ` o ${startAt}` : "") + (rec?.intervalHours && startAt && rec.timeZone ? ` (${AutoRefreshPanel.zoneName_(rec.timeZone,now)})` : "");
        const lastRun = rec?.lastRun ?? fill?.lastRun;
        return {
          id: id,
          handler: handler,
          known: !!rec?.docName || !!rec?.docId,
          here: !!rec?.docId && rec.docId === doc.docId || (!!permit?.issuedFor && permit.issuedFor === id),
          name: rec?.docName ?? null,
          url: AutoRefreshPanel.safeUrl_(rec?.url, rec?.gid),
          every: every,
          everyFromSheet: !rec?.intervalHours && !!hours,
          last: lastRun ? SettingsGrid.stamp(new Date(lastRun), zone) : null,
          lastFromSheet: !rec?.lastRun && !!fill?.lastRun,
          duration: AutoRefreshPanel.duration(rec?.lastDurationMs),
          next: rec?.nextRefresh ? SettingsGrid.stamp(new Date(rec.nextRefresh), zone) : null
        };
      };
      const reads = {others: 0, started: Date.now()};
      const items = seen.map(t => {
        const rec = RefreshRegistry.get(t.getUniqueId());
        const fill = rec?.docId && (!rec.intervalHours || !rec.lastRun) ? AutoRefreshPanel.readSpreadsheet_(rec, doc.docId, reads) : null;
        return item(t.getUniqueId(), t.getHandlerFunction(), rec, fill);
      });
      items.sort((a, b) => (b.known - a.known) || String(a.name ?? "").localeCompare(String(b.name ?? "")) || a.id.localeCompare(b.id));
      return {items: items, error: null};
    }catch(err){
      dbgLog(`Auto refresh panel: trigger list not read: ${err}`);
      return {items: [], error: String(err && err.message || err)};
    }
  },

  /**
   * The settings sheet of a document read from the document itself, for what the user's record has no value for: the last refresh (lastRefresh line, D) and
   * the frequency (refreshFrequency line: D number, E godzin / dni) with the time of day (refreshTime line, D). The sheet is found by its id (the record's `gid`),
   * else by its header (B2 "Opis linii"). Other documents are opened by id (at most 8 and about 15 s per listing; the reading is kept 60 s in the user cache);
   * a document that cannot be opened or read gives null. Read only.
   * @returns {{lastRun: number|null, intervalHours: number|null, startAt: string|null, tz: string}|null}
   */
  readSpreadsheet_(rec, hereId, reads){
    try{
      const cacheKey = `refreshDocRead:${rec.docId}`;
      const here = rec.docId === hereId;
      if(!here){
        try{ const cached = Store.cache.get("user",cacheKey); if(cached) return JSON.parse(cached); }catch(err){}
        if(reads.others >= 8 || Date.now() - reads.started > 15000) return null;
        reads.others++;
      }
      const ss = here ? SpreadsheetApp.getActiveSpreadsheet() : SpreadsheetApp.openById(rec.docId);
      const sheets = ss.getSheets();
      const sheet = (Number.isInteger(rec.gid) && sheets.find(sh => sh.getSheetId() === rec.gid)) || sheets.find(sh => sh.getRange(2,2).getValue() === "Opis linii");
      if(!sheet || sheet.getLastRow() < 1) return null;
      const tz = ss.getSpreadsheetTimeZone();
      const rows = sheet.getRange(1,2,sheet.getLastRow(),4).getValues();
      const line = key => rows.find(r => r[0] === key);
      const out = {lastRun: null, intervalHours: null, startAt: null, tz: tz};
      const last = line("lastRefresh")?.[2];
      if(Object.prototype.toString.call(last) === "[object Date]" && !isNaN(last)) out.lastRun = last.getTime();
      const freq = line("refreshFrequency");
      const n = Number(freq?.[2]), unit = freq?.[3];
      if(Number.isInteger(n) && n > 0 && (unit == "godzin" || unit == "dni")) out.intervalHours = unit == "dni" ? 24 * n : n;
      const at = out.intervalHours ? SettingsGrid.parseTime(line("refreshTime")?.[2], tz) : null;
      if(at) out.startAt = `${at.hour}:${String(at.minute).padStart(2,"0")}`;
      if(!here) try{ Store.cache.set("user",cacheKey,JSON.stringify(out),60); }catch(err){}
      return out;
    }catch(err){
      dbgLog(`Auto refresh panel: the spreadsheet ${rec?.docId} not read: ${err}`);
      return null;
    }
  },

  /** The address of a spreadsheet (and of its settings sheet) for a link; anything that is not a Google spreadsheet address is dropped. */
  safeUrl_(url, gid){
    if(typeof url != "string" || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(url)) return null;
    const base = url.split("#")[0];
    return Number.isInteger(gid) ? `${base}#gid=${gid}` : base;
  },

  zoneName_(timeZone, now){
    try{ return SettingsGrid.offsetName(now, timeZone); }catch(err){ return timeZone; }
  },

  /** "27 m 11 s", "5 s", "2 h 3 m 4 s"; null when the run did not record it. */
  duration(ms){
    if(typeof ms !== "number" || ms < 0) return null;
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    return [h ? `${h} h` : "", h || m ? `${m} m` : "", `${s} s`].filter(x => x).join(" ");
  },

  /** The settings sheet's wishes: what they would set up and whether that differs from what is set now. Never creates the sheet. */
  fromSheet_(now, tz, current, stamp){
    try{
      const name = MainSettings.getSettingsSheetName();
      if(!name || !SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)) return {available: false};
      const settings = getMainSettings();
      const frequency = settings.getRefreshFrequency();
      const at = settings.getRefreshStartAt();
      const atText = at ? `${at.hour}:${String(at.minute).padStart(2,"0")}` : null;
      if(!frequency?.freq || (frequency.unit != "days" && frequency.unit != "hrs")){
        return {available: true, off: true, differs: !!current?.active};
      }
      const hours = frequency.unit == "days" ? 24 * frequency.freq : frequency.freq;
      const next = ScheduleRefresh.nextRefresh(now, frequency.unit, frequency.freq, at);
      return {
        available: true, off: false,
        every: `${frequency.freq} ${SettingsGrid.unitName(frequency)}`,
        startAt: atText,
        next: stamp(next.getTime()),
        differs: !current?.active || current.intervalHours !== hours || (current.startAt ?? null) !== atText
      };
    }catch(err){
      dbgLog(`Auto refresh panel: settings sheet not read: ${err}`);
      return {available: false, error: String(err && err.message || err)};
    }
  },

  /** The explanation for a user who does not see this document in the list because another user's trigger refreshes it. */
  showWhyDialog(){
    const text = REFRESH_WHY_MESSAGE.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const html = HtmlService.createHtmlOutput(`<div style="font-family:Arial,sans-serif;font-size:13px;padding:8px">${text}</div>`).setWidth(380).setHeight(150);
    SpreadsheetApp.getUi().showModelessDialog(html,REFRESH_WHY_TITLE);
  },

  /** The button: the same as editing the frequency in the settings sheet (job settings.refreshApply for the live check). */
  apply(){
    Controller.intent("settings.refreshApply",{sheet: null, changeType: null});
    getMainSettings().setRefreshTrigger();
  }
};

const REFRESH_WHY_TITLE = "Dlaczego nie widzę tego arkusza?";
const REFRESH_WHY_MESSAGE = "Ten arkusz jest odświeżany automatycznie zgodnie z informacjami w panelu. " +
  "Jeśli nie widzisz go na liście arkuszy oznacza to, że automatyczne odświeżanie jest wykonywane przez innego użytkownika.";

/** Sidebar: the note "Dlaczego nie widzę tego arkusza?" - a modeless dialog (it may later give way to a link to the manual). */
function showRefreshHelp(){
  return Controller.run("requestShowRefreshHelp",() => AutoRefreshPanel.showWhyDialog());
}

/** Sidebar: the tab is opened, the refresh button, after applying. Read only. */
function getAutoRefreshInfo(){
  return Controller.run("requestAutoRefreshInfo",() => AutoRefreshPanel.info());
}

/** Sidebar button "Ustaw wg. danych w arkuszu". */
function applyRefreshSettings(){
  return Controller.run("requestApplyRefreshSettings",() => AutoRefreshPanel.apply());
}
