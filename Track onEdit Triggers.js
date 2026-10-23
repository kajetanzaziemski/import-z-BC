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
 *
 * Logging: every line written by this mechanism starts with "[AGENT-CHECK <time> #<execution>]", see agentLog().
 * Grep the execution log for "AGENT-CHECK" to follow one edit: the simple (SIMPLE) and installable (INSTALLABLE) lines
 * of the same edit share the sheet!range, the "#xxxx" tells apart the executions running at the same time.
 */
const INSTAL_TRACE_KEY = "instalTraceKey_";
const AGENT_SUSPECT_KEY = "agentSuspect";
const TRACE_TTL_S = 30;            // how long an unconsumed installable record lives
const INSTAL_WAIT_MS = 12000;      // simple triggers are limited to 30 s
const INSTAL_POLL_MS = 500;
const LOCK_WAIT_MS = 5000;

const AGENT_LOG_ENABLED = true;
const AGENT_LOG_EXEC_ID = Math.random().toString(36).slice(2,6);   // new for every execution (the script is reloaded)

/**
 * Log line of the agent detection mechanism.
 * @param side {String} "SIMPLE" (simple onEdit), "INSTALLABLE" (agent sheetEdit) or "SHARED" (helpers used by both).
 * @param fp {String|null} Edited sheet!range the line is about.
 * @param msg {String} What happens / has been decided, in plain words.
 */
function agentLog(side,fp,msg){
  Controller.checkNote(`${side}${fp ? " " + fp : ""}: ${msg}`);   // the live check reads the decisions from here
  if(!AGENT_LOG_ENABLED) return;
  const time = new Date().toISOString().slice(11,23);   // HH:mm:ss.SSS (UTC), Logger's own timestamp has no milliseconds
  Logger.log(`[AGENT-CHECK ${time} #${AGENT_LOG_EXEC_ID}] ${side}${fp ? " " + fp : ""}: ${msg}`);
}

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
 * @param label {String} Used in the log only, e.g. "record installable event".
 */
function withDocumentLock(action, runUnlocked, fallback, label="action", fp=null){
  let lock = null, locked = false;
  const start = Date.now();
  try{
    lock = LockService.getDocumentLock();
    if(lock) locked = lock.tryLock(LOCK_WAIT_MS);
    else agentLog("SHARED",fp,`Lock for "${label}": no document lock available in this context.`);
  } catch(err) { agentLog("SHARED",fp,`Lock for "${label}": error when acquiring the document lock: ${err}`); }
  if(locked) agentLog("SHARED",fp,`Lock for "${label}": document lock acquired after ${Date.now()-start} ms.`);
  else if(runUnlocked) agentLog("SHARED",fp,`Lock for "${label}": NOT acquired after ${Date.now()-start} ms. Running WITHOUT the lock (best effort).`);
  else {
    agentLog("SHARED",fp,`Lock for "${label}": NOT acquired after ${Date.now()-start} ms. Skipping the action (returning ${JSON.stringify(fallback)}).`);
    return fallback;
  }
  try{
    return action();
  } finally {
    if(locked) lock.releaseLock();
  }
}

// - - - - - - - - installable side - - - - - - - -

/** Called by the installable trigger for every edit, before the power check. */
function recordInstallableSeen(e){
  const fp = fingerprint(e);
  const key = getKey(INSTAL_TRACE_KEY,fp);
  agentLog("INSTALLABLE",fp,`Installable edit trigger ${e.triggerUid} fired. Recording this fact so the simple trigger can find it.`);
  withDocumentLock(() => {
    // A counter, not a flag: two quick edits of the same cell must each be matched by their own simple trigger.
    const n = Number(HelperDataStore.getDocumentCacheValue(key) || 0);
    HelperDataStore.setDocumentCacheValue(key,String(n+1),TRACE_TTL_S);
    agentLog("INSTALLABLE",fp,`Record written: counter ${n} -> ${n+1} (expires in ${TRACE_TTL_S} s if nobody consumes it).`);
    clearAgentSuspect(fp,"installable trigger is alive");
  }, true, undefined, "record installable event", fp);
}

// - - - - - - - - simple trigger side - - - - - - - -

