/**
 * Live check helpers - framework.
 *
 * Every entry point of the add-on (triggers, menu items, sidebar server functions, the OAuth callback) runs a crude
 * consistency check of its own result once it has finished. The checks are meant for testing the add-on in a real
 * spreadsheet, so they look at the effect of the run (sheets, formats, validations, properties, triggers) and never
 * re-run the work: nothing here calls Business Central, and long calculations are only judged by their outcome
 * (e.g. number of rows written vs. the estimate stored in the config sheet).
 *
 * The expected results are written down independently in "Live Check Verifiers.js" (they were taken from the code as
 * it is now). When the code changes on purpose, the matching verifier has to change with it.
 *
 * The whole mechanism is OFF unless switched on (liveCheckEnable()), and it never throws into the run it checks.
 * Output: execution log / Cloud Logging lines starting with "[LIVE-CHECK]", a toast on FAIL / WARN, and a ring of the
 * last results in the document properties (liveCheckReport()).
 *
 * Hooks in the add-on code (all go through Controller, which does nothing when this file is missing):
 *   Controller.run()          - brackets every action that goes through it (before snapshot / verify after closing actions)
 *   Controller.checked()      - the same for the entry points that do not use Controller.run()
 *   Controller.checkInput()   - hands the verifier what the action was called with (event object, arguments)
 *   Controller.checkNote()    - lets the code leave a note about a decision it took (used by the agent detection)
 */
const LIVE_CHECK_ENABLED_KEY = "liveCheckEnabled";
const LIVE_CHECK_RESULT_PREFIX = "liveCheck:";
const LIVE_CHECK_MAX_RESULTS = 40;
const LIVE_CHECK_TAG = "[LIVE-CHECK]";

var lcEnabled = null;     // decided once per execution
var lcStack = [];         // frames of the checks in progress (runs can be nested)
var lcInputs = {};        // inputs handed over by liveCheckInput(), by action name

// - - - - - - - - switching - - - - - - - -

function liveCheckIsEnabled(){
  if(lcEnabled !== null) return lcEnabled;
  lcEnabled = false;
  try{ if(PropertiesService.getDocumentProperties().getProperty(LIVE_CHECK_ENABLED_KEY) === "on") lcEnabled = true; } catch(err) {}
  try{ if(PropertiesService.getScriptProperties().getProperty(LIVE_CHECK_ENABLED_KEY) === "on") lcEnabled = true; } catch(err) {}
  return lcEnabled;
}

/**
 * Switch the live checks on. Run it from a context that has the document (script editor of a bound script, "Test as add-on").
 * @param scope {String} "document" (default, this file only) or "script" (every file, every user of the add-on).
 */
function liveCheckEnable(scope="document"){
  lcProperties_(scope).setProperty(LIVE_CHECK_ENABLED_KEY,"on");
  lcEnabled = true;
  Logger.log(`${LIVE_CHECK_TAG} enabled for scope ${scope}.`);
}

function liveCheckDisable(scope="document"){
  lcProperties_(scope).deleteProperty(LIVE_CHECK_ENABLED_KEY);
  lcEnabled = null;
  Logger.log(`${LIVE_CHECK_TAG} disabled for scope ${scope}. (The other scope may still keep it on.)`);
}

function lcProperties_(scope){
  const props = scope == "script" ? PropertiesService.getScriptProperties() : PropertiesService.getDocumentProperties();
  if(!props) throw new Error(`No ${scope} properties in this context.`);
  return props;
}

// - - - - - - - - hooks called by Controller - - - - - - - -

/** Hands over how the action is going to be called. Must be called right before the action starts. */
function liveCheckInput(actionName,data){
  if(!liveCheckIsEnabled()) return;
  lcInputs[actionName] = data;
}

/** Note about a decision taken by the code, available to the verifier of the action running now. */
function liveCheckNote(text){
  if(!lcEnabled || lcStack.length == 0) return;
  const notes = lcStack[lcStack.length-1].notes;
  if(notes.length < 200) notes.push(String(text));
}

