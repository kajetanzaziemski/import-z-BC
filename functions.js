function listProjectTriggers(){
  return Controller.run("requestListProjectTriggers",() => StatusManager.getAllProjectTriggers());
}

function logObjectsArray(arrayOfObjects) {
  dbgLog(arrayOfObjects.map(obj => JSON.stringify(obj)).join('\n'));
}

function rectArray(array,minWidth=0){
  let res = [];
  let dataWidth = minWidth;
  array.forEach(row => dataWidth = Math.max(dataWidth,row.length));
  array.forEach(row => {
    if(row.length<dataWidth) res.push(row.concat(Array(dataWidth-row.length).fill(null)));
    else res.push(row);
  });
  return res;
}

function joinIfNotEmpty(a,b){
  if(!a) return b;
  if(!b) return a;
  return a+" "+b;
}

function compareArrays(a,b){
  if(!a.length) return false;
  if(!b.length) return false;
  if(a.length != b.length) return false;
  let len = a.length;
  for(i = 0; i<len; ++i) if(a[i]!==b[i]) return false;
  return true;
}

function map2D(array,f){
  return array.map(row => row.map(elem => f(elem)));
}

function isInRange(row,col,range){
  return row<=range.getLastRow() && row >=range.getRow() && col<=range.getLastColumn() && col >=range.getColumn();
}

function transposed(table){
  if(!Array.isArray(table)) return table;
  testRect = table[0].length;
  table.forEach(t => {
    if(!Array.isArray(t) || t.length != testRect) testRect = false;
  });
  if(!testRect) return table;
  let res = [];
  for (let i = 0; i < table[0].length; i++) {
    let row = [];
    for (let j = 0; j < table.length; j++){ 
      row[j]=table[j][i];
    }
    res.push(row);
  }
  return res;
}

function md5Hash(string){
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, string).map(function(chr){return (chr+256).toString(16).slice(-2)})
  .join('');
}

/**
 * Runs `action` so that only the LAST run to start completes: runs started meanwhile are not queued up one after the other, the older ones drop out,
 * even in the middle of their work.
 *  - Every run first writes its own ticket to the document property `flag` ("I am the newest"). The ticket in the property is the newest run's.
 *  - Then it takes the SCRIPT lock, trying for about LATEST_WAIT_MS. While it waits it gives up as soon as it is not the newest any more ("dropped"); if the lock
 *    does not come in time: "timeout". (Not the DOCUMENT lock: the agent detection (Track onEdit Triggers.js) uses that one for a few milliseconds at a time and
 *    waits for it only 5 s - a co-edit holding it for 10-20 s would starve the detector and get the agents powered off.)
 *  - With the lock it checks once more, then runs `action(isLatest)`. The action calls isLatest() at its checkpoints (before it changes anything, and before
 *    every write that cannot be taken back or is slow to prepare) and drops out by returning false when a newer run has started; the lock is then freed for it.
 * Returns "completed" (the action finished and no newer run came), "dropped" (a newer run exists: leave what the newer one needs - the reading indicator -
 * to it) or "timeout" (never got the lock; the caller was the newest and nobody will do its work). An error from the action goes on to the caller.
 */
/** Notes an event for the co-edit's flight recorder (Coedit Trace.js) when that file is in the project; the co-edit works without it. */
function coeditNote_(event,data){
  if(typeof CoeditTrace !== "undefined") CoeditTrace.note(event,data);
}

/** Short hash of the lines (Coedit Trace.js), or null when the recorder file is not in the project. */
function coeditHash_(values){
  return typeof CoeditTrace !== "undefined" ? CoeditTrace.hash(values) : null;
}

/** What the last co-edit of a sheet left behind ({t, rows, hash}), kept in a document property so that the next one - another execution - can check its reading. */
function coeditMarkerSet_(sheetName,marker){
  if(typeof Store !== "undefined") Store.set("document","coeditExpected:"+sheetName,JSON.stringify(marker));
}

function coeditMarkerGet_(sheetName){
  try{
    const raw = typeof Store !== "undefined" ? Store.get("document","coeditExpected:"+sheetName) : null;
    return raw ? JSON.parse(raw) : null;
  } catch(err) {
    return null;
  }
}

const LATEST_WAIT_MS = 90000;
const LATEST_POLL_MS = 2000;

function runLatestOnly(action,flag="scriptLocked__"){
  const ticket = Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
  Store.set("document",flag,ticket);
  coeditNote_("ticket",{ticket: ticket, was: "see the next run"});
  const isLatest = () => Store.get("document",flag) === ticket;

  const lock = LockService.getScriptLock();
  const waitStart = Date.now();
  for(let tries = 0; !lock.hasLock(); tries++){
    if(!isLatest()){ coeditNote_("dropped",{while: "waiting for the lock", tries: tries}); return "dropped"; }
    if(tries * LATEST_POLL_MS >= LATEST_WAIT_MS){ coeditNote_("timeout",{tries: tries}); return "timeout"; }
    lock.tryLock(LATEST_POLL_MS);
  }
  coeditNote_("lock",{waitedMs: Date.now() - waitStart});
  try {
    if(!isLatest()){ coeditNote_("dropped",{while: "just after getting the lock"}); return "dropped"; }
    const result = action(isLatest);
    return result !== false && isLatest() ? "completed" : "dropped";
  } finally {
    lock.releaseLock();
    coeditNote_("released",{});
  }
}

function average(array){
  return array.length>0 ? array.reduce((a, b) => a + b,0) / array.length : null; 
}
/**
 * General debug log. Currently switched OFF so that only the agent detection log (agentLog() in
 * "Track onEdit Triggers.js") is visible while that mechanism is being tested.
 * Flip the return value to true to restore all the logs routed through dbgLog().
 * A function (not a const) so that it is also safe to call while the project files are still loading.
 */
function isDebugLogEnabled(){
  return false;
}

function dbgLog(...args){
  if(isDebugLogEnabled()) Logger.log(...args);
}
