// The authenticated fetch of one BC url (the token comes from BCAuth). Used by the OData reads and the metadata download.

class BCConnection{
  /** Debug log of the BC requests (always on, GAS Logger). Never allowed to break a run. */
  static queryLog(buildText){
    try{ Logger.log("[BC-QUERY] " + buildText()); } catch(e){}
  }

  static fetchURL(url){
    const started = Date.now();
    try{
      var response = UrlFetchApp.fetch(url, {
        headers: {
          Authorization: 'Bearer ' + BCAuth.accessToken()
        }
        ,muteHttpExceptions: true
      });
    }
    catch(error){
      BCConnection.queryLog(() => `GET ${url}\n  FAILED after ${Date.now() - started} ms: ${error.message}`);
      if(error.message == "Access not granted or expired.") throw new ConnectionError("Access not granted or expired.");
      if(error.message == "Limit Exceeded: URLFetch URL Length.") throw new Error("Zbyt długie zapytanie. Ogranicz opcje.");
      else throw error;
    }
    const elapsed = Date.now() - started;
    BCConnection.queryLog(() => `GET ${url}\n  -> HTTP ${response.getResponseCode()}, ${elapsed} ms, ${response.getContent().length} bytes`);   // the Authorization header (token) is deliberately not logged
    return response;
  }
}