/**
 * The running entry point turned out to be a particular JOB (the router calls this through Controller.intent): "config.coedit",
 * "settings.refreshFrequency" ... The run is then reported under that name ("via" the technical entry point) and the verifier of the intent
 * judges what the job was supposed to do. data = { sheet, changeType }.
 */
function liveCheckIntent(name,data){
  if(!lcEnabled || lcStack.length == 0) return;
  try{
    const frame = lcStack[lcStack.length-1];
    frame.intent = String(name);
    frame.intentData = data ?? {};
    lcStoreRunning_(frame);          // the sidebar shows the job while it is still running
  } catch(err) {}
}

/** Starts the check of an action: takes the "before" snapshot. Returns the frame to give to liveCheckEnd(), or null. */
function liveCheckBegin(actionName){
  if(!liveCheckIsEnabled()) return null;
  try{
    const spec = liveCheckVerifiers()[actionName] ?? null;
    const startedAt = Date.now();
    const startedIso = new Date(startedAt).toISOString();
    const frame = {
      actionName: actionName,
      spec: spec,
      startedAt: startedAt,
      startedIso: startedIso,
      key: LIVE_CHECK_RESULT_PREFIX + startedIso + ":" + Math.random().toString(36).slice(2,6),
      input: lcInputs[actionName],
      nested: lcStack.length > 0,      // started while another checked action was still running (e.g. from a closing action)
      notes: [],
      before: {}
    };
    delete lcInputs[actionName];
    (spec?.needs ?? []).forEach(part => frame.before[part] = lcCapture_(part));
    lcStoreRunning_(frame);
    lcStack.push(frame);
    return frame;
  } catch(err) {
    console.error(`${LIVE_CHECK_TAG} could not start the check of ${actionName}: ${err && err.stack || err}`);
    return null;
  }
}

/**
 * Finishes the check: runs the verifier and records the outcome. Never throws.
 * @param note {String} "addon-off" when Controller skipped the action because the add-on is switched off.
 */
function liveCheckEnd(frame,error,result,note){
  if(!frame) return;
  const at = lcStack.indexOf(frame);
  if(at >= 0) lcStack.splice(at,1);
  try{
    const c = new LiveCheckContext(frame,error,result);
    lcRunVerifier_(c,note);
    lcRecord_(c);
  } catch(err) {
    console.error(`${LIVE_CHECK_TAG} internal error when checking ${frame.actionName}: ${err && err.stack || err}`);
  }
}

/** Check around an entry point that does not go through Controller.run(). Passes result and errors through unchanged. */
function liveCheckGuard(actionName,action,input){
  if(!liveCheckIsEnabled()) return action();
  if(input !== undefined) lcInputs[actionName] = input;
  const frame = liveCheckBegin(actionName);
  let result, error;
  try{
    result = action();
    return result;
  } catch(err) {
    error = err;
    throw err;
  } finally {
    liveCheckEnd(frame,error,result);
  }
}

// - - - - - - - - snapshots - - - - - - - -
// A verifier lists the parts it wants in "needs"; they are captured before the action and, on demand, after it.
// Secrets never go into a snapshot (only the keys of OAuth tokens are kept).

