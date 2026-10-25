// FROZEN copy of the SettingsSheet class (Settings Sheet.js) as it was while it still used the Spreadsheet service itself (commit 4ff96b2).
// Golden reference for tests/settings-sheet.test.js, loaded as LegacySettingsSheet. Do not edit.
class LegacySettingsSheet{
  constructor(){
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if(!MainSettings.getSettingsSheetName()) MainSettings.setSettingsSheetName();
    let name = MainSettings.getSettingsSheetName();

    this.sheet = ss.getSheetByName(name);
    if(!this.sheet) this.sheet = this.createNewSheet(ss,name);
    this.setupEditTriggers();
    this.settings = this.getAllSettingsData();
    this.lastConfigSheetPos = 2;
    this.lastRefreshPos = null;
    this.refreshFrequencyPos = null;
    this.sheetList = this.getSheetList();
    this.refreshFrequency = this.readRefreshFrequency();
    this.lastRefresh = this.readLastRefresh();
    
    // dbgLog("Sheet list:");
    // dbgLog(this.sheetList);
    // dbgLog("Last refresh:");
    // dbgLog(this.lastRefresh);
    // dbgLog("Refresh frequency:");
    // dbgLog(this.refreshFrequency);
  }

  // setImportSheetName(name){
  //   // getImportSettings().storageArray.importSheetName = name;
  // }

  // getImportSheetName(){
  //   // if(!storedSettings.getArray().importSheetName) storedSettings.storageArray.importSheetName = "Ustawienia Importu";
  //   return storedSettings.getArray().importSheetName;
  // }

  setupEditTriggers(){
    let triggers = ScriptApp.getUserTriggers(SpreadsheetApp.getActiveSpreadsheet());
    if (triggers.find(trigger => trigger.getHandlerFunction()=="sheetEdit")==null) ScriptApp.newTrigger('sheetEdit').forSpreadsheet(this.sheet.getParent()).onEdit().create();
    if(triggers.find(trigger => trigger.getHandlerFunction()=="sheetChange")==null) ScriptApp.newTrigger('sheetChange').forSpreadsheet(this.sheet.getParent()).onChange().create();
  }

  createNewSheet(spreadSheet,name){
    let sheet = spreadSheet.insertSheet(name);
    sheet.getRange(2,2,5,4).setValues([
      ["Opis linii","Arkusz konfiguracji","Arkusz docelowy         .","Odświeżanie automatyczne"],
      ["","","",""],
      ["headerGeneralSettings","Ustawienia odświeżania automatycznego","",""],
      ["lastRefresh","Ostatnio odświeżone o:","",""],
      ["refreshFrequency","Odświeżaj co:","","godzin"]
    ]);
    sheet.getRange(6,5,1,1).setDataValidation(SpreadsheetApp.newDataValidation().withCriteria(SpreadsheetApp.DataValidationCriteria["VALUE_IN_LIST"],[["godzin", "dni"], true]).build());
    sheet.getRange(5,4,1,1).setNumberFormat("yyyy-mm-dd hh:mm");
    sheet.autoResizeColumns(2,5);
    return sheet;
  }

  /** Is the edited range (part of) the refresh frequency: its number (column D) or its unit (column E)? */
  isRefreshFrequencyCell(range){
    return isInRange(this.refreshFrequencyPos,4,range) || isInRange(this.refreshFrequencyPos,5,range);
  }

  sheetEdit(e){
    if(this.isRefreshFrequencyCell(e.range)){
      dbgLog("refreshFreqency data editted. Setting new time trigger.");
      this.setRefreshTrigger();
    } 
  }

  getAllSettingsData(){
    return this.settings ?? this.sheet.getRange(1,2,this.sheet.getLastRow(),4).getValues();
  }

  getSheetList(){
    return this.sheetList ?? this.readSheetList();
  }

  getSheetListWithRefreshTrue(){
    return this.sheetList.filter(item => item.refresh);
  }

  getRefreshFrequency(){
    return this.refreshFrequency ?? this.readRefreshFrequency();
  }

  getLastRefresh(){
    return this.lastRefresh ?? this.readLastRefresh();
  }
  
