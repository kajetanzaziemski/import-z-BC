class SettingsSheet{
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
    
    // Logger.log("Sheet list:");
    // Logger.log(this.sheetList);
    // Logger.log("Last refresh:");
    // Logger.log(this.lastRefresh);
    // Logger.log("Refresh frequency:");
    // Logger.log(this.refreshFrequency);
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

  sheetEdit(e){
    Logger.log(isInRange(this.refreshFrequencyPos,4,e.range));
    Logger.log(isInRange(this.refreshFrequencyPos,5,e.range));
    if(isInRange(this.refreshFrequencyPos,4,e.range) || isInRange(this.refreshFrequencyPos,5,e.range)){
      Logger.log("refreshFreqency data editted. Setting new time trigger.");
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

  setRefreshTrigger(){
    const ss = this.sheet.getParent();
    Logger.log(`setRefreshTrigger: Active sheet name:`+ss.getName());
    Logger.log(ScriptApp.getUserTriggers(ss).filter(t => t.getEventType() === ScriptApp.EventType.CLOCK).map(t=> `${t.getHandlerFunction()} - ${t.getUniqueId()}\n`));
    ScriptApp.getUserTriggers(ss).filter(trigger => trigger.getHandlerFunction() == "autoRefresh").forEach(trigger => ScriptApp.deleteTrigger(trigger));
    ScriptApp.getUserTriggers(ss).filter(trigger => trigger.getHandlerFunction() == "autoRefreshHandler").forEach(trigger => ScriptApp.deleteTrigger(trigger));
    Logger.log(ScriptApp.getUserTriggers(ss).filter(t => t.getEventType() === ScriptApp.EventType.CLOCK).map(t=> `${t.getHandlerFunction()} - ${t.getUniqueId()}\n`));
    let interval = this.getRefreshFrequency().freq;
    let intervalHrs = interval;

    if(!this.getRefreshFrequency().freq) return;
    let trigger = ScriptApp.newTrigger('autoRefreshHandler').timeBased();
    if(this.getRefreshFrequency().unit=="days"){
      trigger.everyDays(interval);
      intervalHrs = 24 * interval;
    }else if(this.getRefreshFrequency().unit=="hrs"){
      trigger.everyHours(interval);
    }else return;

    let newTrigger = trigger.create();
    // Issue a permit for this trigger. This will override any other permits, so all old triggers will automatically uninstall.
    MainSettings.setRefreshPermit(newTrigger.getUniqueId(),intervalHrs);

  }

  createObjectFromList(itemsNames,list){
    return Object.fromEntries(Object.keys(itemsNames).map(i => [itemsNames[i],list[i]]));
  }
}

function autoRefreshFunction(e){
  refreshAllTrue();
  getMainSettings().setLastRefresh(new Date());
}

function autoRefreshHandler(e) {
  Controller.run("requestAutoRefesh",()=>autoRefreshContent(e));
}

function autoRefreshContent(e) {
  Logger.log(`Running autoRefreshHandler. Id = ${e.triggerUid}.`);
  let myPermit = MainSettings.getRefreshPermit();
  if(myPermit) Logger.log(`Permit issued for ${myPermit.issuedFor} (${myPermit.issuedFor !== e.triggerUid ? 'NOT my permit. Removing...' : 'my permit'})`);
  // Registry doesn't point at me anymore → delete my own trigger and stop
  if (!myPermit || myPermit.issuedFor !== e.triggerUid) {
    ScriptApp.getProjectTriggers()
      .filter(t => t.getUniqueId() === e.triggerUid)
      .forEach(t => ScriptApp.deleteTrigger(t));
    return;
  }

  autoRefreshFunction();
  
  myPermit.lastRun = Date.now();
  MainSettings.updateRefreshPermit(myPermit);
}

/**
 * This function only serves legacy version. Older triggers run autoRefresh() rather than autoRefreshHandler(e). 
 */
function autoRefresh(e) {
  Controller.run("requestAutoRefesh",()=>autoRefreshContentOld(e));
}

function autoRefreshContentOld(e) {
  Logger.log(`Running autoRefresh. Id = ${e.triggerUid}.`);
  let myPermit = MainSettings.getRefreshPermit();
  // There was no permits for autoRefresh. Reissue my own permit.
  if (!myPermit) {
    MainSettings.setRefreshPermit(e.triggerUid);
    myPermit = MainSettings.getRefreshPermit();
    Logger.log(`Permit resissued.`)
  }
  else Logger.log(`Permit was already available. Permit issued for ${myPermit.issuedFor} (${myPermit.issuedFor !== e.triggerUid ? 'NOT my permit. Removing...' : 'my permit'})`);
  // Registry doesn't point at me anymore → delete my own trigger and stop
  if (myPermit.issuedFor !== e.triggerUid) {
    ScriptApp.getProjectTriggers()
      .filter(t => t.getUniqueId() === e.triggerUid)
      .forEach(t => ScriptApp.deleteTrigger(t));
    return;
  }

  autoRefreshFunction();
  
  myPermit.lastRun = Date.now();
  MainSettings.updateRefreshPermit(myPermit);
}

