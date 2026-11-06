// ---------------------------------------------------------------------------
// REFRESH LOG (use case): the log of the data downloads. Every download from Business Central that writes (or should write) data in the sheets - the menu items
// "Pobierz dane dla tego arkusza" and "Pobierz dane dla wszystkich arkuszy", and the automatic refresh by the clock trigger - leaves ONE entry in the log sheet
// (default name "Dziennik pobrań", chosen in the sidebar: MainSettings.getLogSheetName), newest first. The layout is Refresh Log Grid.js.
//
//   RefreshLog.run(source, technical, work)     runs `work`, then writes the entry: start, end, duration, the status and the sheets refreshed (with their rows).
//                                               A refresh inside a refresh is one entry (the outer one). The error `work` throws is written as the status and thrown on.
//   RefreshLog.noteSheet(name, rows)            (RefreshSheet) a result sheet was written
//   RefreshLog.noteProblem(text)                (RefreshSheet) a failure the add-on handled itself (BC answered with an error, no table in the config sheet): the status
//   RefreshLog.noteFailedSheet(name, error)     (RefreshSheet) the data of this sheet could not be pulled - the platform threw an error, or BC answered with an error document: the status only says
//                                               "Błąd ❗️ Przy pobieraniu danych dla arkusza X." (all the failed sheets: "dla arkuszy: X, Y."), the errors go to the technical column,
//                                               each with its sheet: "Errors: X: <error> | Y: <error>"
//   RefreshLog.run(..., {opening, limitSeconds})  a scheduled run opens its entry when it STARTS (status "Nieznany (w trakcie lub błąd wykonania)", no end) and completes it at the end,
//                                               so a run the platform kills at 30 minutes still shows; checkTime() / timeIsUp() fail it after limitSeconds (1700) with the log written
//   RefreshLog.logOnly(source, technical, status)   an entry for a run that refreshed nothing on purpose (a clock trigger that deleted itself)
//
// Writing the log never fails a refresh: a failure there is console.error and a note on the live check run.
// ---------------------------------------------------------------------------

const REFRESH_LOG_SOURCES = {
  auto: "Autoodświeżanie",
  one: "Odświeżanie jednego arkusza",
  all: "Odświeżanie wszystkich arkuszy"
};

/** The status of an entry written when a run STARTS (a run killed by the platform at 30 minutes never completes it). */
const REFRESH_LOG_UNKNOWN = "Nieznany (w trakcie lub błąd wykonania)";

/** A scheduled run gives up after this many seconds (the platform ends an execution at 30 minutes), leaving time to write the log. */
const REFRESH_TIME_LIMIT_SECONDS = 1700;

class RefreshTimeLimitError extends Error{}

