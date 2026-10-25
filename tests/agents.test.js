// The life of the agents (the installable sheetEdit / sheetChange trigger pairs): when they are created, replaced, powered off and deleted, and what the
// three logs (document, user, project triggers) and the pair list look like each time. Registered by tests/run.js.
//
// These are CHARACTERISATION tests of the code as it was before the AgentService regroup (docs/agent-lifecycle.md describes the same facts in prose):
// they pin what happens today, including the things that look like bugs (marked "quirk"), so that the regroup can be shown to change none of it.
// Several documents of one user are several FakePlatforms sharing the project's triggers and the user properties (FakePlatform.otherDocument()).
'use strict';
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const FILES = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js', 'Settings Sheet.js'];

// Captured from the code before the regroup (PRINT_AGENT_GOLDEN=1 node tests/run.js prints them again).
const STORY = {
 "ok": [
  "SIMPLE: onEdit entry point called (add-on status: ON).",
  "SIMPLE S!B2: Simple onEdit fired. Waiting up to N ms (polling every N ms) for the installable trigger to report the same edit.",
  "SIMPLE S!B2: Poll #1 (N ms): installable record already present (counter 1).",
  "SIMPLE S!B2: Poll #1 (N ms): installable record present (counter 1). Trying to consume it.",
  "SHARED S!B2: Lock for \"consume installable record\": document lock acquired after N ms.",
  "SIMPLE S!B2: Consume: counter 1 -> 0 (record deleted).",
  "SIMPLE S!B2: OK: installable trigger reported this edit (found after N ms). Agent is alive, nothing to do."
 ],
 "first": [
  "SIMPLE: onEdit entry point called (add-on status: ON).",
  "SIMPLE S!B2: Simple onEdit fired. Waiting up to N ms (polling every N ms) for the installable trigger to report the same edit.",
  "SIMPLE S!B2: Poll #1 (N ms): installable record not there yet.",
  "SIMPLE S!B2: Gave up after N polls (N ms).",
  "SIMPLE S!B2: NO REPORT from the installable trigger within N ms. Raising the alarm.",
  "SHARED S!B2: Lock for \"read/set suspect flag\": document lock acquired after N ms.",
  "SHARED S!B2: Suspect flag SET.",
  "SIMPLE S!B2: ALARM level 1: agent marked SUSPECT (flag set). Not powering off yet: the installable trigger may only be late. A later installable run clears the flag, a second miss without one powers the agents off.",
  "SIMPLE S!B2: Showing the 'agent not configured' alert to the user (shown when this execution closes)."
 ],
 "second": [
  "SIMPLE: onEdit entry point called (add-on status: ON).",
  "SIMPLE S!B2: Simple onEdit fired. Waiting up to N ms (polling every N ms) for the installable trigger to report the same edit.",
  "SIMPLE S!B2: Poll #1 (N ms): installable record not there yet.",
  "SIMPLE S!B2: Gave up after N polls (N ms).",
  "SIMPLE S!B2: NO REPORT from the installable trigger within N ms. Raising the alarm.",
  "SHARED S!B2: Lock for \"read/set suspect flag\": document lock acquired after N ms.",
  "SIMPLE S!B2: ALARM level 2: agent was already marked suspect N s ago (edit S!B2) and no installable run has been seen since. Agent considered DEAD.",
  "SIMPLE S!B2: Powering OFF all agents in this file.",
  "SIMPLE S!B2: Showing the 'agent not configured' alert to the user (shown when this execution closes)."
 ],
 "third": [
  "SIMPLE: onEdit entry point called (add-on status: ON).",
  "SIMPLE S!B2: Simple onEdit fired. Waiting up to N ms (polling every N ms) for the installable trigger to report the same edit.",
  "SIMPLE S!B2: Poll #1 (N ms): installable record not there yet.",
  "SIMPLE S!B2: Gave up after N polls (N ms).",
  "SIMPLE S!B2: NO REPORT from the installable trigger within N ms. Raising the alarm.",
  "SHARED S!B2: Lock for \"read/set suspect flag\": document lock acquired after N ms.",
  "SIMPLE S!B2: ALARM level 2: agent was already marked suspect N s ago (edit S!B2) and no installable run has been seen since. Agent considered DEAD.",
  "SIMPLE S!B2: Agents are already powered off (user has been warned before). Not powering off again, not showing the alert again."
 ]
};
const TABLE = [["No","Event","Trigger Id","Source","Function","Created","Last Used","Power","Doc","Usr","Script"],[1,"ON_EDIT","trig-1","<a href=\"url-A\"> name-A</a>","sheetEdit","DATE","DATE","ON","✓","✓","✓"],[2,"ON_CHANGE","trig-2","<a href=\"url-A\"> name-A</a>","sheetChange","DATE","DATE","ON","✓","✓","✓"],[3,"ON_EDIT","trig-3","<a href=\"url-A\"> name-A</a>","sheetEdit","DATE","DATE","ON","✗","✓","✓"],[4,"ON_CHANGE","trig-4","<a href=\"url-A\"> name-A</a>","sheetChange","DATE","DATE","ON","✗","✓","✓"]];

