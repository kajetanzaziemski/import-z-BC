// ---------------------------------------------------------------------------
// REFRESH LOG (use case): the log of the data downloads. Every download from Business Central that writes (or should write) data in the sheets - the menu items
// "Pobierz dane dla tego arkusza" and "Pobierz dane dla wszystkich arkuszy", and the automatic refresh by the clock trigger - leaves ONE entry in the log sheet
// (default name "Dziennik pobrań", chosen in the sidebar: MainSettings.getLogSheetName), newest first. The layout is Refresh Log Grid.js.
//
//   RefreshLog.run(source, technical, work)     runs `work`, then writes the entry: start, end, duration, the status and the sheets refreshed (with their rows).
//                                               A refresh inside a refresh is one entry (the outer one). The error `work` throws is written as the status and thrown on.
//   RefreshLog.noteSheet(name, rows)            (RefreshSheet) a result sheet was written
//   RefreshLog.noteProblem(text)                (RefreshSheet) a failure the add-on handled itself (BC answered with an error, no table in the config sheet): the status
//   RefreshLog.logOnly(source, technical, status)   an entry for a run that refreshed nothing on purpose (a clock trigger that deleted itself)
//
// Writing the log never fails a refresh: a failure there is console.error and a note on the live check run.
// ---------------------------------------------------------------------------

const REFRESH_LOG_SOURCES = {
  auto: "Autoodświeżanie",
  one: "Odświeżanie jednego arkusza",
  all: "Odświeżanie wszystkich arkuszy"
};

const RefreshLog = {
  session_: null,

  run(source, technical, work){
    if(RefreshLog.session_) return work();
    const session = RefreshLog.session_ = {source: source, technical: technical, start: new Date(), sheets: [], problems: [], error: null};
    try{
      return work();
    }catch(err){
      session.error = err;
      throw err;
    }finally{
      RefreshLog.session_ = null;
      RefreshLog.write_(RefreshLog.entry_(session,new Date()));
    }
  },

  noteSheet(name, rows){
    if(RefreshLog.session_) RefreshLog.session_.sheets.push({name: name, rows: rows});
  },

  noteProblem(text){
    if(RefreshLog.session_) RefreshLog.session_.problems.push(String(text));
  },

  logOnly(source, technical, status){
    const now = new Date();
    RefreshLog.write_(RefreshLog.entry_({source: source, technical: technical, start: now, sheets: [], problems: [status], error: null},now));
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
    return {
      source: session.source,
      start: session.start,
      end: end,
      duration: AutoRefreshPanel.duration(end.getTime() - session.start.getTime()),
      status: session.error ? String(session.error.message ?? session.error) : session.problems.length ? session.problems.join("; ") : "OK ✅",
      sheets: [`${n} ${RefreshLog.plural_(n,"arkusz","arkusze","arkuszy")}${n ? ":" : ""}`].concat(lines).join("\n"),
      technical: session.technical
    };
  },

  write_(entry){
    try{
      RefreshLogGrid.append(MainSettings.getLogSheetName(),entry);
    }catch(err){
      const text = `The download log was not written: ${err && err.stack || err}`;
      console.error(text);
      try{ Controller.checkNote(text); }catch(e){}
    }
  }
};
