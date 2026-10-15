# Project notes

- This is a **Google Apps Script add-on for Google Sheets** (managed with clasp; `.clasp.json`), currently published in the Google Workspace Marketplace SDK **privately** (testers only, within the domain). Treat changes as affecting a live add-on.
- `CLIENT_ID_`, `CLIENT_SECRET_` and `SCOPE_` are JS consts defined in an untracked file (`Autoryzacja-credentials.js`, in `.gitignore`) whose name starts with `00` so it sorts first in the clasp file list. Treat them as defined.
- Storage: `getImportSettings()` is a `StorageObject` over document properties. Executions run concurrently (onEdit, onChange, time triggers), so `StorageObject.saveArray()` writes only the keys changed via `setProperty()`, merged under a lock. Never write a whole snapshot back.
- Time-based triggers are managed through a "refresh permit" (`MainSettings.*RefreshPermit`): a trigger runs only if `permit.issuedFor === e.triggerUid`, otherwise it deletes itself. Time-based triggers are not returned by `ScriptApp.getUserTriggers(ss)`; use `getProjectTriggers()`.
