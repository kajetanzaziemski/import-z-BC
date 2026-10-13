const SIMPLE_TRACE_KEY = "simpleTraceKey_";
const INSTAL_TRACE_KEY = "instalTraceKey_";
const EVENT_MISMATCH_SAFETY_LIMIT = 4;
const UNMATCHED_STREAK_KEY = 'unmatchedStreak';

function fingerprint(e) {
  const range = e.range;
  return range.getSheet().getName() + '!' + range.getA1Notation();
}

function reconcileEdit(e, sourceTraceKey) {
  const fp = fingerprint(e);
  const otherTraceKey = (sourceTraceKey === SIMPLE_TRACE_KEY ? INSTAL_TRACE_KEY : SIMPLE_TRACE_KEY);

  Logger.log("reconcile edit - "+sourceTraceKey);
  Logger.log("unmatched streak: "+JSON.stringify(getUnmatchedStreak()));
  Logger.log(`cache otherKey (${otherTraceKey}): `+JSON.stringify(HelperDataStore.getDocumentCacheValue(getKey(otherTraceKey,fp))));

  if(checkOtherEvent(otherTraceKey,fp)){
    resetUnmatchedStreak();
    deleteTrace(otherTraceKey,fp);
  } else {
    leaveTrace(sourceTraceKey,fp);
    if(unmatchedLimitCheck()) sendLackOfAgentInformation();
    else increaseUnmatchedStreak();
  }
}

function unmatchedLimitCheck(){
  return getUnmatchedStreak()>=EVENT_MISMATCH_SAFETY_LIMIT;
}

function getUnmatchedStreak(){
  return Number(HelperDataStore.getDocumentPropertyValue(UNMATCHED_STREAK_KEY) || 0);
}

function resetUnmatchedStreak(){
  HelperDataStore.setDocumentPropertyValue(UNMATCHED_STREAK_KEY,String(0));
  Logger.log('Unmatched streak RESET to '+HelperDataStore.getDocumentPropertyValue(UNMATCHED_STREAK_KEY));
}

function increaseUnmatchedStreak(){
  HelperDataStore.setDocumentPropertyValue(UNMATCHED_STREAK_KEY,String(getUnmatchedStreak() + 1));
  Logger.log('Unmatched streak INCREASED to '+HelperDataStore.getDocumentPropertyValue(UNMATCHED_STREAK_KEY));
}

function leaveTrace(traceKey,fp){
  Logger.log(`Leaving trace for ${traceKey}, fp: ${fp}`);
  HelperDataStore.setDocumentCacheValue(getKey(traceKey,fp),"1",30);  // Leave key for 30 s.
  Logger.log(`Trace check (should be 1): ${HelperDataStore.getDocumentCacheValue(getKey(traceKey,fp))}`);
}

function deleteTrace(traceKey,fp){
  Logger.log(`Deleting trace for ${traceKey}, fp: ${fp}`);
  HelperDataStore.deleteDocumentCache(getKey(traceKey,fp));
  Logger.log(`Trace check (should be null): ${HelperDataStore.getDocumentCacheValue(getKey(traceKey,fp))}`);
}

function checkOtherEvent(otherEventTraceKey,fp){
  Logger.log(`Checking trace for ${otherEventTraceKey}, fp: ${fp}. Check result: `+(HelperDataStore.getDocumentCacheValue(getKey(otherEventTraceKey,fp)) ? "true" : "false"));
  return HelperDataStore.getDocumentCacheValue(getKey(otherEventTraceKey,fp)) ? true : false;
}

function getKey(traceKey,fp){
  return 'edit:'+fp+traceKey;
}

function sendLackOfAgentInformation(){

  // Response to lack of installable agent goes here.
  
  Logger.log("Alert: No active installable edit event.");
  StatusManager.powerOffAllAgentsInFile();
  StatusManager.lightFailInfo();
}