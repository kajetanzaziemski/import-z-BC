const IMPORT_SETTINGS_SHEET_NAME_KEY = "importSettingsSheetName";
const IMPORT_SETTINGS_KEY = "importSettingsArray";
imStgs = null;
function getImportSettings(){
  return imStgs ?? (imStgs = new StorageObject(IMPORT_SETTINGS_KEY,"document"));
}

class MainSettings{
  static getProperty(name){
    return getImportSettings().getProperty(name);
  }

  static setProperty(name,value){
    getImportSettings().setProperty(name,value);
    return this;
  }

  static getSettingsSheetName(){
    return this.getProperty("importSheetName");
  }

  static setSettingsSheetName(name){
    if(!name) name = getValidImportSettingsSheet();
    return this.setProperty("importSheetName",name)
  }

  static getAddonStatus(){
    dbgLog("getAddonStatus returning "+(this.getProperty("addonStatus") ?? false)?'true':'false');
    return this.getProperty("addonStatus") ?? false;
  }

  static setAddonStatus(statusOn){
    if(statusOn == "on" || statusOn == "ON") statusOn = true;
    if(statusOn == "off" || statusOn == "OFF") statusOn = false;
    if(statusOn && !this.getSettingsSheetName()) this.setSettingsSheetName();
    if(statusOn) Controller.registerClosingOnce(() => StatusManager.fullStatusCheck(),"status check")
    return this.setProperty("addonStatus",statusOn);
  }

  static setRefreshPermit(issuedForId,intervalHoursValue){
    let permit = {
      issuedFor: issuedForId,
      lastRefresh: Date.now(),
      intervalHours: intervalHoursValue
    }
    return this.setProperty("refreshPermit",permit)
  }

  static updateRefreshPermit(permit){
    return this.setProperty("refreshPermit",permit)
  }

  /**
   * Records the run time on the permit, but only if it is still issued for the given trigger.
   * The permit is re-read from the store, as it could have been reissued while the refresh was running.
   */
  static touchRefreshPermit(triggerUid){
    let current = getImportSettings().getFreshProperty("refreshPermit");
    if(!current || current.issuedFor !== triggerUid) return false;
    current.lastRun = Date.now();
    this.updateRefreshPermit(current);
    return true;
  }

  static getRefreshPermit() {
    return this.getProperty("refreshPermit");
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