const LC_CAPTURE = {
  sheets: () => SpreadsheetApp.getActiveSpreadsheet().getSheets().map(s => ({name: s.getName(), id: s.getSheetId()})),
  activeSheet: () => SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getName(),
  docProps: () => {
    const props = PropertiesService.getDocumentProperties().getProperties();
    Object.keys(props).filter(k => k.indexOf(LIVE_CHECK_RESULT_PREFIX) == 0).forEach(k => delete props[k]);
    if(props.docTriggerArray) props.docTriggerArray = lcNormalizedTriggerLog_(props.docTriggerArray);
    return props;
  },
  userProps: () => {
    const props = PropertiesService.getUserProperties().getProperties();
    return {
      agentArray: props.agentArray ?? null,
      usrTriggerArray: props.usrTriggerArray ? lcNormalizedTriggerLog_(props.usrTriggerArray) : null,
      oauthKeys: Object.keys(props).filter(k => k.indexOf("oauth2.") == 0).sort().join(",")
    };
  },
  triggers: () => ScriptApp.getProjectTriggers().map(t => ({
    id: t.getUniqueId(),
    fn: t.getHandlerFunction(),
    type: String(t.getEventType()),
    ss: t.getTriggerSourceId()
  })).sort((a,b) => a.id < b.id ? -1 : 1),
  settings: () => lcImportSettings_(),
  settingsSheet: () => lcReadSettingsSheet_(),
  // How the activity indicators (B2:D2) of every config sheet look before a run, so that a cell somebody edited by hand is not blamed on the run.
  indicators: () => {
    const settings = lcReadSettingsSheet_();
    const out = {};
    if(!settings.exists) return out;
    settings.configs.forEach(x => {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(x.config);
      if(sheet) out[x.config] = lcIndicatorLook_(sheet);
    });
    return out;
  }
};

function lcCapture_(part){
  try{
    if(!LC_CAPTURE[part]) throw new Error(`unknown snapshot part "${part}"`);
    return LC_CAPTURE[part]();
  } catch(err) {
    return {__unavailable: String(err && err.message || err)};
  }
}

function lcHave_(snapshot){
  return snapshot !== undefined && snapshot !== null && !snapshot.__unavailable;
}

/** Trigger logs rewrite themselves (with new "lastUsed") on most runs; only ids, handlers and power matter. */
function lcNormalizedTriggerLog_(raw){
  try{
    return JSON.stringify(JSON.parse(raw).map(t => [t.triggerId,t.trigFunction,t.powerOn]).sort());
  } catch(err) {
    return raw;
  }
}

// - - - - - - - - context handed to the verifiers - - - - - - - -

class LiveCheckContext{
  constructor(frame,error,result){
    this.actionName = frame.actionName;
    this.input = frame.input ?? {};
    this.notes = frame.notes;
    this.intent = frame.intent ?? null;           // the job the router found (see liveCheckIntent), if any
    this.intentData = frame.intentData ?? {};
    this.nested = frame.nested;
    this.before = frame.before;
    this.startedAt = frame.startedAt;
    this.startedIso = frame.startedIso;
    this.key = frame.key;
    this.durationMs = Date.now() - frame.startedAt;
    this.error = error;
    this.result = result;
    this.errorIsExpected = false;
    this.checks = [];
    this._now = {};
  }

  // - - - - - - - - record - - - - - - - -
  add(status,name,detail=""){
    this.checks.push({status: status, name: name, detail: String(detail).slice(0,300)});
    return status == "PASS";
  }
  pass(name,detail){ return this.add("PASS",name,detail); }
  fail(name,detail){ return this.add("FAIL",name,detail); }
  warn(name,detail){ return this.add("WARN",name,detail); }
  skip(name,detail){ return this.add("SKIP",name,detail); }

  /** FAIL when cond is falsy. */
  expect(name,cond,detailIfWrong=""){
    return cond ? this.pass(name) : this.fail(name,detailIfWrong);
  }

  /** Same, but only a WARN: for things that are suspicious rather than wrong, or that the code is known to get wrong. */
  expectSoft(name,cond,detailIfWrong=""){
    return cond ? this.pass(name) : this.warn(name,detailIfWrong);
  }

