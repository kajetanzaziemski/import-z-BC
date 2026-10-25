// Tests of what the two installable triggers (sheetEdit / sheetChange, "the agent") make of an event: which action fires for which edit.
// Registered by tests/run.js.
//
// Real: Quick Start.js (entry points), Controller, the trigger logs / power check, Settings / Store, and (once they exist) Router.js / AnalyseConfig.js.
// Faked (recording): the settings sheet object (getMainSettings) and the config sheet coeditor (SheetCoeditor).
// Written FIRST against the old code (characterisation); the router extraction must keep all of it green.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const BASE = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Data Type.js', 'Menu.js', 'Settings Sheet.js'];
const NEW_FILES = ['Import Query.js', 'ResultSheet.js', 'RefreshSheet.js', 'EstimateSheet.js', 'RefreshAll.js', 'ScheduleRefresh.js', 'AnalyseConfig.js', 'Router.js']
  .filter(f => fs.existsSync(path.join(ROOT, f)));

const FAKES = `
  globalThis.SheetCoeditor = class {
    constructor(name, readingActive) { __log.push(['coed.new', name, !!readingActive]); this.name = name; }
    sheetEdit(e) { __log.push(['coed.sheetEdit', e === undefined ? 'no event' : (e === __event ? 'the event' : 'another event')]); if (__cfg.coeditError) throw new Error(__cfg.coeditError); }
    switchReadingControl(a) { __log.push(['reading', a]); }
  };
  getMainSettings = () => {
    __settingsCalls.n++;
    return {
      isConfigSheet: name => __cfg.configSheets.includes(name),
      isRefreshFrequencyCell: range => !!__cfg.freqCell,
      sheetEdit: e => { if (__cfg.freqCell) __log.push(['setRefreshTrigger']); },
      setRefreshTrigger: () => __log.push(['setRefreshTrigger'])
    };
  };
`;

