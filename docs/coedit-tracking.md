# The doubled queryOption / extend pairs: what it was (closed)

**Symptom (real sheet, build `c06ab0e+`):** after pasting many `queryOption | select | (empty)` lines under the table and filling the fields one by one, the co-edit added the pair "empty `queryOption`
line + `extend` line" more than once.

**Cause (found with a flight recorder and two probes on the real sheet, since removed):** an execution keeps seeing the spreadsheet as of its last `SpreadsheetApp.flush()` (or its start), however long it
waits and however often it fetches the sheet again. A co-edit that started before another one committed, and got the lock after it, read the lines WITHOUT that co-edit's inserts (the same 13 rows, the same
hash, 8-11 s on) and inserted the pair again; after its own commit (and flush) the sheet showed both pairs. The lock was exclusive (the waiter got it 50 ms after the holder released it) and the ticket logic
did its job; what failed was the picture the co-edit worked from. Its constructor flushes too (the reading light) - but before the other co-edit committed, which brings nothing.

**Fix:** `ConfigGrid.lines()` calls `SpreadsheetApp.flush()` before it reads the lines, i.e. after the lock is got. `tests/coeditor.test.js` models the stale view (reads come from the state at the start of the
execution until a flush after the lock): without the flush the second co-edit doubles the pair, with it it does not. Kept next to it: the check that the lines are still what was read before anything is written
(`SheetCoeditor.linesChanged`, start over at most 3 times), the "only the last co-edit completes" tickets (`runLatestOnly`) and the script lock.

**Removed again** (the fix was confirmed; they wrote their own document properties, which disturbed the live check's "no property changed" checks): the flight recorder (`Coedit Trace.js`, the
`coeditTrace:*` and `coeditExpected:*` properties, the wait-and-read-again safeguard `confirmFresh_`) and the probes (`Concurrency Probe.js`, `probe:*`). They are in the git history (commit `ea32c94` and the ones before it)
if the same kind of problem comes back; the method was: record per run what it read (rows + hash), when it got the lock and what it inserted, and compare the runs.

**General lesson (still open):** every place that reads a sheet which another execution may have just written should flush first. `ConfigGrid.lines()` does; the other `Grid.open` callers (status cells, settings
sheet) do not yet.
