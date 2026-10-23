// ---------------------------------------------------------------------------
// REFRESH SHEET (use case): read a config sheet, fetch everything it asks for from Business Central, write the result sheet.
// Moved here unchanged from Menu.js (refreshAllDataForConfigSheet); the status cells of the config sheet show the progress:
//   reading (B2) while the config is read and the pages are fetched, connection (C2) per page, data writing (D2) while the result is written.
// Whatever fails, the cells are put back to idle and the error goes on to the caller.
// ---------------------------------------------------------------------------

const RefreshSheet = {
  /**
   * @param configSheetName {String} Config sheet; default: the first one listed in the settings sheet.
   * @param resultSheetName {String} Result sheet; default: the one the settings sheet lists for this config sheet.
   */
  run(configSheetName,resultSheetName){
    configSheetName = configSheetName ?? getMainSettings().getConfigSheetNames()[0];
    let shCoed = new SheetCoeditor(configSheetName,true);
    let odConnection, columnDataTypes;
    try{ 
      if(!shCoed.getTable()){
        dbgLog("No table in config sheet. Quitting.");
        shCoed.switchReadingControl(false);
        return;
      }
      
      odConnection = ImportQuery.connectionFor(shCoed);
      odConnection.readAllPages(shCoed);

      columnDataTypes = odConnection.getColumnInfo().map(info => getMetadata().getDataType(info.field,info.table ?? shCoed.getTable()));
    } catch(e) {
      shCoed.switchReadingControl(false);
      throw e;  
    }
    shCoed.switchReadingControl(false);
    shCoed.switchDataWritingControl(true);
    try{  
      const table = odConnection.getDataArray();
      const sheetName = resultSheetName ?? getMainSettings().getResultSheetName(configSheetName);
      ResultSheet.write(sheetName,table,columnDataTypes);
    } catch (e) {
      shCoed.switchDataWritingControl(false);
      throw e;  
    }
    shCoed.switchDataWritingControl(false);
  }
};
