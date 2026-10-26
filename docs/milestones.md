# Milestones of the refactoring

## half-way-through-refactoring  (commit `a20b4b9`, branch `refactor-and-grid`)

**The tag could not be pushed from the working session**: GitHub (through the session's git proxy) answers a tag push with `HTTP 403` (only the branch may be pushed), so the tag exists only
in the container that made it. This file is the record. To create it on GitHub from a normal clone:

```
git fetch origin refactor-and-grid
git tag -a half-way-through-refactoring a20b4b92cbd9171a93d4b377ed716d226a4d42a2 -m "Half-way through refactoring"
git push origin half-way-through-refactoring
```
(The name is `half-way-through-refactoring`: tag names cannot contain spaces.)

State at this milestone (330 offline tests passing; nothing verified on a real spreadsheet since the controller / router work):

Done
- Grid layer (from wyceny) extended and tested through both commit paths; `ConfigGrid` for the config sheet header and status cells (golden-tested against the old code)
- `Store` / `Settings` facade over the four storage mechanisms, callers moved
- Use cases extracted from `Menu.js` / `Settings Sheet.js`: `RefreshSheet`, `EstimateSheet`, `RefreshAll`, `ScheduleRefresh`; `ResultSheet` seam
- Router (`sheetEdit` / `sheetChange` -> named jobs), `AnalyseConfig`; the live check reports by job
- `Controller` rules: every platform entry is a run, no nested runs, `onOpen` builds the menu first; closing phase drains late registrations
- Live check helpers merged (the judge, pinned); fixed on the way: bugs-todo #1 (settings lost in `sheetEdit`), #2 (nested run lost log saves), #4, `UnknownError` unwrapping

Still to do
- (done after the tag: `SheetCoeditor` split, see `docs/testing.md` section 2b)
- (done after the tag: `SettingsGrid`, see `docs/testing.md` section 2c)
- (done after the tag: `BulkSheet` behind `ResultSheet`, see `docs/testing.md` section 2d)
- (done after the tag: `AgentService` regroup, facade `Agents`, `docs/agent-lifecycle.md`)
- (done after the tag: menu items in `Menu Actions.js` - analyse, refresh, estimate, wizard, authorise, logout; `docs/use-cases.md`)
- (done on branch `refactor-login-and-rest`: login flow behind `BCAuth`, `docs/login-flow.md`; the status check was already thin forwarders to `Agents`)
- (done on branch `refactor-login-and-rest`: BC layer reorganised and cleaned of test-only code, `docs/bc-layer.md`)
- (done: the old-name forwarders and dead leftovers removed)
- (done: bugs-todo #4/#6/#8/#10 closed - `ManagedSheets` cache; `BulkSheet` Sheets API path written and tested on the simulated spreadsheet only)
- (done: the time trigger as two live-check jobs `refresh.scheduled` / `refresh.retired`; the dead "Test item" menu entry and its verifier removed; live check helpers re-pinned)


## Reminders
- **Before merging `refactor-and-grid` into `main`: keep `Test Functions.js` on a separate branch or tag** (agreed: it is the testers' manual code, ignored by the refactor and by the tests). Remind when the merge comes up.
