// Functions responsible for UI Menu management.

/**
 * Builds the add-on menu. It is always the full menu: the connection is not checked any more (the "Autoryzuj" item is in it).
 * 
 * @param isAuthorized {Boolean} Not used (kept for the callers that pass the result of the authorisation).
 */
function menuSelector(isAuthorized){
  fullMenu();
}

/**
 * Menu available when the connection is active.
 */
function fullMenu() {
  const ui = SpreadsheetApp.getUi();
  ui
      .createAddonMenu()
      .addItem('Autoryzuj', 'startAuthFlow')
      .addItem('Stan konfiguracji','statusCheck')
      .addSubMenu(devToolsMenu_(ui))
      .addItem('Nowy kreator importu', 'insertImportWizard')
      .addItem('Analizuj zapytanie','checkConfigSheet')
      .addItem('Oszacuj wielkość danych','estimateForCurrentSheet')
      .addItem('Pobierz dane dla tego arkusza','refreshCurrentSheet')
      .addItem('Pobierz dane dla wszystkich arkuszy', 'refreshAll')
      .addItem('Ustawienia połączenia BC','connectionSetup')
      .addItem('Wyloguj', 'logoutFlow')
      .addItem('Test item','testItem')
      .addToUi();
}

/** "Narzędzia programisty" submenu. The live check entry exists only while the helper files are in the project. */
function devToolsMenu_(ui){
  const menu = ui.createMenu('Narzędzia programisty').addItem('Wszystkie triggery','listAllTriggers');
  if(typeof liveCheckSidebar === "function") menu.addItem('Live check','liveCheckSidebar');
  return menu;
}

function statusCheck(){
  return Controller.run("requestStatusCheck",()=>StatusManager.statusSidebar());
}

function listAllTriggers(){
  return Controller.run("requestListAllTriggers",()=>StatusManager.triggerTableSidebar());
}

function testItem(){
  return Controller.run("menuTestItem",()=>testFunc_errorReporting());
}

function checkConfigSheet(){
  return Controller.run("requestCheckConfigSheet",()=>MenuActions.analyseActive());
}

function connectionSetup(){
  Controller.run("menuConnectionSetup",()=>{
    const html = HtmlService.createTemplateFromFile('Global Settings Side Bar').evaluate()
        .setTitle('Ustawienia połączenia BC');
    SpreadsheetApp.getUi() // Or DocumentApp or SlidesApp or FormApp.
        .showSidebar(html);
  });
}

function refreshCurrentSheet(){
  Controller.run("menuRefreshCurrentSheet",()=>MenuActions.refreshActive());
}

function estimateForCurrentSheet(){
  Controller.run("menuEstimateForCurrentSheet",()=>MenuActions.estimateActive());
}

/**
 * Function triggered by menu selection.
 * 
 * showSidebar() is responsible for actual authorization flow.
 */
function startAuthFlow() {
  Controller.run("menuAuthFlow",()=>MenuActions.authorise());
}

/**
 * Function triggered by menu selection.
 * 
 * tbc.
 */
function insertImportWizard(){
  Controller.run("menuInsertImportWizard",()=>MenuActions.insertWizard());
}

function refreshAll(){
  Controller.run("menuRefreshAll",() => RefreshAll.all());
}

/** Kept under its old name; the work is in RefreshAll.js. */
function refreshAllTrue(){
  RefreshAll.ticked();
}

/** Kept under its old name (Test Functions.js, anything that still calls it); the work is in RefreshSheet.js. */
function refreshAllDataForConfigSheet(configSheetName,resultSheetName){
  return RefreshSheet.run(configSheetName,resultSheetName);
}

/** Kept under its old name; the work is in EstimateSheet.js. */
function estimateResponseSize(configSheetName){
  return EstimateSheet.run(configSheetName);
}

/**
 * Function triggered by menu selection.
 */
function logoutFlow(){
  Controller.run("menuLogoutFlow",()=>MenuActions.logout());
}