  expectEqual(name,actual,expected){
    return JSON.stringify(actual) === JSON.stringify(expected) ? this.pass(name) : this.fail(name,`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  /** Runs a check body that may throw. Authorization limits of simple triggers turn into SKIP, anything else into FAIL. */
  attempt(name,body){
    try{
      return body(this);
    } catch(err) {
      const msg = String(err && err.message || err);
      if(/authori[sz]|permission|not allowed|do not have/i.test(msg)) return this.skip(name,`not possible in this context: ${msg}`);
      return this.fail(name,`check threw: ${msg}`);
    }
  }

  /** The run ended with the add-on's ConnectionError: BC is not authorised / reachable, which a live test has to know about. */
  get connectionDown(){
    return typeof ConnectionError !== "undefined" && this.error instanceof ConnectionError;
  }

  /** The action is supposed to fail this way, e.g. because the connection is not authorised. */
  expectError(predicate,reason){
    if(this.error && predicate(this.error)) this.errorIsExpected = reason;
  }

  // - - - - - - - - state - - - - - - - -
  now(part){
    if(!(part in this._now)) this._now[part] = lcCapture_(part);
    return this._now[part];
  }

  /** Document properties as stored right now (after the closing actions of the run). */
  docProp(key){
    return PropertiesService.getDocumentProperties().getProperty(key);
  }

  settings(){
    return lcImportSettings_();
  }

  spreadsheet(){
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  /** Sheets / properties / triggers are the same as before the action. Properties: allowed lists keys (or RegExps) that may differ. */
  unchanged(part,name,allowed=[]){
    const before = this.before[part], after = this.now(part);
    if(!lcHave_(before) || !lcHave_(after)) return this.skip(name,`no "${part}" snapshot (${before?.__unavailable ?? after?.__unavailable ?? "not requested"})`);
    if(part == "docProps" || part == "userProps"){
      const keys = new Set([...Object.keys(before),...Object.keys(after)]);
      const changed = [...keys].filter(k => before[k] !== after[k]).filter(k => !allowed.some(a => a instanceof RegExp ? a.test(k) : a === k));
      return changed.length == 0 ? this.pass(name) : this.fail(name,`changed: ${changed.join(", ")}`);
    }
    return JSON.stringify(before) === JSON.stringify(after) ? this.pass(name) : this.fail(name,`before ${JSON.stringify(before).slice(0,120)} / after ${JSON.stringify(after).slice(0,120)}`);
  }

  get status(){
    if(this.checks.some(x => x.status == "FAIL")) return "FAIL";
    if(this.checks.some(x => x.status == "WARN")) return "WARN";
    if(this.checks.some(x => x.status == "PASS")) return "PASS";
    return "SKIP";
  }
}

// - - - - - - - - running the verifier - - - - - - - -

function lcRunVerifier_(c,note){
  if(note == "addon-off"){
    c.pass("skipped as the add-on is OFF");
    ["sheets","docProps","triggers"].filter(p => lcHave_(c.before[p])).forEach(p => c.unchanged(p,`${p} untouched while skipped`,[/_coedit$/]));
    return;
  }
  const spec = liveCheckVerifiers()[c.actionName];
  if(!spec) c.skip("verifier","no verifier registered for this entry point");
  else{
    try{ spec.verify(c); }
    catch(err) { c.fail("verifier crashed",err && err.stack || err); }
  }
  // The job the entry point turned out to be is judged on its own, after the technical checks of the entry point.
  if(c.intent){
    const intentSpec = liveCheckVerifiers()[c.intent];
    if(!intentSpec) c.skip(`job ${c.intent}`,"no verifier registered for this job");
    else{
      try{ intentSpec.verify(c); }
      catch(err) { c.fail("verifier crashed",err && err.stack || err); }
    }
  }
  if(c.error){
    if(c.errorIsExpected) c.pass("error expected",c.errorIsExpected);
    else if(c.connectionDown) c.warn("ended with a connection error",`BC not authorised or metadata not cached, so the parts that need BC could not be checked: ${c.error.message}`);
    else c.fail("finished without an error",String(c.error && c.error.message || c.error));
  }
  lcCommonChecks_(c);
}

/** Checks every entry point gets on top of its own. */
function lcCommonChecks_(c){
  const simple = ["simpleOnEdit","onOpen"].includes(c.actionName);
  const limit = simple ? 25000 : 300000;     // simple triggers are killed at 30 s, the others at 6 min
  c.expectSoft("duration within limits",c.durationMs <= limit,`${c.durationMs} ms (limit ${limit} ms)`);
  if(/^menu/.test(c.actionName) && !c.error){
    c.expect("menu action leaves the add-on ON",c.settings().addonStatus === true,`addonStatus is ${JSON.stringify(c.settings().addonStatus)}`);
  }
}

// - - - - - - - - recording - - - - - - - -

/** What a run is called in reports: the job (with its sheet) via the technical entry point, or just the entry point. */
function lcName_(entry){
  return entry.i ? `${entry.i}${entry.d ? " [" + entry.d + "]" : ""} (via ${entry.a})` : entry.a;
}

function lcFormat_(entry){
  if(entry.s == "RUN" || entry.s == "LOST"){
    return `${LIVE_CHECK_TAG} ${entry.s} ${lcName_(entry)} (started ${entry.t}${entry.s == "LOST" ? "; no result was ever recorded - the run was aborted, timed out or crashed" : "; still running"})`;
  }
  const head = `${LIVE_CHECK_TAG} ${entry.s} ${lcName_(entry)} (${entry.ms} ms)`;
  return head + entry.c.map(x => `\n    ${x[0]} ${x[1]}${x[2] ? " - " + x[2] : ""}`).join("");
}

function lcRecord_(c){
  const entry = {
    t: c.startedIso,
    a: c.actionName,
    s: c.status,
    ms: c.durationMs,
    i: c.intent ?? undefined,                     // the job, when the router named one
    d: c.intentData.sheet ?? undefined,           // the sheet it is about
    c: c.checks.map(x => [x.status,x.name,x.detail])
  };
  const text = lcFormat_(entry);
  Logger.log(text);
  if(entry.s == "FAIL") console.error(text); else console.log(text);

  try{
    const props = PropertiesService.getDocumentProperties();
    // A property holds 9 kB at most: drop the details of what passed first, then what passed, then the tail.
    let stored = JSON.stringify(entry);
    if(stored.length > 8500){
      entry.c = entry.c.map(x => x[0] == "PASS" ? [x[0],x[1],""] : x);
      stored = JSON.stringify(entry);
    }
    if(stored.length > 8500){
      entry.c = entry.c.filter(x => x[0] != "PASS");
      stored = JSON.stringify(entry);
    }
    if(stored.length > 8500){
      entry.c = entry.c.slice(0,15);
      stored = JSON.stringify(entry);
    }
    props.setProperty(c.key,stored);
    lcPrune_(props);
  } catch(err) {
    console.error(`${LIVE_CHECK_TAG} could not store the result: ${err}`);
  }

  if(entry.s == "FAIL" || entry.s == "WARN"){
    try{
      const bad = entry.c.filter(x => x[0] == "FAIL" || x[0] == "WARN").map(x => x[1]).join("; ");
      SpreadsheetApp.getActiveSpreadsheet().toast(`${entry.s} ${lcName_(entry)}: ${bad}`.slice(0,200),"Live check",10);
    } catch(err) {}
  }
}

function lcPrune_(props){
  const keys = props.getKeys().filter(k => k.indexOf(LIVE_CHECK_RESULT_PREFIX) == 0).sort();
  keys.slice(0,Math.max(0,keys.length - LIVE_CHECK_MAX_RESULTS)).forEach(k => props.deleteProperty(k));
}

// - - - - - - - - reports (run from the script editor) - - - - - - - -

function lcStoredResults_(){
  const props = PropertiesService.getDocumentProperties();
  return props.getKeys().filter(k => k.indexOf(LIVE_CHECK_RESULT_PREFIX) == 0).sort().reverse().map(k => {
    try{ const entry = JSON.parse(props.getProperty(k)); entry.k = k; return entry; } catch(err) { return null; }
  }).filter(x => x);
}

/** A run is on the list from its start, so that the sidebar can show it while it is still going. */
function lcStoreRunning_(frame){
  try{
    PropertiesService.getDocumentProperties().setProperty(frame.key,JSON.stringify({t: frame.startedIso, a: frame.actionName, i: frame.intent, d: frame.intentData?.sheet ?? undefined, s: "RUN", ms: 0, c: []}));
  } catch(err) {}
}

/** Logs and returns the last results, newest first. onlyBad = true hides what passed. */
function liveCheckReport(limit=20,onlyBad=false){
  const text = lcStoredResults_().filter(e => !onlyBad || e.s == "FAIL" || e.s == "WARN").slice(0,limit).map(lcFormat_).join("\n");
  Logger.log(text || `${LIVE_CHECK_TAG} no results stored.`);
  return text;
}

/** For running from the script editor (no arguments there): the failed and warned runs among the last 40, newest first. */
function reportFailedChecks(){
  return liveCheckReport(40,true);
}

/** One line per entry point: how many times it passed / warned / failed among the stored results. */
function liveCheckSummary(){
  const counts = {};
  lcStoredResults_().filter(e => e.s != "RUN" && e.s != "LOST").forEach(e => {
    const name = e.i ?? e.a;                                  // a run is counted under its job when it has one
    counts[name] = counts[name] ?? {PASS: 0, WARN: 0, FAIL: 0, SKIP: 0};
    counts[name][e.s]++;
  });
  const text = Object.keys(counts).sort().map(a => `${a}: ${JSON.stringify(counts[a])}`).join("\n");
  Logger.log(text || `${LIVE_CHECK_TAG} no results stored.`);
  return counts;
}

function liveCheckClear(){
  const props = PropertiesService.getDocumentProperties();
  props.getKeys().filter(k => k.indexOf(LIVE_CHECK_RESULT_PREFIX) == 0).forEach(k => props.deleteProperty(k));
}

/** Entry points known to the checks and the ones that have no verifier yet. */
function liveCheckCoverage(){
  const verifiers = liveCheckVerifiers();
  const missing = LIVE_CHECK_ENTRY_POINTS.filter(x => !verifiers[x.action]).concat(LIVE_CHECK_INTENTS.filter(x => !verifiers[x.intent]).map(x => ({action: x.intent, entry: "job: " + x.text})));
  const unknown = Object.keys(verifiers).filter(a => !LIVE_CHECK_ENTRY_POINTS.some(x => x.action == a) && !LIVE_CHECK_INTENTS.some(x => x.intent == a));
  Logger.log(`${LIVE_CHECK_TAG} ${LIVE_CHECK_ENTRY_POINTS.length} entry points listed, ${missing.length} without a verifier${missing.length ? ": " + missing.map(x => x.action).join(", ") : ""}; verifiers not matching a listed entry point: ${unknown.join(", ") || "none"}.`);
  return {missing: missing, unknown: unknown};
}

/**
 * The JOBS an entry point can turn out to be (the router, Router.js, announces them with Controller.intent()). The same technical trigger means
 * very different things: these are what the user cares about, and what the report is headed with. Each has a verifier of its own.
 */
const LIVE_CHECK_INTENTS = [
  {intent: "config.coedit",              text: "a config sheet was edited or changed: its query lines and dropdowns (with notes) are completed"},
  {intent: "settings.refreshFrequency",  text: "the refresh frequency in the settings sheet was edited: the time trigger and its permit are set up"},
  {intent: "settings.edit",              text: "another edit in the settings sheet: nothing to do"},
  {intent: "sheet.ignored",              text: "an edit or change in a sheet the add-on does not manage: nothing to do"},
  {intent: "change.ignored",             text: "a change of type EDIT or FORMAT (the cells are handled by the edit trigger): nothing to do"},
  {intent: "agent.skipped",              text: "the edit trigger is powered off or not logged: the edit is skipped"},
  {intent: "refresh.scheduled",          text: "the time trigger holds the refresh permit: the ticked sheets are refreshed, the time is noted, the permit records the run"},
  {intent: "refresh.retired",            text: "the time trigger does not hold the refresh permit: it deletes itself and nothing is refreshed"}
];

/** Logs and returns the catalogue of jobs. */
function liveCheckIntents(){
  const text = LIVE_CHECK_INTENTS.map(x => `${x.intent}: ${x.text}`).join("\n");
  Logger.log(text);
  return text;
}

/**
 * Every action name given to Controller.run() / Controller.checked() in the add-on. Add new entry points here together
 * with their verifier (Live Check Verifiers.js).
 */
const LIVE_CHECK_ENTRY_POINTS = [
  {action: "onOpen",                          entry: "onOpen(e) - simple trigger: the menu is built first (outside the controller), then the status check where authorised"},
  {action: "simpleOnEdit",                    entry: "onEdit(e) - simple trigger"},
  {action: "sheetEditAction",                 entry: "sheetEdit(e) - installable onEdit trigger (the agent)"},
  {action: "sheetChangeAction",               entry: "sheetChange(e) - installable onChange trigger (the agent)"},
  {action: "requestAutoRefesh",               entry: "autoRefreshHandler(e) / autoRefresh(e) - time-based trigger"},
  {action: "menuAuthFlow",                    entry: "menu: Autoryzuj"},
  {action: "requestStatusCheck",              entry: "menu: Stan konfiguracji"},
  {action: "requestListAllTriggers",          entry: "menu: Narzędzia programisty -> Wszystkie triggery"},
  {action: "requestShowCellValidation",       entry: "menu: Narzędzia programisty -> Weryfikacja danych komórki"},
  {action: "requestBuildValidationLab",       entry: "menu: Narzędzia programisty -> Test weryfikacji (arkusz roboczy)"},
  {action: "requestLiveCheckSidebar",         entry: "menu: Narzędzia programisty -> Live check"},
  {action: "menuInsertImportWizard",          entry: "menu: Nowy kreator importu"},
  {action: "requestCheckConfigSheet",         entry: "menu: Analizuj zapytanie"},
  {action: "menuEstimateForCurrentSheet",     entry: "menu: Oszacuj wielkość danych"},
  {action: "menuRefreshCurrentSheet",         entry: "menu: Pobierz dane dla tego arkusza"},
  {action: "menuRefreshAll",                  entry: "menu: Pobierz dane dla wszystkich arkuszy"},
  {action: "menuConnectionSetup",             entry: "menu: Ustawienia połączenia BC"},
  {action: "menuLogoutFlow",                  entry: "menu: Wyloguj"},
  {action: "requestSettingsSheetName",        entry: "sidebar: getImportSettingsSheetName()"},
  {action: "requestSetSettingsSheetName",     entry: "sidebar: setImportSettingsSheetName(name)"},
  {action: "requestAddonStatus",              entry: "sidebar: getAddonStatus()"},
  {action: "requestChangeAddonStatus",        entry: "sidebar: changeAddonStatus(newStatus)"},
  {action: "requestPermitsInfo",              entry: "sidebar: getPermitsInfo()"},
  {action: "forceAgentRefresh",               entry: "sidebar / closing action: forceAgentRefresh()"},
  {action: "requestDeleteAllAgents",          entry: "sidebar: deleteAllAgents()"},
  {action: "deleteAllInDocumentTriggerLog",   entry: "sidebar: deleteAllInDocumentTriggerLog()"},
  {action: "deleteAllInUserTriggerLog",       entry: "sidebar: deleteAllInUserTriggerLog()"},
  {action: "requestAgentStatus",              entry: "sidebar: getAgentStatus()"},
  {action: "requestListProjectTriggers",     entry: "sidebar: listProjectTriggers()"},
  {action: "requestSetGlobalSettings",       entry: "sidebar: setGlobalSettings(form)"},
  {action: "requestAuthCallback",            entry: "OAuth callback: authCallback(request)"}
];
