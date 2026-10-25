// ---------------------------------------------------------------------------
// COEDIT TRACE: a flight recorder for the co-edit of a config sheet (AnalyseConfig -> runLatestOnly -> SheetCoeditor), for tracking down what several
// overlapping co-edits do on a REAL spreadsheet (docs/coedit-tracking.md). Every execution keeps the events of its own co-edit in memory and writes them
// in ONE document property when it ends ("coeditTrace:<start ms>:<run id>:<n>"): runs never overwrite each other's trace. The last COEDIT_TRACE_KEEP are kept.
//
//   coeditTrace()   run it from the script editor: all the stored runs, one line per event, in time order (also logged); coeditTraceClear() empties it
//
// Events (e): start, ticket, waiting, lock, dropped, timeout, read, reread, stale-confirmed, changed, insert, commit, dropdowns, checkpoint, end, released ...
// Each has t (ms), the sheet's rows count and a short hash of the lines where one was read or written. Nothing here changes what the co-edit does.
// ---------------------------------------------------------------------------

const COEDIT_TRACE_PREFIX = "coeditTrace:";
const COEDIT_TRACE_KEEP = 20;
const COEDIT_TRACE_MAX_EVENTS = 60;

const CoeditTrace = {
  runId: Math.random().toString(36).slice(2,6),
  events: [],

  /** Short hash (8 hex digits) of any JSON-able value: enough to tell two readings of the lines apart. */
  hash(value){
    const text = JSON.stringify(value) ?? "";
    let h = 5381;
    for(let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return ("0000000" + h.toString(16)).slice(-8);
  },

  note(event,data){
    if(this.events.length >= COEDIT_TRACE_MAX_EVENTS) return;
    this.events.push(Object.assign({t: Date.now(), e: event},data || {}));
  },

  /** Writes this execution's events as one property and drops the oldest runs beyond COEDIT_TRACE_KEEP. */
  flush(sheetName){
    if(!this.events.length) return;
    try{
      const key = COEDIT_TRACE_PREFIX + this.events[0].t + ":" + this.runId + ":" + (this.flushes = (this.flushes || 0) + 1);
      Store.set("document",key,JSON.stringify({run: this.runId, sheet: sheetName, events: this.events}));
      this.events = [];
      const service = Store.service("document","properties");
      service.getKeys().filter(k => k.indexOf(COEDIT_TRACE_PREFIX) == 0).sort().slice(0,-COEDIT_TRACE_KEEP).forEach(k => Store.remove("document",k));
    } catch(err) {
      // a recorder must never break the thing it records
    }
  },

  /** Every stored event of every run, in time order, as text lines. */
  report(){
    const service = Store.service("document","properties");
    const all = [];
    service.getKeys().filter(k => k.indexOf(COEDIT_TRACE_PREFIX) == 0).forEach(k => {
      try{
        const run = JSON.parse(Store.get("document",k));
        run.events.forEach(ev => all.push({run: run.run, sheet: run.sheet, ev: ev}));
      } catch(err) {}
    });
    all.sort((a,b) => a.ev.t - b.ev.t);
    return all.map(x => {
      const {t, e, ...rest} = x.ev;
      const time = new Date(t).toISOString().slice(11,23);
      return `${time} [${x.run}] ${e}${Object.keys(rest).length ? " " + JSON.stringify(rest) : ""}`;
    }).join("\n");
  }
};

/** For the script editor: logs and returns the stored co-edit traces (see docs/coedit-tracking.md). */
function coeditTrace(){
  const text = CoeditTrace.report();
  Logger.log(text || "No co-edit trace stored.");
  return text;
}

function coeditTraceClear(){
  Store.service("document","properties").getKeys().filter(k => k.indexOf(COEDIT_TRACE_PREFIX) == 0).forEach(k => Store.remove("document",k));
}
