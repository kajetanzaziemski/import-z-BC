
const OData_Page_Length = 20000;

// Functions adapted from tutorial for OAuth2 library: https://github.com/googleworkspace/apps-script-oauth2

class BCConnection{
  static fetchURL(url){
    var bcService = getBCService_();
    try{
      var response = UrlFetchApp.fetch(url, {
        headers: {
          Authorization: 'Bearer ' + bcService.getAccessToken()
        }
        ,muteHttpExceptions: true
      });
    }
    catch(error){
      if(error.message == "Access not granted or expired.") throw new ConnectionError("Access not granted or expired.");
      if(error.message == "Limit Exceeded: URLFetch URL Length.") throw new Error("Zbyt długie zapytanie. Ogranicz opcje.");
      else throw error;
    }
    return response;
  }
}

/** 
 * Create a new service with the given name. The name will be used when
 * persisting the authorized token, so ensure it is unique within the
 * scope of the property store.
 **/
function getBCService_(){
  // dbgLog(getGlobalSettings().getServiceName());
  return OAuth2.createService(getGlobalSettings().getServiceName())

      // Set the endpoint URLs
      .setAuthorizationBaseUrl(getGlobalSettings().getAuthURL())
      .setTokenUrl(getGlobalSettings().getTokenURL())

      // Set the client ID and secret
      .setClientId(CLIENT_ID_)
      .setClientSecret(CLIENT_SECRET_)

      // Set the name of the callback function in the script referenced
      // above that should be invoked to complete the OAuth flow.
      .setCallbackFunction('authCallback')

      // Set the property store where authorized tokens should be persisted.
      .setPropertyStore(HelperDataStore.getUserProperties())
      .setCache(HelperDataStore.getUserCache())
      .setLock(LockService.getUserLock()) // - - - \ | / - - \ | / - - \ | / - Unprotected access to external services! LOCK SERVICE

      // Set the scopes to request 
      .setScope(SCOPE_)
      
      .setParam('access_type', 'offline')
      .setParam('prompt', 'consent')
      
      ;

}

/** 
 * Wyświetl panel z linkiem autoryzacyjnym. (Apps Script nie może otwierać wyskakujących okienek.)
 * .hasAccess() próbuje odnowić token jeśli stracił ważność.
 **/
function showSidebar() {
  var bcService = getBCService_();
  if (!bcService.hasAccess()) {
    var authorizationUrl = bcService.getAuthorizationUrl();
    
    
    var template = HtmlService.createTemplate(
        'Użyj poniższego linku aby nawiązać połączenie z Business Central. Zostaniesz przekierowany na stronę Microsoft. Zaloguj się kontem, którego używasz do pracy z BC. Zaakceptuj przekazanie uprawnień aplikacji "Integracja do arkuszy Google 2". Dane pobierane do arkusza będą odczytywane w Twoim imieniu.' +
        '<br /><br />' +
        '<a href="<?= authorizationUrl ?>" target="_blank">Autoryzuj</a>. ' +
        '<br /> Po nawiązaniu połączenia możesz zamknąć ten panel.');
    template.authorizationUrl = authorizationUrl;
    var page = template.evaluate();
    SpreadsheetApp.getUi().showSidebar(page);
  } else {
    dbgLog("Access denied!")
  }
}

/** 
 * Funkcja odbierająca wynik autoryzacji (ustawiona przez .setCallbackFunction w getBCService_())
 **/
function authCallback(request) {
  return Controller.checked("authCallback",() => {
    var bcService = getBCService_();
    var isAuthorized = bcService.handleCallback(request);
    postAuthorizationFlow(isAuthorized);
    if (isAuthorized) {
      return HtmlService.createHtmlOutput('Połączenie nawiązane poprawnie. Możesz zamknąć tę stronę.');
    } else {
      return HtmlService.createHtmlOutput('Połączenie nieudane (odmowa autoryzacji)! Możesz zamknąć tę stronę.');
    }
  },{request});
}

/** 
 * service.reset() usuwa wszystkie dane użytkownika, w tym aktywne tokeny, skutując wylogowaniem.
 **/
function logout() {
  var service = getBCService_()
  service.reset();
}

/** 
 * authCallback(request) is set as a callback function. It then calls for postAuthotizationFlow to perform any tasks
 * within the spreadsheet that should be run after cofirming auth status (isAuthorized).
 * 
 * @param isAuthorized {Boolean}
 **/
function postAuthorizationFlow(isAuthorized){
  // menuSelector() is defined in menu.gs file.
  menuSelector(isAuthorized);
}