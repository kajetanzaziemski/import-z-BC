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
//                                               "Błąd ❗️ Przy pobieraniu danych dla arkusza X." (all the failed sheets: "dla arkuszy: X, Y."; a sheet that BC refused access to says why after its name:
//                                               "dla arkuszy: X: Odmowa dostępu do BC, Y."), the errors go to the technical column,
//                                               each with its sheet: "Errors: X: <error> | Y: <error>"
//   Every run opens its entry when it STARTS (status "Nieznany (w trakcie lub błąd wykonania)", no end), writes it over after each sheet with what is known and completes it at
//                                               the end, so a run the platform kills still shows. The row is found again by the hash of its cells; not found (edited by the user) = a new row.
//   RefreshLog.run(..., {limitSeconds})         checkTime() / timeIsUp() fail the run after limitSeconds (the scheduled one: 1700) with the log written
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

/** What BCConnection throws when there is no valid token for BC, and what the log says instead (after the name of the sheet). */
const BC_ACCESS_DENIED_MESSAGE = "Access not granted or expired.";
const BC_ACCESS_DENIED_TEXT = "Odmowa dostępu do BC";

const RefreshLog = {
  session_: null,

  /**
   * An entry with just the start and what is known is written when the run STARTS (status REFRESH_LOG_UNKNOWN), written over again after every sheet with what is
   * known by then, and completed at the end - a run the platform kills leaves the last of these. The row is found again by its hash (RefreshLogGrid.rowHash).
   * @param opts {{limitSeconds?: number}} `limitSeconds`: checkTime() fails after that long.
   */
  run(source, technical, work, opts){
    if(RefreshLog.session_) return work();
    const start = new Date();
    const session = RefreshLog.session_ = {source: source, technical: technical, start: start, sheets: [], problems: [], failures: [], error: null,
      deadline: opts && opts.limitSeconds ? start.getTime() + opts.limitSeconds * 1000 : null, limitSeconds: opts && opts.limitSeconds, hash: null};
    session.hash = RefreshLog.open_(session);
    try{
      return work();
    }catch(err){
      session.error = err;
      throw err;
    }finally{
      RefreshLog.session_ = null;
      RefreshLog.write_(RefreshLog.entry_(session,new Date()),session.hash);
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

  /** The entry of a run that has just started: the start and what is known, no end. Returns the hash of the row written, or null when it could not be written. */
  open_(session){
    try{
      return RefreshLogGrid.append(MainSettings.getLogSheetName(),RefreshLog.openEntry_(session));
    }catch(err){
      RefreshLog.reportWriteFailure_(err);
      return null;
    }
  },

  /** What is known while the run goes on: the sheets so far (and the errors so far in the technical text); no end, no duration, the status unknown. */
  openEntry_(session){
    return Object.assign(RefreshLog.entry_(session,session.start),{end: null, duration: "", status: REFRESH_LOG_UNKNOWN});
  },

  /** A sheet is done: the row of the run is written over with what is known now. A failure here is not reported (the next write, at the end, reports it). */
  progress_(){
    const session = RefreshLog.session_;
    if(!session || !session.hash) return;
    try{
      session.hash = RefreshLogGrid.update(MainSettings.getLogSheetName(),session.hash,RefreshLog.openEntry_(session));
    }catch(err){
      dbgLog(`The download log not updated after a sheet: ${err}`);
    }
  },

  noteSheet(name, rows){
    if(RefreshLog.session_){
      RefreshLog.session_.sheets.push({name: name, rows: rows});
      RefreshLog.progress_();
    }
  },

  noteProblem(text){
    if(RefreshLog.session_) RefreshLog.session_.problems.push(String(text));
  },

  /** Did a sheet of the refresh that is running fail (an error thrown, or BC's error document)? */
  hasFailures(){
    return !!RefreshLog.session_ && RefreshLog.session_.failures.length > 0;
  },

  noteFailedSheet(name, error){
    if(RefreshLog.session_){
      RefreshLog.session_.failures.push({name: String(name), message: String(error && error.message || error)});
      RefreshLog.progress_();
    }
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
    // BC refused the access (no token, or it expired): the status says so after the sheet's name; the platform's text stays in the technical column
    const failed = session.failures.map(x => x.message === BC_ACCESS_DENIED_MESSAGE ? `${x.name}: ${BC_ACCESS_DENIED_TEXT}` : x.name);
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

  write_(entry, hash){
    try{
      if(hash) RefreshLogGrid.update(MainSettings.getLogSheetName(),hash,entry);
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
