# Bugs found, to fix later

Found while building and testing the live check helpers (`docs/live-check.md`), or noticed on the way. Not fixed on
`live-test-helpers`. The trigger / agent items are in `trigger-management-todo.md`; only cross-references are repeated here.

## Confirmed (reproduced with the live checks)

1. **Settings writes lost in `sheetEdit` (and `onEdit`).** `agentLog(... MainSettings.getAddonStatus() ...)` is evaluated
   before `Controller.run()` (`Quick Start.js`, first line of both handlers). That creates the `StorageObject` for the
   import settings and registers its save with `registerClosingOnce()` (once per execution) in the *previous* `closingActions`,
   which `run()` then resets. Every `setProperty()` made later in that execution is never saved.
   Visible effect: editing the refresh frequency creates the time trigger but `setRefreshPermit()` is lost, so the trigger
   finds no permit and deletes itself - automatic refresh set up from the settings sheet does not work.
   Seen by the check as `FAIL permit issued for the new trigger`. Fix options: do not touch the store before `run()` (log
   inside the action), or make closing-action registration survive the reset in `run()`.
2. **Nested `Controller.run()` loses log saves.** Switching the add-on ON runs `fullStatusCheck()` as a closing action, which
   calls `forceAgentRefresh()` -> `Controller.run()`. Triggers are installed but the trigger logs and agent array are not
   saved (the log objects register their save into the array being iterated, and `registerClosingOnce` flags are never
   reset). Already listed in `trigger-management-todo.md`; the live check reports it as `WARN (known issue)`.
3. **Config sheet edit throws `ConnectionError` when BC is not authorised and metadata is not cached.** Only
   `ConfigDValStore.metadataTables()` catches `ConnectionError`; `tableFields()` / `tableNavProperties()` do not, so choosing
   a table while offline aborts the whole co-edit (dropdowns not set, rows may be half done). Reported as
   `WARN ended with a connection error`.

## Noticed while reading the code (not reproduced)

4. **`estimateForCurrentSheet_script`** (`Menu.js`) assigns `configSheet = ...` without `let`, creating an implicit global.
5. **`SettingsSheet.setRefreshTrigger()`** deletes every `autoRefresh` / `autoRefreshHandler` trigger of the user in the whole
   project (`getProjectTriggers()`), i.e. also the ones of other documents, and the permit is per document.
6. **`ODataConnection.readAllPages()`** (and `_test`) catch block calls `shCoed.switchConnectionControl(false)` although
   `shCoed` is optional (`if(shCoed)` is used elsewhere in the same method).
7. **`SheetCoeditor.getDataRange()`** reads `lastRow - 1` rows from row 6, i.e. 5 rows more than the sheet's data (it is
   harmless while the sheet has spare rows, but the height is not the data height).
8. **`onOpenAction`** does not return what `lightStatusCheck()` returns, so a caller cannot tell whether the agents are active.
9. **`sheetChange`** checks the trigger power after running the action (also #5 in `trigger-management-todo.md`).
10. **Unrelated edits still build `SettingsSheet`.** `updateAfterEdit()` calls `getMainSettings()` for every edit in every
    sheet, which reads the whole settings sheet and creates it (plus two unlogged triggers) when missing - see the earlier
    discussion about firewalling add-on runs in unrelated files.
