// ---------------------------------------------------------------------------
// MANAGED SHEETS: which sheets of the document are config sheets - kept in the document cache, so that an edit or a structure change in an unrelated sheet is
// recognised as such without building the settings sheet object (which reads the whole settings sheet; bugs-todo #10).
//
// The entry { settings: <name of the settings sheet>, configs: [<config sheet names>] } is
//   - filled when the document opens (warmUp), where the add-on is ON and the script is authorised,
//   - replaced whenever the settings sheet object exists anyway and the list may have changed: an edit or a structure change in the settings sheet (Router.js),
//     a config line added by the wizard (SettingsSheet.addNewSheetInfo),
//   - dropped after MANAGED_SHEETS_TTL seconds (the safety net: a list changed while the triggers were off), and not used when it was made for another settings sheet name.
// Without the cache (not filled, expired, no cache service) the settings sheet object is built and the list cached - the add-on works as it did, just slower.
// ---------------------------------------------------------------------------

const MANAGED_SHEETS_KEY = "managedSheets";
const MANAGED_SHEETS_TTL = 3600;     // seconds

const ManagedSheets = {
  /** The names of the config sheets: from the cache when it is there and was made for the current settings sheet, else read from the settings sheet (and cached). */
  configSheets(){
    const cached = ManagedSheets.read_();
    if(cached && cached.settings === MainSettings.getSettingsSheetName()) return cached.configs;
    return ManagedSheets.rebuild().configs;
  },

  isConfigSheet(sheetName){
    return ManagedSheets.configSheets().includes(sheetName);
  },

  /** Builds the settings sheet object, caches its list of config sheets and returns the entry. */
  rebuild(){
    return ManagedSheets.store(getMainSettings());
  },

  /** Caches the list of config sheets of a settings sheet object that exists already. */
  store(settingsSheet){
    const entry = {settings: MainSettings.getSettingsSheetName(), configs: settingsSheet.getConfigSheetNames()};
    Store.optional.setCache("document",MANAGED_SHEETS_KEY,JSON.stringify(entry),MANAGED_SHEETS_TTL);
    return entry;
  },

  /** When the document opens: fills the cache if there is a settings sheet (never creates one). A failure is only logged: the cache is optional. */
  warmUp(){
    try{
      const name = MainSettings.getSettingsSheetName();
      if(!name || !Grid.exists(name)) return;
      ManagedSheets.rebuild();
    }
    catch(e){
      dbgLog("ManagedSheets.warmUp failed: "+e);
    }
  },

  read_(){
    const raw = Store.optional.getCache("document",MANAGED_SHEETS_KEY);
    if(!raw) return null;
    try{ return JSON.parse(raw); } catch(e) { return null; }
  }
};
