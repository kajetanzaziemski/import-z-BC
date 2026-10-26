// The authenticated fetch of one BC url (the token comes from BCAuth). Used by the OData reads and the metadata download.

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
