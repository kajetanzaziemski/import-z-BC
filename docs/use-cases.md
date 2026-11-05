# Use cases extracted from Menu.js and Settings Sheet.js (step 3 of the plan)

Pure move: same calls in the same order, same error handling, same status-cell switching. One intended difference (below).

| New | Was | Role |
|---|---|---|
| `RefreshSheet.run(configSheetName?, resultSheetName?)` (`RefreshSheet.js`) | `refreshAllDataForConfigSheet` in `Menu.js` | read the config sheet, fetch every page from BC, write the result sheet; status cells show reading → connection (per page) → writing and are put back to idle on any failure |
| `EstimateSheet.run(configSheetName?)` (`EstimateSheet.js`) | `estimateResponseSize` in `Menu.js` | fetch the first page, show the estimated row count in F2 of the config sheet; writes to no other sheet |
| `ImportQuery.connectionFor(shCoed)` (`Import Query.js`) | the same 5 lines written out twice | the `ODataConnection` described by a config sheet |
| `ResultSheet.write(sheetName, table, columnDataTypes)` (`ResultSheet.js`) | the inline block at the end of the refresh | create-if-missing, wipe (`getDataRange().clear()`), one number format per column from the data type, one `setValues` |

`Menu.js` keeps the menu entry points and their action names (`menuRefreshCurrentSheet`, `menuRefreshAll`, `menuEstimateForCurrentSheet`, so the live check still recognises them) and now
calls the use cases. (The old names `refreshAllDataForConfigSheet`, `estimateResponseSize` and `refreshAllTrue` are gone.)

