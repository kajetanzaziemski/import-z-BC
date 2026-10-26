// ---------------------------------------------------------------------------
// ROUTER: from a technical entry point to the action that is actually wanted.
//
// The installable triggers say little: "something was edited" (sheetEdit) or "the structure changed" (sheetChange). What matters to the user is
// what the add-on does about it, and that depends on WHERE and WHAT:
//
//   intent                        when                                                       does
//   config.coedit                 an edit / structure change while a config sheet is active  AnalyseConfig: lines and dropdowns completed
//   settings.refreshFrequency     an edit of the refresh frequency in the settings sheet     ScheduleRefresh: the time trigger is set
//   settings.edit                 any other edit in the settings sheet                       nothing
//   sheet.ignored                 an edit / change in any other sheet                        nothing
//   change.ignored                a change of type EDIT or FORMAT                            nothing
//   agent.skipped                 the trigger is powered off (set by sheetEdit before routing) nothing
//
// routeEdit / routeChange only LOOK (they return a route: { intent, sheet, event }); perform() announces the intent to the live check
// (Controller.intent) and runs the action. Nothing else decides what an edit means.
// Quirk kept from before: the sheet is the ACTIVE sheet, not the sheet of the edited range. Which sheets are config sheets comes from the cache
// (Managed Sheets.js); the settings sheet object is built only for an edit or a change in the settings sheet itself (bugs-todo #10, fixed).
// ---------------------------------------------------------------------------

const ROUTE_ACTIONS_ = {
  "config.coedit": route => AnalyseConfig.run(route.sheet,route.event),
  "settings.refreshFrequency": () => {
    dbgLog("refreshFreqency data editted. Setting new time trigger.");
    getMainSettings().setRefreshTrigger();
  },
  "settings.edit": () => {},
  "sheet.ignored": () => {},
  "change.ignored": () => {}
};

const Router = {
  /** The installable onEdit event -> a route. */
  routeEdit(e){
    const sheet = e.source.getActiveSheet().getName();
    if(sheet == MainSettings.getSettingsSheetName()){
      const settings = getMainSettings();      // the list of config sheets may have changed with this edit: the cache is replaced
      ManagedSheets.store(settings);
      return {intent: settings.isRefreshFrequencyCell(e.range) ? "settings.refreshFrequency" : "settings.edit", sheet: sheet, event: e};
    }
    return {intent: ManagedSheets.isConfigSheet(sheet) ? "config.coedit" : "sheet.ignored", sheet: sheet, event: e};
  },

  /** The installable onChange event -> a route. A structure change carries no event of the cells. */
  routeChange(e){
    if(e.changeType=="EDIT" || e.changeType=="FORMAT") return {intent: "change.ignored", changeType: e.changeType};
    const sheet = e.source.getActiveSheet().getName();
    if(sheet == MainSettings.getSettingsSheetName()){
      ManagedSheets.rebuild();                 // a line inserted or deleted in the settings sheet
      return {intent: "sheet.ignored", sheet: sheet, changeType: e.changeType};
    }
    return {intent: ManagedSheets.isConfigSheet(sheet) ? "config.coedit" : "sheet.ignored", sheet: sheet, changeType: e.changeType};
  },

  /** Announces the intent (live check) and runs what it stands for. */
  perform(route){
    Controller.intent(route.intent,{sheet: route.sheet ?? null, changeType: route.changeType ?? null});
    ROUTE_ACTIONS_[route.intent](route);
    return route;
  },

  edit(e){ return Router.perform(Router.routeEdit(e)); },
  change(e){ return Router.perform(Router.routeChange(e)); }
};
