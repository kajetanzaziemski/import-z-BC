// ---------------------------------------------------------------------------
// SETTINGS: typed access to the add-on's stored settings. Two groups, both unchanged on the storage side (same scopes, keys and JSON):
//
//   import settings (document scope, one StorageObject under "importSettingsArray")
//       Settings.addonStatus() / setAddonStatus(x), settingsSheetName() / setSettingsSheetName(name),
//       refreshPermit() / issueRefreshPermit(triggerId, hours) / updateRefreshPermit(permit) / touchRefreshPermit(triggerId) / markRefreshFired(triggerId),
//       get(name) / set(name, value)  for the rest
//   BC connection (tenant, environment, company; each in document, user and script scope; the active one is document > user > script)
//       Settings.bc()  -> the GlobalSettings object ("Global Add-on Settings.js")
//
// Only plain reads and writes live here. What the old MainSettings did around them (turning the add-on on registers a status check,
// "on"/"off" are understood, a missing settings sheet name is looked up) stays in MainSettings, which forwards to this file.
// Writes go to the StorageObject and reach the store when the run closes (or saveArray()); see Store.js.
// ---------------------------------------------------------------------------

const IMPORT_SETTINGS_KEY = "importSettingsArray";
const REFRESH_LOG_DEFAULT_NAME = "Dziennik pobrań";

const Settings = {
  /** The StorageObject behind the import settings (one per run). */
  store() { return Store.object(IMPORT_SETTINGS_KEY, "document"); },

  get(name) { return Settings.store().getProperty(name); },
  set(name, value) { Settings.store().setProperty(name, value); return Settings; },

  addonStatus() { return Settings.get("addonStatus") ?? false; },
  setAddonStatus(statusOn) { return Settings.set("addonStatus", statusOn); },

  settingsSheetName() { return Settings.get("importSheetName"); },
  setSettingsSheetName(name) { return Settings.set("importSheetName", name); },

  /** The time zone of the spreadsheet as the add-on last saw it (the sheet's zone labels and the time of day are in it; see ScheduleRefresh.syncTimeZone). */
  lastTimeZone() { return Settings.get("timeZone"); },
  setLastTimeZone(timeZone) { return Settings.set("timeZone", timeZone); },

  /** The sheet the log of the data downloads (menu and automatic refresh) is written to; the default name when none was chosen. */
  logSheetName() { return Settings.get("logSheetName") || REFRESH_LOG_DEFAULT_NAME; },
  setLogSheetName(name) { return Settings.set("logSheetName", name); },

  /** The last set-up of the automatic refresh that failed ({ at, details, limit, current }); null when the last set-up went right (see ScheduleRefresh.recordSetupError_). */
  refreshSetupError() { return Settings.get("refreshSetupError") ?? null; },
  setRefreshSetupError(error) { return Settings.set("refreshSetupError", error); },

  refreshPermit() { return Settings.get("refreshPermit"); },
  /** A permit for one time-based trigger: only that trigger may refresh (the others delete themselves). */
  issueRefreshPermit(issuedForId, intervalHoursValue) {
    return Settings.set("refreshPermit", { issuedFor: issuedForId, lastRefresh: Date.now(), intervalHours: intervalHoursValue });
  },
  updateRefreshPermit(permit) { return Settings.set("refreshPermit", permit); },
  /**
   * Records the run time on the permit, but only if it is still issued for the given trigger.
   * The permit is re-read from the store, as it could have been reissued while the refresh was running.
   */
  touchRefreshPermit(triggerUid, extra) {
    const current = Settings.store().getFreshProperty("refreshPermit");
    if (!current || current.issuedFor !== triggerUid) return false;
    current.lastRun = Date.now();
    if (extra) Object.assign(current, extra);                              // what the run did: lastDurationMs, lastSheets (the side panel shows them)
    if (current.intervalHours && !(extra && extra.nextRefresh)) current.nextRefresh = current.lastRun + current.intervalHours * 3600000;
    Settings.updateRefreshPermit(current);
    return true;
  },

  /**
   * The permit has two stamps for a scheduled run: `lastFired` - the trigger fired and holds the permit (written at once, so a run the platform ends leaves it) - and
   * `lastRun` - the run COMPLETED (touchRefreshPermit). Only when the permit is still issued for the given trigger. Saved straight away (not with the closing actions).
   */
  markRefreshFired(triggerUid) {
    const current = Settings.store().getFreshProperty("refreshPermit");
    if (!current || current.issuedFor !== triggerUid) return false;
    current.lastFired = Date.now();
    Settings.updateRefreshPermit(current);
    Settings.store().saveArray();
    return true;
  },

  /** Tenant, environment and company of Business Central (one object per run). */
  bc() { return Settings._bc || (Settings._bc = new GlobalSettings()); }
};
