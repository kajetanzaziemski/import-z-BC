# Tracking down the doubled queryOption / extend lines

**Symptom (real sheet, build `c06ab0e+`):** after pasting many `queryOption | select | (empty)` lines under the table and filling the fields one by one, the co-edit adds the pair
"empty `queryOption` line + `extend` line" more than once (14 -> 19 rows). Easy to repeat.

**What the simulation says.** One co-edit adds exactly one pair; 300 random interleavings of pastes, field fills and "a newer run started" (with the real lock, ticket and re-read code) never doubled it.
A second pair needs a second co-edit that works from a picture WITHOUT the first one's pair. The lock, the ticket and the "have the lines changed since I read them" check all assume that a co-edit which
gets the lock reads what the previous one committed. If the platform does not guarantee that, all of them are blind. `tests/coeditor.test.js` ("stale reads reproduce the symptom") models exactly that
(reads show the old state until a moment has passed) and gets the exact symptom: two `extend` and two empty `queryOption` lines.

## Three hypotheses and the experiment for each
| # | Hypothesis | What would show it |
|---|---|---|
| H1 | An execution reads the spreadsheet (or properties) as it was some seconds earlier: it started before the previous co-edit committed, and its service keeps showing the old state | probe 1 (`STALE` in `same` / `refetched`), or in the trace `stale-suspected` followed by `reread` with more rows |
| H2 | The script lock is not exclusive between these executions (two co-edits inside at once) | probe 2 (`OVERLAP`), or in the trace two runs whose `lock` ... `released` intervals overlap |
| H3 | Something else inserts the lines (another trigger, a run of an older build, a second pair of agent triggers running the co-edit twice per edit) | the trace shows two `insert` events from runs that read the SAME `hash` with no stale suspicion and no overlap; or `Wszystkie triggery` shows two agent pairs |

## 1. The probes (5 minutes, no add-on code involved)
Open the script editor in two tabs of the browser (same spreadsheet open).
1. Tab 1: run `probeWriter()`. At once, tab 2: run `probeReader()`. Wait about 20 s until both have finished. Then `probeReport()` (either tab) and send the log.
   - Every line ends with the four ways of reading the cell and the property; `STALE` = it showed an older value than the writer had written 2+ s earlier.
2. Tab 1: run `probeLockHolder()`. At once, tab 2: run `probeLockWaiter()`. Wait until both are done. Then `probeLockReport()` and send the log.
3. Delete the sheet `_probe` and run `probeClear()`.

## 2. The flight recorder (`Coedit Trace.js`, always on)
Every co-edit keeps its own events and writes them in one document property when it ends (the last 20 runs are kept). To use it:
1. `coeditTraceClear()` in the editor (optional, to start clean).
2. Reproduce: paste the `select` lines, fill the fields one by one, wait until the sheet is quiet.
3. In the editor run `coeditTrace()` and send the log (one line per event, time ordered, `[xxxx]` = the run).

Events: `start`, `read` (rows, hash of the lines), `ticket`, `lock` (how long it waited), `dropped`, `timeout`, `stale-suspected` / `reread` / `stale-confirmed`, `changed`, `insert` (which lines, after which row),
`commit` (rows and hash after it), `checkpoint`, `error`, `released`, `end` (outcome).

How to read it:
- Two `insert` events with the same lines, the second run's `read` showing FEWER rows than the first run's `commit` -> **H1**. The `stale-suspected` events (and `stale-confirmed` when waiting helped) are the safeguard noticing it.
- `lock` ... `released` intervals of two runs overlapping in time -> **H2**.
- A run's `read` having the same hash as the previous run's `commit`, and still inserting -> the model decides to insert although the lines are there (**H3**, a model bug: send the rows).
- No `start` from a run that inserted -> an older build or another trigger did it.

## What is already done about it (safeguard, harmless if the hypothesis is wrong)
Each co-edit records what it left (`coeditExpected:<sheet>` = time, rows, hash). The next co-edit that reads FEWER lines than that within 30 s waits 1.5 s (then 2.5 s more) and reads again before it
decides anything (`SheetCoeditor.confirmFresh_`). If the lines come back, the doubled pair never happens; if they never do, the trace says so.

## Result of the probes on the real sheet (2026-10-25)
- No reading was older than 2 s, the lock is exclusive (the waiter got it 50 ms after the holder released it): **H2 is out**, and H1 is not "the execution sees an old snapshot for good".
- But the readings *without a flush* were consistently **one write behind** (about 1.5 s: `same` / `refetched` = 1,2,3 while `afterFlush` / `reopened` / `property` had 2,3,4), and they caught up as soon as the reader called
  `SpreadsheetApp.flush()`. So an execution that reads without flushing sees the sheet a moment ago - enough for a co-edit that starts right after another one committed to miss the lines that one inserted.
- Counter-measures now in: `ConfigGrid.lines()` flushes before every read, and the earlier safeguard (`confirmFresh_`) still waits and reads again when the lines are fewer than the previous co-edit left.
  If the doubled pairs do not come back, `coeditTrace()` shows whether the safeguard was needed (`stale-confirmed`); if it never is, it can go.

## What the recorder showed (2026-10-25, build `c06ab0e+`, before the flush) - the cause
```
20:08:36 [bpwi] read rows 13 hash 13937cf7           <- bpwi's execution started at 20:08:35
20:08:40 [wjgo] insert queryOption + extend after 12; commit rows 15 hash e436e058
20:08:42 [bpwi] lock; read rows 13 hash 13937cf7      <- the lock is bpwi's now, wjgo has committed, bpwi still sees 13 rows
20:08:43 [bpwi] stale-suspected (13 < 15)  ... read again after 1.5 s: rows 13, same hash ... after 2.5 s more: rows 13, same hash
20:08:50 [bpwi] insert queryOption + extend after 12  <- the same two lines again; commit
20:08:54 [bpwi] changed rows 17 (expected 15)         <- after its own commit (and flush) the sheet shows 17 rows: both pairs are there
```
(and the same earlier at 20:07: `hc44` read 11 rows for 11 s while `vmre` had committed 13; it was dropped by the ticket, `swee`, started after the commit, read 13 at once.)
- It is neither a lock failure (the intervals do not overlap) nor a delay: **an execution keeps seeing the sheet as of its last `SpreadsheetApp.flush()` (or its start)**, however long it waits and however often it
  fetches the sheet again. The probe said the same (the `same` / `refetched` columns moved only when the reader flushed). The constructor of the co-edit flushes (reading light) - before the other co-edit committed.
- The fix is the flush **after** the lock is got, right before the lines are read: `ConfigGrid.lines()` does `SpreadsheetApp.flush()` first. Waiting (`confirmFresh_`) alone is useless, as the trace shows; it now waits once (1.5 s) and reads
  again - through `lines()`, i.e. with a flush - so it can still catch a stale view that a flush does not cure.
- `tests/coeditor.test.js` has this model (reads come from the state at the start of the execution until a flush after the lock): the co-edit without the flush doubles the pair, with it it does not.
