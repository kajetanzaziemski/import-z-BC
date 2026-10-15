/**
 * Single-edit agent detection.
 *
 * Every user edit fires two handlers: the simple onEdit() and the installable sheetEdit() ("agent").
 * Only the simple trigger judges. The installable one just records that it ran for the edit
 * (recordInstallableSeen), the simple one waits for that record (waitForInstallable) and raises an alarm if it never comes.
 *
 * A single missing record does not power the agent off: the installable trigger may only be late, and a powered-off
 * agent would stay dead (sheetEdit quits early when the trigger is powered off). Instead the first miss sets a "suspect"
 * flag, any later installable run clears it, and a second miss with no installable run in between powers all agents off.
 */
const INSTAL_TRACE_KEY = "instalTraceKey_";
const AGENT_SUSPECT_KEY = "agentSuspect";
const TRACE_TTL_S = 30;            // how long an unconsumed installable record lives
const INSTAL_WAIT_MS = 12000;      // simple triggers are limited to 30 s
const INSTAL_POLL_MS = 500;
const LOCK_WAIT_MS = 5000;

function fingerprint(e) {
  const range = e.range;
  return range.getSheet().getName() + '!' + range.getA1Notation();
}

function getKey(traceKey,fp){
  return 'edit:'+fp+traceKey;
}

/**
 * Runs action under the document lock (not the script lock, which would serialise all documents and
 * queue behind long coedit runs). When the lock cannot be obtained, the action still runs if runUnlocked is true.
 */
function withDocumentLock(action, runUnlocked, fallback){
  let lock = null, locked = false;
  try{
    lock = LockService.getDocumentLock();
    if(lock) locked = lock.tryLock(LOCK_WAIT_MS);
  } catch(err) { Logger.log(`withDocumentLock: could not acquire lock: ${err}`); }
  if(!locked && !runUnlocked) return fallback;
  try{
    return action();
  } finally {
    if(locked) lock.releaseLock();
  }
}

// - - - - - - - - installable side - - - - - - - -

/** Called by the installable trigger for every edit, before the power check. */
function recordInstallableSeen(e){
  const key = getKey(INSTAL_TRACE_KEY,fingerprint(e));
  withDocumentLock(() => {
    // A counter, not a flag: two quick edits of the same cell must each be matched by their own simple trigger.
    const n = Number(HelperDataStore.getDocumentCacheValue(key) || 0);
    HelperDataStore.setDocumentCacheValue(key,String(n+1),TRACE_TTL_S);
    clearAgentSuspect();
  }, true);
}

// - - - - - - - - simple trigger side - - - - - - - -

/** Called by the simple onEdit trigger. */
function checkInstallableAgentRan(e){
  const fp = fingerprint(e);
  if(waitForInstallable(fp,INSTAL_WAIT_MS)) return;
  Logger.log(`No installable edit event for ${fp} after ${INSTAL_WAIT_MS} ms.`);
  raiseAgentAlarm(fp);
}

function waitForInstallable(fp,maxMs){
  const key = getKey(INSTAL_TRACE_KEY,fp);
  const start = Date.now();
  do{
    // Cheap unlocked peek; the lock is only taken when there is something to consume.
    if(HelperDataStore.getDocumentCacheValue(key) && consumeInstallableTrace(key)) return true;
    Utilities.sleep(INSTAL_POLL_MS);
  } while(Date.now() - start < maxMs);
  return false;
}

function consumeInstallableTrace(key){
  return withDocumentLock(() => {
    const n = Number(HelperDataStore.getDocumentCacheValue(key) || 0);
    if(n <= 0) return false;
    if(n == 1) HelperDataStore.deleteDocumentCache(key);
    else HelperDataStore.setDocumentCacheValue(key,String(n-1),TRACE_TTL_S);
    return true;
  }, false, false);
}

// - - - - - - - - alarm - - - - - - - -

function raiseAgentAlarm(fp){
  const alreadySuspect = withDocumentLock(() => {
    const suspect = getAgentSuspect();
    if(!suspect) setAgentSuspect(fp);
    return suspect != null;
  }, true);
  if(alreadySuspect) {
    // Second miss and no installable run since the first: treat the agent as dead.
    Logger.log("Alert: second missed installable edit event in a row. Powering agents off.");
    if(!StatusManager.basicStatusCheck()) return;   // already powered off and reported, don't nag on every edit
    StatusManager.powerOffAllAgentsInFile();
  } else {
    Logger.log("Alert: installable edit event missing. Agent marked as suspect.");
  }
  StatusManager.lightFailInfo();
}

function getAgentSuspect(){
  const value = HelperDataStore.getDocumentPropertyValue(AGENT_SUSPECT_KEY);
  return value ? JSON.parse(value) : null;
}

function setAgentSuspect(fp){
  HelperDataStore.setDocumentPropertyValue(AGENT_SUSPECT_KEY,JSON.stringify({fp:fp,time:new Date().toISOString()}));
}

function clearAgentSuspect(){
  if(HelperDataStore.getDocumentPropertyValue(AGENT_SUSPECT_KEY) == null) return;
  HelperDataStore.deleteProperty("document",AGENT_SUSPECT_KEY);
  Logger.log("Agent suspect flag cleared.");
}
