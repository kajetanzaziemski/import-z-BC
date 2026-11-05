// ---------------------------------------------------------------------------
// REFRESH REGISTRY: what this user's time triggers (the automatic refresh) are for. A time trigger tells nothing about itself: no document, no interval, no
// last run (ScriptApp gives its id, handler and event type, and that is all), while ScriptApp.getProjectTriggers() lists the user's triggers of ALL documents.
// So every set-up writes a record to the USER properties, and every scheduled run updates it; the sidebar's list "Arkusze, które odświeżasz automatycznie"
// is made from the triggers that exist and these records.
//
//   one property per trigger, "refreshTrigger:<trigger id>" (user scope), JSON:
//     docId, docName, url, gid (the settings sheet), docTz        the document the trigger refreshes (as of the last write)
//     intervalHours, startAt ("17:30"), timeZone                  how it was set up
//     setAt, nextRefresh                                           when it was set up; the next planned run
//     lastRun, lastDurationMs, lastSheets                          the last scheduled run
//     seenAt                                                       the last time the list saw the trigger
//
// One property per trigger, not one for all: the runs of different documents can write at the same moment and a whole-snapshot write-back would lose one
// of them (CLAUDE.md). A record never makes a trigger exist: the list starts from the triggers; a record whose trigger has not been seen for a week is dropped.
// Nothing here may fail a set-up or a run: callers wrap the calls, and the functions below do not throw on missing data.
// ---------------------------------------------------------------------------

const REFRESH_REGISTRY_PREFIX = "refreshTrigger:";
const REFRESH_REGISTRY_FORGET_MS = 7 * 24 * 3600000;
const REFRESH_REGISTRY_SEEN_EVERY_MS = 3600000;      // seenAt is renewed at most this often (a write per trigger per opening of the tab otherwise)

const RefreshRegistry = {
  get(triggerId){
    if(!triggerId) return null;
    try{ return Store.getJson("user",REFRESH_REGISTRY_PREFIX + triggerId,null); }catch(err){ return null; }
  },

  /** All records, each with its `id`. */
  all(){
    return Store.keys("user",REFRESH_REGISTRY_PREFIX).map(k => {
      const rec = RefreshRegistry.get(k.slice(REFRESH_REGISTRY_PREFIX.length));
      return rec && Object.assign({id: k.slice(REFRESH_REGISTRY_PREFIX.length)},rec);
    }).filter(x => x);
  },

  /** Merges fields into the record (made if missing). Undefined fields are left out. */
  put(triggerId, fields){
    if(!triggerId) return null;
    const merged = Object.assign({},RefreshRegistry.get(triggerId),fields);
    Object.keys(merged).forEach(k => { if(merged[k] === undefined) delete merged[k]; });
    Store.setJson("user",REFRESH_REGISTRY_PREFIX + triggerId,merged);
    return merged;
  },

  remove(triggerId){
    if(triggerId) Store.remove("user",REFRESH_REGISTRY_PREFIX + triggerId);
  },

  /** The document the code is running in, as far as it can be told (a missing piece is left out). */
  document_(){
    const out = {};
    const take = (key, fn) => { try{ const v = fn(); if(v !== null && v !== undefined && v !== "") out[key] = v; }catch(err){} };
    let ss = null;
    try{ ss = SpreadsheetApp.getActiveSpreadsheet(); }catch(err){}
    if(!ss) return out;
    take("docId",() => ss.getId());
    take("docName",() => ss.getName());
    take("url",() => ss.getUrl());
    take("docTz",() => ss.getSpreadsheetTimeZone());
    take("gid",() => ss.getSheetByName(MainSettings.getSettingsSheetName()).getSheetId());
    return out;
  },

  /** A set-up made this trigger: the record is written from scratch (a record of an earlier trigger with the same id cannot exist). */
  register(triggerId, how){
    if(!triggerId) return;
    Store.setJson("user",REFRESH_REGISTRY_PREFIX + triggerId,Object.assign(RefreshRegistry.document_(),how));
  },

  /** What the refresh permit of this document (document properties, shared by all users of the document) says about its trigger, as record fields. */
  fromPermit(permit){
    return {intervalHours: permit.intervalHours, startAt: permit.startAt ?? undefined, timeZone: permit.timeZone ?? undefined, setAt: permit.lastRefresh,
            nextRefresh: permit.nextRefresh, lastRun: permit.lastRun, lastDurationMs: permit.lastDurationMs, lastSheets: permit.lastSheets};
  },

  /** The record is replaced as a whole (put() only adds to it: a field that is gone from the new data would stay). */
  replace(triggerId, fields){
    Object.keys(fields).forEach(k => { if(fields[k] === undefined) delete fields[k]; });
    Store.setJson("user",REFRESH_REGISTRY_PREFIX + triggerId,fields);
  },

  /**
   * This user's trigger of THIS document: the user's record is made or brought up to date from the document's permit when it is missing, has no document, or
   * differs in the settings or has an older last run (another user of the document, or an older version of the add-on, may have written the permit; the
   * permit is where this document's trigger is kept true). Called only for a trigger that is among the user's.
   */
  syncFromPermit(permit){
    if(!permit?.issuedFor || !permit.intervalHours || permit.off) return;
    const id = permit.issuedFor, rec = RefreshRegistry.get(id);
    const fromPermit = RefreshRegistry.fromPermit(permit);
    const stale = !rec || !rec.docId || rec.intervalHours !== permit.intervalHours || (rec.startAt ?? null) !== (permit.startAt ?? null) || (permit.lastRun ?? 0) > (rec.lastRun ?? 0);
    if(stale) RefreshRegistry.replace(id,Object.assign(RefreshRegistry.document_(),fromPermit,rec?.seenAt ? {seenAt: rec.seenAt} : {}));
  },

  /** A scheduled run of this trigger finished: the record gets the run (and the document's name / address as they are now). */
  touch(triggerId, run){
    RefreshRegistry.put(triggerId,Object.assign(RefreshRegistry.document_(),run));
  },

  /** The list saw these triggers (ids): renews `seenAt` of their records (at most once an hour) and drops the records unseen for a week. */
  markSeen(seenIds, now = Date.now()){
    RefreshRegistry.all().forEach(rec => {
      if(seenIds.includes(rec.id)){
        if(!rec.seenAt || now - rec.seenAt > REFRESH_REGISTRY_SEEN_EVERY_MS) RefreshRegistry.put(rec.id,{seenAt: now});
      }else if(now - (rec.seenAt ?? rec.setAt ?? rec.lastRun ?? 0) > REFRESH_REGISTRY_FORGET_MS){
        RefreshRegistry.remove(rec.id);
      }
    });
  }
};
