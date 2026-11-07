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
  const menu = ui
      .createAddonMenu()
      .addItem('Autoryzuj', 'startAuthFlow')
      .addItem('Nowy kreator importu', 'insertImportWizard')
      .addItem('Analizuj zapytanie','checkConfigSheet')
      .addItem('Oszacuj wielkość danych','estimateForCurrentSheet')
      .addItem('Pobierz dane dla tego arkusza','refreshCurrentSheet')
      .addItem('Pobierz dane dla wszystkich arkuszy', 'refreshAll')
      .addSubMenu(settingsMenu_(ui));
  if(DeveloperTools.enabled) menu.addSubMenu(devToolsMenu_(ui));        // not in the version users get
  menu.addItem('Wyloguj', 'logoutFlow').addToUi();
}

/**
 * "Ustawienia" submenu: the three tabs of the settings sidebar ("Ustawienia"), each opens the sidebar on its tab. The connection settings (BC tenant, environment, company)
 * are the tab "Połączenie z BC" - the sidebar of their own is gone. The configuration check (agents) runs whenever the sidebar is opened, on whichever tab.
 */
function settingsMenu_(ui){
  return ui.createMenu('Ustawienia').addItem('Ogólne','statusCheck').addItem('Połączenie z BC','connectionSetup').addItem('Auto-odświeżanie','autoRefreshSettings');
}

/** "Narzędzia programisty" submenu. The live check entry exists only while the helper files are in the project. */
function devToolsMenu_(ui){
  const menu = ui.createMenu('Narzędzia programisty').addItem('Wszystkie triggery','listAllTriggers').addItem('Triggery odświeżania','refreshTriggersSidebar');
  if(typeof liveCheckSidebar === "function") menu.addItem('Live check','liveCheckSidebar');
  return menu;
}

/** Menu "Ustawienia" -> "Ogólne" (the old "Stan konfiguracji"). */
function statusCheck(){
  return Controller.run("menuSettingsGeneral",()=>StatusManager.statusSidebar("status"));
}

/** Menu "Ustawienia" -> "Auto-odświeżanie". */
function autoRefreshSettings(){
  return Controller.run("menuSettingsAutoRefresh",()=>StatusManager.statusSidebar("refresh"));
}

function listAllTriggers(){
  DeveloperTools.require();
  return Controller.run("requestListAllTriggers",()=>StatusManager.triggerTableSidebar());
}

function refreshTriggersSidebar(){
  DeveloperTools.require();
  return Controller.run("requestRefreshTriggersSidebar",()=>StatusManager.refreshTriggersSidebar());
}

function checkConfigSheet(){
  return Controller.run("requestCheckConfigSheet",()=>MenuActions.analyseActive());
}

/** Menu "Ustawienia" -> "Połączenie z BC": the settings sidebar on the tab with the connection settings. */
function connectionSetup(){
  Controller.run("menuSettingsConnection",()=>StatusManager.statusSidebar("help"));
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

/**
 * Function triggered by menu selection.
 */
function logoutFlow(){
  Controller.run("menuLogoutFlow",()=>MenuActions.logout());
}
