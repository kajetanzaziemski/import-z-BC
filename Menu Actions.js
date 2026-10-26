// The use cases behind the add-on menu items (Menu.js has the entry points: the Controller run, the action name, nothing else).
// "The active sheet" is looked up here once for every item that works on a config sheet.
const MenuActions = {
  /** The config sheet that belongs to the sheet the user is on (the sheet itself or its result sheet), or null. */
  activeConfigSheet(){
    const activeSheet = SpreadsheetApp.getActive().getActiveSheet().getName();
    return getMainSettings().getConfigSheetName(activeSheet);
  },

  /** The user is on a sheet that is not a config sheet: one alert when the run closes. */
  warnNotConfigSheet(){
    Controller.registerClosingOnce(()=>SpreadsheetApp.getUi().alert("Wybrany arkusz nie jest arkszuem konfiguracji. \n Zobacz: menu Rozszerzenia -> Import z BC -> Pomoc."),"userAlertNoConfigSheet");
  },

  /** "Analizuj zapytanie": reads the config sheet again and sets up its lines and dropdowns. */
  analyseActive(){
    const configSheet = MenuActions.activeConfigSheet();
    if(configSheet) updateAfterEdit(configSheet);
    else MenuActions.warnNotConfigSheet();
  },

  /** "Pobierz dane dla tego arkusza". */
  refreshActive(){
    const configSheet = MenuActions.activeConfigSheet();
    if(configSheet) RefreshSheet.run(configSheet);
    else MenuActions.warnNotConfigSheet();
  },

  /** "Oszacuj wielkość danych" (on any other sheet it does nothing, without a warning). */
  estimateActive(){
    const configSheet = MenuActions.activeConfigSheet();
    if(configSheet) EstimateSheet.run(configSheet);
  },

  /** "Nowy kreator importu": a new config line on the settings sheet, then its config sheet is analysed. */
  insertWizard(){
    const impWizData = getMainSettings().addNewSheetInfo();
    updateAfterEdit(impWizData.configSheet);
  },

  /** "Autoryzuj": the authorisation sidebar, or just a notice when the connection is active. */
  authorise(){
    const bcService = getBCService_();
    if (!bcService.hasAccess()) showSidebar();
    else SpreadsheetApp.getUi().alert('Połączenie aktywne!');      // nothing happens; the alert tells the user the function ran properly
  },

  /** "Wyloguj": ends the connection, the menu is rebuilt when the run closes. */
  logout(){
    logout();
    Controller.registerClosingOnce(menuSelector,"menuSelector");
  }
};