const RefreshLog = {
  session_: null,

  /**
   * @param opts {{opening?: boolean, limitSeconds?: number}} `opening`: an entry with just the start and what is known is written when the run starts (status
   *   REFRESH_LOG_UNKNOWN) and completed at the end - a run the platform kills leaves it as it was. `limitSeconds`: checkTime() fails after that long.
   */
  run(source, technical, work, opts){
    if(RefreshLog.session_) return work();
    const start = new Date();
    const session = RefreshLog.session_ = {source: source, technical: technical, start: start, sheets: [], problems: [], failures: [], error: null,
      deadline: opts && opts.limitSeconds ? start.getTime() + opts.limitSeconds * 1000 : null, limitSeconds: opts && opts.limitSeconds, opened: null};
    if(opts && opts.opening) session.opened = RefreshLog.open_(session);
    try{
      return work();
    }catch(err){
      session.error = err;
      throw err;
    }finally{
      RefreshLog.session_ = null;
      RefreshLog.write_(RefreshLog.entry_(session,new Date()),session.opened);
    }
  },

  /** Has the running refresh used up its time? (false when it has no limit or nothing runs) */
  timeIsUp(){
    const s = RefreshLog.session_;
    return !!s && !!s.deadline && Date.now() > s.deadline;
  },

  /** Throws when the running refresh has used up its time; called between the sheets and between the pages of BC's answer. */
  checkTime(){
    if(RefreshLog.timeIsUp()) throw new RefreshTimeLimitError(`Przekroczono limit czasu odświeżania (${RefreshLog.session_.limitSeconds} s).`);
  },

  /** The entry of a run that has just started: the start and what is known, no end. Returns the entry written, or null when it could not be written. */
  open_(session){
    const entry = {source: session.source, start: session.start, end: null, duration: "", status: REFRESH_LOG_UNKNOWN, sheets: "", technical: session.technical};
    try{
      RefreshLogGrid.append(MainSettings.getLogSheetName(),entry);
      return entry;
    }catch(err){
      RefreshLog.reportWriteFailure_(err);
      return null;
    }
  },

  noteSheet(name, rows){
    if(RefreshLog.session_) RefreshLog.session_.sheets.push({name: name, rows: rows});
  },

  noteProblem(text){
    if(RefreshLog.session_) RefreshLog.session_.problems.push(String(text));
  },

  /** Did a sheet of the refresh that is running fail (an error thrown, or BC's error document)? */
  hasFailures(){
    return !!RefreshLog.session_ && RefreshLog.session_.failures.length > 0;
  },

  noteFailedSheet(name, error){
    if(RefreshLog.session_) RefreshLog.session_.failures.push({name: String(name), message: String(error && error.message || error)});
  },

  logOnly(source, technical, status){
    const now = new Date();
    RefreshLog.write_(RefreshLog.entry_({source: source, technical: technical, start: now, sheets: [], problems: [status], failures: [], error: null},now));
  },

  /** 1 arkusz, 2 arkusze, 5 arkuszy, 22 arkusze, 12 arkuszy ... */
  plural_(n, one, few, many){
    const last = n % 10, lastTwo = n % 100;
    if(n === 1) return one;
    return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
  },

  entry_(session, end){
    const n = session.sheets.length;
    const lines = session.sheets.map(x => `${x.name} (${x.rows} ${RefreshLog.plural_(x.rows,"wiersz","wiersze","wierszy")})`);
    // A failure while the data of a sheet was pulled: the status only says for which sheet(s); the error itself is for the technical column. An error that is
    // not tied to a sheet (the lock, the settings sheet ...) is the status as it is.
    const failed = session.failures.map(x => x.name);
    const failure = !failed.length ? null
      : failed.length == 1 ? `Błąd ❗️ Przy pobieraniu danych dla arkusza ${failed[0]}.`
      : `Błąd ❗️ Przy pobieraniu danych dla arkuszy: ${failed.join(", ")}.`;
    const status = failure ? session.problems.concat([failure]).join("; ")
      : session.error ? String(session.error.message ?? session.error)
      : session.problems.length ? session.problems.join("; ") : "OK ✅";
    return {
      source: session.source,
      start: session.start,
      end: end,
      duration: AutoRefreshPanel.duration(end.getTime() - session.start.getTime()),
      status: status,
      sheets: [`${n} ${RefreshLog.plural_(n,"arkusz","arkusze","arkuszy")}${n ? ":" : ""}`].concat(lines).join("\n"),
      technical: failure ? `${session.technical}. Errors: ${session.failures.map(x => `${x.name}: ${x.message}`).join(" | ")}` : session.technical
    };
  },

  write_(entry, opened){
    try{
      if(opened) RefreshLogGrid.update(MainSettings.getLogSheetName(),opened,entry);
      else RefreshLogGrid.append(MainSettings.getLogSheetName(),entry);
    }catch(err){
      RefreshLog.reportWriteFailure_(err);
    }
  },

  reportWriteFailure_(err){
    const text = `The download log was not written: ${err && err.stack || err}`;
    console.error(text);
    try{ Controller.checkNote(text); }catch(e){}
  }
};
