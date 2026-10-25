// ---------------------------------------------------------------------------
// CONCURRENCY PROBES: small experiments to run on a REAL spreadsheet, from the script editor, to find out three things the simulation cannot tell, about
// how executions that overlap see each other (docs/coedit-tracking.md says why: doubled queryOption / extend lines after overlapping co-edits).
//
//   1. Stale reads.  Open the editor in TWO browser tabs. Tab 1: run probeWriter() and at once, in tab 2, probeReader(). Afterwards run probeReport().
//      The writer changes a cell (sheet "_probe", A1) and a document property every 1.5 s; the reader looks at them for 15 s in four ways (the range it
//      opened first, the sheet fetched again, after SpreadsheetApp.flush(), a freshly opened spreadsheet). A reader that does not see the values
//      move on is the stale read behind the doubled lines.
//   2. The lock.  Tab 1: probeLockHolder() (takes the script lock, keeps it 10 s). Tab 2, at once: probeLockWaiter(). Then probeLockReport().
//      The waiter must get the lock only after the holder let it go.
//
// The probes write nothing but the sheet "_probe" (created when missing; delete it afterwards) and document properties "probe:*" (probeClear() removes them).
// ---------------------------------------------------------------------------

const PROBE_SHEET = "_probe";
const PROBE_WRITES = 8;
const PROBE_WRITE_EVERY_MS = 1500;
const PROBE_READS = 15;
const PROBE_READ_EVERY_MS = 1000;

function probeSheet_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(PROBE_SHEET) || ss.insertSheet(PROBE_SHEET);
}

function probeWriter(){
  const sheet = probeSheet_();
  const writes = [];
  for(let i = 1; i <= PROBE_WRITES; i++){
    sheet.getRange("A1").setValue(i);
    Store.set("document","probe:counter",String(i));
    SpreadsheetApp.flush();
    writes.push({i: i, t: Date.now()});
    Utilities.sleep(PROBE_WRITE_EVERY_MS);
  }
  Store.set("document","probe:writer",JSON.stringify(writes));
  Logger.log("probeWriter done: "+writes.length+" writes. Run probeReport() when probeReader() has finished too.");
}

function probeReader(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = probeSheet_();
  const opened = sheet.getRange("A1");                               // touched now, read again and again below: the reading of a long-running execution
  opened.getValue();
  const samples = [];
  for(let n = 0; n < PROBE_READS; n++){
    const same = opened.getValue();
    const refetched = ss.getSheetByName(PROBE_SHEET).getRange("A1").getValue();
    SpreadsheetApp.flush();
    const afterFlush = ss.getSheetByName(PROBE_SHEET).getRange("A1").getValue();
    const reopened = SpreadsheetApp.openById(ss.getId()).getSheetByName(PROBE_SHEET).getRange("A1").getValue();
    const property = Store.get("document","probe:counter");
    samples.push({t: Date.now(), same: same, refetched: refetched, afterFlush: afterFlush, reopened: reopened, property: property});
    Utilities.sleep(PROBE_READ_EVERY_MS);
  }
  Store.set("document","probe:reader",JSON.stringify(samples));
  Logger.log("probeReader done: "+samples.length+" samples. Run probeReport().");
}

/** Compares what the reader saw with what the writer had written at that moment (allowing 2 s for the write to arrive). */
function probeReport(){
  const writes = JSON.parse(Store.get("document","probe:writer") || "[]");
  const samples = JSON.parse(Store.get("document","probe:reader") || "[]");
  if(!writes.length || !samples.length){ Logger.log("Run probeWriter() and probeReader() first (at the same time, in two tabs)."); return null; }
  const written = t => { const done = writes.filter(w => w.t <= t - 2000); return done.length ? done[done.length-1].i : 0; };
  const styles = ["same","refetched","afterFlush","reopened","property"];
  const stale = {};
  styles.forEach(s => stale[s] = 0);
  const lines = samples.map(x => {
    const want = written(x.t);
    const marks = styles.map(s => { const old = Number(x[s]) < want; if(old) stale[s]++; return `${s}=${x[s]}${old ? " STALE" : ""}`; });
    return `${new Date(x.t).toISOString().slice(11,23)} writer had written >= ${want}: ${marks.join("  ")}`;
  });
  const summary = "stale readings (older than 2 s): " + styles.map(s => `${s} ${stale[s]}/${samples.length}`).join(", ");
  const text = lines.join("\n") + "\n" + summary;
  Logger.log(text);
  return {stale: stale, of: samples.length, text: text};
}

function probeLockHolder(){
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(5000);
  const record = {got: got, acquired: Date.now()};
  if(got){
    Store.set("document","probe:lockHolder",JSON.stringify(record));
    Utilities.sleep(10000);
    record.released = Date.now();
    lock.releaseLock();
  }
  Store.set("document","probe:lockHolder",JSON.stringify(record));
  Logger.log("probeLockHolder: "+JSON.stringify(record));
}

function probeLockWaiter(){
  const lock = LockService.getScriptLock();
  const asked = Date.now();
  const got = lock.tryLock(25000);
  const record = {asked: asked, got: got, acquired: Date.now()};
  if(got) lock.releaseLock();
  Store.set("document","probe:lockWaiter",JSON.stringify(record));
  Logger.log("probeLockWaiter: "+JSON.stringify(record));
}

function probeLockReport(){
  const holder = JSON.parse(Store.get("document","probe:lockHolder") || "null");
  const waiter = JSON.parse(Store.get("document","probe:lockWaiter") || "null");
  if(!holder || !waiter || !holder.released){ Logger.log("Run probeLockHolder() and probeLockWaiter() first (at the same time, in two tabs), and wait for both."); return null; }
  const overlap = waiter.got && waiter.acquired < holder.released - 200;
  const text = `holder had the lock ${holder.released - holder.acquired} ms; the waiter asked ${waiter.asked - holder.acquired} ms after it was taken and got it ${waiter.acquired - holder.acquired} ms after (got=${waiter.got}). ` +
    (overlap ? "OVERLAP: the lock is not exclusive between these executions." : "OK: the waiter got the lock only after the holder had released it.");
  Logger.log(text);
  return {overlap: overlap, text: text};
}

function probeClear(){
  ["probe:counter","probe:writer","probe:reader","probe:lockHolder","probe:lockWaiter"].forEach(k => Store.remove("document",k));
}
