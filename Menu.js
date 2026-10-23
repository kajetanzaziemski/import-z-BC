// Functions responsible for UI Menu management.

/**
 * Configures menu options based on whether the connection to BS is active.
 * 
 * @param isAuthorized {Boolean} Optional. If not provided a check to bcService is performed (.hasAccess() method).
 */
function menuSelector(isAuthorized){
  // if(!isAuthorized) 
  // {
  //   try{
  //     var bcService = getBCService_();
  //     isAuthorized = bcService.hasAccess();
  //   }
  //   catch{
  //     dbgLog("Calling BC Service failed.");
  //   }
  // }
  // isAuthorized ? fullMenu() : basicMenu();
  fullMenu();
}

/**
 * Menu available without connection to BC. The only option is to start authorization flow
 * to estabilish a new connection.
 */
function basicMenu() {
  const ui = SpreadsheetApp.getUi();
  ui
      .createAddonMenu()
      .addItem('Autoryzuj', 'startAuthFlow')
      .addToUi();
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
  return Controller.run("requestCheckConfigSheet",() => {
    let activeSheet = SpreadsheetApp.getActive().getActiveSheet().getName();
    let mStgs = getMainSettings();
    let configSheet = mStgs.getConfigSheetName(activeSheet);
    if(configSheet) updateAfterEdit(configSheet);
    else Controller.registerClosingOnce(()=>SpreadsheetApp.getUi().alert("Wybrany arkusz nie jest arkszuem konfiguracji. \n Zobacz: menu Rozszerzenia -> Import z BC -> Pomoc."),"userAlertNoConfigSheet");
  });
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
  Controller.run("menuRefreshCurrentSheet",refreshCurrentSheet_script);
}

function refreshCurrentSheet_script(){
  let activeSheet = SpreadsheetApp.getActive().getActiveSheet().getName();
  // dbgLog("activeSheet: "+activeSheet);
  let mStgs = getMainSettings();
  let configSheet = mStgs.getConfigSheetName(activeSheet);
  // dbgLog("configSheet: "+configSheet);
  if(configSheet) RefreshSheet.run(configSheet);
  else Controller.registerClosingOnce(()=>SpreadsheetApp.getUi().alert("Wybrany arkusz nie jest arkszuem konfiguracji. \n Zobacz: menu Rozszerzenia -> Import z BC -> Pomoc."),"userAlertNoConfigSheet");
}

function estimateForCurrentSheet(){
  Controller.run("menuEstimateForCurrentSheet",estimateForCurrentSheet_script);
}

function estimateForCurrentSheet_script(){
  let activeSheet = SpreadsheetApp.getActive().getActiveSheet().getName();
  let mStgs = getMainSettings();
  const configSheet = mStgs.getConfigSheetName(activeSheet);
  if(configSheet) EstimateSheet.run(configSheet);
}

/**
 * Function triggered by menu selection.
 * 
 * showSidebar() is responsible for actual authorization flow.
 */
function startAuthFlow() {
  Controller.run("menuAuthFlow",()=> {
    var bcService = getBCService_();
    if (!bcService.hasAccess()) showSidebar(); 
    else {
      // If the connection is active nothing happens. 
      // The alert is shown to inform the user that the function run properly.
      SpreadsheetApp.getUi()
        .alert('Połączenie aktywne!');
      
      // fullMenu();
    }
  });
}

/**
 * Function triggered by menu selection.
 * 
 * tbc.
 */
function insertImportWizard(){
  Controller.run("menuInsertImportWizard",() => {
    let impWizData = getMainSettings().addNewSheetInfo();
    updateAfterEdit(impWizData.configSheet);
  });
}

function refreshAll(){
  Controller.run("menuRefreshAll",() => getMainSettings().getSheetList().forEach(cfg => RefreshSheet.run(cfg.configSheet,cfg.resultSheet)));
}

function refreshAllTrue(){
  let sList = getMainSettings().getSheetListWithRefreshTrue();
  if(sList.length) sList.forEach(cfg => RefreshSheet.run(cfg.configSheet,cfg.resultSheet));
}

/** Kept under its old name (Test Functions.js, anything that still calls it); the work is in RefreshSheet.js. */
function refreshAllDataForConfigSheet(configSheetName,resultSheetName){
  return RefreshSheet.run(configSheetName,resultSheetName);
}

/** Kept under its old name; the work is in EstimateSheet.js. */
function estimateResponseSize(configSheetName){
  return EstimateSheet.run(configSheetName);
}

function getTable(tableName,queryText) {
  var request = ODATA_URL_+`/Company('Megaron%20S.A.')/${tableName}`;
  request += "?"+(queryText ?? "$top=100");
  request += "&$count=true";
  dbgLog(request);
  return getTableWithRequest(request);
}

function getTableWithRequest(requestURL){
  if(!requestURL) return null;
  var bcService = getBCService_();
  var response = UrlFetchApp.fetch(requestURL, {
    headers: {
      Authorization: 'Bearer ' + bcService.getAccessToken()
    }
    ,muteHttpExceptions: true
  });
  return new ODataResponseTable(response.getContentText());
}

/**
 * Function triggered by menu selection.
 */
function logoutFlow(){
  // End the connection.
  Controller.run("menuLogoutFlow",() => {
    logout();

    // Reconfigure options available in the menu.
    Controller.registerClosingOnce(menuSelector,"menuSelector");
  });
}