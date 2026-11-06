# Live check helpers

Every entry point of the add-on checks its own outcome once it is done. Meant for testing a new version in a real
spreadsheet: after clicking a menu item, editing a config sheet or waiting for a trigger, the result is judged without
re-running the work.

* Code: `Live Check.js` (switch, snapshots, recording, reports), `Live Check Verifiers.js` (the expectations) and
  `Live Check Sidebar Server.js` / `Live Check Sidebar.html` (the sidebar).
* **Off by default.** The add-on behaves exactly as before until the switch is turned on, and with the two files removed
  the hooks in `Controller.js` do nothing.
* A check never throws into the run it checks. A crashing verifier is reported as `FAIL verifier crashed`.
* Nothing here calls Business Central. Metadata is read from the document cache only; no cache entry means the
  check is `SKIP`ped.

## Using it

From the script editor (needs the document, e.g. "Test as add-on"):

| Function | What it does |
|---|---|
| `liveCheckEnable()` / `liveCheckDisable()` | Switch for this document. `liveCheckEnable("script")` switches it for every file and user. |
| `liveCheckReport(limit, onlyBad)` | Logs and returns the last results (newest first). `liveCheckReport(20, true)` shows only `FAIL` / `WARN`. |
| `liveCheckSummary()` | Pass / warn / fail counts per entry point. |
| `liveCheckClear()` | Forgets the stored results. |
| `liveCheckCoverage()` | Lists entry points without a verifier. |

While it is on: every checked run writes `[LIVE-CHECK] <status> <entry point> (<ms>)` plus one line per check to the
execution log / Cloud Logging (failures as errors), shows a toast on `FAIL` / `WARN`, and keeps the last 40 results in the
document properties (`liveCheck:*`).

Statuses: `PASS`, `FAIL` (the add-on did not do what it should), `WARN` (suspicious, or tied to a defect listed in
`docs/trigger-management-todo.md`; the line says which), `SKIP` (cannot be checked here, e.g. UI, or simple-trigger
authorisation limits). The status of a run is its worst check.

