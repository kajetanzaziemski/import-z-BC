// ---------------------------------------------------------------------------
// SETTINGS: typed access to the add-on's stored settings. Two groups, both unchanged on the storage side (same scopes, keys and JSON):
//
//   import settings (document scope, one StorageObject under "importSettingsArray")
//       Settings.addonStatus() / setAddonStatus(x), settingsSheetName() / setSettingsSheetName(name),
//       refreshPermit() / issueRefreshPermit(triggerId, hours) / updateRefreshPermit(permit) / touchRefreshPermit(triggerId),
//       get(name) / set(name, value)  for the rest
//   BC connection (tenant, environment, company; each in document, user and script scope; the active one is document > user > script)
//       Settings.bc()  -> the GlobalSettings object ("Global Add-on Settings.js")
//
// Only plain reads and writes live here. What the old MainSettings did around them (turning the add-on on registers a status check,
// "on"/"off" are understood, a missing settings sheet name is looked up) stays in MainSettings, which forwards to this file.
// Writes go to the StorageObject and reach the store when the run closes (or saveArray()); see Store.js.
// ---------------------------------------------------------------------------

const IMPORT_SETTINGS_KEY = "importSettingsArray";

const Settings = {
  /** The StorageObject behind the import settings (one per run). */
  store() { return Store.object(IMPORT_SETTINGS_KEY, "document"); },

  get(name) { return Settings.store().getProperty(name); },
  set(name, value) { Settings.store().setProperty(name, value); return Settings; },

  addonStatus() { return Settings.get("addonStatus") ?? false; },
  setAddonStatus(statusOn) { return Settings.set("addonStatus", statusOn); },

  settingsSheetName() { return Settings.get("importSheetName"); },
  setSettingsSheetName(name) { return Settings.set("importSheetName", name); },

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
  touchRefreshPermit(triggerUid) {
    const current = Settings.store().getFreshProperty("refreshPermit");
    if (!current || current.issuedFor !== triggerUid) return false;
    current.lastRun = Date.now();
    Settings.updateRefreshPermit(current);
    return true;
  },

  /** Tenant, environment and company of Business Central (one object per run). */
  bc() { return Settings._bc || (Settings._bc = new GlobalSettings()); }
};
