# Bugs and quirks that are still open

Only what is **not fixed in the current code**. The fixed ones (#1 to #18 with their causes and tests) are in `bugs-fixed.md`. Nothing here was verified on a real spreadsheet unless it says so.

## Agents and their records (details: `agent-lifecycle.md`; the quirks are pinned by `tests/agents.test.js`)
1. **Whole-array saves of the logs.** The document trigger log, the user trigger log and the pair list (`agentArray`) are `StorageArray`s written as a whole when a run closes (no dirty-key merge, no lock). Two runs of one document that both change a log can overwrite each other, and
   the user log is shared by all documents of the user. Fix: a keyed register (`triggerId -> entry`) merged under a lock, like `StorageObject`. *Held.*
2. **An evicted document believes it is covered.** Eviction deletes the least-recently-used pair wherever it was installed but can only clean the current document's log; the victim document keeps `ON` entries (`X|ON|X`), `checkIfActive` says "active" and nothing
   repairs it until the detector powers it off (two missed edits) and the next menu click repairs it - by evicting the next pair. With more than five documents they take each other's slots in turn.
3. **`checkIfActive` never asks the platform.** A trigger deleted in the dashboard or lost with revoked authorisation still looks active. Fix: an optional check against `getProjectTriggers()` at the status check. *Held.*
4. **`lastUsed` is written on every installable run**, to both logs (a lock and two property writes per edit). Fix: write at most once per few hours per trigger. *Held, goes with #1.*
5. **The edit detector with several users.** Several installable triggers on one document (several users): only one trace can be consumed per edit, leftovers can mask a failure within the trace's lifetime. *Held.*
6. **Four records of one fact** (project triggers, document log, user log, pair list) are reconciled only by `logCleanUp`; drift makes eviction start too early or never.
7. **`AgentManager.deleteAllInDocument()`** is an unfinished stub (an empty `forEach({})`) and nothing calls it.

## Edits and structure changes
8. **Changes made by the add-on itself still fire `sheetChange`.** Every status-light switch (`FORMAT`), result write (`EDIT`, `FORMAT`) fires the on-change trigger: a refresh produces dozens of `change.ignored` runs (cheap: decided before anything is read,
   and quiet in the live check). The expensive part, structure changes of the add-on's own writes starting a co-edit, is fixed (#19 in `bugs-fixed.md`). What stays: a user's structure change within 20 s of an add-on write is not co-edited (the cell edits that follow are).
9. **A dropdown left on a line the user emptied is no longer swept.** The config line range is B6 down to the last row with content (my-todo.md), so cells below it that held a dropdown are not cleared. Harmless; the validation stays on an empty cell.

## Refresh and estimate
10. **`EstimateSheet` without a table returns early and leaves the reading cell (B2) lit.** Pinned in `tests/refresh.test.js`; the live check reports it as "still showing activity". Fix: switch the cell off before returning.
11. **Automatic refresh without a frequency.** `ScheduleRefresh.setUp` with no frequency removes the trigger and then fails with a `TypeError` (pinned). The first run of a legacy `autoRefresh` trigger records no `lastRun` (the permit it just issued is not stored yet when it is touched).
12. **`RefreshAll` stops at the first sheet that fails** (the error goes on to the caller; the sheets after it are not refreshed). By design today; listed because a scheduled refresh with one bad sheet refreshes nothing after it.
