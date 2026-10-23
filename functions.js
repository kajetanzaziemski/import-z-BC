function listProjectTriggers(){
  return Controller.checked("listProjectTriggers",() => StatusManager.getAllProjectTriggers());
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

function runFunctionWithLock(action,flag="scriptLocked__"){
  const lock = LockService.getScriptLock();
  lock.tryLock(1000);
  if (lock.hasLock()) { 
    // dbgLog("Lock received. Applying coedits.");
    action();
    HelperDataStore.setDocumentPropertyValue(flag,"no");
    // dbgLog("Coedits applied. Setting requireCoedit to "+properties.getProperty(flag));
  } else {
    HelperDataStore.setDocumentPropertyValue(flag,"yes");
    // dbgLog("Script locked. Setting requireCoedit to "+properties.getProperty(flag)+" and waiting...");
    lock.tryLock(10000);
    let requireCoedit = HelperDataStore.getDocumentPropertyValue(flag)=="yes";
    // dbgLog("Lock status: "+lock.hasLock()+". requireCoedit: "+requireCoedit);
    if (lock.hasLock() && requireCoedit) {
      // dbgLog("Lock available, coedits required. Applying coedits.");
      action();
      HelperDataStore.setDocumentPropertyValue(flag,"no");
      // dbgLog("Additional script finished. Setting requireCoedit to "+properties.getProperty(flag));
    }
    // else dbgLog("Quitting.");
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