## Behaviour kept on purpose (pinned by tests)
- The reading cell is lit by the `SheetCoeditor` constructor; refresh puts it idle *before* lighting writing; an error anywhere puts the lit cell back to idle and is rethrown.
- A refresh without a table in the config sheet only puts reading to idle. The result sheet is only touched after the data was fetched successfully.
- The data type of a column is looked up with the column's own table (`Sales.Since`) or else the main table.
- **Quirk kept: `EstimateSheet` without a table returns early and leaves the reading cell lit** (the old code did; the live check's "activity indicators back to idle" will report it - see `docs/bugs-fixed.md` style findings). It is pinned by a test so that fixing it is a conscious change.

## The one intended change
`estimateForCurrentSheet_script` assigned `configSheet = ...` without `let` and created an implicit global (`docs/bugs-fixed.md` #4). It is a local now. Nothing else read that global.

## How it is tested (`tests/refresh.test.js`)
Real: `Menu.js`, the use cases, `DataType`, `Controller`/`Settings`/`Store`, and the result sheet on the simulated spreadsheet. Faked (recording every call): `SheetCoeditor`, `ODataConnection`,
`getMetadata`, `getMainSettings`. Written first against the old `Menu.js` (all green), then the extraction ran against the same tests; 12 deliberate breakages of the new files are all caught.
Rules: the use cases and `ImportQuery` contain no `SpreadsheetApp`/range access; `Menu.js` builds no connection or coeditor; only `ResultSheet.js` clears a data range; the new files load alone.

**Not covered offline:** the real query model (`CCTImportConfig`, `ODataQuery`, `ODataResponseTable`) end to end - they were not changed, and the fakes stand in for them. The live check
(`menuRefreshCurrentSheet`, `menuRefreshAll`, `menuEstimateForCurrentSheet`: result sheet exists, data rows = estimate, uniform formats, indicators idle) covers that on a real spreadsheet.

## Next
- `RefreshAll` / `ScheduleRefresh` (the loops in `Menu.js` and `Settings Sheet.js`, `autoRefreshFunction`) can now call `RefreshSheet.run` directly.
- `ResultSheet.write` is the seam for the BulkSheet writer: tall data should not go through Grid's 3000-row window; the contract (table, per-column types) is already the one a bulk writer needs.


---

# RefreshAll and ScheduleRefresh

| New | Was | Role |
|---|---|---|
| `RefreshAll.all()` (`RefreshAll.js`) | body of `refreshAll` in `Menu.js` | every config/result pair of the settings sheet, in order (menu "refresh all") |
| `RefreshAll.ticked()` | `refreshAllTrue` | only the pairs ticked for automatic refresh |
| `RefreshAll.scheduled()` | `autoRefreshFunction` in `Settings Sheet.js` | what a time trigger does: `ticked()`, then note the time on the settings sheet |
| `ScheduleRefresh.setUp(frequency)` (`ScheduleRefresh.js`) | `SettingsSheet.setRefreshTrigger` | remove the refresh triggers, create THE time trigger (`everyHours(n)` / `everyDays(n)`), issue the refresh permit for it (interval in hours) |
| `ScheduleRefresh.run(e)` | `autoRefreshContent` | a time trigger fired: only if the permit was issued for this trigger refresh (`RefreshAll.scheduled()`) and touch the permit, else delete itself |
| `ScheduleRefresh.runLegacy(e)` | `autoRefreshContentOld` | the same for old triggers that run `autoRefresh()`; issues its own permit when there is none |

Entry points stay where they are and keep their names, action names and live-check hooks: `autoRefreshHandler(e)` / `autoRefresh(e)` (`Controller.checkInput` + `Controller.run("requestAutoRefesh", ...)`),
`refreshAll()` (`menuRefreshAll`). The old function names (`autoRefreshFunction`, `autoRefreshContent`, `autoRefreshContentOld`, `refreshAllTrue`, `SettingsSheet.setRefreshTrigger`) are one-line forwarders.

## Behaviour kept on purpose (pinned by `tests/schedule.test.js`, written first against the old code)
- The permit rules of CLAUDE.md: a trigger refreshes only if `permit.issuedFor === e.triggerUid`, otherwise it deletes itself (only itself); `touchRefreshPermit` re-reads the store, so a permit reissued by another run meanwhile is not overwritten.
- Quirks, pinned so that fixing them is a conscious change: `setUp` replaces only the trigger this document's permit names (bugs-fixed #5, fixed: it used to remove the refresh triggers of all documents of the user); without a refresh-frequency row (`null`) it fails with a `TypeError` before anything is changed; a frequency that is no whole number above zero ("x", 1.5) is an error before anything is changed too, the old trigger is removed BEFORE the new one is created (the add-on may hold only one time trigger per document and user; creating first failed with "too many triggers named time-based"), and when the creation fails the old one is put back from the permit (interval, `startAt`, `timeZone`), or the permit is marked off; after a scheduled refresh the permit records the run and the next planned one (`nextAfterRun_`) and the status message is written again (green, as after a set-up, the next refresh moved on; a failed refresh leaves the message); switching off keeps the permit and marks it `off`; the permit records who issued it (`issuedBy`, a token in the user properties) so that a trigger deleted by hand is not shown as another user's; whether the trigger is installed is asked up to three times and a sighting counts for two minutes (`isInstalled_`: in a sidebar call `ScriptApp.getProjectTriggers()` was seen to return 8 triggers and, two seconds later, 2 of them);
  the time is noted also when nothing was ticked and not when a refresh fails; the first legacy run records no `lastRun` (the permit it issued is not stored yet when it is touched); the first failing sheet stops the loop.

## The one difference
`SettingsSheet.setRefreshTrigger()` used to read the refresh frequency *after* removing the triggers; the forwarder reads it first and hands the value to `ScheduleRefresh.setUp`. It only matters if reading the settings sheet itself fails: then the old triggers are no longer removed first.

## Testing
Real files in a fresh Apps Script scope on fake Properties/Cache/Lock services and a fake `ScriptApp` with real trigger bookkeeping (`tests/platform-fakes.js`: `newTrigger(...).timeBased().everyHours(n).create()`, `getProjectTriggers()`, `getUserTriggers()` without time triggers,
`deleteTrigger`). Faked: the settings sheet object and the single-sheet refresh. 12 deliberate breakages of the new files are all caught. Rules: neither file touches a spreadsheet; only `ScheduleRefresh.js` creates time-based triggers or removes the refresh triggers; the new files load alone.
**Not covered offline:** Apps Script's real trigger quotas/latency and real `ScriptApp` behaviour; the live check (`requestAutoRefesh`, `sheetEditAction` for the refresh-frequency edit) covers those on a real spreadsheet.

## Menu items (`Menu Actions.js`)
`Menu.js` keeps the entry points (one `Controller.run` with the action name each); `MenuActions` has the work: `analyseActive`, `refreshActive`, `estimateActive`, `insertWizard`, `authorise`, `logout`
and the shared lookup of the config sheet of the active sheet (`activeConfigSheet`, `warnNotConfigSheet`). The `*_script` helpers (`refreshCurrentSheet_script`, `estimateForCurrentSheet_script`) are gone.
Pinned by `tests/menu.test.js` (written before the move) and `tests/refresh.test.js`.


## The user's list of time triggers (Refresh Registry.js, Auto Refresh Panel.js)
A time trigger says nothing about itself: ScriptApp gives its id, handler and event type; no interval, no document, no last run (`getTriggerSourceId()` is null), while `getProjectTriggers()` lists the user's triggers of ALL documents.
So each set-up writes a record to the USER properties, one property per trigger (`refreshTrigger:<id>`: document name / address / settings sheet gid / zone, interval, time of day, zone, set-up time, next planned run, last run, its duration and sheets,
`seenAt`), a scheduled run updates it, replacing / switching off / retiring a trigger removes it. One property per trigger so that the runs of different documents never overwrite each other (CLAUDE.md: no whole-snapshot write-back).
The list in the sidebar tab ("Arkusze, które odświeżasz automatycznie:") starts from the clock triggers that exist (three looks, as everywhere: the trigger list is unreliable) and adds the record; for THIS document the document's permit (document properties, shared by all users of the document) fills in and updates the user's record when that is missing, differs in the settings or has an older last run (`syncFromPermit`), a permit that names a trigger which is not the user's own but was used lately (another user of the document) is NOT listed (it is not this user's): the tab's current settings show it as another user's and a note "Dlaczego nie widzę tego arkusza?" opens a modeless dialog explaining why the document is not in the list (`showRefreshHelp`, job-less run `requestShowRefreshHelp`); any other trigger without a record is listed as "Nieznany arkusz" with its id and handler (`autoRefresh` = an old version). A record whose trigger has not been seen for a week is dropped; a record never makes a trigger appear.

Last resort: only THIS document's last refresh. When the record has no last run, the lastRefresh line of this spreadsheet's settings sheet (found by the record's `gid`, else by its header) is shown, marked "(wg arkusza)"
(`readSpreadsheet_`). Nothing else is read from a sheet and other documents are never opened.

## Developer tools: "Triggery odświeżania"
Menu Narzędzia programisty -> Triggery odświeżania opens a sidebar (`Refresh Triggers Sidebar.html`) with the same list as the tab (every time trigger of the user: document, frequency, last refresh, id and handler) and a button "Usuń trigger" per entry
(a second press within 4 s confirms). `forceDeleteRefreshTrigger(id)` -> `ScheduleRefresh.forceDelete` deletes the time trigger and NOTHING ELSE - not the permit, not the user's record, not the sighting cache, not the status message: it exists to test what the
add-on does when a trigger goes missing (a test pins that the properties and the cache are unchanged). Only a time trigger can be deleted this way, never an agent.

## Switching the refresh off on purpose ("Wyłącz autoodświeżanie")
The button in the Auto-odświeżanie tab (`turnOffRefresh` -> `AutoRefreshPanel.turnOff`, job `settings.refreshOff`; a second press within 4 s confirms) cleans the frequency number and the time of day in the settings sheet (the unit and the zone label stay),
then runs the same set-up as after an edit: it finds no frequency, removes the trigger, marks the permit `off`, forgets the user's record and writes the yellow message "Odświeżanie zostało wyłączone". A trigger that is still around after that
(another user's, or one an incomplete trigger list hid from the removal) retires itself when it fires: a permit marked `off` holds nobody (`run` / `runLegacy`; the live check's `lcRefreshTriggerHoldsPermit_` agrees). Breaking the settings by an edit
(empty or invalid frequency) switches it off the same way, only without cleaning the cells.

## The spreadsheet's time zone changes (`ScheduleRefresh.syncTimeZone`, called by `onOpen`)
Changing File > Settings > Time zone reloads the sheet, so the check is made when the document opens: the zone the add-on last saw is kept in the import settings (`timeZone`; before that, the permit's zone). When it differs, the zone labels (E of `lastRefresh`
and `refreshTime`) are rewritten as `UTC+N` for the new zone, the time of day of `refreshTime` is converted so that it stays the same MOMENT (17:30 in UTC+1 becomes 16:30 in UTC+0; stored as a fraction of a day, shown as HH:mm), the permit and the user's record follow
(`startAt`, `timeZone`), the status message is written again (its times are in the new zone) and the new zone is remembered. The trigger is not recreated: it keeps its own zone and fires at the same moment. Nothing is known about the zone before (first open after
an update, no permit zone): only the labels are corrected. The check never throws, builds no settings sheet that does not exist, and an off refresh keeps its permit untouched. The live check allows `importSettingsArray` to change in `onOpen` for this.