/** Called by the simple onEdit trigger. */
function checkInstallableAgentRan(e){
  const fp = fingerprint(e);
  agentLog("SIMPLE",fp,`Simple onEdit fired. Waiting up to ${INSTAL_WAIT_MS} ms (polling every ${INSTAL_POLL_MS} ms) for the installable trigger to report the same edit.`);
  const start = Date.now();
  if(waitForInstallable(fp,INSTAL_WAIT_MS)) {
    agentLog("SIMPLE",fp,`OK: installable trigger reported this edit (found after ${Date.now()-start} ms). Agent is alive, nothing to do.`);
    return;
  }
  agentLog("SIMPLE",fp,`NO REPORT from the installable trigger within ${Date.now()-start} ms. Raising the alarm.`);
  raiseAgentAlarm(fp);
}

function waitForInstallable(fp,maxMs){
  const key = getKey(INSTAL_TRACE_KEY,fp);
  const start = Date.now();
  let polls = 0;
  do{
    polls++;
    // Cheap unlocked peek; the lock is only taken when there is something to consume.
    const peek = HelperDataStore.getDocumentCacheValue(key);
    if(polls == 1) agentLog("SIMPLE",fp,`Poll #1 (${Date.now()-start} ms): installable record ${peek ? "already present (counter " + peek + ")" : "not there yet"}.`);
    if(peek) {
      agentLog("SIMPLE",fp,`Poll #${polls} (${Date.now()-start} ms): installable record present (counter ${peek}). Trying to consume it.`);
      if(consumeInstallableTrace(key,fp)) return true;
      agentLog("SIMPLE",fp,`Poll #${polls}: record was not consumed (taken by another simple trigger or lock timeout). Still waiting.`);
    }
    Utilities.sleep(INSTAL_POLL_MS);
  } while(Date.now() - start < maxMs);
  agentLog("SIMPLE",fp,`Gave up after ${polls} polls (${Date.now()-start} ms).`);
  return false;
}

function consumeInstallableTrace(key,fp){
  return withDocumentLock(() => {
    const n = Number(HelperDataStore.getDocumentCacheValue(key) || 0);
    if(n <= 0) {
      agentLog("SIMPLE",fp,`Consume: counter is ${n}, another simple trigger took the record first.`);
      return false;
    }
    if(n == 1) HelperDataStore.deleteDocumentCache(key);
    else HelperDataStore.setDocumentCacheValue(key,String(n-1),TRACE_TTL_S);
    agentLog("SIMPLE",fp,`Consume: counter ${n} -> ${n-1}${n==1 ? " (record deleted)" : ""}.`);
    return true;
  }, false, false, "consume installable record", fp);
}

// - - - - - - - - alarm - - - - - - - -

function raiseAgentAlarm(fp){
  const previous = withDocumentLock(() => {
    const suspect = getAgentSuspect();
    if(!suspect) setAgentSuspect(fp);
    return suspect;
  }, true, undefined, "read/set suspect flag", fp);

  if(previous) {
    const ageS = Math.round((Date.now() - new Date(previous.time).getTime())/1000);
    agentLog("SIMPLE",fp,`ALARM level 2: agent was already marked suspect ${ageS} s ago (edit ${previous.fp}) and no installable run has been seen since. Agent considered DEAD.`);
    if(!StatusManager.basicStatusCheck()) {
      agentLog("SIMPLE",fp,"Agents are already powered off (user has been warned before). Not powering off again, not showing the alert again.");
      return;
    }
    agentLog("SIMPLE",fp,"Powering OFF all agents in this file.");
    StatusManager.powerOffAllAgentsInFile();
  } else {
    agentLog("SIMPLE",fp,"ALARM level 1: agent marked SUSPECT (flag set). Not powering off yet: the installable trigger may only be late. A later installable run clears the flag, a second miss without one powers the agents off.");
  }
  agentLog("SIMPLE",fp,"Showing the 'agent not configured' alert to the user (shown when this execution closes).");
  StatusManager.lightFailInfo();
}

function getAgentSuspect(){
  const value = HelperDataStore.getDocumentPropertyValue(AGENT_SUSPECT_KEY);
  return value ? JSON.parse(value) : null;
}

function setAgentSuspect(fp){
  HelperDataStore.setDocumentPropertyValue(AGENT_SUSPECT_KEY,JSON.stringify({fp:fp,time:new Date().toISOString()}));
  agentLog("SHARED",fp,"Suspect flag SET.");
}

function clearAgentSuspect(fp=null,reason="no reason given"){
  const value = HelperDataStore.getDocumentPropertyValue(AGENT_SUSPECT_KEY);
  if(value == null) return;
  HelperDataStore.deleteProperty("document",AGENT_SUSPECT_KEY);
  agentLog("SHARED",fp,`Suspect flag CLEARED (${reason}). It had been set by: ${value}`);
}
