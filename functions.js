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
 * Runs `action` under the script lock, so that two executions never work on the same thing at once - and so that a request made while the action
 * runs is not lost. `flag` (a document property) says "a run is requested":
 *  - every caller first sets it to "yes" (its request) and then tries the lock, 1 s and then up to 10 s more;
 *  - the caller that gets the lock sets the flag to "no" BEFORE each pass and then runs the action (which reads whatever it works on at its start),
 *    so a request made during the pass leaves the flag "yes" and the holder does another pass; at most LOCK_MAX_PASSES in one run (the rest stays "yes");
 *  - a caller that finds the flag "no" once it has the lock has been served by a pass that started after its request: it does nothing;
 *  - a caller that never gets the lock leaves its request "yes": the holder serves it.
 * (Before, the holder set "no" AFTER its pass, which erased the requests made during it: a paste while an analyse was running was never analysed.)
 */
const LOCK_MAX_PASSES = 5;

function runFunctionWithLock(action,flag="scriptLocked__"){
  Store.set("document",flag,"yes");
  const lock = LockService.getScriptLock();
  lock.tryLock(1000);
  if (!lock.hasLock()) lock.tryLock(10000);
  if (!lock.hasLock()) return;
  try {
    for (let pass = 0; pass < LOCK_MAX_PASSES && Store.get("document",flag)=="yes"; pass++) {
      Store.set("document",flag,"no");
      action();
    }
  } finally {
    lock.releaseLock();
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
