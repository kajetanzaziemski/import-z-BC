# The router: from a technical trigger to the job that is actually wanted

```
 L5  ENTRY POINTS  (technical: sheetEdit, sheetChange, menu*, autoRefreshHandler ...)   <- Apps Script / the menu call these by name
        |  say little: "something was edited", "the structure changed"
 L4a ROUTER        Router.js    looks at the event (which sheet? which cells? which change type?) and names the JOB
        |  route = { intent, sheet, event }      Controller.intent(name, data) tells the live check
 L4b USE CASES     AnalyseConfig, ScheduleRefresh, RefreshSheet ...   do the job
```

## Why
The installable `onEdit` / `onChange` triggers fire for everything. What matters to the user is what the add-on does about it, and that depends on where and what:
an edit in a config sheet completes its query lines and dropdowns; the same trigger, firing for the refresh frequency in the settings sheet, sets a time trigger; for any other
sheet it does nothing. The live check used to report all of these as `sheetEditAction`. It now reports the job.

## The jobs (`Router.js`, catalogue `LIVE_CHECK_INTENTS` in `Live Check.js`, print it with `liveCheckIntents()`)
| Job | When | Does |
|---|---|---|
| `config.coedit` | an edit, or a structure change (row/column/sheet added or removed ...), while a **config sheet** is the active sheet | `AnalyseConfig.run`: query lines and dropdowns completed, notes set, reading cell lit meanwhile |
| `settings.refreshFrequency` | an edit of the refresh frequency (number or unit) in the settings sheet | `getMainSettings().setRefreshTrigger()` -> `ScheduleRefresh.setUp`: time trigger + permit |
| `settings.edit` | any other edit in the settings sheet | nothing |
| `sheet.ignored` | an edit / change while any other sheet is active | nothing |
| `change.ignored` | a change of type `EDIT` or `FORMAT` (the cells are handled by the edit trigger) | nothing |
| `agent.skipped` | the edit trigger is powered off or not logged (announced by `sheetEdit` before routing) | nothing |

Not a router matter (already one name = one job): the menu actions (`menuRefreshCurrentSheet`, `menuInsertImportWizard` ...), the time trigger (`requestAutoRefesh`: the permit decides between refreshing and removing itself,
see `ScheduleRefresh`), the sidebars. The wizard that inserts a config sheet is a menu action; editing the settings sheet by hand adds no config sheets today.

## Rules
- `routeEdit(e)` / `routeChange(e)` only **look** and return a route; `perform(route)` announces the job (`Controller.intent`) and then runs it. Nothing else decides what an edit means.
- The entry points stay (`sheetEdit`, `sheetChange`, `sheetEditAction(e)`, `sheetChangeAction(e)`, with their `Controller.run` action names and `checkInput` hooks); `sheetEditAction` / `sheetChangeAction` are one-liners that call the router.
  The trigger's own business stays in the entry point: recording the edit for the simple trigger, the power check, logging the trigger's use.
- Behaviour is exactly the old one (`tests/router.test.js` was written first against the old code): the sheet is the **active** sheet, not the sheet of the edited range; the settings sheet object is built for every edit/change that
  is not an EDIT/FORMAT one (bugs-todo #10); `sheetChange` runs the action **before** the power check (a powered-off trigger still co-edits; trigger-management #5).
- To add a job: a line in `ROUTE_ACTIONS_`, a branch in `routeEdit`/`routeChange`, an entry in `LIVE_CHECK_INTENTS` and a verifier with the same name in `Live Check Verifiers.js`
  (`tests/live-check.test.js` fails until all four agree).

## In the live check
- A run is stored and reported under its job, with the sheet and the technical entry point: `config.coedit [Konfiguracja 1] (via sheetEditAction)`. While it runs, the sidebar already shows the job.
  The sidebar's headline is the job, "via sheetEditAction" is muted next to it and the tooltip says in words what the job is. Runs without a job (menu actions, triggers without routing) keep their entry point name.
  `liveCheckSummary()` counts per job.
- Two verifiers per run: the **entry point's** (trigger bookkeeping: last use recorded, suspect flag, power, the settings sheet exists) and the **job's** (did it do what it is for: dropdowns and lines present, the time trigger and its permit match
  the settings sheet, nothing was touched for an ignored edit ...). Each job verifier works out its own premise from the event and the settings sheet instead of trusting the router, so a wrongly routed edit is a FAIL
  (e.g. an edit of a config sheet routed as `sheet.ignored`). If the run stopped before routing, the entry point's verifier judges the content itself, as before.
