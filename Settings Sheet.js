// The settings sheet of the add-on: which config sheets exist (and which refresh automatically), when the last refresh was and how often
// to refresh. It does not touch the spreadsheet itself: the cells are read and written through SettingsGrid (Settings Grid.js).
class SettingsSheet{
  constructor(){
    if(!MainSettings.getSettingsSheetName()) MainSettings.setSettingsSheetName();
    let name = MainSettings.getSettingsSheetName();

    if(!SettingsGrid.exists(name)) SettingsGrid.create(name);
    this.grid = SettingsGrid.open(name);
    this.setupEditTriggers();
    this.settings = this.getAllSettingsData();
    this.lastConfigSheetPos = 2;
    this.lastRefreshPos = null;
    this.refreshFrequencyPos = null;
    this.sheetList = this.getSheetList();
    this.refreshFrequency = this.readRefreshFrequency();
    this.lastRefresh = this.readLastRefresh();
  }

  // setImportSheetName(name){
  //   // getImportSettings().storageArray.importSheetName = name;
  // }

  // getImportSheetName(){
  //   // if(!storedSettings.getArray().importSheetName) storedSettings.storageArray.importSheetName = "Ustawienia Importu";
  //   return storedSettings.getArray().importSheetName;
  // }

  setupEditTriggers(){
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let triggers = ScriptApp.getUserTriggers(ss);
    if (triggers.find(trigger => trigger.getHandlerFunction()=="sheetEdit")==null) ScriptApp.newTrigger('sheetEdit').forSpreadsheet(ss).onEdit().create();
    if(triggers.find(trigger => trigger.getHandlerFunction()=="sheetChange")==null) ScriptApp.newTrigger('sheetChange').forSpreadsheet(ss).onChange().create();
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
    return this.settings ?? this.grid.rows();
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
    let values = this.grid.frequency(this.refreshFrequencyPos);
    return {
      freq: values[0],
      unit: values[1]=="godzin" ? "hrs" : values[1]=="dni" ? "days" : null
    }
  }
  
  readLastRefresh(){
    if(!this.lastRefreshPos) this.readSheetList();
    if(!this.lastRefreshPos) return null;
    return this.grid.lastRefresh(this.lastRefreshPos);
  }

  setLastRefresh(time){
    if(!this.lastRefreshPos) this.readSheetList();
    if(!this.lastRefreshPos) this.lastRefreshPos = this.grid.addLastRefreshRow();
    time = time ?? new Date();
    this.grid.writeLastRefresh(this.lastRefreshPos,time);
    this.lastRefresh = this.readLastRefresh();
  }

  addNewSheetInfo(configSheetName,resultSheetName,refresh=false){
    if(!configSheetName) configSheetName = "Konfiguracja "+(this.getSheetList().length+1);
    if(!resultSheetName) resultSheetName = "Dane wg. "+configSheetName;
    let lastPos = this.lastConfigSheetPos;
    lastPos = this.grid.addConfigRow(lastPos,configSheetName,resultSheetName,refresh);
    this.lastConfigSheetPos = lastPos;
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

function autoRefreshFunction(e){
  RefreshAll.scheduled();
}

function autoRefreshHandler(e) {
  Controller.checkInput("requestAutoRefesh",{e,legacy:false});
  Controller.run("requestAutoRefesh",()=>autoRefreshContent(e));
}

function autoRefreshContent(e) {
  ScheduleRefresh.run(e);
}

/**
 * This function only serves legacy version. Older triggers run autoRefresh() rather than autoRefreshHandler(e). 
 */
function autoRefresh(e) {
  Controller.checkInput("requestAutoRefesh",{e,legacy:true});
  Controller.run("requestAutoRefesh",()=>autoRefreshContentOld(e));
}

function autoRefreshContentOld(e) {
  ScheduleRefresh.runLegacy(e);
}
