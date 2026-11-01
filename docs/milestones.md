# Milestones of the refactoring

## Half-way through the refactoring  (commit `a20b4b9`, branch `refactor-and-grid`)

State at this milestone (330 offline tests passing; nothing verified on a real spreadsheet since the controller / router work):

Done
- Grid layer (from wyceny) extended and tested through both commit paths; `ConfigGrid` for the config sheet header and status cells (golden-tested against the old code)
- `Store` / `Settings` facade over the four storage mechanisms, callers moved
- Use cases extracted from `Menu.js` / `Settings Sheet.js`: `RefreshSheet`, `EstimateSheet`, `RefreshAll`, `ScheduleRefresh`; `ResultSheet` seam
- Router (`sheetEdit` / `sheetChange` -> named jobs), `AnalyseConfig`; the live check reports by job
- `Controller` rules: every platform entry is a run, no nested runs, `onOpen` builds the menu first; closing phase drains late registrations
- Live check helpers merged (the judge, pinned); fixed on the way: bugs-fixed #1 (settings lost in `sheetEdit`), #2 (nested run lost log saves), #4, `UnknownError` unwrapping

Still to do
- (done after the tag: `SheetCoeditor` split, see `docs/testing.md` section 2b)
- (done after the tag: `SettingsGrid`, see `docs/testing.md` section 2c)
- (done after the tag: `BulkSheet` behind `ResultSheet`, see `docs/testing.md` section 2d)
- (done after the tag: `AgentService` regroup, facade `Agents`, `docs/agent-lifecycle.md`)
- (done after the tag: menu items in `Menu Actions.js` - analyse, refresh, estimate, wizard, authorise, logout; `docs/use-cases.md`)
- (done on branch `refactor-login-and-rest`: login flow behind `BCAuth`, `docs/login-flow.md`; the status check was already thin forwarders to `Agents`)
- (done on branch `refactor-login-and-rest`: BC layer reorganised and cleaned of test-only code, `docs/bc-layer.md`)
- (done: the old-name forwarders and dead leftovers removed)
- (done: bugs-fixed #4/#6/#8/#10 closed - `ManagedSheets` cache; `BulkSheet` Sheets API path written and tested on the simulated spreadsheet only)
- (done: the time trigger as two live-check jobs `refresh.scheduled` / `refresh.retired`; the dead "Test item" menu entry and its verifier removed; live check helpers re-pinned)

## Merged into the default branch
`refactor-and-grid` was merged into `remote-main` (the repository's default branch; there is no branch called `main`). The state before the refactoring - including `Test Functions.js`, the testers' manual code, which was removed with the refactor because the code it called is gone - is kept on the branch
`before-refactoring-and-test-functions` (the commit `remote-main` was at when `refactor-and-grid` branched off). Switch to it if the manual tests are needed.
