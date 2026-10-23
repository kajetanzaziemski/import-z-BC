function onOpen(e) {
  return Controller.checked("onOpen",() => {
    // dbgLog(e.authMode);
    // testFunc_errorReporting();
    menuSelector();
    if(e.authMode != ScriptApp.AuthMode.NONE) Controller.run("onOpenAction",onOpenAction,e);
  },{e});
}

function onOpenAction(e){
  StatusManager.lightStatusCheck();
}

function onEdit(e) {                    
  agentLog("SIMPLE",null,`onEdit entry point called (add-on status: ${MainSettings.getAddonStatus() ? "ON" : "OFF - the check is skipped"}).`);
  Controller.checkInput("simpleOnEdit",{e});
  Controller.run("simpleOnEdit",() => checkInstallableAgentRan(e));
}

function getGlobalSettings(){
  return Settings.bc();
}

function setGlobalSettings(form){
  return Controller.checked("setGlobalSettings",() => {
    // throw new Error("Cannot set values: "+form.tenantid+" "+form.environment+" "+form.company);
    // dbgLog(`Setting ${form.scope} properties to (t/e/c): ${form.tenantid}, ${form.environment}, ${form.company}.`)
    getGlobalSettings().setAllPropertiesForScope(form.scope,form.tenantid,form.environment,form.company);
  },{form});
}

function sheetEdit(e){
  agentLog("INSTALLABLE",null,`sheetEdit entry point called by trigger ${e.triggerUid} (add-on status: ${MainSettings.getAddonStatus() ? "ON" : "OFF - nothing is recorded"}).`);
  Controller.registerInit(() => TriggerWrapper.logTriggerUsed(e.triggerUid));
  Controller.checkInput("sheetEditAction",{e});
  Controller.run("sheetEditAction",() => {
    recordInstallableSeen(e);   // before the power check: a powered-off agent that is still alive must be seen
    const powerOn = StatusManager.checkTriggerPower(e.triggerUid);
    agentLog("INSTALLABLE",fingerprint(e),`Power check of trigger ${e.triggerUid}: ${powerOn ? "ON - running the edit action" : "OFF or not logged - edit action SKIPPED (the edit was still reported to the simple trigger)"}.`);
    if(!powerOn) return;
    sheetEditAction(e);
  });
}

/**
 * Action to be taken on sheet edit. Will be wrapped in Controller.run() inside the handler function.
 * 
 *
 **/
function sheetEditAction(e){
  if(e.source.getActiveSheet().getName() == MainSettings.getSettingsSheetName()) getMainSettings().sheetEdit(e);
  updateAfterEdit(e.source.getActiveSheet().getName(),e);  
}

function sheetChange(e){
  Controller.registerInit(() => TriggerWrapper.logTriggerUsed(e.triggerUid));
  Controller.checkInput("sheetChangeAction",{e});
  Controller.run("sheetChangeAction",() => {
    sheetChangeAction(e);
    if(!StatusManager.checkTriggerPower(e.triggerUid)) return;
  });
}

function sheetChangeAction(e){
  dbgLog(e.changeType);
  if(e.changeType=="EDIT" || e.changeType=="FORMAT") return;
  updateAfterEdit(e.source.getActiveSheet().getName());
}

function updateAfterEdit(sheetName,editEvent){
  if(getMainSettings().isConfigSheet(sheetName)){
    let shCoed = new SheetCoeditor(sheetName,true);
    try{
    runFunctionWithLock(() => shCoed.sheetEdit(editEvent),sheetName+"_coedit");
    } catch(e) {
      shCoed.switchReadingControl(false);
      throw e;
    }
    shCoed.switchReadingControl(false);
  };
}

var mStgs = null;
function getMainSettings(){
  return mStgs ?? (mStgs = new SettingsSheet());
}

var bcMetadata = null;
function getMetadata() {
  return bcMetadata ?? (bcMetadata = new BCMetadata());
}

var docTL = null;
function getDocumentTriggerLog(){
  return docTL ?? (docTL = new DocumentTriggerLog());
}

var usrTL = null;
function getUserTriggerLog(){
  return usrTL ?? (usrTL = new UserTriggerLog());
}

const AEGENT_USER_KEY = "agentArray";
var agtMng = null;
function getAgentManager(){
  return agtMng ?? (agtMng = new AgentManager(AEGENT_USER_KEY));
}

function getValidImportSettingsSheet(name,ss) {
  if(!name) name = "Ustawienia importu";
  if(!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if(!sheet) return name;
  if(verifyIfSheetIsValidImportSettingsSheet(sheet)) return name;
  dbgLog(`Sheet ${name} is not a valid Import Settings sheet. Trying sheet ${nextName(name)}`);
  return getValidImportSettingsSheet(nextName(name,ss));
}

function verifyIfSheetIsValidImportSettingsSheet(sheet) {
  let B2value = sheet.getRange("B2").getValue();
  return B2value=="headerSheetList" || B2value=="Opis linii";
}

function nextName(name) {
  const match = name.match(/^(.*)\s(\d+)$/); // base + trailing number
  const base = match ? match[1] : name;
  const num = match ? parseInt(match[2], 10) : 0;
  return `${base} ${num + 1}`;
}

// - - - - - - - - Debugging - - - - - - - -   
const DEBUG_turncate_table_output = true;