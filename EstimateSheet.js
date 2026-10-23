// ---------------------------------------------------------------------------
// ESTIMATE SHEET (use case): ask Business Central for the first page of what a config sheet describes and show the estimated number of
// rows in the config sheet (F2). Moved here unchanged from Menu.js (estimateResponseSize). Nothing is written to any other sheet.
// Known quirk kept as it was: without a table in the config sheet it returns early and leaves the reading cell (B2) lit.
// ---------------------------------------------------------------------------

const EstimateSheet = {
  /** @param configSheetName {String} Config sheet; default: the first one listed in the settings sheet. */
  run(configSheetName){
    configSheetName = configSheetName ?? getMainSettings().getConfigSheetNames()[0];
    const shCoed = new SheetCoeditor(configSheetName,true);
    try{
      if(!shCoed.getTable()){
        dbgLog("No table in config sheet. Quitting.")
        return;
      }   
    } catch(e) {
      shCoed.switchReadingControl(false);
      throw e;
    }
    shCoed.switchReadingControl(false);
    shCoed.switchConnectionControl(true);
    let odConnection;
    try{
      odConnection = ImportQuery.connectionFor(shCoed);
      odConnection.fetchHttpResponse();
      odConnection.readPage();
      dbgLog(odConnection.getTotalRows());
    } catch(e) {
      shCoed.switchConnectionControl(false);
      throw e;  
    }
    shCoed.switchConnectionControl(false);
    shCoed.setTotRowsInfo(odConnection.getTotalRows());
  }
};
