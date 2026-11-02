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
// Known quirks kept: without a frequency (null) it removes that trigger and then fails with a TypeError; the first legacy run records no lastRun (the permit it just issued is not stored yet when it is touched).
// ---------------------------------------------------------------------------

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
    ScheduleRefresh.removeRefreshTrigger_(permit?.issuedFor);

    let interval = frequency.freq;
    let intervalHrs = interval;

    if(!frequency.freq || (frequency.unit != "days" && frequency.unit != "hrs")){
      // Refresh switched off here. A document that never had a permit gets one for nobody: an old trigger of this document that has not claimed
      // one yet would otherwise claim it when it fires (the legacy handler does) and go on refreshing; with a permit for nobody it deletes itself.
      if(!permit) MainSettings.setRefreshPermit(null,0);
      return null;
    }
    let trigger = ScriptApp.newTrigger('autoRefreshHandler').timeBased();
    if(frequency.unit=="days"){
      trigger.everyDays(interval);
      if(startAt) trigger.atHour(startAt.hour);
      intervalHrs = 24 * interval;
    }else{
      trigger.everyHours(interval);
    }
    if(startAt && startAt.minute != null) trigger.nearMinute(startAt.minute);
    if(startAt?.timeZone) trigger.inTimezone(startAt.timeZone);      // else the time zone of the script

    let newTrigger = trigger.create();
    // Issue a permit for this trigger. This will override any other permits, so all old triggers will automatically uninstall.
    MainSettings.setRefreshPermit(newTrigger.getUniqueId(),intervalHrs);
    const nextRefresh = ScheduleRefresh.nextRefresh(new Date(), frequency.unit, interval, startAt);
    const issued = MainSettings.getRefreshPermit();
    MainSettings.updateRefreshPermit(Object.assign({}, issued, {nextRefresh: nextRefresh.getTime()}));
    return {nextRefresh, intervalHrs};
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

  /** The next HH:mm ahead in the time zone of startAt (today or tomorrow), as a moment. */
  nextDailyIn_(now, startAt){
    const tz = startAt.timeZone;
    const [y, m, d] = Utilities.formatDate(now, tz, "yyyy-MM-dd").split("-").map(Number);
    const momentAt = (yy, mm, dd) => {              // the wall time hh:mm of that day in tz: its UTC reading minus the offset of tz at that moment (twice: the offset may change on the day)
      const wall = Date.UTC(yy, mm - 1, dd, startAt.hour, startAt.minute ?? 0);
      const offset = t => { const z = Utilities.formatDate(new Date(t), tz, "Z"); return (z[0] == "-" ? -1 : 1) * (+z.slice(1,3) * 60 + +z.slice(3)) * 60000; };
      return new Date(wall - offset(wall - offset(wall)));
    };
    let next = momentAt(y, m, d);
    if(next <= now){
      const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
      next = momentAt(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate());
    }
    return next;
  },

  /**
   * The edit of the refresh frequency: sets the trigger up and reports the result in the message area of the settings sheet.
   * Success: the message says how often and when next; failure: the message says nothing was updated and a toast tells about it;
   * when even the message cannot be written, only the toast is left. The error goes on to the caller as before.
   * @param settings the settings sheet object (getMainSettings())
   */
  apply(settings){
    let result;
    try{
      result = ScheduleRefresh.setUp(settings.getRefreshFrequency(), settings.getRefreshStartAt());
    }catch(err){
      ScheduleRefresh.report_(settings,{ok:false,when:new Date(),current:ScheduleRefresh.current()});
      throw err;
    }
    ScheduleRefresh.report_(settings,{ok:true,off:!result,when:new Date(),frequency:settings.getRefreshFrequency(),next:result?.nextRefresh ?? null});
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
      const exists = ScriptApp.getProjectTriggers().some(t => t.getUniqueId() === permit.issuedFor && ["autoRefresh","autoRefreshHandler"].includes(t.getHandlerFunction()));
      if(!exists) return {active:false};
      const hours = permit.intervalHours, days = hours % 24 === 0;
      const step = hours * 3600000;
      let next = permit.nextRefresh ?? ((permit.lastRun ?? permit.lastRefresh ?? now.getTime()) + step);
      if(next <= now.getTime()) next += Math.ceil((now.getTime() - next + 1) / step) * step;
      return {active:true, frequency:{freq: days ? hours / 24 : hours, unit: days ? "days" : "hrs"}, next: new Date(next)};
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
    if (!myPermit || myPermit.issuedFor !== e.triggerUid) {
      Controller.intent("refresh.retired",{sheet: null, changeType: null});
      ScheduleRefresh.removeTrigger(e.triggerUid);
      return;
    }

    Controller.intent("refresh.scheduled",{sheet: null, changeType: null});
    RefreshAll.scheduled();
    
    MainSettings.touchRefreshPermit(e.triggerUid);
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
    if (myPermit.issuedFor !== e.triggerUid) {
      Controller.intent("refresh.retired",{sheet: null, changeType: null});
      ScheduleRefresh.removeTrigger(e.triggerUid);
      return;
    }

    Controller.intent("refresh.scheduled",{sheet: null, changeType: null});
    RefreshAll.scheduled();
    
    MainSettings.touchRefreshPermit(e.triggerUid);
  },

  /** Deletes the refresh trigger (current or legacy handler) with this id, if there is one. Any other trigger with that id (an agent) is left alone. */
  removeRefreshTrigger_(triggerUid){
    if(!triggerUid) return;
    ScriptApp.getProjectTriggers()
      .filter(t => t.getUniqueId() === triggerUid && ["autoRefresh","autoRefreshHandler"].includes(t.getHandlerFunction()))
      .forEach(t => ScriptApp.deleteTrigger(t));
  },

  /** Deletes the project trigger with this id (a time trigger removes itself this way). */
  removeTrigger(triggerUid){
    ScriptApp.getProjectTriggers()
      .filter(t => t.getUniqueId() === triggerUid)
      .forEach(t => ScriptApp.deleteTrigger(t));
  }
};
