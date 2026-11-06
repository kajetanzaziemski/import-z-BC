// ---------------------------------------------------------------------------
// REFRESH ALL (use case): refresh several config sheets, one after the other, with RefreshSheet.
// Moved here unchanged from Menu.js (refreshAll, refreshAllTrue) and Settings Sheet.js (autoRefreshFunction).
// A sheet that fails does not stop the others: every sheet is tried, the failures are collected (and written to the download log, RefreshSheet) and, when the loop is
// done, the FIRST error goes on to the caller (the same error as before for one failing sheet).
// ---------------------------------------------------------------------------

const RefreshAll = {
  /** Every config/result pair of the settings sheet, in the order listed there (menu "refresh all"). */
  all(){
    RefreshLog.run(REFRESH_LOG_SOURCES.all,"Menu: refresh all sheets",
      () => RefreshAll.each_(getMainSettings().getSheetList()));
  },

  /** Refreshes every pair, one after the other. A pair that fails does not stop the rest; the first error is thrown when all were tried. */
  each_(list){
    const errors = [];
    list.forEach((cfg, i) => {
      if(errors.length && errors[errors.length - 1] instanceof RefreshTimeLimitError) return;
      if(RefreshLog.timeIsUp()){
        // out of time: the rest is not tried (the platform would end the execution), the log says which sheets were left
        const left = list.slice(i).map(x => x.resultSheet || x.configSheet).join(", ");
        const err = new RefreshTimeLimitError(`Przekroczono limit czasu odświeżania (${REFRESH_TIME_LIMIT_SECONDS} s). Nie odświeżono arkuszy: ${left}.`);
        RefreshLog.noteProblem(err.message);
        errors.push(err);
        return;
      }
      try{ RefreshSheet.run(cfg.configSheet,cfg.resultSheet); }
      catch(err){ errors.push(err); }
    });
    if(errors.length) throw errors[0];
  },

  /** Only the pairs ticked for automatic refresh. */
  ticked(){
    const list = getMainSettings().getSheetListWithRefreshTrue();
    if(list.length) RefreshAll.each_(list);
  },

  /**
   * What a time-based trigger does: refresh the ticked pairs, then note the time on the settings sheet.
   * Quirk kept: the time is noted also when nothing was ticked; it is not noted when a refresh fails (the other sheets are tried first) - an error thrown or BC's error
   * document for a sheet. Returns false for a failed attempt that threw nothing (the caller then does not record the run), true otherwise.
   */
  scheduled(technical = "Clock trigger"){
    return RefreshLog.run(REFRESH_LOG_SOURCES.auto,technical,() => {
      try{
        RefreshAll.ticked();
      }catch(err){
        RefreshAll.noteFailedAttempt_();       // the time stays as it was, with a note that says why
        throw err;
      }
      // BC answered a sheet with an error document: nothing is thrown, but the attempt failed all the same - the time is not noted, the note is put, the caller does not
      // record the run on the permit (false)
      if(RefreshLog.hasFailures()){
        RefreshAll.noteFailedAttempt_();
        return false;
      }
      getMainSettings().setLastRefresh(new Date());
      return true;
    },{opening: true, limitSeconds: REFRESH_TIME_LIMIT_SECONDS});
  },

  /** The attempt failed: a note on the time of the last refresh. Never hides the error that is on its way. */
  noteFailedAttempt_(){
    try{ getMainSettings().markLastRefreshAttemptFailed(); }
    catch(err){ dbgLog(`Note on the last refresh not written: ${err}`); }
  }
};