module.exports = function register(t) {
  const { test } = t;
  const FILES = [...BASE, ...NEW_FILES];
  const plain = v => JSON.parse(JSON.stringify(v));

  /** A fresh execution with the add-on ON, a logged trigger "t1" (power on / off) and the faked settings sheet / coeditor. */
  function scenario(over) {
    const cfg = Object.assign({ active: 'Konfiguracja 1', configSheets: ['Konfiguracja 1'], settingsSheet: 'Ustawienia', power: true, freqCell: false, changeType: 'INSERT_ROW' }, over || {});
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify({ addonStatus: true, importSheetName: cfg.settingsSheet });
    p.props.document.docTriggerArray = JSON.stringify([{ triggerId: 't1', trigEventType: 'ON_EDIT', trigFunction: 'sheetEdit', dateCreated: '2020-01-01', lastUsed: '2020-01-01', SsId: 'ss-1', powerOn: cfg.power }]);
    const log = [], settingsCalls = { n: 0 };
    const event = { triggerUid: 't1', changeType: cfg.changeType, range: { getSheet: () => ({ getName: () => cfg.rangeSheet || cfg.active }), getA1Notation: () => 'B2', getRow: () => 2, getColumn: () => 2 },
      source: { getActiveSheet: () => ({ getName: () => cfg.active }) } };
    const ex = p.execution(FILES, { __cfg: cfg, __log: log, __event: event, __settingsCalls: settingsCalls });
    ex.eval(`StatusManager.fullStatusCheck = () => {}`);
    ex.eval(FAKES);
    return { p, ex, log, cfg, event, settingsCalls, calls: () => plain(log),
      edit: () => { ex.ctx.e = event; return ex.eval(`sheetEdit(e)`); },
      change: () => { ex.ctx.e = event; return ex.eval(`sheetChange(e)`); } };
  }
  const lastUse = sc => JSON.parse(sc.p.props.document.docTriggerArray)[0].lastUsed;

  // ---- sheetEdit: what an edit does, by the sheet it happened in -------------------------------------------------------------------------
  test('edit: in a config sheet -> the co-editing of that sheet (reading lit, the event handed over, under the "<sheet>_coedit" lock flag, reading idle)', () => {
    const sc = scenario();
    sc.edit();
    assert.deepStrictEqual(sc.calls(), [['coed.new', 'Konfiguracja 1', true], ['coed.sheetEdit', 'the event'], ['reading', false]]);
    assert.strictEqual(sc.p.props.document['Konfiguracja 1_coedit'], 'no', 'runFunctionWithLock leaves its flag');
  });

  test('edit: in the settings sheet on the refresh frequency -> the time trigger is set; nothing else happens', () => {
    const sc = scenario({ active: 'Ustawienia', freqCell: true });
    sc.edit();
    assert.deepStrictEqual(sc.calls(), [['setRefreshTrigger']]);
  });

  test('edit: in the settings sheet anywhere else -> nothing happens', () => {
    const sc = scenario({ active: 'Ustawienia', freqCell: false });
    sc.edit();
    assert.deepStrictEqual(sc.calls(), []);
  });

  test('edit: in any other sheet -> nothing happens (the settings sheet object is still built: bugs-todo #10)', () => {
    const sc = scenario({ active: 'Arkusz1' });
    sc.edit();
    assert.deepStrictEqual(sc.calls(), []);
    assert.ok(sc.settingsCalls.n >= 1);
  });

  test('edit: the sheet is the ACTIVE sheet, not the one of the edited range (quirk kept)', () => {
    const sc = scenario({ active: 'Konfiguracja 1', rangeSheet: 'Arkusz1' });
    sc.edit();
    assert.deepStrictEqual(sc.calls().map(c => c[0]), ['coed.new', 'coed.sheetEdit', 'reading']);
  });

  test('edit: a failing co-edit puts the reading cell back to idle and gives the error back', () => {
    const sc = scenario({ coeditError: 'dropdowns failed' });
    assert.throws(() => sc.edit(), /dropdowns failed/);
    assert.deepStrictEqual(sc.calls().filter(c => c[0] === 'reading'), [['reading', false]]);
  });

  test('edit: a trigger that is powered OFF does nothing (the edit is still recorded for the simple trigger) - whatever sheet was edited', () => {
    const sc = scenario({ power: false });
    sc.edit();
    assert.deepStrictEqual(sc.calls(), []);
    assert.strictEqual(sc.p.cache.document['edit:Konfiguracja 1!B2instalTraceKey_'].value, '1', 'recorded for the simple trigger');
    const st = scenario({ power: false, active: 'Ustawienia', freqCell: true });
    st.edit();
    assert.deepStrictEqual(st.calls(), []);
  });

  test('edit: every edit records "the installable trigger ran" for the simple trigger, powered or not', () => {
    const sc = scenario({ active: 'Arkusz1' });
    sc.edit();
    assert.strictEqual(sc.p.cache.document['edit:Arkusz1!B2instalTraceKey_'].value, '1');
  });

  // ---- sheetChange: structure changes ---------------------------------------------------------------------------------------------------
  test('change: EDIT and FORMAT changes are ignored (the settings sheet object is not even built)', () => {
    ['EDIT', 'FORMAT'].forEach(type => {
      const sc = scenario({ changeType: type });
      sc.change();
      assert.deepStrictEqual(sc.calls(), [], type);
      assert.strictEqual(sc.settingsCalls.n, 0, type + ': no settings access');
    });
  });

  test('change: a structure change (row inserted, sheet added ...) while a config sheet is active -> co-editing WITHOUT an event', () => {
    ['INSERT_ROW', 'REMOVE_ROW', 'INSERT_COLUMN', 'INSERT_GRID', 'OTHER'].forEach(type => {
      const sc = scenario({ changeType: type });
      sc.change();
      assert.deepStrictEqual(sc.calls(), [['coed.new', 'Konfiguracja 1', true], ['coed.sheetEdit', 'no event'], ['reading', false]], type);
    });
  });

  test('change: a structure change while any other sheet (also the settings sheet) is active -> nothing happens', () => {
    ['Arkusz1', 'Ustawienia'].forEach(active => {
      const sc = scenario({ active, freqCell: true });
      sc.change();
      assert.deepStrictEqual(sc.calls(), [], active);
    });
  });

  test('change: KNOWN QUIRK pinned - the action runs BEFORE the power check, so a powered-OFF trigger still co-edits (bugs-todo / trigger-management #5)', () => {
    const sc = scenario({ power: false });
    sc.change();
    assert.deepStrictEqual(sc.calls().map(c => c[0]), ['coed.new', 'coed.sheetEdit', 'reading']);
  });

  test('change: the use of the trigger is logged (lastUsed moves) and a failing co-edit idles the reading cell and gives the error back', () => {
    const sc = scenario({ coeditError: 'boom' });
    const before = lastUse(sc);
    assert.throws(() => sc.change(), /boom/);
    assert.deepStrictEqual(sc.calls().filter(c => c[0] === 'reading'), [['reading', false]]);
    sc.ex.eval(`getDocumentTriggerLog()`);                  // saved when the run closed
    assert.notStrictEqual(JSON.parse(sc.p.props.document.docTriggerArray)[0].lastUsed, before);
  });

  // ---- the technical names the live check knows -------------------------------------------------------------------------------------------
  test('entry points: they keep the action names "sheetEditAction" / "sheetChangeAction" and the global functions of the same names', () => {
    const text = fs.readFileSync(path.join(ROOT, 'Quick Start.js'), 'utf8');
    assert.ok(/Controller\.run\("sheetEditAction"/.test(text) && /Controller\.run\("sheetChangeAction"/.test(text));
    assert.ok(/function sheetEditAction\(e\)/.test(text) && /function sheetChangeAction\(e\)/.test(text));
  });

  // ---- the router itself: what each event means (the jobs), announced before the action runs ---------------------------------------------------
  const route = (sc, kind) => { sc.ex.ctx.e = sc.event; return plain(sc.ex.eval(kind === 'edit' ? `Router.routeEdit(e)` : `Router.routeChange(e)`)); };
  const withIntentLog = sc => { sc.ex.ctx.liveCheckIntent = (n, d) => sc.log.push(['intent', n, d]); return sc; };

  test('router: an EDIT means ... config sheet -> config.coedit, settings sheet -> refresh frequency or plain settings edit, anything else -> sheet.ignored', () => {
    const r = (over, kind) => { const x = route(scenario(over), kind || 'edit'); return [x.intent, x.sheet]; };
    assert.deepStrictEqual(r({}), ['config.coedit', 'Konfiguracja 1']);
    assert.deepStrictEqual(r({ active: 'Ustawienia', freqCell: true }), ['settings.refreshFrequency', 'Ustawienia']);
    assert.deepStrictEqual(r({ active: 'Ustawienia', freqCell: false }), ['settings.edit', 'Ustawienia']);
    assert.deepStrictEqual(r({ active: 'Arkusz1' }), ['sheet.ignored', 'Arkusz1']);
    assert.deepStrictEqual(r({ active: 'Dane wg. 1' }), ['sheet.ignored', 'Dane wg. 1'], 'a result sheet is not a config sheet');
  });

  test('router: a CHANGE means ... EDIT / FORMAT -> change.ignored; a structure change -> config.coedit on a config sheet, sheet.ignored elsewhere (also in the settings sheet)', () => {
    const r = (over) => { const x = route(scenario(over), 'change'); return [x.intent, x.sheet === undefined ? null : x.sheet, x.changeType]; };
    assert.deepStrictEqual(r({ changeType: 'EDIT' }), ['change.ignored', null, 'EDIT']);
    assert.deepStrictEqual(r({ changeType: 'FORMAT' }), ['change.ignored', null, 'FORMAT']);
    assert.deepStrictEqual(r({ changeType: 'INSERT_ROW' }), ['config.coedit', 'Konfiguracja 1', 'INSERT_ROW']);
    assert.deepStrictEqual(r({ changeType: 'INSERT_GRID', active: 'Arkusz1' }), ['sheet.ignored', 'Arkusz1', 'INSERT_GRID']);
    assert.deepStrictEqual(r({ changeType: 'REMOVE_ROW', active: 'Ustawienia', freqCell: true }), ['sheet.ignored', 'Ustawienia', 'REMOVE_ROW']);
  });

  test('router: routing only LOOKS - no action runs and no intent is announced until perform()', () => {
    const sc = withIntentLog(scenario());
    route(sc, 'edit');
    assert.deepStrictEqual(sc.calls(), []);
  });

  test('router: the intent is announced BEFORE the action, with the sheet and the change type', () => {
    const sc = withIntentLog(scenario());
    sc.edit();
    assert.deepStrictEqual(sc.calls().slice(0, 2), [['intent', 'config.coedit', { sheet: 'Konfiguracja 1', changeType: null }], ['coed.new', 'Konfiguracja 1', true]]);
    const st = withIntentLog(scenario({ active: 'Ustawienia', freqCell: true }));
    st.edit();
    assert.deepStrictEqual(st.calls(), [['intent', 'settings.refreshFrequency', { sheet: 'Ustawienia', changeType: null }], ['setRefreshTrigger']]);
    const ch = withIntentLog(scenario({ changeType: 'INSERT_ROW' }));
    ch.change();
    assert.deepStrictEqual(ch.calls()[0], ['intent', 'config.coedit', { sheet: 'Konfiguracja 1', changeType: 'INSERT_ROW' }]);
  });

  test('router: every kind of event announces its job (sheet.ignored, settings.edit, change.ignored, agent.skipped included)', () => {
    const intents = (over, kind) => { const sc = withIntentLog(scenario(over)); sc[kind](); return sc.calls().filter(c => c[0] === 'intent').map(c => c[1]); };
    assert.deepStrictEqual(intents({ active: 'Arkusz1' }, 'edit'), ['sheet.ignored']);
    assert.deepStrictEqual(intents({ active: 'Ustawienia' }, 'edit'), ['settings.edit']);
    assert.deepStrictEqual(intents({ changeType: 'FORMAT' }, 'change'), ['change.ignored']);
    assert.deepStrictEqual(intents({ power: false }, 'edit'), ['agent.skipped']);
    assert.deepStrictEqual(intents({ active: 'Arkusz1', changeType: 'INSERT_GRID' }, 'change'), ['sheet.ignored']);
  });

  test('router: a failing action still has its job announced first (the live check labels the failed run correctly)', () => {
    const sc = withIntentLog(scenario({ coeditError: 'boom' }));
    assert.throws(() => sc.edit(), /boom/);
    assert.strictEqual(sc.calls()[0][0], 'intent');
  });

  // ---- rules ---------------------------------------------------------------------------------------------------------------------------------
  const code = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

  test('rule: the entry points only hand over to the router (sheetEditAction / sheetChangeAction are one-liners, no edit logic left in Quick Start.js)', () => {
    const q = code('Quick Start.js');
    assert.ok(/function sheetEditAction\(e\)\{\s*Router\.edit\(e\);[^\n]*\s*\}/.test(q));
    assert.ok(/function sheetChangeAction\(e\)\{\s*dbgLog\(e\.changeType\);\s*Router\.change\(e\);\s*\}/.test(q));
    assert.ok(!/getMainSettings\(\)\.sheetEdit\(|e\.changeType==/.test(q));
    assert.ok(/function updateAfterEdit\(sheetName,editEvent\)\{\s*if\(getMainSettings\(\)\.isConfigSheet\(sheetName\)\) AnalyseConfig\.run\(sheetName,editEvent\);\s*\}/.test(q));
  });

  test('rule: only AnalyseConfig builds the co-editor for an edit (the coedit flag "<sheet>_coedit" lives there), Router has no sheet access', () => {
    assert.ok(/runFunctionWithLock\(\(\) => shCoed\.sheetEdit\(editEvent\),sheetName\+"_coedit"\)/.test(code('AnalyseConfig.js')));
    assert.ok(!/_coedit/.test(code('Quick Start.js')));
    assert.ok(!/SpreadsheetApp|getRange|SheetCoeditor/.test(code('Router.js')));
    assert.ok(!/SpreadsheetApp|getRange/.test(code('AnalyseConfig.js')));
  });

  test('rule: the new files load alone, in any order (nothing is used at load time)', () => {
    const vm = require('vm');
    ['Router.js', 'AnalyseConfig.js'].forEach(f => vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), {}));
  });
};
