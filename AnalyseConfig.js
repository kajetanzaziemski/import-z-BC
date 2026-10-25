// ---------------------------------------------------------------------------
// ANALYSE CONFIG (use case): a config sheet was edited or its structure changed -> read it again and complete it: the query lines that follow
// from the chosen table / options, and the dropdowns (query options, operators, field lists from the BC metadata) with their notes.
// Moved here unchanged from Quick Start.js (updateAfterEdit). The reading cell (B2) is lit while it works and put back to idle, also on errors;
// the work runs under the lock-and-retry helper with the flag "<sheet>_coedit".
// ---------------------------------------------------------------------------

const AnalyseConfig = {
  /**
   * @param sheetName {String} A config sheet.
   * @param editEvent {Object|undefined} The onEdit event when an edit started this (not given for structure changes).
   */
  run(sheetName,editEvent){
    let shCoed = new SheetCoeditor(sheetName,true);
    try{
      runFunctionWithLock(() => shCoed.sheetEdit(editEvent),sheetName+"_coedit");
    } catch(e) {
      shCoed.switchReadingControl(false);
      throw e;
    }
    shCoed.switchReadingControl(false);
  }
};
