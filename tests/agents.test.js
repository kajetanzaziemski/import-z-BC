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
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Settings Sheet.js'];

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
      const d = { id, p, alerts: 0 };
      const ss = { getId: () => id, getSheetByName: () => null, getUrl: () => 'url-' + id, getName: () => 'name-' + id };
      d.run = (code, more) => {
        const ex = p.execution(files, Object.assign({
          __p: p, __d: d,
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
    'ON|OFF|V': [1, 1, 1]                                                  // quirk: the one combination the table has no row for - nothing happens
  };
  Object.keys(OUTCOMES).forEach(key => test(`agents: clean-up of one item in the state user|doc|script = ${key}${key === 'ON|OFF|V' ? ' (quirk: no rule, nothing happens)' : ''}`, () => {
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
};