(On `refactor-and-grid`: the activity indicators (B2:D2) are judged against the state before the run - a cell the run does not work with must look as before, a hand-edited cell is
not blamed on the run; a cell lit while *another* checked run is in progress is a `WARN` naming that run; the detail lists the colours that were read. In the sidebar's detail view `FAIL` lines are red and `WARN` lines amber.)

## Sidebar

Menu: add-on menu -> **Narzędzia programisty** -> **Live check**. It lists the recent runs (40), newest first, one per line:
green = `PASS`, red = `FAIL`, amber = `WARN`, grey = `SKIP`, pulsing blue = still running, grey `LOST` = started but no
result in 10 minutes (aborted, timed out or crashed). The number in brackets is the count of failed / warned checks. A click
opens the details, exactly as `liveCheckReport()` prints them. The switch in the top bar turns the checks on / off for the
document.

A run is stored as `RUN` when it starts and overwritten with its result when it ends (one extra property write per checked run).
The sidebar asks the server every 3 s (not while the sidebar is hidden) and gets only a token back when nothing changed.
The three server functions it uses (`liveCheckSidebarData`, `liveCheckSidebarDetail`, `liveCheckSidebarSetEnabled`) are
monitoring tools and are not checked themselves. The submenu entry only appears while the helper files are in the project.

## Jobs (what the run actually did)
`sheetEdit` / `sheetChange` fire for everything, so the router (`docs/router.md`) names the job the event turned out to be and the run is reported under it:
`config.coedit [Konfiguracja 1] (via sheetEditAction)`, `settings.refreshFrequency`, `settings.edit`, `sheet.ignored`, `change.ignored`, `agent.skipped`, and for the time trigger `refresh.scheduled` (it holds the permit and refreshes) / `refresh.retired` (it does not, and deletes itself; announced by `ScheduleRefresh.run` / `runLegacy`). `liveCheckIntents()` prints the catalogue.
Each run gets two sets of checks: the trigger's (bookkeeping, power) and the job's (did it do its job). The sidebar's headline is the job.

## What is checked

| Entry point (action name) | Crude check of the outcome |
|---|---|
| `onOpen` (the status check; the menu is built before the controller) | nothing changed (sheets, properties); menu / alert cannot be read back |
| `simpleOnEdit` | no sheet touched; only the suspect flag (and agent power after a level 2 alarm) changed; the outcome fits the decision the code logged; duration under the 30 s limit |
| `sheetEditAction` (the trigger side; the content is judged under the job, see above) | power OFF/unlogged → skipped; last-use recorded; settings sheet exists; edit of refresh frequency → one time trigger, permit issued for it with the right interval; edit in a config sheet → co-edit result (below); other sheet → nothing added |
| `sheetChangeAction` | `EDIT`/`FORMAT` ignored; otherwise the co-edit result for the active config sheet |
| `requestAutoRefesh` | permitted trigger: refresh time + zone shown, permit `lastRun` set, result sheets of ticked configs verified; unpermitted trigger: removed itself, nothing refreshed |
| `menuInsertImportWizard` | one new row in the settings sheet at the right place with a checkbox, new config sheet with the golden header and co-edit result, no result sheet yet |
| `requestCheckConfigSheet` | co-edit result for a config sheet, nothing changed otherwise |
| `menuEstimateForCurrentSheet` | F2 is a number formatted `#,##0`, estimate info shown, indicators idle |
| `menuRefreshCurrentSheet`, `menuRefreshAll` | result sheet exists; data rows = estimate in F2 (±5 % warns, approximate when `extend` is used); every column has a header and a uniform number format; formats match the cached data types; indicators idle |
| `menuAuthFlow`, `menuLogoutFlow`, `requestAuthCallback` | nothing changed / OAuth token key removed / stored |
| `menuConnectionSetup`, `requestStatusCheck`, `requestListAllTriggers`, `requestLiveCheckSidebar` | read-only |
| `requestAddonStatus`, `requestChangeAddonStatus`, `requestSettingsSheetName`, `requestSetSettingsSheetName`, `requestPermitsInfo` | returned / stored value matches; ON → settings sheet name stored, agents active; a sheet with the chosen name must have the settings signature |
| `forceAgentRefresh` | one edit + one change trigger installed for this document, returned id matches, both logged ON for document and user, pair in the agent array (≤ 5), no logged trigger missing from the project, suspect flag cleared |
| `requestDeleteAllAgents` | agent array empty, only the agents' triggers removed, log entries gone |
| `deleteAllInDocumentTriggerLog`, `deleteAllInUserTriggerLog` | log is empty, no trigger installed or removed |
| `requestAgentStatus`, `requestListProjectTriggers`, `requestSetGlobalSettings` | returned value matches the logs / header row and every project trigger listed / properties stored in the chosen scope |

Co-edit result of a config sheet: header intact, activity indicators (B2:D2) back to idle, estimate info greyed out, a
`table` row, and after a table is chosen an `extend` row and an empty `queryOption` row (empty `extendOption` row if
extend is chosen), dropdowns where the row type needs them (query options, operators, `AND`/`OR`, `asc`/`desc`; lists
that come from BC metadata only have to be dropdowns, with the explanatory note when empty), none elsewhere.

All run types also get: duration within limits (`WARN`; 25 s for simple triggers, 5 min for the rest, 25 min for the scheduled refresh `requestAutoRefesh` - a Workspace domain allows a time trigger 30 min and a real run of several sheets took 7.5 min), and for `menu*` actions the add-on is ON afterwards. A run that
ends with `ConnectionError` is a `WARN` ("not authorised"), the parts that need BC are `SKIP`ped.

## Hooks in the add-on code

* `Controller.run()` takes a snapshot before the action and verifies after the closing actions (so saved properties are
  visible). When the add-on is OFF and the action is skipped, the check asserts nothing changed.
* `Controller.checked(name, fn, input)` does the same for entry points that do not use `Controller.run()`: `onOpen`,
  `setGlobalSettings`, `getAgentStatus`, `listProjectTriggers`, `authCallback`.
* `Controller.checkInput(name, data)` hands over the event object / arguments (`onEdit`, `sheetEdit`, `sheetChange`,
  `autoRefresh*`, `changeAddonStatus`, `setImportSettingsSheetName`).
* `Controller.checkNote(text)` is called from `agentLog()`: the verifier of `simpleOnEdit` reads the decision the code took.

## Adding or changing an entry point

1. Add it to `LIVE_CHECK_ENTRY_POINTS` (`Live Check.js`) and give it a verifier in `buildLiveCheckVerifiers_()`.
   List the snapshot parts the verifier needs in `needs` (`sheets`, `activeSheet`, `docProps`, `userProps`, `triggers`,
   `settings`, `settingsSheet`).
2. Write the expected values down in the verifier instead of calling the code under test (they are copies of what the
   code does now; update them together with an intended change).
3. `liveCheckCoverage()` reports entry points without a verifier. Without one a run is recorded as `SKIP`.

## Limits

* Written without a way to run Apps Script: the checks were exercised against an in-memory fake of the Sheets / Properties /
  Trigger services running the real add-on code (including deliberate breakages), not against Google. The first live run is
  the real calibration; likely spots are number formats Sheets reports in its own notation (`General` is not compared) and
  the 300-character detail limit.
* UI (menu, alerts, sidebars) cannot be read back by a script. These are `SKIP`.
* Simple triggers may not use services that need authorisation; checks that need them are `SKIP`ped there.
* The checks look at one document and one user: another user's triggers are invisible to `ScriptApp.getProjectTriggers()`.

## Found while building this

Defects the checks reported on the code as it was when the helpers were written are logged in `docs/bugs-fixed.md`
(settings writes lost in `sheetEdit`, nested `Controller.run`, `ConnectionError` while editing a config sheet offline, and
smaller ones noticed on the way). They are not fixed on this branch.

## Entry-point names on `refactor-and-grid`
Every platform entry goes through `Controller.run` now (`docs/controller.md`): `setGlobalSettings`, `getAgentStatus`, `listProjectTriggers` and `authCallback` are reported as `requestSetGlobalSettings`, `requestAgentStatus`,
`requestListProjectTriggers`, `requestAuthCallback` (the functions keep their names), `onOpenAction` is merged into `onOpen`, and there are no nested runs, so the `known issue: nested Controller.run` fallbacks no longer apply.

## Developer tools extras
- **Build version.** Both "Narzędzia programisty" sidebars (Live check, Wszystkie triggery) show `Wersja: <commit>[+] (<date>, <branch>)`, taken from `Version.js`. The file is written by
  `tools/stamp-version.sh` and is **self-reported**: nothing checks it, and a commit cannot contain its own hash, so the value is the commit it was built on. A trailing `+` means "that commit plus uncommitted changes"
  (what you get when the script runs before a commit); run it on a clean checkout before `clasp push` to get the exact commit. Commits made before this one have no version in them.
- **`reportFailedChecks()`** (Live Check.js) runs from the script editor without arguments: it logs and returns the FAIL / WARN runs among the last 40 stored results (`liveCheckReport(40, true)`).
- **Sidebar scrolling.** The Live check sidebar no longer rebuilds its list every second while a run is going (only the clock text is updated) and a rebuild keeps the sideways scroll of the open details and the page
  position. Checked once in headless Chromium against the old and the new page (scroll 150 px, one poll with new data: old page 0, new page 150); the automated test only asserts the code shape.

## Two verifier changes after real-sheet runs (intended, hashes re-pinned)
- **Number format uniformity** (`menuRefreshCurrentSheet`, `menuRefreshAll`, `requestAutoRefesh`): judged on the **data rows** (row 2 vs the last row). The header cell of a date column comes back from Sheets
  with the automatic format (`0.###############`) whatever was set (the old and the new writer both set it), so row 1 vs the last row failed for every `Edm.Date` column. The message now shows the formats of the two data rows and of the header.
- **`<sheet>_coedit` flags** (`simpleOnEdit`, `change.ignored`, and the old combined judgement): the lock helper's flag of a co-edit that runs at the same time is no longer reported as a change **when another checked run overlapped
  this one** (still running, or ended after this one started; `lcParallelCoeditFlags_`). On a quiet document it still is one. Trade-off: a run that wrongly started a co-edit while another one was going is not caught by this check
  (the sheet and indicator checks still see its effects).

## Verifier changes for the refreshTime / refreshStatus lines (intended, hash of `Live Check Verifiers.js` re-pinned)
- **`change.ignored`** (and the old combined judgement): `importSettingsArray` (the refresh permit) is no longer reported as a change when another checked run that overlapped this one was a `settings.refreshFrequency` job
  (`lcParallelSettingsWrites_`). A frequency edit now also writes the status message into the settings sheet, so it runs for seconds and the change event of the same edit is still being judged while the permit is written.
  Only that job excuses it; on a quiet document, or beside another job, a changed permit is still a failure.
- **`settings.refreshFrequency` / `settings.edit`**: the edit counts as "touching the refresh settings" also when it covers column D of the `refreshTime` line (`lcReadSettingsSheet_` reads `timeRow`).

## The sidebar button (job `settings.refreshApply`, hash of `Live Check.js` and `Live Check Verifiers.js` re-pinned)
`applyRefreshSettings()` (action `requestApplyRefreshSettings`) sets the time trigger up from the settings sheet, like editing the frequency; the job `settings.refreshApply` is judged by the same check as `settings.refreshFrequency`
(`lcVerifyRefreshTrigger_`: the trigger of the previous permit is gone, a new `autoRefreshHandler` trigger exists for the new permit, the interval matches the sheet). `getAutoRefreshInfo()` (action `requestAutoRefreshInfo`: tab opened, refresh button, after applying) only reads: the check is that no sheet and no document property changed. `showRefreshHelp()` (action `requestShowRefreshHelp`, the dialog "Dlaczego nie widzę tego arkusza?") is judged the same way.

## Trigger lists (hash of `Live Check Verifiers.js` re-pinned)
In a sidebar call `ScriptApp.getProjectTriggers()` was seen to return 8 triggers and, two seconds later, 2 of them. The refresh-trigger checks (`lcVerifyRefreshTrigger_`, scheduled / retired refresh) therefore take the union of three looks
(`lcTriggersSeen_`): a deleted trigger shows in none, so "is gone" is as safe as before, and "stays installed" no longer fails on one incomplete list. The agent checks (`lcProjectIds`-style comparisons) are unchanged.

## Job `settings.timeZoneCell` (hashes re-pinned)
An edit of the zone label (E of the `refreshTime` line) is undone and answered with a dialog. The verifier reads the label back (`lcReadSettingsSheet_` gives `timeZoneLabel`): it has to be a `UTC+N` label again, and the permit / triggers are untouched.

## Developer tools: the trigger list (hash of `Live Check.js` / `Live Check Verifiers.js` re-pinned)
`requestRefreshTriggersSidebar` (menu) and `requestRefreshTriggerList` only read (no sheet, no document property changes). `requestForceDeleteTrigger` is judged on: the trigger is gone, no sheet and no document property changed - the missing cleanup is
the point of the action.

## Job `settings.refreshOff` (hashes re-pinned)
The sidebar button "Wyłącz autoodświeżanie" (action `requestTurnOffRefresh`): the verifier requires the frequency in the sheet to be cleaned and then applies the same trigger check as `settings.refreshFrequency` with an empty frequency
(no refresh trigger left for this document's permit). `lcRefreshTriggerHoldsPermit_` now says a permit marked `off` holds nobody, matching the handlers: a trigger that fires after the refresh was switched off retires itself.

## Time zone labels (hashes re-pinned)
`lcVerifyZoneLabels_` checks what the user sees against the spreadsheet itself: E of the `refreshTime` line must read the spreadsheet's zone as `UTC+N` for now, E of the `lastRefresh` line the zone's offset at the moment of that last refresh (an older version's
"CET" is skipped: it says nothing about the zone and the next refresh rewrites it). It is part of `onOpen` (where a changed zone is put right; `onOpen` now also reads the settings sheet), `settings.refreshFrequency`, `settings.refreshApply` and the scheduled refresh. A sheet without those lines is skipped. The TIME of the last refresh is checked too: it must be within 15 minutes of the moment of the last scheduled run that the permit remembers (a label can be right while the time still reads the old zone).
A failure of the check in `onOpen` itself is no longer silent: it is `console.error` in the execution log and a note on the live check run.

## The download log (hashes re-pinned)
`lcVerifyRefreshLog_` reads the log sheet as the user sees it: the refresh that just ran must be the newest entry (row 2): its source, a start inside the run, an end not before it, a duration and a status (the error message when the run failed) and the technical text; the start cell's format must end with the spreadsheet's zone for that moment (`"UTC+1"`).
It is part of `menuRefreshCurrentSheet` (a config sheet), `menuRefreshAll`, the scheduled refresh, and the retired trigger (whose entry says nothing was refreshed; the retired check no longer fails on the log sheet that entry may have made). The sidebar functions
`getRefreshLogSheetName` / `setRefreshLogSheetName` are `requestRefreshLogSheetName` / `requestSetRefreshLogSheetName` (a refused name - already a sheet of the add-on, or over 100 characters - is an expected error).

## Many edits at once (hashes re-pinned)
`lcVerifyRefreshTrigger_` also requires that exactly one refresh trigger belongs to this document - the permit's - judged by the user's records in the user properties (`lcDocumentsRefreshTriggers_`), none when the refresh is off. A set-up that dropped out for a newer edit
(note "refresh set-up dropped") is skipped: the newer run is judged on its own.

## Two live check failures after real-sheet runs (hashes re-pinned)
- `simpleOnEdit` (and `change.ignored`) reported the document property **`refreshSetup`** as a change: it is the ticket of the newest-only lock (`runLatestOnly`) that a set-up of the automatic refresh writes, at the same time as the simple trigger of the same edit runs. It is allowed exactly like the
  `<sheet>_coedit` flags - only when another checked run overlapped (`lcParallelCoeditFlags_`); on a quiet document it is still a change.
- `config.coedit` "dropdowns match the rows - E11 should be a </>... dropdown": the verifier's operator list (`LC_OPERATORS`) still had the bare `=`; since `e470426` the dropdown carries equality as `" ="` with a leading space (a bare `=` would start a formula; bugs-fixed #18). The list is now
  `["<",">"," =","<>","<=",">=","endswith","startswith","contains"]` and a test keeps it equal to what `OData Query.js` / `Data Validations.js` build.

## Quiet jobs
`sheet.ignored`, `change.ignored` and `change.own` (`LIVE_CHECK_QUIET_JOBS`, `Live Check.js`) only look at an event and do nothing; they were most of the report. While they **pass** (or skip) nothing is logged, stored or shown, and their "running" placeholder
is removed at once. One that fails or warns (an edit in a config sheet wrongly ignored) is recorded and shown like any other run. `settings.edit` and `agent.skipped` also do nothing but are still reported.
