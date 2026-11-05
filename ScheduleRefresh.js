// ---------------------------------------------------------------------------
// SCHEDULE REFRESH (use case): the automatic refresh by a time-based trigger.
// Moved here unchanged from Settings Sheet.js (setRefreshTrigger, autoRefreshContent, autoRefreshContentOld).
//
//   setUp(frequency)   (re)creates THE time trigger from the refresh frequency of the settings sheet and issues a refresh permit for it
//   run(e)             a time trigger fired: refresh the ticked sheets only if the permit was issued for THIS trigger, else delete itself
//   runLegacy(e)       the same for old triggers that run autoRefresh() instead of autoRefreshHandler(e)
//
// The refresh permit (Settings.js, CLAUDE.md) is what keeps old triggers from refreshing: a new permit makes every other trigger delete itself.
// Time-based triggers are not returned by ScriptApp.getUserTriggers(ss): getProjectTriggers() is used.
// setUp replaces only the trigger this document's permit names (bugs-fixed #5, fixed); other triggers, legacy ones included, delete themselves when they fire.
// Known quirks kept: without a frequency line (null) it fails with a TypeError (nothing was changed before it, since the set-up checks first); the first legacy run records no lastRun (the permit it just issued is not stored yet when it is touched).
// ---------------------------------------------------------------------------

const REFRESH_TRIGGER_SEEN_SECONDS = 120;

