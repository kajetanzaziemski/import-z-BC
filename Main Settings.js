/** The StorageObject behind the import settings (see Settings.js). */
function getImportSettings(){
  return Settings.store();
}

/**
 * The old entry to the import settings. The values live in Settings.js; what stays here is what happens AROUND them:
 * "on"/"off" are understood, turning the add-on on needs a settings sheet name and schedules a status check for the end of the run.
 */
class MainSettings{
  static getProperty(name){
    return Settings.get(name);
  }

  static setProperty(name,value){
    Settings.set(name,value);
    return this;
  }

  static getSettingsSheetName(){
    return Settings.settingsSheetName();
  }

  static setSettingsSheetName(name){
    if(!name) name = getValidImportSettingsSheet();
    Settings.setSettingsSheetName(name);
    return this;
  }

  static getLogSheetName(){
    return Settings.logSheetName();
  }

  /**
   * The name of the sheet of the download log. Empty = the default ("Dziennik pobrań"). A name that is already a sheet of the add-on (the settings sheet, a config
   * or a result sheet) is refused: the log would be written into it. Sheet names are not told apart by case.
   */
  static setLogSheetName(name){
    name = String(name ?? "").trim() || REFRESH_LOG_DEFAULT_NAME;
    if(name.length > 100) throw new Error("Nazwa arkusza dziennika pobrań może mieć najwyżej 100 znaków.");
    const taken = [MainSettings.getSettingsSheetName()];
    if(settingsSheetExists()) getMainSettings().getSheetList().forEach(x => taken.push(x.configSheet,x.resultSheet));
    if(taken.some(x => x && String(x).toLowerCase() === name.toLowerCase())) throw new Error(`Nazwa „${name}” jest już używana przez arkusz ustawień, konfiguracji lub wynikowy.`);
    Settings.setLogSheetName(name);
    return this;
  }

  static getAddonStatus(){
    const status = Settings.addonStatus();
    dbgLog("getAddonStatus returning "+(status ? 'true' : 'false'));
    return status;
  }

  static setAddonStatus(statusOn){
    if(statusOn == "on" || statusOn == "ON") statusOn = true;
    if(statusOn == "off" || statusOn == "OFF") statusOn = false;
    if(statusOn && !this.getSettingsSheetName()) this.setSettingsSheetName();
    if(statusOn) Controller.registerClosingOnce(() => Agents.ensureActive(),"status check")
    Settings.setAddonStatus(statusOn);
    return this;
  }

  static setRefreshPermit(issuedForId,intervalHoursValue){
    Settings.issueRefreshPermit(issuedForId,intervalHoursValue);
    return this;
  }

  static updateRefreshPermit(permit){
    Settings.updateRefreshPermit(permit);
    return this;
  }

  static touchRefreshPermit(triggerUid,extra){
    return Settings.touchRefreshPermit(triggerUid,extra);
  }

  static getRefreshPermit() {
    return Settings.refreshPermit();
  }
}

function getImportSettingsSheetName(){
  return Controller.run("requestSettingsSheetName",()=>{
    dbgLog("Asked for settings sheet name. Returning "+MainSettings.getSettingsSheetName());
    return MainSettings.getSettingsSheetName();
  });
}

function setImportSettingsSheetName(name){
  Controller.checkInput("requestSetSettingsSheetName",{name});
  return Controller.run("requestSetSettingsSheetName",()=>{
    dbgLog("Changing settings Sheet name to "+name);
    return MainSettings.setSettingsSheetName(name);
  });
}

function getRefreshLogSheetName(){
  return Controller.run("requestRefreshLogSheetName",()=>MainSettings.getLogSheetName());
}

function setRefreshLogSheetName(name){
  Controller.checkInput("requestSetRefreshLogSheetName",{name});
  return Controller.run("requestSetRefreshLogSheetName",()=>MainSettings.setLogSheetName(name));
}

function changeAddonStatus(newStatus){
  Controller.checkInput("requestChangeAddonStatus",{newStatus});
  Controller.run("requestChangeAddonStatus",() =>{
    dbgLog(`changeAddonStatus called. Changing to ${newStatus ? "ON" : "OFF"}`);
    MainSettings.setAddonStatus(newStatus);
  });
}

function getAddonStatus(){
  return Controller.run("requestAddonStatus",()=>MainSettings.getAddonStatus());
}

function getPermitsInfo() {
  return Controller.run("requestPermitsInfo",()=>{
    if(MainSettings.getRefreshPermit()) return JSON.stringify(MainSettings.getRefreshPermit()); //Object.entries(MainSettings.getRefreshPermit()).map(entry => entry[0] + ": " + entry[1] + "<br />").join("\n");
    return "No permits info ):";
  });
}