  readSheetList(){
    let res = [];
    let i = 0;
    this.getAllSettingsData().forEach(row => {
      i++;
      switch(row[0]){
        case 'configSheet':
          res.push(this.createObjectFromList(["configSheet","resultSheet","refresh"],row.slice(1,5)));
          this.lastConfigSheetPos = i;
          break;
        case 'lastRefresh':
          this.lastRefreshPos = i;
          break;
        case 'refreshFrequency':
          this.refreshFrequencyPos = i;
          break;
      }
    });
    return res;
  }

  getConfigSheetNames(){
    let res = [];
    this.getSheetList().forEach(o => res.push(o.configSheet));
    return res;
  }

  getConfigSheetForResultSheet(resultSheet){
    for(o of this.getSheetList()) if(o.resultSheet == resultSheet) return o.configSheet;
    return null;
  }

  isConfigSheet(sheetName){
    return this.getSheetList().find(item => item.configSheet == sheetName)!=undefined;
  }

  isResultSheet(sheetName){
    return this.getSheetList().find(item => item.resultSheet == sheetName)!=undefined;
  }

  getConfigSheetName(sheetName){
    if(this.isConfigSheet(sheetName)) return sheetName;
    let resSheet = this.getSheetList().find(item => item.resultSheet == sheetName);
    return resSheet ? resSheet.configSheet : null;
  }

  getResultSheetName(sheetName){
    if(this.isResultSheet(sheetName)) return sheetName;
    let cfgSheet = this.getSheetList().find(item => item.configSheet == sheetName);
    return cfgSheet ? cfgSheet.resultSheet : null;
  }

  readRefreshFrequency(){
    if(!this.refreshFrequencyPos) this.readSheetList();
    if(!this.refreshFrequencyPos) return null;
    let values = this.sheet.getRange(this.refreshFrequencyPos,4,1,2).getValues()[0];
    return {
      freq: values[0],
      unit: values[1]=="godzin" ? "hrs" : values[1]=="dni" ? "days" : null
    }
  }
  
  readLastRefresh(){
    if(!this.lastRefreshPos) this.readSheetList();
    if(!this.lastRefreshPos) return null;
    return this.sheet.getRange(this.lastRefreshPos,4,1,1).getValue();
  }

  setLastRefresh(time){
    if(!this.lastRefreshPos) this.readSheetList();
    if(!this.lastRefreshPos){
      let lastPos = this.sheet.getLastRow();
      this.sheet.insertRowAfter(lastPos++);
      this.lastRefreshPos = lastPos;
      this.sheet.getRange(this.lastRefreshPos,2,1,2).setValues([["lastRefresh","Ostatnie odświeżone o:"]]);
    }
    time = time ?? new Date();
    this.sheet.getRange(this.lastRefreshPos,4,1,2).setValues([[time,Utilities.formatDate(time,SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),"z")]]);
    SpreadsheetApp.flush();
    this.lastRefresh = this.readLastRefresh();
  }

  addNewSheetInfo(configSheetName,resultSheetName,refresh=false){
    if(!configSheetName) configSheetName = "Konfiguracja "+(this.getSheetList().length+1);
    if(!resultSheetName) resultSheetName = "Dane wg. "+configSheetName;
    let lastPos = this.lastConfigSheetPos ?? this.sheet.getLastRow();
    this.sheet.insertRowAfter(lastPos++);
    this.lastConfigSheetPos = lastPos;
    this.sheet.getRange(lastPos,2,1,4).setValues([["configSheet",configSheetName,resultSheetName,refresh]]);
    this.sheet.getRange(lastPos,5,1,1).insertCheckboxes();
    this.sheetList.push(this.createObjectFromList(["configSheet","resultSheet","refresh"],[configSheetName,resultSheetName,refresh]));
    return this.sheetList[this.sheetList.length-1];
  }

  /** (Re)creates the time-based trigger for the refresh frequency of this sheet; the work is in ScheduleRefresh.js. */
  setRefreshTrigger(){
    ScheduleRefresh.setUp(this.getRefreshFrequency());
  }

  createObjectFromList(itemsNames,list){
    return Object.fromEntries(Object.keys(itemsNames).map(i => [itemsNames[i],list[i]]));
  }
}

