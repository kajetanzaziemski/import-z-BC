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
// Known quirks kept: setUp removes the refresh triggers of ALL documents of the user (bugs-todo #5); without a frequency (null) it removes them
// and then fails with a TypeError; the first legacy run records no lastRun (the permit it just issued is not stored yet when it is touched).
// ---------------------------------------------------------------------------

const ScheduleRefresh = {
  /**
   * @param frequency {{freq: number, unit: "hrs"|"days"|null}} As SettingsSheet.getRefreshFrequency() returns it.
   *   Empty freq or unknown unit: the old triggers are removed and no new one is created.
   */
  setUp(frequency){
    // Time-based triggers are not bound to the spreadsheet, so getUserTriggers(ss) does not list them. Use project triggers.
    ScriptApp.getProjectTriggers().filter(trigger => ["autoRefresh","autoRefreshHandler"].includes(trigger.getHandlerFunction())).forEach(trigger => ScriptApp.deleteTrigger(trigger));

    let interval = frequency.freq;
    let intervalHrs = interval;

    if(!frequency.freq) return;
    let trigger = ScriptApp.newTrigger('autoRefreshHandler').timeBased();
    if(frequency.unit=="days"){
      trigger.everyDays(interval);
      intervalHrs = 24 * interval;
    }else if(frequency.unit=="hrs"){
      trigger.everyHours(interval);
    }else return;

    let newTrigger = trigger.create();
    // Issue a permit for this trigger. This will override any other permits, so all old triggers will automatically uninstall.
    MainSettings.setRefreshPermit(newTrigger.getUniqueId(),intervalHrs);
  },

  /** @param e {Object} The time-based trigger event (e.triggerUid). */
  run(e){
    dbgLog(`Running autoRefreshHandler. Id = ${e.triggerUid}.`);
    let myPermit = MainSettings.getRefreshPermit();
    if(myPermit) dbgLog(`Permit issued for ${myPermit.issuedFor} (${myPermit.issuedFor !== e.triggerUid ? 'NOT my permit. Removing...' : 'my permit'})`);
    // Registry doesn't point at me anymore → delete my own trigger and stop
    if (!myPermit || myPermit.issuedFor !== e.triggerUid) {
      ScheduleRefresh.removeTrigger(e.triggerUid);
      return;
    }

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
      ScheduleRefresh.removeTrigger(e.triggerUid);
      return;
    }

    RefreshAll.scheduled();
    
    MainSettings.touchRefreshPermit(e.triggerUid);
  },

  /** Deletes the project trigger with this id (a time trigger removes itself this way). */
  removeTrigger(triggerUid){
    ScriptApp.getProjectTriggers()
      .filter(t => t.getUniqueId() === triggerUid)
      .forEach(t => ScriptApp.deleteTrigger(t));
  }
};
