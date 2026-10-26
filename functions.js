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
const LATEST_WAIT_MS = 90000;
const LATEST_POLL_MS = 2000;

function runLatestOnly(action,flag="scriptLocked__"){
  const ticket = Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
  Store.set("document",flag,ticket);
  const isLatest = () => Store.get("document",flag) === ticket;

  const lock = LockService.getScriptLock();
  for(let tries = 0; !lock.hasLock(); tries++){
    if(!isLatest()) return "dropped";
    if(tries * LATEST_POLL_MS >= LATEST_WAIT_MS) return "timeout";
    lock.tryLock(LATEST_POLL_MS);
  }
  try {
    if(!isLatest()) return "dropped";
    const result = action(isLatest);
    return result !== false && isLatest() ? "completed" : "dropped";
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
