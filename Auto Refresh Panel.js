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
    // nothing set by this version: a sheet of the legacy era is judged from the sheet itself (a guess, marked `legacy`)
    let current = ScheduleRefresh.current(now);
    if(current && !current.active) current = ScheduleRefresh.legacyCurrent(now) ?? current;

    const out = {zone: SettingsGrid.offsetName(now, tz), current: null, last: null, sheet: null, error: current === null, diag: ScheduleRefresh.explain(now)};
    if(current?.active){
      out.current = {
        foreign: current.foreign,
        every: `${current.frequency.freq} ${SettingsGrid.unitName(current.frequency)}`,
        startAt: current.startAt,
        next: stamp(current.next.getTime())
      };
      if(current.legacy) out.current.legacy = true;
    }
    if(permit?.lastRun){
      out.last = {
        at: stamp(permit.lastRun),
        duration: AutoRefreshPanel.duration(permit.lastDurationMs),
        sheets: Array.isArray(permit.lastSheets) ? permit.lastSheets : null
      };
    }
    // the trigger fired after the last completed run: a run in progress, cut off by the platform or failed (the permit's `lastFired` is the first stamp of a run, `lastRun` the second)
    if(permit?.lastFired && permit.lastFired > (permit.lastRun ?? 0)) out.attempt = {at: stamp(permit.lastFired)};
    out.setupError = AutoRefreshPanel.setupError_(tz);
    out.sheet = AutoRefreshPanel.fromSheet_(now, tz, current, stamp);
    out.triggers = AutoRefreshPanel.triggerList_(now, tz, permit, current);
    return out;
  },

  /**
   * The last set-up of the automatic refresh that failed, for the sidebar: only the headline of the red message of the settings sheet and the time of the attempt (with the
   * sentence about the limit of clock triggers between them when that was the cause) - not what is set now, the sidebar shows that itself - and the platform's error for the
   * collapsed "Szczegóły błędu". The first time (the set-up was made by an edit, not by the sidebar's button) it begins with the advice to try again with the button below;
   * an error that came from the button itself is shown plainly. null when the last set-up went right.
   */
  setupError_(tz){
    try{
      const e = Settings.refreshSetupError();
      if(!e) return null;
      const stamp = ms => SettingsGrid.stamp(new Date(ms), tz);
      const current = e.current && Object.assign({}, e.current, {next: e.current.next ? new Date(e.current.next) : null});
      const lines = SettingsGrid.messageLines({ok: false, when: e.at, current: current, limit: !!e.limit, advise: !e.retried}, d => SettingsGrid.stamp(Object.prototype.toString.call(d) === "[object Date]" ? d : new Date(d), tz), true);
      return {lines: lines, limit: !!e.limit, retried: !!e.retried, details: e.details ?? "", at: stamp(e.at)};
    }catch(err){
      dbgLog(`Auto refresh panel: set-up error not read: ${err}`);
      return null;
    }
  },

  /**
   * ALL of the user's time triggers (clock triggers of every document the add-on is used in), each with what is known about it: the registry's record
   * (Refresh Registry.js) or, for any other trigger, only what the trigger itself says (its id and handler: ScriptApp gives a time trigger no interval, no
   * document, no last run). For THIS document the document's permit (document properties) fills in what the user's record lacks and brings it up to date.
   * The last refresh the record and the permit leave empty is read from THIS spreadsheet's settings sheet (readSpreadsheet_, lastRefresh line only): the last resort.
   * Other documents are never opened.
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
        const hours = rec?.intervalHours, days = hours && hours % 24 === 0;
        const zone = rec?.docTz || fill?.tz || tz;
        const every = !hours ? null : `${days ? hours / 24 : hours} ${SettingsGrid.unitName({freq: days ? hours / 24 : hours, unit: days ? "days" : "hrs"})}`
          + (rec.startAt ? ` o ${rec.startAt}` : "") + (rec.startAt && rec.timeZone ? ` (${AutoRefreshPanel.zoneName_(rec.timeZone,now)})` : "");
        const lastRun = rec?.lastRun ?? fill?.lastRun;
        return {
          id: id,
          handler: handler,
          known: !!rec?.docName || !!rec?.docId,
          here: !!rec?.docId && rec.docId === doc.docId || (!!permit?.issuedFor && permit.issuedFor === id),
          name: rec?.docName ?? null,
          url: AutoRefreshPanel.safeUrl_(rec?.url, rec?.gid),
          every: every,
          last: lastRun ? SettingsGrid.stamp(new Date(lastRun), zone) : null,
          lastFromSheet: !rec?.lastRun && !!fill?.lastRun,
          duration: AutoRefreshPanel.duration(rec?.lastDurationMs),
          next: rec?.nextRefresh ? SettingsGrid.stamp(new Date(rec.nextRefresh), zone) : null
        };
      };
      const items = seen.map(t => {
        const rec = RefreshRegistry.get(t.getUniqueId());
        const fill = rec?.docId && rec.docId === doc.docId && !rec.lastRun ? AutoRefreshPanel.readSpreadsheet_(rec) : null;
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
   * The last refresh of THIS document as its settings sheet says it (lastRefresh line, D), for a record that has none. The sheet is found by its id (the record's
   * `gid`), else by its header (B2 "Opis linii"). Only the active spreadsheet is read, only that one value; null when there is none. Read only.
   * @returns {{lastRun: number, tz: string}|null}
   */
  readSpreadsheet_(rec){
    try{
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheets = ss.getSheets();
      const sheet = (Number.isInteger(rec?.gid) && sheets.find(sh => sh.getSheetId() === rec.gid)) || sheets.find(sh => sh.getRange(2,2).getValue() === "Opis linii");
      if(!sheet || sheet.getLastRow() < 1) return null;
      const last = sheet.getRange(1,2,sheet.getLastRow(),4).getValues().find(r => r[0] === "lastRefresh")?.[2];
      if(Object.prototype.toString.call(last) !== "[object Date]" || isNaN(last)) return null;
      return {lastRun: last.getTime(), tz: ss.getSpreadsheetTimeZone()};
    }catch(err){
      dbgLog(`Auto refresh panel: the last refresh not read from the spreadsheet: ${err}`);
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
        differs: !current?.active || !!current.legacy || current.intervalHours !== hours || (current.startAt ?? null) !== atText
      };
    }catch(err){
      dbgLog(`Auto refresh panel: settings sheet not read: ${err}`);
      return {available: false, error: String(err && err.message || err)};
    }
  },

  /** The list of the user's time triggers alone (the developer tools sidebar): the same entries as the tab's list, with the zone. */
  triggersOnly(now = new Date()){
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const permit = MainSettings.getRefreshPermit();
    return {zone: SettingsGrid.offsetName(now, tz), triggers: AutoRefreshPanel.triggerList_(now, tz, permit, ScheduleRefresh.current(now))};
  },

  /**
   * Developer tools: deletes the time trigger with this id and NOTHING ELSE - the permit, the user's record, the cache and the settings sheet are left as they are,
   * on purpose: this is how to test what the add-on does when a trigger goes missing. Only time triggers can be deleted here (never an agent).
   */
  forceDeleteTrigger(triggerId){
    ScheduleRefresh.forceDelete(triggerId);
  },

  /** The explanation for a user who does not see this document in the list because another user's trigger refreshes it. */
  showWhyDialog(){
    const text = REFRESH_WHY_MESSAGE.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const html = HtmlService.createHtmlOutput(`<div style="font-family:Arial,sans-serif;font-size:13px;padding:8px">${text}</div>`).setWidth(380).setHeight(150);
    SpreadsheetApp.getUi().showModelessDialog(html,REFRESH_WHY_TITLE);
  },

  /**
   * "Wyłącz autoodświeżanie": the refresh is switched off on purpose. The frequency and the time of day are cleaned in the sheet, then the same set-up as after
   * an edit runs - it finds no frequency, removes the trigger, marks the permit off and writes the yellow "wyłączone" message.
   */
  turnOff(){
    Controller.intent("settings.refreshOff",{sheet: null, changeType: null});
    const settings = getMainSettings();
    settings.clearRefreshSettings();
    settings.setRefreshTrigger();
  },

  /** The button: the same as editing the frequency in the settings sheet (job settings.refreshApply for the live check). */
  apply(){
    Controller.intent("settings.refreshApply",{sheet: null, changeType: null});
    ScheduleRefresh.byButton_ = true;          // an error of this set-up is an error of the retry the sidebar advised: it is shown plainly, without the advice
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

/** Developer tools sidebar: the user's time triggers. Read only. */
function getRefreshTriggerList(){
  DeveloperTools.require();
  return Controller.run("requestRefreshTriggerList",() => AutoRefreshPanel.triggersOnly());
}

/** Developer tools sidebar, "Usuń trigger": deletes the time trigger, no cleanup of any kind (see AutoRefreshPanel.forceDeleteTrigger). */
function forceDeleteRefreshTrigger(triggerId){
  DeveloperTools.require();
  Controller.checkInput("requestForceDeleteTrigger",{id: triggerId});
  return Controller.run("requestForceDeleteTrigger",() => AutoRefreshPanel.forceDeleteTrigger(triggerId));
}

/** Sidebar button "Wyłącz autoodświeżanie". */
function turnOffRefresh(){
  return Controller.run("requestTurnOffRefresh",() => AutoRefreshPanel.turnOff());
}

/** Sidebar button "Ustaw wg. danych w arkuszu". */
function applyRefreshSettings(){
  return Controller.run("requestApplyRefreshSettings",() => AutoRefreshPanel.apply());
}
