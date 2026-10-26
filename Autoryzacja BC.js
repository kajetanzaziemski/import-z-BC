
const OData_Page_Length = 20000;

// Functions adapted from tutorial for OAuth2 library: https://github.com/googleworkspace/apps-script-oauth2

class BCConnection{
  static fetchURL(url){
    try{
      var response = UrlFetchApp.fetch(url, {
        headers: {
          Authorization: 'Bearer ' + BCAuth.accessToken()
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
 * The login to Business Central (OAuth2 library, https://github.com/googleworkspace/apps-script-oauth2). THE ONLY place that talks to the OAuth2 service:
 * everybody else asks BCAuth (the BC fetch, the menu items, the OAuth callback). The tokens live in the USER's properties / cache under the tenant name.
 */
const BCAuth = {
  /**
   * A new OAuth2 service with the name of the BC tenant (the name is used when persisting the authorised token, so it must be unique within the property store).
   * Build it when needed, it keeps no state of its own: tokens are in the stores below.
   */
  service(){
    return OAuth2.createService(getGlobalSettings().getServiceName())

        // Set the endpoint URLs
        .setAuthorizationBaseUrl(getGlobalSettings().getAuthURL())
        .setTokenUrl(getGlobalSettings().getTokenURL())

        // Set the client ID and secret
        .setClientId(CLIENT_ID_)
        .setClientSecret(CLIENT_SECRET_)

        // Set the name of the callback function in the script that should be invoked to complete the OAuth flow (authCallback below).
        .setCallbackFunction('authCallback')

        // Set the property store where authorized tokens should be persisted.
        .setPropertyStore(Store.service("user","properties"))
        .setCache(Store.service("user","cache"))
        .setLock(LockService.getUserLock()) // - - - \ | / - - \ | / - - \ | / - Unprotected access to external services! LOCK SERVICE

        // Set the scopes to request 
        .setScope(SCOPE_)

        .setParam('access_type', 'offline')
        .setParam('prompt', 'consent');
  },

  /** The access token for a request to BC. Throws "Access not granted or expired." when there is none (BCConnection.fetchURL turns it into a ConnectionError). */
  accessToken(){
    return BCAuth.service().getAccessToken();
  },

  /** Is the connection active? Tries to renew an expired token. */
  hasAccess(){
    return BCAuth.service().hasAccess();
  },

  /**
   * "Autoryzuj": true when the connection is active. Otherwise the sidebar with the authorisation link is shown (Apps Script cannot open pop-ups) and false is returned;
   * the user finishes in the browser and authCallback is called by the platform.
   */
  authorise(){
    const service = BCAuth.service();
    if (service.hasAccess()) return true;      // hasAccess() renews an expired token
    const template = HtmlService.createTemplate(
        'Użyj poniższego linku aby nawiązać połączenie z Business Central. Zostaniesz przekierowany na stronę Microsoft. Zaloguj się kontem, którego używasz do pracy z BC. Zaakceptuj przekazanie uprawnień aplikacji "Integracja do arkuszy Google 2". Dane pobierane do arkusza będą odczytywane w Twoim imieniu.' +
        '<br /><br />' +
        '<a href="<?= authorizationUrl ?>" target="_blank">Autoryzuj</a>. ' +
        '<br /> Po nawiązaniu połączenia możesz zamknąć ten panel.');
    template.authorizationUrl = service.getAuthorizationUrl();
    SpreadsheetApp.getUi().showSidebar(template.evaluate());
    return false;
  },

  /** The platform calls back after the user's consent: stores the token. Returns whether the user was authorised; the menu is rebuilt either way. */
  completeCallback(request){
    const isAuthorized = BCAuth.service().handleCallback(request);
    menuSelector(isAuthorized);
    return isAuthorized;
  },

  /** service.reset() removes all the user's data of the service, the active tokens included: the user is logged out. */
  logout(){
    BCAuth.service().reset();
  }
};

// Names kept for callers outside the login flow (Metadata, Test Functions.js, the menu code of the old days): all forward to BCAuth.
function getBCService_(){ return BCAuth.service(); }
function showSidebar(){ BCAuth.authorise(); }
function logout(){ BCAuth.logout(); }

/** Function set as the OAuth callback (BCAuth.service). The result page tells the user to close the tab. */
function authCallback(request) {
  Controller.checkInput("requestAuthCallback",{request});
  return Controller.run("requestAuthCallback",() => {
    if (BCAuth.completeCallback(request)) {
      return HtmlService.createHtmlOutput('Połączenie nawiązane poprawnie. Możesz zamknąć tę stronę.');
    } else {
      return HtmlService.createHtmlOutput('Połączenie nieudane (odmowa autoryzacji)! Możesz zamknąć tę stronę.');
    }
  });
}
