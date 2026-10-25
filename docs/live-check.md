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
`config.coedit [Konfiguracja 1] (via sheetEditAction)`, `settings.refreshFrequency`, `settings.edit`, `sheet.ignored`, `change.ignored`, `agent.skipped`. `liveCheckIntents()` prints the catalogue.
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
| `menuConnectionSetup`, `menuTestItem`, `requestStatusCheck`, `requestListAllTriggers`, `requestLiveCheckSidebar` | read-only |
| `requestAddonStatus`, `requestChangeAddonStatus`, `requestSettingsSheetName`, `requestSetSettingsSheetName`, `requestPermitsInfo` | returned / stored value matches; ON → settings sheet name stored, agents active; a sheet with the chosen name must have the settings signature |
| `forceAgentRefresh` | one edit + one change trigger installed for this document, returned id matches, both logged ON for document and user, pair in the agent array (≤ 5), no logged trigger missing from the project, suspect flag cleared |
| `requestDeleteAllAgents` | agent array empty, only the agents' triggers removed, log entries gone |
| `deleteAllInDocumentTriggerLog`, `deleteAllInUserTriggerLog` | log is empty, no trigger installed or removed |
| `requestAgentStatus`, `requestListProjectTriggers`, `requestSetGlobalSettings` | returned value matches the logs / header row and every project trigger listed / properties stored in the chosen scope |

Co-edit result of a config sheet: header intact, activity indicators (B2:D2) back to idle, estimate info greyed out, a
`table` row, and after a table is chosen an `extend` row and an empty `queryOption` row (empty `extendOption` row if
extend is chosen), dropdowns where the row type needs them (query options, operators, `AND`/`OR`, `asc`/`desc`; lists
that come from BC metadata only have to be dropdowns, with the explanatory note when empty), none elsewhere.

All run types also get: duration within limits (`WARN`), and for `menu*` actions the add-on is ON afterwards. A run that
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

Defects the checks reported on the code as it was when the helpers were written are logged in `docs/bugs-todo.md`
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
