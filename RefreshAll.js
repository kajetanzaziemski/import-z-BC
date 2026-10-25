// ---------------------------------------------------------------------------
// REFRESH ALL (use case): refresh several config sheets, one after the other, with RefreshSheet.
// Moved here unchanged from Menu.js (refreshAll, refreshAllTrue) and Settings Sheet.js (autoRefreshFunction).
// The first sheet that fails stops the loop and the error goes on to the caller.
// ---------------------------------------------------------------------------

const RefreshAll = {
  /** Every config/result pair of the settings sheet, in the order listed there (menu "refresh all"). */
  all(){
    getMainSettings().getSheetList().forEach(cfg => RefreshSheet.run(cfg.configSheet,cfg.resultSheet));
  },

  /** Only the pairs ticked for automatic refresh. */
  ticked(){
    const list = getMainSettings().getSheetListWithRefreshTrue();
    if(list.length) list.forEach(cfg => RefreshSheet.run(cfg.configSheet,cfg.resultSheet));
  },

  /**
   * What a time-based trigger does: refresh the ticked pairs, then note the time on the settings sheet.
   * Quirk kept: the time is noted also when nothing was ticked; it is not noted when a refresh fails.
   */
  scheduled(){
    RefreshAll.ticked();
    getMainSettings().setLastRefresh(new Date());
  }
};
