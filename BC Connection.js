// The authenticated fetch of one BC url (the token comes from BCAuth). Used by the OData reads and the metadata download.
// Every request is logged: a line before it is sent (execution log only - if the run dies inside the request, that is the last line) and a line when it is over
// (status, size, time, time spent on the token; or the error) - RefreshLog.trace, so it is in the execution log and in the technical column of the download log.

const BC_TRACE_URL_CHARS = 300;       // the url in the kept trace (the execution log has it whole)

class BCConnection{
  static fetchURL(url){
    const n = BCConnection.requestCount_ = (BCConnection.requestCount_ || 0) + 1;
    const started = Date.now();
    BCConnection.log_("live",`HTTP #${n} GET ${url}`);
    let tokenMs = 0;
    try{
      var response = (() => {
        const token = BCAuth.accessToken();
        tokenMs = Date.now() - started;
        return UrlFetchApp.fetch(url, {
          headers: {
            Authorization: 'Bearer ' + token
          }
          ,muteHttpExceptions: true
        });
      })();
    }
    catch(error){
      BCConnection.log_("trace",`HTTP #${n} FAILED after ${Date.now() - started} ms (token ${tokenMs} ms): ${error && error.message || error} | ${BCConnection.shortUrl_(url)}`);
      if(error.message == "Access not granted or expired.") throw new ConnectionError("Access not granted or expired.");
      if(error.message == "Limit Exceeded: URLFetch URL Length.") throw new Error("Zbyt długie zapytanie. Ogranicz opcje.");
      else throw error;
    }
    BCConnection.log_("trace",`HTTP #${n} ${BCConnection.describe_(response)} in ${Date.now() - started} ms (token ${tokenMs} ms) | ${BCConnection.shortUrl_(url)}`);
    return response;
  }

  /** "200, 1234567 B" - never throws (a fake response in a test has neither). */
  static describe_(response){
    try{
      const code = typeof response.getResponseCode == "function" ? response.getResponseCode() : "?";
      const bytes = typeof response.getContent == "function" ? `${response.getContent().length} B` : "? B";
      return `${code}, ${bytes}`;
    }catch(err){ return "?"; }
  }

  static shortUrl_(url){
    const s = String(url);
    return s.length > BC_TRACE_URL_CHARS ? s.slice(0,BC_TRACE_URL_CHARS) + `... (${s.length} chars)` : s;
  }

  /** @param method "trace" (kept) or "live" (execution log only). Logging never fails a request. */
  static log_(method, text){
    try{ if(typeof RefreshLog !== "undefined") RefreshLog[method](text); }catch(err){}
  }
}
