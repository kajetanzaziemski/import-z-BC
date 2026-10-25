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
- Split `SheetCoeditor` (config rows read / written with direct `SpreadsheetApp` calls; query model entangled with dropdown logic)
- `SettingsGrid` (`Settings Sheet.js` still makes direct range calls)
- Writer for tall result data behind `ResultSheet` (Grid's window is 3000 rows)
- `AgentService` regroup (`Trigger Manager.js`, `Status Manager.js`, `Track onEdit Triggers.js`)
- Remaining use cases still inside `Menu.js` / `Status Manager.js` (wizard, auth flow, logout, status check); BC layer reorganisation
- The time trigger as two live-check jobs (`refresh.scheduled`, `refresh.retired`)
