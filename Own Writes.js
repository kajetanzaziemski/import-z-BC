// ---------------------------------------------------------------------------
// OWN WRITES: "the add-on wrote to the spreadsheet just now", kept in the document cache for OWN_WRITE_WINDOW seconds.
// A write made by the script fires the installable on-change trigger a moment later (a sheet inserted, rows added, a result table grown). The router (Router.js) judges an
// on-change event by the ACTIVE sheet, so the event of the wizard's new config sheet - or of a result sheet growing while a config sheet is open - started a second co-edit
// of a sheet that was being analysed anyway: the first one was dropped for it and left the reading light to the newer one. Structure changes that arrive while the note is
// there are the add-on's own: the job is "change.own" and nothing is done. (A user's structure change in the same few seconds is not co-edited either; the cell edits that
// follow it are.)
// The Grid and BulkSheet announce their writes through the hook ownWriteHook (they know nothing of the project).
// ---------------------------------------------------------------------------

const OWN_WRITE_KEY = "ownWrite";
const OWN_WRITE_WINDOW = 20;       // seconds, counted from the last write

const OwnWrites = {
  /** The add-on has just written to the spreadsheet. Never throws: the note is optional. */
  note(){
    Store.optional.setCache("document",OWN_WRITE_KEY,"1",OWN_WRITE_WINDOW);
  },

  /** Did the add-on write within the last OWN_WRITE_WINDOW seconds? (No cache service: false.) */
  recent(){
    return !!Store.optional.getCache("document",OWN_WRITE_KEY);
  }
};

function ownWriteHook(){
  OwnWrites.note();
}
