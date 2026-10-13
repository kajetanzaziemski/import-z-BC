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
  //     Logger.log("Calling BC Service failed.");
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
      .addItem('Narzędzia programisty','listAllTriggers') 
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
  // Logger.log("activeSheet: "+activeSheet);
  let mStgs = getMainSettings();
  let configSheet = mStgs.getConfigSheetName(activeSheet);
  // Logger.log("configSheet: "+configSheet);
  if(configSheet) refreshAllDataForConfigSheet(configSheet);
  else Controller.registerClosingOnce(()=>SpreadsheetApp.getUi().alert("Wybrany arkusz nie jest arkszuem konfiguracji. \n Zobacz: menu Rozszerzenia -> Import z BC -> Pomoc."),"userAlertNoConfigSheet");
}

function estimateForCurrentSheet(){
  Controller.run("menuEstimateForCurrentSheet",estimateForCurrentSheet_script);
}

function estimateForCurrentSheet_script(){
  let activeSheet = SpreadsheetApp.getActive().getActiveSheet().getName();
  let mStgs = getMainSettings();
  configSheet = mStgs.getConfigSheetName(activeSheet);
  if(configSheet) estimateResponseSize(configSheet);
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
  Controller.run("menuRefreshAll",() => getMainSettings().getSheetList().forEach(cfg => refreshAllDataForConfigSheet(cfg.configSheet,cfg.resultSheet)));
}

function refreshAllTrue(){
  let sList = getMainSettings().getSheetListWithRefreshTrue();
  if(sList.length) sList.forEach(cfg => refreshAllDataForConfigSheet(cfg.configSheet,cfg.resultSheet));
}

function refreshAllDataForConfigSheet(configSheetName,resultSheetName){
  configSheetName = configSheetName ?? getMainSettings().getConfigSheetNames()[0];
  let shCoed = new SheetCoeditor(configSheetName,true);
  try{ 
    if(!shCoed.getTable()){
      Logger.log("No table in config sheet. Quitting.");
      shCoed.switchReadingControl(false);
      return;
    }
    
    var odConnection = new ODataConnection()
      .setODataQuery(shCoed.getTable(),shCoed.getTableQueryArray(),shCoed.getDataTypes())
      .setExtendQuery(shCoed.getExtendTable(),shCoed.getExtendQueryArray(),shCoed.getDataTypes())
      .setupConnection();
    // odConnection.queryURL = odConnection.queryURL.replace("S.A.","sa");
    Logger.log(odConnection.queryURL);
    
    odConnection.readAllPages(shCoed);

    var columnDataTypes = odConnection.getColumnInfo().map(info => getMetadata().getDataType(info.field,info.table ?? shCoed.getTable()));
  } catch(e) {
    shCoed.switchReadingControl(false);
    throw e;  
  }
  shCoed.switchReadingControl(false);
  shCoed.switchDataWritingControl(true);
  try{  
    var table1 = odConnection.getDataArray();

    var sheetName = resultSheetName ?? getMainSettings().getResultSheetName(configSheetName);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.getDataRange().clear();
    Logger.log(columnDataTypes);
    columnDataTypes.forEach((dataType,index)=>{
      sheet.getRange(1,index+1,table1.length,1).setNumberFormat(new DataType(dataType).getSpreadsheetNumberFormat()); 
    });
    sheet.getRange(1, 1, table1.length, table1[0].length).setValues(table1); 
  } catch (e) {
    shCoed.switchDataWritingControl(false);
    throw e;  
  }
  shCoed.switchDataWritingControl(false);
}

function estimateResponseSize(configSheetName){
  configSheetName = configSheetName ?? getMainSettings().getConfigSheetNames()[0];
  var shCoed = new SheetCoeditor(configSheetName,true);
  try{
    if(!shCoed.getTable()){
      Logger.log("No table in config sheet. Quitting.")
      return;
    }   
  } catch(e) {
    shCoed.switchReadingControl(false);
    throw e;
  }
  shCoed.switchReadingControl(false);
  shCoed.switchConnectionControl(true);
  try{
    var odConnection = new ODataConnection()
      .setODataQuery(shCoed.getTable(),shCoed.getTableQueryArray(),shCoed.getDataTypes())
      .setExtendQuery(shCoed.getExtendTable(),shCoed.getExtendQueryArray(),shCoed.getDataTypes())
      .setupConnection();
    // odConnection.queryURL = odConnection.queryURL.replace("S.A.","sa");
    Logger.log(odConnection.queryURL);
    odConnection.fetchHttpResponse();
    odConnection.readPage();
    Logger.log(odConnection.getTotalRows());
  } catch(e) {
    shCoed.switchConnectionControl(false);
    throw e;  
  }
  shCoed.switchConnectionControl(false);
  shCoed.setTotRowsInfo(odConnection.getTotalRows());
}

function getTable(tableName,queryText) {
  var request = ODATA_URL_+`/Company('Megaron%20S.A.')/${tableName}`;
  request += "?"+(queryText ?? "$top=100");
  request += "&$count=true";
  Logger.log(request);
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