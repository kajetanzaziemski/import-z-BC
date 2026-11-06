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
    try{
      RefreshSheet.run_(configSheetName,resultSheetName);
    }catch(e){
      RefreshLog.noteFailedSheet(RefreshSheet.nameForLog_(configSheetName,resultSheetName),e);     // the download log says for which sheet the data could not be pulled
      throw e;
    }
  },

  /** The name of the sheet the data is pulled for, as the download log says it: the result sheet (else the config sheet). Never throws. */
  nameForLog_(configSheetName, resultSheetName){
    try{
      configSheetName = configSheetName ?? getMainSettings().getConfigSheetNames()[0];
      return resultSheetName ?? getMainSettings().getResultSheetName(configSheetName) ?? configSheetName;
    }catch(err){
      return configSheetName ?? resultSheetName ?? "?";
    }
  },

  run_(configSheetName,resultSheetName){
    configSheetName = configSheetName ?? getMainSettings().getConfigSheetNames()[0];
    let shCoed = new SheetCoeditor(configSheetName,true);
    let odConnection, columnDataTypes, refreshed = null;
    try{ 
      if(!shCoed.getTable()){
        dbgLog("No table in config sheet. Quitting.");
        RefreshLog.noteProblem(`Brak tabeli w arkuszu konfiguracji „${configSheetName}”`);
        shCoed.switchReadingControl(false);
        return;
      }
      
      odConnection = ImportQuery.connectionFor(shCoed);
      odConnection.readAllPages(shCoed);

      // An error document from BC is shown as it is (code / message rows, text): it has no columns to look up in the metadata.
      columnDataTypes = odConnection.getError()
        ? odConnection.getDataArray()[0].map(() => 'Edm.String')
        : odConnection.getColumnInfo().map(info => getMetadata().getDataType(info.field,info.table ?? shCoed.getTable()));
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
      const bcError = odConnection.getError();
      // BC answered with an error document (shown in the result sheet): the data of this sheet was NOT pulled - for the download log a failed sheet like any other
      if(bcError) RefreshLog.noteFailedSheet(sheetName,`BC ${[bcError.code,bcError.message].filter(x => x).join(": ")}`);
      refreshed = bcError ? null : {name: sheetName, rows: Math.max(table.length - 1,0)};
    } catch (e) {
      shCoed.switchDataWritingControl(false);
      throw e;  
    }
    shCoed.switchDataWritingControl(false);
    // Counted as refreshed only now that everything went through (data written, indicators back to idle): a sheet that failed is never also in the "refreshed" list
    if(refreshed) RefreshLog.noteSheet(refreshed.name,refreshed.rows);
  }
};
