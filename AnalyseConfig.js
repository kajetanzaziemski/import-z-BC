// ---------------------------------------------------------------------------
// ANALYSE CONFIG (use case): a config sheet was edited or its structure changed -> read it again and complete it: the query lines that follow
// from the chosen table / options, and the dropdowns (query options, operators, field lists from the BC metadata) with their notes.
// Moved here unchanged from Quick Start.js (updateAfterEdit). The reading cell (B2) is lit while it works and put back to idle, also on errors;
// the work runs under runLatestOnly (functions.js) with the flag "<sheet>_coedit": only the LAST co-edit to start completes, an older one drops out at its
// next checkpoint (SheetCoeditor.sheetEdit) and leaves the reading indicator to the newer one.
// ---------------------------------------------------------------------------

const AnalyseConfig = {
  /**
   * @param sheetName {String} A config sheet.
   * @param editEvent {Object|undefined} The onEdit event when an edit started this (not given for structure changes).
   */
  run(sheetName,editEvent){
    coeditNote_("start",{sheet: sheetName, event: editEvent ? "edit" : "change"});
    let shCoed = new SheetCoeditor(sheetName,true);
    let outcome;
    try{
      outcome = runLatestOnly(isLatest => shCoed.sheetEdit(editEvent,isLatest),sheetName+"_coedit");
    } catch(e) {
      coeditNote_("error",{message: String(e && e.message || e).slice(0,120)});
      shCoed.switchReadingControl(false);
      if(typeof CoeditTrace !== "undefined") CoeditTrace.flush(sheetName);
      throw e;
    }
    coeditNote_("end",{outcome: outcome});
    if(typeof CoeditTrace !== "undefined") CoeditTrace.flush(sheetName);
    // "dropped": a newer run has taken over and its reading indicator is the one that counts - it puts it back to idle when it is done.
    if(outcome === "dropped") Controller.checkNote("co-edit dropped: a newer co-edit took over");     // (the live check does not judge a sheet the newer one is still completing)
    else shCoed.switchReadingControl(false);
  }
};
