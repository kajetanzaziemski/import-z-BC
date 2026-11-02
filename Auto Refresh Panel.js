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
// The page polls getAutoRefreshInfo() every couple of seconds: it only reads and is not wrapped in Controller.run (like the live check sidebar's polling,
// docs/controller.md). The button calls applyRefreshSettings(), which is an ordinary run.
// ---------------------------------------------------------------------------

const AutoRefreshPanel = {
  info(now = new Date()){
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const stamp = ms => ms ? SettingsGrid.stamp(new Date(ms), tz) : null;
    const permit = MainSettings.getRefreshPermit();
    const current = ScheduleRefresh.current(now);

    const out = {zone: SettingsGrid.offsetName(now, tz), current: null, last: null, sheet: null, error: current === null};
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
    return out;
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

  /** The button: the same as editing the frequency in the settings sheet (job settings.refreshApply for the live check). */
  apply(){
    Controller.intent("settings.refreshApply",{sheet: null, changeType: null});
    getMainSettings().setRefreshTrigger();
  }
};

/** Polled by the sidebar (read only, not wrapped on purpose). */
function getAutoRefreshInfo(){
  return AutoRefreshPanel.info();
}

/** Sidebar button "Ustaw wg. danych w arkuszu". */
function applyRefreshSettings(){
  return Controller.run("requestApplyRefreshSettings",() => AutoRefreshPanel.apply());
}
