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

  static touchRefreshPermit(triggerUid){
    return Settings.touchRefreshPermit(triggerUid);
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