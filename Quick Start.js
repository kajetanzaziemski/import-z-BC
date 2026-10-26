/**
 * The one entry point that is only partly under the Controller: the menu is built first, outside it, in every auth mode - it has to be fast and
 * needs no services, and it must appear whether the add-on is ON or not. Where the script is authorised the rest (the status check that warns when
 * the agents are not active) is an ordinary run.
 */
function onOpen(e) {
  // dbgLog(e.authMode);
  // testFunc_errorReporting();
  menuSelector();
  Controller.checkInput("onOpen",{e});
  if(e.authMode != ScriptApp.AuthMode.NONE) Controller.run("onOpen",() => StatusManager.lightStatusCheck(),e);
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
  Controller.checkInput("requestSetGlobalSettings",{form});
  return Controller.run("requestSetGlobalSettings",() => {
    // throw new Error("Cannot set values: "+form.tenantid+" "+form.environment+" "+form.company);
    // dbgLog(`Setting ${form.scope} properties to (t/e/c): ${form.tenantid}, ${form.environment}, ${form.company}.`)
    getGlobalSettings().setAllPropertiesForScope(form.scope,form.tenantid,form.environment,form.company);
  });
}

function sheetEdit(e){
  agentLog("INSTALLABLE",null,`sheetEdit entry point called by trigger ${e.triggerUid} (add-on status: ${MainSettings.getAddonStatus() ? "ON" : "OFF - nothing is recorded"}).`);
  Controller.registerInit(() => Agents.markUsed(e.triggerUid));
  Controller.checkInput("sheetEditAction",{e});
  Controller.run("sheetEditAction",() => {
    Agents.recordEdit(e);   // before the power check: a powered-off agent that is still alive must be seen
    const powerOn = Agents.isPowered(e.triggerUid);
    agentLog("INSTALLABLE",fingerprint(e),`Power check of trigger ${e.triggerUid}: ${powerOn ? "ON - running the edit action" : "OFF or not logged - edit action SKIPPED (the edit was still reported to the simple trigger)"}.`);
    if(!powerOn){ Controller.intent("agent.skipped",{sheet: null, changeType: null}); return; }
    sheetEditAction(e);
  });
}

/**
 * Action to be taken on sheet edit. Will be wrapped in Controller.run() inside the handler function.
 * 
 *
 **/
function sheetEditAction(e){
  Router.edit(e);     // which job the edit means is decided in Router.js
}

function sheetChange(e){
  Controller.registerInit(() => Agents.markUsed(e.triggerUid));
  Controller.checkInput("sheetChangeAction",{e});
  Controller.run("sheetChangeAction",() => {
    // powered off or not logged: the change is skipped, like an edit (the power is looked at BEFORE the action)
    if(!Agents.isPowered(e.triggerUid)){ Controller.intent("agent.skipped",{sheet: null, changeType: null}); return; }
    sheetChangeAction(e);
  });
}

function sheetChangeAction(e){
  dbgLog(e.changeType);
  Router.change(e);
}

function updateAfterEdit(sheetName,editEvent){
  if(getMainSettings().isConfigSheet(sheetName)) AnalyseConfig.run(sheetName,editEvent);
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
