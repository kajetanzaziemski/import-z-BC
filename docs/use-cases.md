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
What the SHEET says decides; the properties are secondary. On every open the zone labels (E of `lastRefresh` and `refreshTime`) are compared, in the sheet, with what they should read for the zone the spreadsheet is in now (`SettingsGrid.retime`):
- `lastRefresh` holds a moment, so its label is the offset AT THAT MOMENT: it differs only when the zone itself changed. `refreshTime` holds a time of day, labelled with the offset of now: it also differs when the daylight saving time begins or ends.
- Nothing differs: nothing is written.
- Only the `refreshTime` label differs: relabelled (`UTC+N`), the time of day is NOT converted.
- The `lastRefresh` label differs (the zone changed): both labels are rewritten and the time of day of `refreshTime` is converted so that it stays the same MOMENT (17:30 in UTC+1 reads 16:30 in UTC+0; stored as a fraction of a day, shown as HH:mm). The conversion
  uses the zone the properties remember (the saved `timeZone`, else the permit's) when there is one, else the offset in the label. With no last refresh in the sheet to tell by, the remembered zone decides.
Then the properties follow: the saved zone, the permit's start time and zone, the user's record; the status message is written again (its times are in the new zone). The trigger is not recreated: it keeps its own zone and fires at the same moment.
The check never throws and builds no settings sheet that does not exist; an off refresh keeps its permit. The live check allows `importSettingsArray` to change in `onOpen` for this.

The check reads and writes the sheet through the Spreadsheet service only (`Grid.serviceOnly(true)` for the time of the check): `onOpen` may run in the limited authorisation mode, where the Sheets advanced service cannot be called. A lastRefresh label that is
no `UTC+N` (an older version wrote "CET") is left alone. A failure is logged with `console.error` and noted on the live check run, never silent.

The time of the last refresh is put right too (`SettingsGrid.retime`): a cell keeps the wall-clock number, not the moment, so after a change of the zone `2026-11-04 07:44` still reads 07:44 but is another moment. The old label says in which zone it was written
(`UTC-8`), so the moment is the wall reading minus that offset (15:44 UTC) and is written back; the sheet then shows it in the new zone (16:44 in UTC+1) with the label `UTC+1`. A `lastRefresh` label that is no `UTC+N` (an older version's "CET", or none) says nothing about the zone it was written in: that line is left as it is, label AND time (the next refresh writes it in `UTC+N`). The `refreshTime` line is still put right.

## The download log (`Refresh Log.js`, `Refresh Log Grid.js`; `my-todo.md` "Data connection log")
Every download from BC that writes (or should write) data in the sheets leaves ONE entry in the log sheet - the menu items "Pobierz dane dla tego arkusza" (`MenuActions.refreshActive`) and "Pobierz dane dla wszystkich arkuszy" (`RefreshAll.all`) and the automatic refresh
(`RefreshAll.scheduled`, called by both clock-trigger handlers). `RefreshLog.run(source, technical, work)` wraps the work: a refresh inside a refresh is one entry (the outer), the result sheets written (`RefreshSheet` -> `RefreshLog.noteSheet(name, data rows)`),
a failure the add-on handles itself (`noteProblem`: a BC error document, a config sheet without a table) and the error the platform throws (written as the status, thrown on). A clock trigger that does not hold the permit and deletes itself writes an entry too
(`logOnly`: status "Odświeżanie nie zostało wykonane", technical, in English: the clock trigger, that it was deleted and that no refresh was performed). Writing the log never fails a refresh (`console.error` + a note on the live check run).

The sheet (name chosen in the sidebar, Ogólne, "Arkusz dziennika pobrań"; default "Dziennik pobrań"; made by the first entry, headers in row 1): columns Źródło (Autoodświeżanie / Odświeżanie jednego arkusza / Odświeżanie wszystkich arkuszy), Początek, Koniec, Czas trwania,
Status ("OK ✅", the handled failure, or the platform error), Odświeżone arkusze (one cell: "2 arkusze" and a line "name (n wierszy)" per sheet), Dane techniczne (in English: "Clock trigger <id>" / "Menu: refresh one sheet (config sheet: K1)" / "Menu: refresh all sheets"). NEWEST FIRST: an entry is inserted as row 2, under the headers and above the older entries
(`Grid.insertRowsAfter(1, 1, { fromBelow: true })`: the grid reads only the first rows and commits once per entry). The name may not be the settings sheet, a config sheet or a result sheet (`MainSettings.setLogSheetName`).
An older log sheet stays where it is when the name is changed (nothing is renamed or moved).

Look of the log sheet (`Refresh Log Grid.js`): headers grey (`#cccccc`, the grey of a config sheet's headers), bold, centred, wrapped, the header row frozen; entries left aligned and top, rows fitted to their content; the technical column Courier New 8 pt; widths and wrapping are FIXED per column (see below); the freeze is set once, with the sheet; "Odświeżone arkusze" starts with "N arkusze:" (no colon for "0 arkuszy": nothing follows). The start and end carry
their time zone IN THE FORMAT of the cell (`yyyy-mm-dd hh:mm:ss "UTC+1"`, the offset of that moment): a cell keeps the wall clock of the spreadsheet's zone, so an old entry stays true when the zone is changed later. Needed in Grid.js: `setFontFamily`,
`setColumnWidth`, `freezeRows`.

## Many edits at once ("the last one makes sure")
Typing a frequency fires an edit per keystroke, each running `ScheduleRefresh.apply` at the same time, each wanting to create or delete time triggers. `apply` therefore runs under `runLatestOnly` (functions.js) with the flag `refreshSetup`, like the co-edit of a config
sheet: every run writes its ticket, takes the script lock, and an OLDER run drops out as soon as it sees a newer ticket (nothing changed, a note "refresh set-up dropped: a newer edit took over" for the live check). The newest run
(`applyNewest_`) re-reads the settings sheet from the server under the lock (`SettingsSheet.reloadRefreshSettings`: what the sheet says now, not what the run read when it started), sets up (`setUp`), and then makes sure (`reconcile_`):
- ONE trigger: the triggers the user's records say belong to this document (`docId`; a time trigger has none of its own) are deleted with their records, except the permit's - this is how the trigger of an earlier run that died half way is found, because the record is
  written right after the trigger is made, before the permit; triggers of other documents and triggers with no record are left alone;
- a VALID permit: issued for a trigger that exists (three looks), not off, with the interval and the time of day the settings ask for; with the refresh off, no trigger of this document is left;
- a result that is not right is set up once more; if it still is not, the error says what is wrong (`Odświeżanie nie zostało ustawione poprawnie (...)`) and the message is red. A run that never gets the lock (90 s) reports a failure: nobody else will set up for it.
The live check judges the same (exactly the permit's trigger among this document's records; none when off) and skips a dropped run.

## Error reporting of the set-up (`my-todo.md` "Error reporting")
A set-up of the automatic refresh that fails (`ScheduleRefresh.fail_`: the platform's error, a set-up that could not be made right, the lock that never came) writes the red message in the settings sheet AND keeps the error in the import settings (`refreshSetupError`: when, the
platform's message and stack cut to 1200 characters - the settings are one property of 9 KB -, whether it was the trigger limit, and what was set at that moment). The next set-up that goes right clears it; a run that drops out for a newer edit does neither.
The Auto-odświeżanie tab shows it (`AutoRefreshPanel.setupError_`), after the last refresh and before the buttons, as a red box with only the headline "Ustawienia odświeżania nie zostały zaktualizowane!" and the time of the attempt (`SettingsGrid.messageLines(..., brief)`: not what is set now - the tab shows that itself - and no pointer to the menu; the sheet's own message keeps both) and "Szczegóły błędu" folded, holding the platform's error.
When Apps Script refused one more clock trigger (the platform's "too many triggers" / "zbyt wiele wyzwalaczy", or a trigger-related error while the user already has 5 clock triggers: `isTriggerLimit_`) the main message says so between the headline and the time of the attempt
("Możesz odświeżać automatycznie najwyżej 5 plików. Zobacz listę aktualnie odświeżanych arkuszy poniżej." - the list of the user's refreshed files is in the same tab); the sheet's message says it in its own words ("Możesz odświeżać automatycznie najwyżej 5 plików. Zobacz szczegóły w menu dodatku:" and the path, in bold, in the place of the general pointer).

## The limit of 5 clock triggers
Counted and refused by the add-on before it asks the platform (`ScheduleRefresh.assertRoomForTrigger_`, in `createTrigger_`): see `docs/clock-triggers.md` for the counting, every case in which a trigger is created and what each does at the limit.

Retry advice: the first time the tab shows an error it begins with "Spróbuj ponownie używając przycisku poniżej." (`SettingsGrid.retryAdvice`, the `advise` flag of `messageLines`) and the button "Ustaw wg. danych w arkuszu" is ENABLED while an error is shown, also when the sheet and what is set look the same.
`AutoRefreshPanel.apply` (the button) sets `ScheduleRefresh.byButton_`; a set-up that fails then stores `retried: true` and the tab shows the error plainly, without the advice. An error of an edit (or of "Wyłącz") is stored `retried: false`: the advice again.


The first message of the sidebar (the advice to retry) does not carry the sentence about the limit of clock triggers; the plain message after the retry does.

Widths and wrapping of the log sheet (fixed, per column; set ONCE, when the sheet is made, together with the freeze and the look of the entries - what the user changes afterwards stays):
Źródło 200 px wrap | Początek 200 px wrap | Koniec 200 px wrap | Czas trwania 100 px wrap | Status 200 px wrap | Odświeżone arkusze 300 px wrap | Dane techniczne 200 px cut (the text is cut at the edge of its cell). Nothing is fitted to its content.
A later entry is inserted as "a row above" the first entry (`Grid.insertRowsAfter(1, 1, { fromBelow: true })`: the API's `inheritFromBelow`, the service's `insertRowsBefore`), so the sheet gives it the look of the entries - formats, row height before the fit -
and the look of the headers does not leak in; only what differs from entry to entry is set for each (the start and end formats with their zone, and the row is fitted to its wrapped content). A log sheet made by an older version keeps its look: set the widths by hand once.

Errors while pulling data (download log): `RefreshSheet.run` notes the sheet whose data could not be pulled (`RefreshLog.noteFailedSheet`, the result sheet's name, else the config sheet's) and throws the error on. The entry's status then only says
"Błąd ❗️ Przy pobieraniu danych dla arkusza X." (or "... dla arkuszy: X, Y." for more than one; handled problems stay before it) and the error goes to the TECHNICAL column ("<what fired it>. Platform error: <message>"). An error that is not tied
to a sheet (the lock, the settings sheet ...) is still the status as it is. `RefreshAll` does NOT stop at a sheet that fails (`RefreshAll.each_`): every pair is tried, the failed ones are named (the plural when more than one), the FIRST error is thrown when all were tried (so the Controller, the live check and the caller see the same error as for one failing sheet), and a scheduled refresh with a failure does not note the time on the settings sheet or the run on the permit. "Odświeżone arkusze" counts and lists only the sheets that went through completely: a sheet counts as refreshed after its data is written AND its indicators are back to idle (`RefreshSheet.run_` notes it last); a BC error document or a config sheet without a table is a handled problem, not a refreshed sheet.
The live check requires, for a failed run, the status to be the error itself or "Błąd ❗️ ..." with the error in the technical column.

Last refresh after a failed attempt: when a scheduled refresh throws (a sheet that could not be pulled), the time of the last refresh is left as it was and a NOTE is put on that cell (`SettingsSheet.markLastRefreshAttemptFailed`, called by `RefreshAll.scheduled`):
"Komórka pokazuje czas ostatniego w pełni poprawnego odświeżania. Sprawdź arkusz dziennika pobrań, żeby zobaczyć informacje o wszystkich próbach odświeżania." (the line is added when the sheet has none). The next fully correct scheduled refresh writes the time and removes the note
(`SettingsGrid.writeLastRefresh`). A problem the add-on handled itself (a BC error document, a config sheet without a table) is not an error of the run: the time is noted as before and no note is put. The menu refreshes never touch that cell. The live check reads the note after a scheduled refresh
(present when the run failed, absent when it was fully correct).
