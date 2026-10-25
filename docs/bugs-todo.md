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
7. **The config line range** (`ConfigGrid.lines().values()`, formerly `SheetCoeditor.getDataRange()`; behaviour pinned by `tests/coeditor.test.js`) reads `lastRow - 1` rows from row 6, i.e. 5 rows more than the sheet's data (it is
   harmless while the sheet has spare rows, but the height is not the data height).
8. **`onOpenAction`** does not return what `lightStatusCheck()` returns, so a caller cannot tell whether the agents are active.
9. **`sheetChange`** checks the trigger power after running the action (also #5 in `trigger-management-todo.md`).
10. **Unrelated edits still build `SettingsSheet`.** `updateAfterEdit()` calls `getMainSettings()` for every edit in every
    sheet, which reads the whole settings sheet and creates it (plus two unlogged triggers) when missing - see the earlier
    discussion about firewalling add-on runs in unrelated files.
11. **`SettingsSheet` row positions go stale.** `addNewSheetInfo()` inserts a config line (after row 2 while there are no config lines, i.e. above the `lastRefresh` /
    `refreshFrequency` lines) but does not move `lastRefreshPos` / `refreshFrequencyPos`; a `setLastRefresh()` later in the same execution writes into the wrong row.
    Pinned in `tests/settings-sheet.test.js`. In practice the wizard and `RefreshAll` run in separate executions.
12. **`runFunctionWithLock` lost requests made during the action: FIXED, then REPLACED by "only the last co-edit completes"** (see the end of this item). First fix: The holder set its flag to "no" after its action, erasing the "yes" of a run that had been waiting for the lock; the waiting run then found "no" and
    did nothing, although the holder had read the sheet before the change (a row pasted during an analyse was never analysed: no empty queryOption row, no dropdowns on the pasted line). Now every caller sets "yes", the holder
    sets "no" before each pass and does another pass when "yes" came back (max 5), the lock is released after the action. `functions.js`, tests in `tests/state.test.js`.
    **Final design (`runLatestOnly`, `functions.js`):** every co-edit writes its own ticket to `<sheet>_coedit` when it starts and takes the *document* lock (not the script lock: documents no longer wait for each other),
    waiting up to ~90 s and giving up at once if a newer ticket appears; the co-edit checks `isLatest()` at three checkpoints (before the first write, after the lines are inserted, before the dropdowns - prepared with the
    slow BC calls - are written) and drops out mid-flight when a newer run exists. Outcomes: `completed`, `dropped` (the newer run owns the reading light and switches it off), `timeout` (never got the lock: it switches the light
    off itself). A dropped run leaves what it already wrote (inserted lines): the newer run reads the sheet again and completes it. No pass loop, no queue of redundant runs.

### Fixed after the first real-sheet runs (each with tests)
- **#3 `ConnectionError` aborting the co-edit: FIXED.** The field list, the navigation property list and the data-type lookup of `ConfigDValStore` fall back to the empty list with its note, like the table list (not remembered, so the next run asks BC again).
- **#5 `setUp` deleting the refresh triggers of all documents: FIXED.** A time trigger is not bound to a document (its source id is null), so the only link is the permit stored in the document: `setUp` now removes just the trigger that permit names
  (a refresh trigger only, never an agent). Other triggers of the document - older ones, legacy `autoRefresh` ones that never claimed a permit - cannot be recognised and are left; they delete themselves when they fire because the permit is not issued
  for them (`run` / `runLegacy`). Switching the refresh OFF in a document with no permit issues a permit for nobody, so an unclaimed legacy trigger deletes itself instead of claiming the permit and refreshing on. A legacy trigger that
  did claim the permit (it ran with none) is the one it names and is replaced like any other. The live check's refresh-trigger verifier was changed accordingly (hashes re-pinned): it judges this document's permit and trigger, not the whole project.
- **#7 the line range: CHANGED** to what was asked: B6 down to the last row with anything in B-F (at least one row). Side effect: a dropdown left on a line the user emptied is no longer swept by the extra five rows the old range happened to include.
- **#9 `sheetChange` power check: FIXED.** The power is looked at before the action; a powered-off or unlogged trigger skips the change and announces the job `agent.skipped`, like an edit.
- **#11 stale `SettingsSheet` row positions: FIXED** (the remembered rows follow a line `addNewSheetInfo` inserts above them).
- Agent pool (`docs/agent-lifecycle.md`): the missing clean-up row `ON|OFF|V` (document OFF wins: its entry removed, trigger uninstalled, user entry kept as an OFF tombstone), eviction by least-recently-used (`getOldest` sorted nothing),
  log entries removed when a trigger *object* is deleted (`installNew`'s pre-delete), `installNew` all or nothing (rolls the edit trigger back if the change trigger fails) and refuses a pair that would pass the 20-trigger quota.

## Status on `refactor-and-grid`

- **#1 Settings writes lost in `sheetEdit` (and `onEdit`): FIXED in `Controller.run`.** A top-level run now keeps the closing actions that were registered before it started (the entry
  point's log line builds the settings object and registers its save); a nested run still starts with an empty list, as before. The live check's
  `FAIL permit issued for the new trigger` / `permit interval in hours` after setting a refresh frequency are gone (`tests/controller.test.js`,
  `tests/router.test.js`, `tests/live-check.test.js`). Nested runs (#2) are untouched.
- #2, #3, #5-#10: unchanged (the refactor keeps them on purpose; tests pin them where they are observable).
- **#2 Nested `Controller.run` loses log saves: FIXED.** There are no nested runs any more (the status check calls `StatusManager.forceRefresh()` instead of the entry point `forceAgentRefresh`; a nested call is reported as `NESTED RUN`
  and done inline), and the closing phase runs actions registered while it runs, so the trigger logs and the agent pair installed by the status check are saved. `docs/controller.md`.