const ScheduleRefresh = {
  /**
   * @param frequency {{freq: number, unit: "hrs"|"days"|null}} As SettingsSheet.getRefreshFrequency() returns it.
   *   Empty freq or unknown unit: the old triggers are removed and no new one is created.
   * @param startAt {{hour: number, minute: number, timeZone?: string}|null} The time of day the refresh should happen at (days: atHour + nearMinute; hours: nearMinute only).
   *   The platform only promises "near" this time (within about 15 minutes).
   * @returns {{nextRefresh: Date, intervalHrs: number}|null} null when the refresh was switched off.
   */
  setUp(frequency, startAt){
    // A time trigger is not bound to a document (getTriggerSourceId() is null for it, getUserTriggers(ss) does not list it) - the only link to a
    // document is the permit stored in that document. So the trigger to replace is the one THIS document's permit names, and no other (the refresh
    // triggers of other documents stay). Triggers of this document that the permit does not name - older ones, legacy `autoRefresh` ones - cannot be
    // recognised here; they delete themselves the next time they fire, because the permit is not issued for them.
    const permit = MainSettings.getRefreshPermit();

    // Nothing is touched before the settings are known to be usable (a missing frequency line is a TypeError here, an invalid number an Error): a refused
    // set-up leaves the trigger and the permit that were there. The old trigger is removed BEFORE the new one is created: an add-on may hold only one
    // time-based trigger per document and user, and creating a second one first fails with "too many triggers named time-based in this document".
    if(!frequency.freq || (frequency.unit != "days" && frequency.unit != "hrs")){
      // Refresh switched off here. A document that never had a permit gets one for nobody: an old trigger of this document that has not claimed
      // one yet would otherwise claim it when it fires (the legacy handler does) and go on refreshing; with a permit for nobody it deletes itself.
      // A permit that was there is kept (it still makes every other trigger delete itself) and marked off: its trigger is gone on purpose.
      ScheduleRefresh.removeRefreshTrigger_(permit?.issuedFor);
      if(!permit) MainSettings.setRefreshPermit(null,0);
      else MainSettings.updateRefreshPermit(Object.assign({}, permit, {off: true}));
      return null;
    }
    const interval = typeof frequency.freq == "string" && frequency.freq.trim() !== "" ? Number(frequency.freq) : frequency.freq;
    if(typeof interval != "number" || !Number.isInteger(interval) || interval < 1){
      throw new Error(`Nieprawidłowa częstotliwość odświeżania: "${frequency.freq}" (potrzebna liczba całkowita większa od zera).`);
    }
    const intervalHrs = frequency.unit == "days" ? 24 * interval : interval;
    const nextRefresh = ScheduleRefresh.nextRefresh(new Date(), frequency.unit, interval, startAt);

    ScheduleRefresh.removeRefreshTrigger_(permit?.issuedFor);
    let newTrigger;
    try{
      newTrigger = ScheduleRefresh.createTrigger_(frequency.unit, interval, startAt);
    }catch(err){
      ScheduleRefresh.restoreAfterFailure_(permit);
      throw err;
    }
    // The record of the new trigger is written at once, before the permit: if this run dies from here on, the trigger can still be told to be this document's
    // (the reconciliation that a later set-up makes finds it by its record and removes it).
    ScheduleRefresh.register_(newTrigger.getUniqueId(),{intervalHours: intervalHrs, startAt: startAt ? `${startAt.hour}:${String(startAt.minute ?? 0).padStart(2,"0")}` : undefined,
                                                      timeZone: startAt?.timeZone, setAt: Date.now(), nextRefresh: nextRefresh.getTime()});
    // Issue a permit for this trigger. This will override any other permits, so all old triggers will automatically uninstall.
    MainSettings.setRefreshPermit(newTrigger.getUniqueId(),intervalHrs);
    const issued = MainSettings.getRefreshPermit();
    MainSettings.updateRefreshPermit(Object.assign({}, issued, {issuedBy: ScheduleRefresh.ownerToken_(true), nextRefresh: nextRefresh.getTime(), startAt: startAt ? `${startAt.hour}:${String(startAt.minute ?? 0).padStart(2,"0")}` : null, timeZone: startAt?.timeZone ?? null}));
    // Save the permit now, not when the run closes: writing the status message takes seconds and the sidebar polls the permit meanwhile
    // (a permit that still names the removed trigger reads as "nothing is set").
    Settings.store().saveArray();
    return {nextRefresh, intervalHrs};
  },

  /** The record of the user's trigger list (Refresh Registry.js). A failure there never fails the set-up or the run. */
  register_(triggerId, how){
    try{ RefreshRegistry.register(triggerId,how); }catch(err){ dbgLog(`Refresh trigger record not written: ${err}`); }
  },

  forget_(triggerId){
    try{ RefreshRegistry.remove(triggerId); }catch(err){ dbgLog(`Refresh trigger record not removed: ${err}`); }
  },

  /** Builds and creates the time trigger: every `interval` days (at the hour of startAt) or hours, near the minute, in the zone of startAt. */
  createTrigger_(unit, interval, startAt){
    const trigger = ScriptApp.newTrigger('autoRefreshHandler').timeBased();
    if(unit == "days"){
      trigger.everyDays(interval);
      if(startAt) trigger.atHour(startAt.hour);
    }else{
      trigger.everyHours(interval);
    }
    if(startAt && startAt.minute != null) trigger.nearMinute(startAt.minute);
    if(startAt?.timeZone) trigger.inTimezone(startAt.timeZone);      // else the time zone of the script
    return trigger.create();
  },

  /**
   * The new trigger could not be created after the old one was removed: put back what was there, from what the permit remembers (interval, time of day, zone),
   * and keep the permit (run record included) with the new id. If even that fails the permit is marked off, so that what is shown is what is true.
   */
  restoreAfterFailure_(permit){
    if(!permit?.issuedFor || !permit.intervalHours || permit.off) return;
    try{
      const days = permit.intervalHours % 24 === 0;
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(permit.startAt ?? ""));
      const startAt = m ? {hour: +m[1], minute: +m[2], timeZone: permit.timeZone ?? undefined} : null;
      const restored = ScheduleRefresh.createTrigger_(days ? "days" : "hrs", days ? permit.intervalHours / 24 : permit.intervalHours, startAt);
      MainSettings.updateRefreshPermit(Object.assign({}, permit, {issuedFor: restored.getUniqueId()}));
      ScheduleRefresh.register_(restored.getUniqueId(),{intervalHours: permit.intervalHours, startAt: permit.startAt ?? undefined, timeZone: permit.timeZone ?? undefined,
                                                       setAt: permit.lastRefresh, nextRefresh: permit.nextRefresh, lastRun: permit.lastRun, lastDurationMs: permit.lastDurationMs, lastSheets: permit.lastSheets});
    }catch(err){
      dbgLog(`The previous refresh trigger could not be put back: ${err}`);
      MainSettings.updateRefreshPermit(Object.assign({}, permit, {off: true}));
    }
    Settings.store().saveArray();
  },

  /**
   * When the first refresh of a new trigger will happen (an estimate: the platform decides the exact minute).
   * days: the next HH:mm that is still ahead (today or tomorrow), no time given: now + the interval.
   * hours: with a minute asked for, the next time the clock shows it (the hour of the start time cannot be set for hourly triggers); without, now + the interval.
   */
  nextRefresh(now, unit, interval, startAt){
    const next = new Date(now.getTime());
    if(unit == "days"){
      if(!startAt) { next.setDate(next.getDate() + interval); return next; }
      if(startAt.timeZone) return ScheduleRefresh.nextDailyIn_(now, startAt);
      next.setHours(startAt.hour, startAt.minute ?? 0, 0, 0);
      if(next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
    if(startAt && startAt.minute != null){      // the earliest run that fits: the next time the clock shows that minute
      next.setMinutes(startAt.minute, 0, 0);
      if(next <= now) next.setHours(next.getHours() + 1);
      return next;
    }
    next.setTime(now.getTime() + interval * 3600000);
    return next;
  },

  /** The moment at which the clock of `tz` shows hh:mm on the given day (month 1-12): its UTC reading minus the offset of tz (twice: the offset may change on that day). */
  momentAtWall_(y, m, d, hour, minute, tz){
    const wall = Date.UTC(y, m - 1, d, hour, minute);
    const offset = t => { const z = Utilities.formatDate(new Date(t), tz, "Z"); return (z[0] == "-" ? -1 : 1) * (+z.slice(1,3) * 60 + +z.slice(3)) * 60000; };
    return new Date(wall - offset(wall - offset(wall)));
  },

  /** The next HH:mm ahead in the time zone of startAt (today or tomorrow), as a moment. */
  nextDailyIn_(now, startAt){
    const tz = startAt.timeZone;
    const [y, m, d] = Utilities.formatDate(now, tz, "yyyy-MM-dd").split("-").map(Number);
    let next = ScheduleRefresh.momentAtWall_(y, m, d, startAt.hour, startAt.minute ?? 0, tz);
    if(next <= now){
      const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
      next = ScheduleRefresh.momentAtWall_(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), startAt.hour, startAt.minute ?? 0, tz);
    }
    return next;
  },

  /** What the clock of toTz shows at the moment when the clock of fromTz shows `at` ({hour, minute}) today. */
  convertTimeOfDay(at, fromTz, toTz, ref = new Date()){
    const [y, m, d] = Utilities.formatDate(ref, fromTz, "yyyy-MM-dd").split("-").map(Number);
    const moment = ScheduleRefresh.momentAtWall_(y, m, d, at.hour, at.minute ?? 0, fromTz);
    const hhmm = Utilities.formatDate(moment, toTz, "HH:mm");
    return {hour: +hhmm.slice(0, 2), minute: +hhmm.slice(3)};
  },

  /** A time of day moved by some minutes (across midnight too). */
  shiftTimeOfDay_(at, minutes){
    const total = (((at.hour * 60 + (at.minute ?? 0) + minutes) % 1440) + 1440) % 1440;
    return {hour: Math.floor(total / 60), minute: total % 60};
  },

  /**
   * onOpen: the labels in the settings sheet must read the spreadsheet's time zone (File > Settings > Time zone; the sheet is reloaded when it is changed). What the
   * SHEET says decides (SettingsGrid retime): the zone labels (E of lastRefresh and refreshTime) are compared with what they should read now. A label that is out
   * of date is rewritten as UTC+N; when the zone itself changed (the lastRefresh label, a label of a past moment, differs) the time of day of refreshTime is converted so
   * that it stays the same moment: 17:30 in UTC+1 reads 16:30 in UTC+0. The conversion uses the zone the properties remember (the saved one, else the permit's) when there
   * is one, else the offset in the label; where only the refreshTime label differs and lastRefresh agrees, it is the daylight saving time: relabelled only. The
   * properties are secondary: they follow (the saved zone, the permit's start time and zone, the user's record) and the status message is written again. The trigger itself
   * is left alone: it keeps its own zone and fires at the same moment. Never throws: it is part of opening the document.
   * @returns {boolean} true when something in the sheet was changed
   */
  syncTimeZone(){
    try{
      const tz = activeSpreadsheetTimeZone();
      const permit = MainSettings.getRefreshPermit();
      const hint = Settings.lastTimeZone() ?? permit?.timeZone ?? null;
      if(Settings.lastTimeZone() !== tz) Settings.setLastTimeZone(tz);
      if(!settingsSheetExists()) return false;
      const plan = info => {
        const changed = info.zoneChanged || (!info.lastKnown && !!hint && hint !== tz);       // no last refresh to tell by: the remembered zone has to
        if(!changed) return null;
        if(hint && hint !== tz) return at => ScheduleRefresh.convertTimeOfDay(at, hint, tz);
        if(info.fromOffset !== null) return at => ScheduleRefresh.shiftTimeOfDay_(at, info.toOffset - info.fromOffset);
        return null;
      };
      // onOpen may run in the limited authorisation mode, where the Sheets advanced service cannot be called: the sheet is read and written through the Spreadsheet service
      let done;
      Grid.serviceOnly(true);
      try{ done = getMainSettings().adoptTimeZone(plan); }finally{ Grid.serviceOnly(false); }
      if(!done.changed) return false;
      Controller.checkNote(`time zone: the labels in the settings sheet now read ${activeSpreadsheetTimeZone()}${done.to ? "; the time of day was converted" : ""}`);
      if(done.to && permit && !permit.off && permit.issuedFor){
        const startAt = `${done.to.hour}:${String(done.to.minute).padStart(2,"0")}`;
        MainSettings.updateRefreshPermit(Object.assign({}, permit, {startAt: startAt, timeZone: tz}));
        try{ RefreshRegistry.put(permit.issuedFor,{startAt: startAt, timeZone: tz, docTz: tz}); }catch(err){ dbgLog(`Refresh trigger record not updated: ${err}`); }
      }else if(done.zoneChanged && permit?.issuedFor && !permit.off){
        try{ RefreshRegistry.put(permit.issuedFor,{docTz: tz}); }catch(err){}
      }
      if(done.zoneChanged || done.to) ScheduleRefresh.reportScheduled_();
      return true;
    }catch(err){
      // never breaks the open - but never silent either: the execution log shows it and so does the live check
      const text = `Time zone of the spreadsheet not synchronised: ${err && err.stack || err}`;
      console.error(text);
      try{ Controller.checkNote(text); }catch(e){}
      return false;
    }
  },

  /**
   * The edit of the refresh frequency: sets the trigger up and reports the result in the message area of the settings sheet.
   * Success: the message says how often and when next; failure: the message says nothing was updated and a toast tells about it;
   * when even the message cannot be written, only the toast is left. The error goes on to the caller as before.
   * @param settings the settings sheet object (getMainSettings())
   */
  apply(settings){
    let outcome;
    try{
      // Many edits can run at once (every keystroke of a number is an edit), each creating or deleting time triggers. Only the NEWEST run completes (runLatestOnly:
      // the older ones drop out, nothing changed); it re-reads the sheet under the lock, sets the trigger up and makes sure the result is right (reconcile_).
      outcome = runLatestOnly(isLatest => ScheduleRefresh.applyNewest_(settings,isLatest),"refreshSetup");
    }catch(err){
      ScheduleRefresh.fail_(settings,err);
      throw err;
    }
    if(outcome === "dropped"){
      Controller.checkNote("refresh set-up dropped: a newer edit took over");        // the newer run sets up and writes the message
    }else if(outcome === "timeout"){
      const err = new Error("Nie udało się ustawić odświeżania: poprzednia zmiana ustawień trwa zbyt długo.");
      ScheduleRefresh.fail_(settings,err);
      throw err;
    }
  },

  /** The work of the newest run, with the lock. Returns false when a newer run took over before anything was changed. */
  applyNewest_(settings, isLatest){
    if(typeof settings.reloadRefreshSettings == "function") settings.reloadRefreshSettings();      // what the sheet says NOW, not what this run read when it started
    if(!isLatest()) return false;
    const frequency = settings.getRefreshFrequency(), startAt = settings.getRefreshStartAt();
    let result = ScheduleRefresh.setUp(frequency,startAt);
    const wanted = ScheduleRefresh.wanted_(frequency,startAt);
    let problems = ScheduleRefresh.reconcile_(wanted);
    if(problems.length){                                                                              // once more from scratch
      dbgLog(`Refresh set-up not right (${problems.join(", ")}): once more.`);
      result = ScheduleRefresh.setUp(frequency,startAt);
      problems = ScheduleRefresh.reconcile_(wanted);
      if(problems.length) throw new Error(`Odświeżanie nie zostało ustawione poprawnie (${problems.join(", ")}).`);
    }
    ScheduleRefresh.clearSetupError_();
    ScheduleRefresh.report_(settings,{ok:true,off:!result,when:new Date(),frequency:frequency,next:result?.nextRefresh ?? null});
    return true;
  },

  /** A set-up failed: the red message in the sheet, and the error kept for the sidebar (cleared by the next set-up that goes right). */
  fail_(settings, err){
    const current = ScheduleRefresh.current();
    const limit = ScheduleRefresh.isTriggerLimit_(err);
    ScheduleRefresh.recordSetupError_(err,current,limit);
    ScheduleRefresh.report_(settings,{ok:false,when:new Date(),current:current,limit:limit});
  },

  /**
   * Did the set-up fail because Apps Script refuses one more clock trigger? (An add-on may have 5 per user; the platform's message says "too many triggers" - in the
   * user's language: "zbyt wiele wyzwalaczy".) A trigger-related error while the user already has 5 clock triggers counts too.
   */
  isTriggerLimit_(err){
    const text = String(err && err.message || err);
    if(/too many triggers|zbyt wiele wyzwalaczy|zbyt wiele trigger|maximum number of triggers/i.test(text)) return true;
    try{
      return /trigger|wyzwalacz/i.test(text) && ScheduleRefresh.triggersSeen_().filter(t => String(t.getEventType()) == "CLOCK").length >= 5;
    }catch(e){ return false; }
  },

  /** What the sidebar shows later: when, the platform's error (cut to fit the settings property), whether it was the limit, and what was set at that moment. */
  recordSetupError_(err, current, limit){
    try{
      const details = String(err && err.stack || err && err.message || err).slice(0,1200);
      Settings.setRefreshSetupError({at: Date.now(), details: details, limit: !!limit,
        current: current ? {active: !!current.active, frequency: current.frequency, next: current.next ? current.next.getTime() : null} : null});
    }catch(e){ dbgLog(`Set-up error not kept: ${e}`); }
  },

  clearSetupError_(){
    try{ if(Settings.refreshSetupError()) Settings.setRefreshSetupError(null); }catch(e){ dbgLog(`Set-up error not cleared: ${e}`); }
  },

  /** What the settings ask for, as the permit and the trigger must show it: { hours, startAt: "17:30"|null }, or null when the refresh is to be off. */
  wanted_(frequency, startAt){
    const n = typeof frequency?.freq == "string" && frequency.freq.trim() !== "" ? Number(frequency.freq) : frequency?.freq;
    if(!n || (frequency.unit != "days" && frequency.unit != "hrs")) return null;
    return {hours: frequency.unit == "days" ? 24 * n : n, startAt: startAt ? `${startAt.hour}:${String(startAt.minute ?? 0).padStart(2,"0")}` : null};
  },

  /**
   * After a set-up: is the result what the settings ask for, and is it the ONLY refresh trigger of this document? The triggers that belong to this document are the
   * ones the user's records name (Refresh Registry.js; a time trigger has no document of its own): every one of them but the permit's is deleted. Then the
   * permit must be valid (issued for a trigger that exists, not off, the interval and the time of day of the settings); with the refresh off no trigger of this
   * document may be left. Triggers are asked for three times (the list is not reliable, see isInstalled_). Returns what is still wrong (nothing = right);
   * a check that cannot be made (the properties are down) finds nothing wrong rather than failing a set-up that worked.
   */
  reconcile_(wanted){
    const problems = [];
    try{
      const permit = MainSettings.getRefreshPermit();
      const here = RefreshRegistry.document_().docId;
      const triggers = ScheduleRefresh.triggersSeen_().filter(t => ["autoRefresh","autoRefreshHandler"].includes(t.getHandlerFunction()));
      const ids = triggers.map(t => t.getUniqueId());
      const keeper = wanted ? permit?.issuedFor : null;
      if(here){
        RefreshRegistry.all().filter(r => r.docId === here && r.id !== keeper && ids.includes(r.id)).forEach(r => {
          triggers.filter(t => t.getUniqueId() === r.id).forEach(t => ScriptApp.deleteTrigger(t));
          ScheduleRefresh.forget_(r.id);
          dbgLog(`Another refresh trigger of this document removed: ${r.id}`);
        });
      }
      if(wanted){
        if(!permit?.issuedFor || permit.off) problems.push("brak ważnego zezwolenia");
        else if(permit.intervalHours !== wanted.hours) problems.push("zezwolenie ma inną częstotliwość niż ustawienia");
        else if((permit.startAt ?? null) !== wanted.startAt) problems.push("zezwolenie ma inną godzinę niż ustawienia");
        else if(!ids.includes(permit.issuedFor)) problems.push("brak triggera czasowego");
      }else if(permit?.issuedFor && !permit.off && ids.includes(permit.issuedFor)){
        problems.push("trigger nadal istnieje");
      }
    }catch(err){
      dbgLog(`Refresh set-up not verified: ${err}`);
    }
    return problems;
  },

  /**
   * Is the refresh trigger with this id installed (for this user)? The list ScriptApp.getProjectTriggers() gives is NOT reliable in a sidebar call: polled every
   * two seconds it was seen to return all eight triggers of the user and, the next time, only two of them (the permit's trigger missing). So: up to three looks,
   * a short pause between them; and a trigger that was seen within the last two minutes still counts (the sighting is kept in the cache, renewed by every look
   * that finds it, and forgotten when the add-on removes the trigger itself). A trigger deleted by hand therefore shows as gone up to two minutes late.
   */
  isInstalled_(triggerUid){
    if(!triggerUid) return false;
    for(let i = 0; i < 3; i++){
      if(i) Utilities.sleep(200);
      const found = ScriptApp.getProjectTriggers().some(t => t.getUniqueId() === triggerUid && ["autoRefresh","autoRefreshHandler"].includes(t.getHandlerFunction()));
      if(found){
        try{ Store.cache.set("document","refreshTriggerSeen",triggerUid,REFRESH_TRIGGER_SEEN_SECONDS); }catch(err){ dbgLog(`Sighting not cached: ${err}`); }
        return true;
      }
    }
    try{ return Store.cache.get("document","refreshTriggerSeen") === triggerUid; }catch(err){ return false; }
  },

  /** What current() looked at, as plain data (the sidebar shows it under "Szczegóły techniczne": a state that flips between two polls can be told apart there). */
  explain(now = new Date()){
    try{
      const permit = MainSettings.getRefreshPermit();
      const triggers = ScriptApp.getProjectTriggers().filter(t => ["autoRefresh","autoRefreshHandler"].includes(t.getHandlerFunction())).map(t => t.getUniqueId());
      return {permitFor: permit?.issuedFor ?? null, off: !!permit?.off, issuedByMe: !!permit?.issuedBy && permit.issuedBy === ScheduleRefresh.ownerToken_(false),
              hasToken: !!permit?.issuedBy, intervalHours: permit?.intervalHours ?? null, lastRun: permit?.lastRun ?? null, triggers: triggers,
              named: !!permit?.issuedFor && triggers.includes(permit.issuedFor), seenRecently: Store.cache.get("document","refreshTriggerSeen") === (permit?.issuedFor ?? null), at: now.toISOString()};
    }catch(err){
      return {error: String(err && err.message || err)};
    }
  },

  /** A token that tells this user from the others in the permit (user properties: not shared). Created only when asked to. */
  ownerToken_(create){
    let token = Store.get("user","refreshOwnerToken");
    if(!token && create){ token = Date.now().toString(36) + Math.random().toString(36).slice(2,10); Store.set("user","refreshOwnerToken",token); }
    return token || null;
  },

  /**
   * What is actually set now, as far as the add-on can tell: the permit of this document names a refresh trigger that exists.
   * `next` is an estimate (the next run the permit remembers, rolled forward by the interval until it is ahead); null when it cannot be told.
   * @returns {{active: boolean, frequency?: {freq: number, unit: "hrs"|"days"}, next?: Date}|null} null when even this could not be read.
   */
  current(now = new Date()){
    try{
      const permit = MainSettings.getRefreshPermit();
      if(!permit?.issuedFor || !permit.intervalHours) return {active:false};
      const hours = permit.intervalHours, days = hours % 24 === 0;
      const step = hours * 3600000;
      if(permit.off) return {active:false};
      const exists = ScheduleRefresh.isInstalled_(permit.issuedFor);
      // The trigger is not among this user's. If this user issued the permit, it was deleted (by hand, in the trigger editor): nothing is set.
      if(!exists && permit.issuedBy && permit.issuedBy === ScheduleRefresh.ownerToken_(false)) return {active:false};
      // getProjectTriggers() lists the triggers of the current user only. A permit that names a trigger which is not there but was used lately (within
      // two and a half intervals) points to a trigger set by another user: it is shown, marked, with what the permit remembers.
      const lately = (permit.lastRun ?? permit.lastRefresh ?? 0) + 2.5 * step > now.getTime();
      if(!exists && !lately) return {active:false};
      let next = permit.nextRefresh ?? ((permit.lastRun ?? permit.lastRefresh ?? now.getTime()) + step);
      if(next <= now.getTime()) next += Math.ceil((now.getTime() - next + 1) / step) * step;
      return {active:true, foreign:!exists, intervalHours:hours, startAt:permit.startAt ?? null,
              frequency:{freq: days ? hours / 24 : hours, unit: days ? "days" : "hrs"}, next: new Date(next)};
    }catch(err){
      dbgLog(`Current refresh state not read: ${err}`);
      return null;
    }
  },

  /** Writes the message; if that fails, or the report is a failure, a toast tells about it (the toast is the last resort and must not throw). */
  report_(settings, report){
    let written = false;
    try{
      settings.setRefreshMessage(report);
      written = true;
    }catch(err){
      dbgLog(`Refresh message not written: ${err}`);
    }
    if(!written || !report.ok){
      try{ settings.toastRefreshError(); }catch(err){ dbgLog(`Toast failed: ${err}`); }
    }
  },

  /** @param e {Object} The time-based trigger event (e.triggerUid). */
  run(e){
    dbgLog(`Running autoRefreshHandler. Id = ${e.triggerUid}.`);
    let myPermit = MainSettings.getRefreshPermit();
    if(myPermit) dbgLog(`Permit issued for ${myPermit.issuedFor} (${myPermit.issuedFor !== e.triggerUid ? 'NOT my permit. Removing...' : 'my permit'})`);
    // Registry doesn't point at me anymore → delete my own trigger and stop
    if (!myPermit || myPermit.issuedFor !== e.triggerUid || myPermit.off) {      // a permit marked off (the refresh was switched off) holds nobody
      Controller.intent("refresh.retired",{sheet: null, changeType: null});
      ScheduleRefresh.logRetired_(e.triggerUid,false);
      ScheduleRefresh.removeTrigger(e.triggerUid);
      return;
    }

    Controller.intent("refresh.scheduled",{sheet: null, changeType: null});
    const sheets = ScheduleRefresh.tickedResultSheets_();
    const started = Date.now();
    RefreshAll.scheduled(ScheduleRefresh.triggerText_(e.triggerUid,false));
    
    ScheduleRefresh.finishRun_(e.triggerUid,sheets,started);
  },

  /** What the log says about the clock trigger that fired. */
  triggerText_(triggerUid, legacy){
    return `Clock trigger ${triggerUid}${legacy ? " (old version: autoRefresh function)" : ""}`;
  },

  /** A trigger that does not hold the permit deletes itself and refreshes nothing: that is an entry of the log too. */
  logRetired_(triggerUid, legacy){
    RefreshLog.logOnly(REFRESH_LOG_SOURCES.auto,
      `${ScheduleRefresh.triggerText_(triggerUid,legacy)}. The refresh permit is not issued for this trigger (the refresh is switched off, or the permit is issued for another trigger): the trigger was deleted, no refresh was performed.`,
      "Odświeżanie nie zostało wykonane");
  },

  /**
   * After a scheduled refresh: the permit records the run (when, how long, which sheets, the next planned run) and the status message in the settings sheet is
   * written again - the same text as after a settings change, with the next refresh moved on. A refresh that failed never gets here (the message stays).
   */
  finishRun_(triggerUid, sheets, started){
    const extra = {lastDurationMs: Date.now() - started, lastSheets: sheets};
    const next = ScheduleRefresh.nextAfterRun_(MainSettings.getRefreshPermit(), started);
    if(next) extra.nextRefresh = next;
    const touched = MainSettings.touchRefreshPermit(triggerUid,extra);
    try{
      RefreshRegistry.syncFromPermit(MainSettings.getRefreshPermit());
      RefreshRegistry.touch(triggerUid,{lastRun: Date.now(), lastDurationMs: extra.lastDurationMs, lastSheets: sheets, nextRefresh: extra.nextRefresh});
    }catch(err){ dbgLog(`Refresh trigger record not updated: ${err}`); }
    if(touched) ScheduleRefresh.reportScheduled_();
  },

  /**
   * The next planned run after the one that started at `started`: the planned time the permit remembers, moved on by whole intervals until it is more than half an
   * interval after the start (a run may start up to a quarter of an hour off its planned time, and it must not count itself as the next one). 0 when unknown.
   */
  nextAfterRun_(permit, started){
    const step = (permit?.intervalHours || 0) * 3600000;
    if(!step) return 0;
    let next = permit.nextRefresh ?? ((permit.lastRun ?? permit.lastRefresh ?? started) + step);
    const limit = started + step / 2;
    if(next <= limit) next += Math.ceil((limit - next + 1) / step) * step;
    return next;
  },

  /** Writes the status message from the permit (the run must not fail because the message cannot be written: it is only logged). */
  reportScheduled_(){
    try{
      const permit = MainSettings.getRefreshPermit();
      if(!permit?.intervalHours || permit.off || !permit.nextRefresh) return;
      const hours = permit.intervalHours, days = hours % 24 === 0;
      getMainSettings().setRefreshMessage({ok: true, when: new Date(permit.lastRefresh ?? Date.now()), frequency: {freq: days ? hours / 24 : hours, unit: days ? "days" : "hrs"}, next: new Date(permit.nextRefresh)});
    }catch(err){
      dbgLog(`Status message not updated after the scheduled refresh: ${err}`);
    }
  },

  /** The result sheets of the pairs ticked for automatic refresh (what a scheduled run refreshes), for the record on the permit. */
  tickedResultSheets_(){
    try{ return getMainSettings().getSheetListWithRefreshTrue().map(x => x.resultSheet); }catch(err){ return []; }
  },

  /** This only serves the legacy version: older triggers run autoRefresh() rather than autoRefreshHandler(e). */
  runLegacy(e){
    dbgLog(`Running autoRefresh. Id = ${e.triggerUid}.`);
    let myPermit = MainSettings.getRefreshPermit();
    // There was no permits for autoRefresh. Reissue my own permit.
    if (!myPermit) {
      MainSettings.setRefreshPermit(e.triggerUid);
      myPermit = MainSettings.getRefreshPermit();
      dbgLog(`Permit resissued.`)
    }
    else dbgLog(`Permit was already available. Permit issued for ${myPermit.issuedFor} (${myPermit.issuedFor !== e.triggerUid ? 'NOT my permit. Removing...' : 'my permit'})`);
    // Registry doesn't point at me anymore → delete my own trigger and stop
    if (myPermit.issuedFor !== e.triggerUid || myPermit.off) {
      Controller.intent("refresh.retired",{sheet: null, changeType: null});
      ScheduleRefresh.logRetired_(e.triggerUid,true);
      ScheduleRefresh.removeTrigger(e.triggerUid);
      return;
    }

    Controller.intent("refresh.scheduled",{sheet: null, changeType: null});
    const sheets = ScheduleRefresh.tickedResultSheets_();
    const started = Date.now();
    RefreshAll.scheduled(ScheduleRefresh.triggerText_(e.triggerUid,true));
    
    ScheduleRefresh.finishRun_(e.triggerUid,sheets,started);
  },

  /** Deletes the refresh trigger (current or legacy handler) with this id, if there is one. Any other trigger with that id (an agent) is left alone. */
  removeRefreshTrigger_(triggerUid){
    if(!triggerUid) return;
    try{ if(Store.cache.get("document","refreshTriggerSeen") === triggerUid) Store.cache.remove("document","refreshTriggerSeen"); }catch(err){}
    ScheduleRefresh.forget_(triggerUid);
    ScheduleRefresh.triggersSeen_()
      .filter(t => t.getUniqueId() === triggerUid && ["autoRefresh","autoRefreshHandler"].includes(t.getHandlerFunction()))
      .forEach(t => ScriptApp.deleteTrigger(t));
  },

  /** The project triggers as seen in up to three looks (union by id): one list may be incomplete (see isInstalled_), a trigger that is gone shows in none. */
  triggersSeen_(){
    const seen = new Map();
    for(let i = 0; i < 3; i++){
      if(i) Utilities.sleep(200);
      ScriptApp.getProjectTriggers().forEach(t => seen.set(t.getUniqueId(),t));
    }
    return [...seen.values()];
  },

  /**
   * Developer tools: deletes the time trigger with this id and NOTHING ELSE (no permit, record, cache or message is touched), so that what the add-on does when a
   * trigger goes missing can be tested. Only a time trigger can be deleted this way, never an agent.
   */
  forceDelete(triggerId){
    const trigger = ScheduleRefresh.triggersSeen_().find(t => t.getUniqueId() === triggerId && String(t.getEventType()) == "CLOCK");
    if(!trigger) throw new Error(`Nie znaleziono triggera czasowego ${triggerId}.`);
    ScriptApp.deleteTrigger(trigger);
  },

  /** Deletes the project trigger with this id (a time trigger removes itself this way). */
  removeTrigger(triggerUid){
    ScheduleRefresh.forget_(triggerUid);
    ScheduleRefresh.triggersSeen_()
      .filter(t => t.getUniqueId() === triggerUid)
      .forEach(t => ScriptApp.deleteTrigger(t));
  }
};
