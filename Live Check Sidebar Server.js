/**
 * Live check helpers - sidebar ("Narzędzia programisty" -> "Live check").
 *
 * The sidebar polls liveCheckSidebarData() and shows the recent runs, newest first, including the ones that are still
 * running (a run is stored as "RUN" when it starts and overwritten with its result when it ends). The three server functions
 * below are monitoring tools: they are deliberately NOT checked themselves (they are called every few seconds and would
 * fill the list with their own runs).
 */
const LC_SIDEBAR_ROWS = 40;
const LC_RUN_STALE_MS = 10 * 60 * 1000;   // a run without a result for this long is shown as LOST

function liveCheckSidebar(){
  return Controller.run("requestLiveCheckSidebar",() => {
    const html = HtmlService.createHtmlOutputFromFile('Live Check Sidebar').setTitle('Live check');
    SpreadsheetApp.getUi().showSidebar(html);
  });
}

/**
 * @param clientToken {String} Token of the list the sidebar already shows. When nothing changed, only the token and
 *   the switch state come back (rows = null).
 */
function liveCheckSidebarData(clientToken){
  const now = Date.now();
  const rows = lcStoredResults_().slice(0,LC_SIDEBAR_ROWS).map(e => ({
    k: e.k,
    t: e.t,
    a: e.a,
    s: e.s == "RUN" && now - Date.parse(e.t) > LC_RUN_STALE_MS ? "LOST" : e.s,
    ms: e.ms,
    bad: e.c.filter(x => x[0] == "FAIL" || x[0] == "WARN").length
  }));
  const token = rows.map(r => r.k + r.s + r.ms).join("|");
  return {
    enabled: liveCheckIsEnabled(),
    token: token,
    rows: token === clientToken ? null : rows
  };
}

/** The run as liveCheckReport() prints it. */
function liveCheckSidebarDetail(key){
  if(typeof key !== "string" || key.indexOf(LIVE_CHECK_RESULT_PREFIX) != 0) return "Unknown run.";
  const raw = PropertiesService.getDocumentProperties().getProperty(key);
  if(!raw) return "This result is no longer stored.";
  const entry = JSON.parse(raw);
  if(entry.s == "RUN" && Date.now() - Date.parse(entry.t) > LC_RUN_STALE_MS) entry.s = "LOST";
  return lcFormat_(entry);
}

function liveCheckSidebarSetEnabled(on){
  if(on) liveCheckEnable(); else liveCheckDisable();
  return liveCheckIsEnabled();
}
