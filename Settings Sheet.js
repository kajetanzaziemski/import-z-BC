// The settings sheet of the add-on: which config sheets exist (and which refresh automatically), when the last refresh was and how often
// to refresh. It does not touch the spreadsheet itself: the cells are read and written through SettingsGrid (Settings Grid.js).
/** The note on the time of the last refresh after an attempt that failed: the cell still shows the last time everything went right. */
const LAST_REFRESH_FAILED_NOTE = "Komórka pokazuje czas ostatniego w pełni poprawnego odświeżania. Sprawdź arkusz dziennika pobrań, żeby zobaczyć informacje o wszystkich próbach odświeżania.";

const TIME_ZONE_EDIT_MESSAGE = "Godzina odświeżania jest ustawiana wg. strefy czasowej dokumentu, więc tej wartości nie można zmienić tutaj (przywrócono poprzednią).\n\n" +
  "Aby zmienić strefę czasową dokumentu wejdź w: Plik -> Ustawienia -> Ogólne -> Strefa czasowa.\n" +
  "Po zmianie strefy dodatek przeliczy godzinę odświeżania tak, żeby wypadała w tym samym momencie (przy ponownym otwarciu dokumentu).";

class SettingsSheet{
  constructor(){
    if(!MainSettings.getSettingsSheetName()) MainSettings.setSettingsSheetName();
    let name = MainSettings.getSettingsSheetName();

    if(!SettingsGrid.exists(name)) SettingsGrid.create(name);
    this.grid = SettingsGrid.open(name);
    this.settings = this.getAllSettingsData();
    this.lastConfigSheetPos = 2;
    this.lastRefreshPos = null;
    this.refreshFrequencyPos = null;
    this.refreshTimePos = null;
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

  /** Is the edited range (part of) the refresh frequency: its number (column D) or its unit (column E)? */
  isRefreshFrequencyCell(range){
    return isInRange(this.refreshFrequencyPos,4,range) || isInRange(this.refreshFrequencyPos,5,range) || isInRange(this.refreshTimePos,4,range);
  }

  /** Is the edited range (part of) the time zone label: column E of the refreshTime line? */
  isRefreshTimeZoneCell(range){
    return isInRange(this.refreshTimePos,5,range);
  }

  /** Reads the sheet again (from the server: edits made meanwhile by other executions are in) and forgets what was read before. */
  reloadRefreshSettings(){
    this.readAgain_(true);
  }

  readAgain_(reopen){
    if(reopen) this.grid = SettingsGrid.open(MainSettings.getSettingsSheetName());
    this.settings = this.grid.rows();
    this.lastConfigSheetPos = 2; this.lastRefreshPos = null; this.refreshFrequencyPos = null; this.refreshTimePos = null;
    this.sheetList = this.readSheetList();
    this.refreshFrequency = this.readRefreshFrequency();
    this.lastRefresh = this.readLastRefresh();
  }

  /** The zone labels follow the spreadsheet's time zone, judged from what the sheet says now; `plan` may give the conversion of the time of day (see SettingsGrid retime). */
  adoptTimeZone(plan){
    return this.grid.retime(plan);
  }

  /** The refresh is switched off on purpose: the frequency and the time of day are cleared in the sheet (and in what this object remembers of them). */
  clearRefreshSettings(){
    if(!this.refreshFrequencyPos) this.readSheetList();
    this.grid.clearRefreshSettings();
    this.refreshFrequency = this.readRefreshFrequency();
  }

  /**
   * The label is information only: the time of day is set in the time zone of the document, whatever stands there. An edit is undone (to what the cell held,
   * else to the zone as it is now) and one dialog tells where the zone is changed.
   */
  rejectTimeZoneEdit(previous){
    this.grid.restoreTimeZoneLabel(typeof previous == "string" && previous != "" ? previous : null);
    Controller.registerClosingOnce(() => alertMessage(TIME_ZONE_EDIT_MESSAGE),"userAlertTimeZone");
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
        case 'refreshTime':
          this.refreshTimePos = i;
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

  /** A scheduled refresh was tried and failed: the time of the last refresh stays, with a note that says so (the next fully correct refresh removes it, setLastRefresh). */
  markLastRefreshAttemptFailed(){
    if(!this.lastRefreshPos) this.readSheetList();
    if(!this.lastRefreshPos) this.lastRefreshPos = this.grid.addLastRefreshRow();
    this.grid.noteLastRefresh(this.lastRefreshPos,LAST_REFRESH_FAILED_NOTE);
  }

  addNewSheetInfo(configSheetName,resultSheetName,refresh=false){
    if(!configSheetName) configSheetName = "Konfiguracja "+(this.getSheetList().length+1);
    if(!resultSheetName) resultSheetName = "Dane wg. "+configSheetName;
    let lastPos = this.lastConfigSheetPos;
    const after = lastPos;
    lastPos = this.grid.addConfigRow(after,configSheetName,resultSheetName,refresh);
    this.lastConfigSheetPos = lastPos;
    // the lines below the new one moved down: the rows remembered for them with it (they were left where they had been, bugs-fixed #11)
    if(this.lastRefreshPos > after) this.lastRefreshPos++;
    if(this.refreshFrequencyPos > after) this.refreshFrequencyPos++;
    if(this.refreshTimePos > after) this.refreshTimePos++;
    this.sheetList.push(this.createObjectFromList(["configSheet","resultSheet","refresh"],[configSheetName,resultSheetName,refresh]));
    ManagedSheets.store(this);
    return this.sheetList[this.sheetList.length-1];
  }

  /** (Re)creates the time-based trigger for the refresh frequency of this sheet; the work is in ScheduleRefresh.js. */
  setRefreshTrigger(){
    ScheduleRefresh.apply(this);
  }

  /** The time of day to refresh at ({hour, minute}) from the refreshTime line, or null when there is none or it is no time. */
  getRefreshStartAt(){
    return this.grid ? this.grid.refreshTime() : null;
  }

  /** The last resort when the outcome cannot be shown in the message area. */
  toastRefreshError(){
    toastMessage("Zobacz Import z BC -> Ustawienia.","BŁĄD!");
  }

  /** Shows the outcome of setting the trigger up in the message area (see SettingsGrid.writeRefreshMessage). */
  setRefreshMessage(report){
    if(!this.grid) return;
    this.grid.writeRefreshMessage(report);
    // the lines it may have added moved the rest down: read the sheet again
    this.readAgain_(false);
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