module.exports = function register(t) {
  const { test } = t;
  const extra = t.extraFiles || [];                                      // the regroup adds its files here
  const files = [...FILES, ...extra];

  /** One user, several documents. doc(id) = { id, p, ex(code), show() } - every ex() call is a NEW execution (fresh globals) on that document. */
  function world() {
    const docs = {};
    let first = null;
    const doc = id => {
      if (docs[id]) return docs[id];
      const p = first ? first.otherDocument() : (first = new FakePlatform());
      const d = { id, p, alerts: 0, log: [] };
      const ss = { getId: () => id, getSheetByName: () => null, getUrl: () => 'url-' + id, getName: () => 'name-' + id };
      d.run = (code, more) => {
        const ex = p.execution(files, Object.assign({
          __p: p, __d: d,
          Logger: { log: line => d.log.push(String(line).replace(/\[AGENT-CHECK [^\]]*\] /, '')) },
          SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ alert() { d.alerts++; } }), flush() {}, openById: () => ss }
        }, more || {}));
        ex.eval(`globalThis.getMainSettings = () => ({ isConfigSheet: () => false }); globalThis.dbgLog = () => {}; globalThis.menuSelector = () => {}; globalThis.Router = { edit() {}, change() {} };
                 { const D = Date; globalThis.Date = class extends D { constructor(...a) { if (a.length) super(...a); else super(__p.now); } static now() { return __p.now; } }; }`);
        return ex.eval(code);
      };
      const json = (scope, key) => JSON.parse(p.props[scope][key] || 'null');
      d.state = () => {
        const doc = json('document', 'docTriggerArray') || [], usr = json('user', 'usrTriggerArray') || [];
        const f = e => e.trigFunction.replace('sheet', '') + ':' + (e.powerOn ? 'ON' : 'OFF');
        return {
          project: p.triggers.map(x => `${x.id}:${x.fn}@${x.source}`),
          doc: doc.map(e => `${e.triggerId}:${f(e)}`),
          user: usr.map(e => `${e.triggerId}:${f(e)}@${e.SsId}`),
          pairs: json('user', 'agentArray') || [],
          suspect: p.props.document.agentSuspect ? JSON.parse(p.props.document.agentSuspect).fp : null
        };
      };
      return docs[id] = d;
    };
    return { doc, docs };
  }
  const click = d => d.run(`Controller.run('menuSomething', () => {})`);            // any menu item: turns the add-on ON, the status check runs when the run closes
  const EDIT = `({ range: { getSheet: () => ({ getName: () => 'S' }), getA1Notation: () => 'B2' } })`;
  const pairOf = n => [`trig-${2 * n - 1}`, `trig-${2 * n}`];

  // ---- creation -----------------------------------------------------------------------------------------------------------------------------
  test('agents: the first menu click of a document installs one pair (edit + change), logs it in the document log, the user log and the pair list', () => {
    const w = world(), a = w.doc('A');
    click(a);
    assert.deepStrictEqual(a.state(), {
      project: ['trig-1:sheetEdit@A', 'trig-2:sheetChange@A'], doc: ['trig-1:Edit:ON', 'trig-2:Change:ON'],
      user: ['trig-1:Edit:ON@A', 'trig-2:Change:ON@A'], pairs: [['trig-1', 'trig-2']], suspect: null });
  });

  test('agents: a second click changes nothing (the document log says an edit and a change agent are active)', () => {
    const w = world(), a = w.doc('A');
    click(a); const before = JSON.stringify(a.state());
    click(a); click(a);
    assert.strictEqual(JSON.stringify(a.state()), before);
  });

  test('agents: a sidebar/request call does not turn the add-on on, so it installs nothing; changeAddonStatus(true) does (status check when the run closes), (false) leaves the agents alone', () => {
    const w = world(), a = w.doc('A');
    a.run(`Controller.run('requestSomething', () => {})`);
    assert.deepStrictEqual(a.state().project, []);
    a.run(`changeAddonStatus(true)`);
    assert.deepStrictEqual(a.state().pairs, [['trig-1', 'trig-2']]);
    a.run(`changeAddonStatus(false)`);
    assert.deepStrictEqual(a.state().project, ['trig-1:sheetEdit@A', 'trig-2:sheetChange@A'], 'switching the add-on off deletes nothing');
    assert.strictEqual(a.state().doc.every(x => /:ON$/.test(x)), true, 'and powers nothing off');
  });

  test('agents: onOpen (authorised) only WARNS when the agents are not active (an alert when the run closes); it installs nothing', () => {
    const w = world(), a = w.doc('A');
    a.run(`onOpen({ authMode: 'FULL' })`);
    assert.deepStrictEqual(a.state().project, []);
    assert.strictEqual(a.alerts, 0, 'the add-on is OFF (never switched on): the run is skipped by the gate, no alert either');
    a.p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: 'Ustawienia' });     // on, but no agents
    a.run(`onOpen({ authMode: 'FULL' })`);
    assert.strictEqual(a.alerts, 1);
    assert.deepStrictEqual(a.state().project, []);
  });

  test('agents: "Odśwież konfigurację" (forceAgentRefresh) REPLACES a working pair: powered off, logs cleaned, triggers uninstalled, a new pair installed', () => {
    const w = world(), a = w.doc('A');
    click(a);
    a.run(`forceAgentRefresh()`);
    assert.deepStrictEqual(a.state(), {
      project: ['trig-3:sheetEdit@A', 'trig-4:sheetChange@A'], doc: ['trig-3:Edit:ON', 'trig-4:Change:ON'],
      user: ['trig-3:Edit:ON@A', 'trig-4:Change:ON@A'], pairs: [['trig-3', 'trig-4']], suspect: null });
  });

  test('agents: forceAgentRefresh also clears the suspect flag (the new agents are fresh)', () => {
    const w = world(), a = w.doc('A');
    click(a);
    a.p.props.document.agentSuspect = JSON.stringify({ fp: 'S!B2', time: '2023-11-14T22:13:20.000Z' });
    a.run(`forceAgentRefresh()`);
    assert.strictEqual(a.state().suspect, null);
  });

  test('agents: quirk - SettingsSheet creates RAW sheetEdit / sheetChange triggers (not logged, not in the pair list) whenever none exists; the next status check replaces them with a logged pair', () => {
    const w = world(), a = w.doc('A');
    a.run(`SettingsSheet.prototype.setupEditTriggers.call({})`, {});
    assert.deepStrictEqual(a.state(), { project: ['trig-1:sheetEdit@A', 'trig-2:sheetChange@A'], doc: [], user: [], pairs: [], suspect: null });
    a.run(`SettingsSheet.prototype.setupEditTriggers.call({})`);
    assert.strictEqual(a.p.triggers.length, 2, 'not again while they exist');
    click(a);                                                                           // checkIfActive is false (logs are empty): installNew deletes ALL user edit/change triggers of the document first
    assert.deepStrictEqual(a.state().project, ['trig-3:sheetEdit@A', 'trig-4:sheetChange@A']);
    assert.deepStrictEqual(a.state().pairs, [['trig-3', 'trig-4']]);
  });

  // ---- the limit and eviction ---------------------------------------------------------------------------------------------------------------
  function sixDocs() {
    const w = world();
    ['A', 'B', 'C', 'D', 'E'].forEach(id => click(w.doc(id)));
    return w;
  }

  test('agents: a user can have 5 pairs; the 6th document evicts the OLDEST pair (first in the user log) - its triggers and its pair-list entry go', () => {
    const w = sixDocs();
    assert.deepStrictEqual(w.doc('E').state().pairs, [1, 2, 3, 4, 5].map(pairOf));
    click(w.doc('F'));
    const f = w.doc('F').state();
    assert.deepStrictEqual(f.pairs, [2, 3, 4, 5, 6].map(pairOf));
    assert.deepStrictEqual(f.project.map(x => x.split(':')[0]), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => 'trig-' + n));
    assert.deepStrictEqual(f.doc, ['trig-11:Edit:ON', 'trig-12:Change:ON']);
  });

  test('agents: eviction takes the pair whose edit trigger was used LEAST recently (lastUsed), not the first in the log', () => {
    const w = sixDocs();
    w.doc('A').p.advance(3600);
    w.doc('A').run(`sheetEdit({ triggerUid: 'trig-1', range: { getSheet: () => ({ getName: () => 'S' }), getA1Notation: () => 'B2' } })`);      // A's agent works: used now
    w.doc('B').p.advance(60);
    click(w.doc('F'));
    const f = w.doc('F').state();
    assert.deepStrictEqual(f.pairs, [1, 3, 4, 5, 6].map(pairOf), "B's pair (never used since it was installed) went, A's stayed");
    assert.deepStrictEqual(f.project.filter(x => /@B$/.test(x)), []);
  });

  test('agents: getOldest copes with missing or unreadable dates (they count as oldest) and with Date objects and ISO strings alike', () => {
    const w = world(), a = w.doc('A');
    const r = a.run(`(() => { const log = new UserTriggerLog();
      const e = (id, used, created) => Object.assign(new TriggerInfoEntry(null), { triggerId: id, trigEventType: 'ON_EDIT', lastUsed: used, dateCreated: created });
      log.triggerArray = [e('late', '2023-11-15T10:00:00.000Z', null), e('none', null, null), e('date', new Date('2023-11-14T10:00:00.000Z'), null), e('created', null, '2023-11-13T10:00:00.000Z')];
      const order = []; while (log.triggerArray.length) { const o = log.getOldest('ON_EDIT'); order.push(o.triggerId); log.deleteEntryWithTriggerId(o.triggerId); }
      return order.join(','); })()`);
    assert.strictEqual(r, 'none,created,date,late');
  });

  test('agents: deleting a trigger given as an object (what installNew does with the document\'s old triggers) removes its log entries too', () => {
    const w = world(), a = w.doc('A');
    click(a);
    a.run(`Controller.run('requestX', () => { TriggerGateway.deleteAllUserEditTriggersInDocument(); })`);
    const s = a.state();
    assert.deepStrictEqual(s.project, ['trig-2:sheetChange@A']);
    assert.deepStrictEqual(s.doc, ['trig-2:Change:ON'], 'the edit entry is gone from the document log');
    assert.deepStrictEqual(s.user, ['trig-2:Change:ON@A'], 'and from the user log');
  });

  test('agents: installNew is all or nothing - if the change trigger cannot be created the edit trigger is deleted again, nothing is logged, the error goes on', () => {
    const w = world(), a = w.doc('A');
    const base = a.p.scriptApp();
    const failing = Object.assign({}, base, { newTrigger: fn => { const b = base.newTrigger(fn); if (fn === 'sheetChange') b.create = () => { throw new Error('boom'); }; return b; } });
    assert.throws(() => a.run(`Controller.run('requestX', () => { getAgentManager().installNew(); })`, { ScriptApp: failing }), /boom/);
    assert.deepStrictEqual(a.state(), { project: [], doc: [], user: [], pairs: [], suspect: null });
    click(a);                                                     // and the next try works (trig-1 was the rolled-back edit trigger)
    assert.deepStrictEqual(a.state().pairs, [['trig-2', 'trig-3']]);
  });

  test('agents: installNew counts the user\'s triggers first - a pair that would pass the quota of 20 is refused with a message, nothing is deleted or created', () => {
    const w = world(), a = w.doc('A');
    for (let i = 0; i < 19; i++) a.p.triggers.push({ id: 'time-' + i, fn: 'autoRefreshHandler', type: 'CLOCK', source: null, params: {} });
    assert.throws(() => a.run(`Controller.run('requestX', () => { getAgentManager().installNew(); })`), /limit triggerów/);
    assert.strictEqual(a.p.triggers.length, 19);
    a.p.triggers.pop();                                           // 18 + 2 = 20: exactly the quota
    click(a);
    assert.strictEqual(a.p.triggers.length, 20);
    assert.deepStrictEqual(a.state().pairs.length, 1);
    // an existing pair of this document does not count against itself when it is replaced
    a.run(`forceAgentRefresh()`);
    assert.strictEqual(a.p.triggers.length, 20);
  });

  test('agents: quirk - eviction cannot touch the other document: its document log still says ON (the add-on there believes it has agents) and the user log keeps the evicted entries', () => {
    const w = sixDocs();
    click(w.doc('F'));
    const a = w.doc('A').state();
    assert.deepStrictEqual(a.doc, ['trig-1:Edit:ON', 'trig-2:Change:ON'], 'A still thinks it is covered');
    assert.ok(a.user.includes('trig-1:Edit:ON@A') && a.user.includes('trig-2:Change:ON@A'), 'stale entries stay in the user log');
    assert.deepStrictEqual(a.project.filter(x => /@A$/.test(x)), [], 'but A has no trigger left');
    assert.strictEqual(w.doc('A').run(`getAgentManager().checkIfActive()`), true, 'a status check in A finds nothing to repair');
    click(w.doc('A'));
    assert.deepStrictEqual(w.doc('A').state().project.filter(x => /@A$/.test(x)), [], 'a menu click in A does not repair it either');
  });

  test('agents: an edit in the evicted document - 1st unreported edit = suspect + alert, 2nd = all agents of the file powered OFF + alert, 3rd = nothing more (no new alert)', () => {
    const w = sixDocs(), a = w.doc('A');
    click(w.doc('F'));
    a.run(`onEdit(${EDIT})`);
    assert.strictEqual(a.state().suspect, 'S!B2');
    assert.strictEqual(a.alerts, 1);
    assert.ok(a.state().doc.every(x => /:ON$/.test(x)));
    a.run(`onEdit(${EDIT})`);
    assert.deepStrictEqual(a.state().doc, ['trig-1:Edit:OFF', 'trig-2:Change:OFF']);
    assert.ok(a.state().user.includes('trig-1:Edit:OFF@A'), 'the user log entry is powered off too');
    assert.strictEqual(a.alerts, 2);
    a.run(`onEdit(${EDIT})`);
    assert.strictEqual(a.alerts, 2, 'already off: not powered off again, not shown again');
  });

  test('agents: quirk - the repair in the evicted document takes the slot of the next oldest pair: the 6 documents keep evicting each other', () => {
    const w = sixDocs(), a = w.doc('A');
    click(w.doc('F'));
    a.run(`onEdit(${EDIT})`); a.run(`onEdit(${EDIT})`);
    click(a);
    const s = a.state();
    assert.deepStrictEqual(s.doc, ['trig-13:Edit:ON', 'trig-14:Change:ON'], "A has its agents again; the stale OFF entries are cleaned ('OFF|OFF|X')");
    assert.deepStrictEqual(s.pairs, [3, 4, 5, 6, 7].map(pairOf), 'the oldest pair (B\'s) was evicted for it');
    assert.deepStrictEqual(s.project.filter(x => /@B$/.test(x)), [], "B's triggers are gone");
    assert.strictEqual(w.doc('B').run(`getAgentManager().checkIfActive()`), true, 'while B still believes it is covered');
    assert.strictEqual(s.suspect, null);
  });

  // ---- power off, the status check, the clean-up table ----------------------------------------------------------------------------------------
  test('agents: powerOffAllAgentsInFile powers every sheetEdit / sheetChange entry of the document OFF in both logs; the status check then repairs (powered-off pair is uninstalled, a new one installed)', () => {
    const w = world(), a = w.doc('A');
    click(a);
    a.run(`StatusManager.powerOffAllAgentsInFile(); Controller.run('requestPowerOff', () => {})`);     // (a run to save the logs)
    // powerOff itself ran outside a run in the line above only for its effect on the logs; save them through a run:
    a.run(`Controller.run('requestPowerOff', () => { StatusManager.powerOffAllAgentsInFile(); })`);
    assert.deepStrictEqual(a.state().doc, ['trig-1:Edit:OFF', 'trig-2:Change:OFF']);
    assert.strictEqual(a.run(`StatusManager.basicStatusCheck()`), false);
    click(a);
    assert.deepStrictEqual(a.state().project, ['trig-3:sheetEdit@A', 'trig-4:sheetChange@A']);
    assert.deepStrictEqual(a.state().doc, ['trig-3:Edit:ON', 'trig-4:Change:ON']);
    assert.deepStrictEqual(a.state().pairs, [['trig-3', 'trig-4']]);
  });

  // The clean-up table, as outcomes. key = user log | document log | project triggers  (X = not there, V = a trigger exists)
  // expected = [user entry kept, document entry kept, trigger kept]; user 'Reinstate' = an entry appears.
  const OUTCOMES = {
    'ON|ON|V': [1, 1, 1], 'ON|ON|X': [0, 0, 0], 'ON|OFF|X': [0, 0, 0], 'ON|X|V': [1, 0, 1], 'ON|X|X': [0, 0, 0],
    'OFF|ON|V': [0, 0, 0], 'OFF|ON|X': [0, 0, 0], 'OFF|OFF|V': [0, 0, 0], 'OFF|OFF|X': [0, 0, 0], 'OFF|X|V': [0, 0, 0], 'OFF|X|X': [0, 0, 0],
    'X|ON|V': [1, 1, 1], 'X|ON|X': [0, 1, 0], 'X|OFF|V': [0, 0, 0], 'X|OFF|X': [0, 1, 0], 'X|X|V': [0, 0, 1], 'X|X|X': [0, 0, 0],
    'ON|OFF|V': [1, 0, 0]                                                  // the document says OFF (it wins): its entry goes, the trigger is uninstalled, the user entry stays powered OFF (tombstone)
  };
  Object.keys(OUTCOMES).forEach(key => test(`agents: clean-up of one item in the state user|doc|script = ${key}${key === 'ON|OFF|V' ? ' (the document wins: doc entry removed, trigger uninstalled, user entry powered OFF)' : ''}`, () => {
    const [u, d, s] = key.split('|');
    const w = world(), a = w.doc('A');
    const entry = on => ({ triggerId: 'trig-1', trigEventType: 'ON_EDIT', trigFunction: 'sheetEdit', dateCreated: '2023-11-14T22:00:00.000Z', lastUsed: '2023-11-14T22:00:00.000Z', SsId: 'A', powerOn: on });
    if (u !== 'X') a.p.props.user.usrTriggerArray = JSON.stringify([entry(u === 'ON')]);
    if (d !== 'X') a.p.props.document.docTriggerArray = JSON.stringify([entry(d === 'ON')]);
    if (s === 'V') a.p.triggers.push({ id: 'trig-1', fn: 'sheetEdit', type: 'ON_EDIT', source: 'A', params: {} });
    a.run(`Controller.run('requestCleanUp', () => StatusManager.logCleanUp())`);
    const st = a.state();
    const got = [st.user.some(x => x.startsWith('trig-1:')) ? 1 : 0, st.doc.some(x => x.startsWith('trig-1:')) ? 1 : 0, st.project.some(x => x.startsWith('trig-1:')) ? 1 : 0];
    assert.deepStrictEqual(got, OUTCOMES[key], key);
    if (key === 'ON|OFF|V') assert.deepStrictEqual(st.user, ['trig-1:Edit:OFF@A'], 'the user log keeps a powered-OFF tombstone; the next clean-up (OFF|X|X) removes it');
  }));

  // ---- deleting -------------------------------------------------------------------------------------------------------------------------------
  test('agents: "Delete all agents in log" deletes EVERY pair of the user (all documents): the triggers and the pair list; log entries only where the document log of the current document knew them', () => {
    const w = sixDocs();
    const e = w.doc('E');
    e.run(`deleteAllAgents()`);
    const s = e.state();
    assert.deepStrictEqual(s.project, [], 'all ten triggers are gone, also those of other documents');
    assert.deepStrictEqual(s.pairs, []);
    assert.deepStrictEqual(s.doc, [], 'the log of this document is emptied');
    assert.strictEqual(s.user.length, 8, "the user log keeps the entries of the other documents' pairs (quirk)");
  });

  test('agents: every edit / change the agents run marks the trigger as used (lastUsed) in both logs when the run starts, and an unknown trigger id is simply not powered', () => {
    const w = world(), a = w.doc('A');
    click(a);
    a.p.advance(3600);
    a.run(`sheetEdit({ triggerUid: 'trig-1', range: { getSheet: () => ({ getName: () => 'S' }), getA1Notation: () => 'B2' } })`);
    const used = JSON.parse(a.p.props.document.docTriggerArray);
    assert.ok(Date.parse(used[0].lastUsed) > Date.parse(used[0].dateCreated), 'edit trigger marked');
    assert.strictEqual(used[1].lastUsed, used[1].dateCreated, 'change trigger not');
    assert.strictEqual(a.run(`StatusManager.checkTriggerPower('trig-1')`), true);
    assert.strictEqual(a.run(`StatusManager.checkTriggerPower('trig-999')`), false);
  });

  // ---- the detector's story and the trigger table, word for word ----------------------------------------------------------------------------------
  const detectorLines = d => d.log.filter(l => /^(SIMPLE|INSTALLABLE|SHARED)/.test(l)).map(l => l.replace(/\d+ ms/g, 'N ms').replace(/\d+ s ago/g, 'N s ago').replace(/after \d+ polls/, 'after N polls').replace(/Gave up after \d+ polls/, 'Gave up after N polls'));

  test('agents: the detector\'s log story for a working agent, a first miss, a second miss and a third (the words the live check and the user read)', () => {
    const w = world(), a = w.doc('A');
    click(a);
    a.run(`recordInstallableSeen(${EDIT})`);
    a.log.length = 0; a.run(`onEdit(${EDIT})`);
    const ok = detectorLines(a);
    a.log.length = 0; a.run(`onEdit(${EDIT})`);
    const first = detectorLines(a);
    a.log.length = 0; a.run(`onEdit(${EDIT})`);
    const second = detectorLines(a);
    a.log.length = 0; a.run(`onEdit(${EDIT})`);
    const third = detectorLines(a);
    if (process.env.PRINT_AGENT_GOLDEN) console.log('STORY=' + JSON.stringify({ ok, first, second, third }, null, 1));
    assert.deepStrictEqual({ ok, first, second, third }, STORY);
  });

  test('agents: the trigger table (rows of the "Wszystkie triggery" sidebar) - one row per trigger id of the three records, in the order document log, user log, project', () => {
    const w = world(), a = w.doc('A');
    click(a);
    w.doc('B'); click(w.doc('B'));
    const rows = a.run(`StatusManager.getAllProjectTriggers()`);
    const norm = JSON.parse(JSON.stringify(rows)).map(r => r.map(x => (typeof x === 'string' && /^20\d\d-/.test(x) ? 'DATE' : x)));
    if (process.env.PRINT_AGENT_GOLDEN) console.log('TABLE=' + JSON.stringify(norm));
    assert.deepStrictEqual(norm, TABLE);
  });

  // ---- the regroup: pure plan, one door, no UI / sheet in the service -------------------------------------------------------------------------
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const ROOT = path.join(__dirname, '..');
  const code = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

  test('AgentReconciler.plan: pure (loads alone, no platform), one entry per id in the order user log, document log, project; no row -> actions undefined', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'Agent Reconciler.js'), 'utf8') + ';globalThis.__R = AgentReconciler;', ctx);
    const plan = ctx.__R.plan(new Map([['u1', 'ON'], ['both', 'OFF']]), new Map([['d1', 'ON'], ['both', 'OFF']]), new Map([['s1', true], ['both', true], ['gap', true]]));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(plan.map(x => [x.itemId, x.key]))), [['u1', 'ON|X|X'], ['both', 'OFF|OFF|V'], ['d1', 'X|ON|X'], ['s1', 'X|X|V'], ['gap', 'X|X|V']]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(plan[1].actions)), { user: 'Remove', doc: 'Remove', script: 'Uninstall' });
    const every = ['ON', 'OFF', 'X'].flatMap(u => ['ON', 'OFF', 'X'].flatMap(d => ['V', 'X'].map(s => [u, d, s])));
    every.forEach(([u, d, s]) => {
      const plan1 = ctx.__R.plan(new Map(u === 'X' ? [] : [['g', u]]), new Map(d === 'X' ? [] : [['g', d]]), new Map(s === 'X' ? [] : [['g', true]]));
      if (plan1.length) assert.ok(plan1[0].actions, `a row for ${u}|${d}|${s}`);
    });
  });

  test('rule: the agent service files touch neither the spreadsheet nor the UI (the alert and the sidebars are StatusManager\'s, the edit event is only read)', () => {
    ['Agents.js', 'Agent Reconciler.js', 'Verify Agent.js', 'Trigger Manager.js', 'Track onEdit Triggers.js'].forEach(f => {
      const c = code(f);
      assert.ok(!/getUi\(|\.alert\(|showSidebar|showModal|HtmlService|openById|getSheetByName|getRange\(|setValue/.test(c), f);
    });
  });

  test('rule: only Trigger Manager.js (TriggerGateway) creates, deletes and lists triggers for the agents; the other ScriptApp callers are the time trigger and the settings sheet\'s raw triggers', () => {
    const users = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^(Live Check|Test Functions)/.test(f))
      .filter(f => /ScriptApp\.(newTrigger|deleteTrigger|getProjectTriggers|getUserTriggers)/.test(code(f))).sort();
    assert.deepStrictEqual(users, ['ScheduleRefresh.js', 'Settings Sheet.js', 'Trigger Manager.js']);
  });

  test('rule: outside the agent files nobody reaches into the registers or the pool - they ask Agents (Quick Start.js keeps the old global getters for the service itself)', () => {
    const inside = new Set(['Trigger Manager.js', 'Status Manager.js', 'Agents.js', 'Track onEdit Triggers.js', 'Verify Agent.js', 'Quick Start.js']);
    const offenders = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !inside.has(f) && !/^(Live Check|Test Functions)/.test(f))
      .filter(f => /getAgentManager|getDocumentTriggerLog|getUserTriggerLog|TriggerWrapper|TriggerGateway|StatusManager\.(basicStatusCheck|fullStatusCheck|forceRefresh|repairStatus|checkTriggerPower|powerOffAllAgentsInFile|logCleanUp|getAgentInfo)/.test(code(f)));
    assert.deepStrictEqual(offenders, []);
    ['Quick Start.js', 'Main Settings.js'].forEach(f => assert.ok(!/TriggerWrapper|TriggerGateway|StatusManager\.(basic|full|check|force|repair)/.test(code(f).replace(/function (getDocumentTriggerLog|getUserTriggerLog|getAgentManager)[\s\S]*?\n\}/g, '')), f));
  });

  test('rule: the old names still answer (forwarders): StatusManager.* and TriggerWrapper, and the old edit-check names', () => {
    const w = world(), a = w.doc('A');
    click(a);
    assert.strictEqual(a.run(`StatusManager.basicStatusCheck() && StatusManager.checkTriggerPower('trig-1') && typeof TriggerWrapper.createOnEditTrigger === 'function' && TriggerWrapper === TriggerGateway`), true);
    assert.strictEqual(a.run(`typeof checkInstallableAgentRan + typeof recordInstallableSeen`), 'functionfunction');
  });
};
