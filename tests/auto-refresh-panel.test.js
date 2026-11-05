// Tests of the "Auto-odświeżanie" tab of the configuration sidebar (Auto Refresh Panel.js): what it reads (the permit and the triggers of this user, the settings
// sheet), when its button is active, what a scheduled run records for it. Registered by tests/run.js.
// The real files run in a fresh scope on the fake services (tests/platform-fakes.js); the settings sheet object and the spreadsheet are faked.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { FakePlatform } = require('./platform-fakes');

const ROOT = path.join(__dirname, '..');
const BASE = ['Custom errors.js', 'Helper Data Store.js', 'Store.js', 'Settings.js', 'Main Settings.js', 'Controller.js', 'Trigger Manager.js',
  'Global Add-on Settings.js', 'Quick Start.js', 'functions.js', 'Track onEdit Triggers.js', 'Status Manager.js', 'Agent Reconciler.js', 'Agents.js', 'Verify Agent.js', 'Data Type.js', 'Menu.js', 'Settings Sheet.js',
  'Settings Grid.js', 'RefreshAll.js', 'Refresh Registry.js', 'ScheduleRefresh.js', 'Auto Refresh Panel.js'];

module.exports = function register(t) {
  const { test } = t;
  const plain = v => JSON.parse(JSON.stringify(v));
  const HOUR = 3600000;
  const NOW = Date.UTC(2026, 10, 2, 10, 0, 0);
  const NAMED = id => ({ id, fn: 'autoRefreshHandler', type: 'CLOCK', source: null, params: {} });

  /** cfg.permit: the stored refresh permit; cfg.sheet: what the (faked) settings sheet says, or null = no settings sheet */
  function scenario(cfg) {
    cfg = Object.assign({ permit: null, sheet: null, triggers: [] }, cfg);
    const p = new FakePlatform();
    p.props.document.importSettingsArray = JSON.stringify(Object.assign({ addonStatus: true, importSheetName: 'Ustawienia' }, cfg.permit ? { refreshPermit: cfg.permit } : {}));
    cfg.triggers.forEach(id => p.triggers.push(NAMED(id)));
    const log = [];
    const ex = p.execution(BASE, { __cfg: cfg, __log: log });
    ex.eval(`
      Agents.ensureActive = () => {};
      Utilities.formatDate = (d, tz, pat) => { const w = new Date(d.getTime() + 3600000).toISOString(); return pat === 'Z' ? '+0100' : pat === 'yyyy-MM-dd' ? w.slice(0, 10) : pat === 'HH:mm' ? w.slice(11, 16) : w.slice(0, 19).replace('T', ' '); };
      SpreadsheetApp.getActiveSpreadsheet = () => ({ getId: () => 'ss-1', getSpreadsheetTimeZone: () => 'Europe/Warsaw', getName: () => 'Faktury 2026', getUrl: () => 'https://docs.google.com/spreadsheets/d/ss-1/edit', getSheetByName: n => (__cfg.sheet && n === 'Ustawienia') ? { getSheetId: () => 7 } : null });
      getMainSettings = () => ({
        getRefreshFrequency: () => __cfg.sheet.freq, getRefreshStartAt: () => __cfg.sheet.at ?? null,
        getSheetListWithRefreshTrue: () => [{ configSheet: 'K1', resultSheet: 'Dane K1', refresh: true }, { configSheet: 'K3', resultSheet: 'Dane K3', refresh: true }],
        setLastRefresh() {}, setRefreshTrigger: () => __log.push(['setRefreshTrigger'])
      });
      RefreshAll.scheduled = () => { __log.push(['refreshed']); Date.now = (n => () => n += 27 * 60000 + 11000)(Date.now()); };`);
    return { p, ex, log, info: () => plain(ex.eval(`AutoRefreshPanel.info(new Date(${NOW}))`)), stored: () => JSON.parse(p.props.document.importSettingsArray),
      save: () => ex.eval(`getImportSettings().saveArray()`) };
  }
  const permit = (over) => Object.assign({ issuedFor: 't1', lastRefresh: NOW - 5 * HOUR, intervalHours: 24, nextRefresh: NOW + 7 * HOUR, startAt: '17:30' }, over);

  test('panel: the duration reads like "27 m 11 s"', () => {
    const sc = scenario();
    const d = ms => sc.ex.eval(`AutoRefreshPanel.duration(${ms})`);
    assert.strictEqual(d(5000), '5 s');
    assert.strictEqual(d(27 * 60000 + 11000), '27 m 11 s');
    assert.strictEqual(d(2 * HOUR + 3 * 60000 + 4000), '2 h 3 m 4 s');
    assert.strictEqual(d(HOUR + 2000), '1 h 0 m 2 s');
    assert.strictEqual(d(undefined), null);
  });

  test('panel: nothing set -> no current settings, no last run; no settings sheet -> the sheet part says so (and the sheet is not created)', () => {
    const i = scenario().info();
    assert.deepStrictEqual([i.current, i.last, i.sheet, i.zone, i.error], [null, null, { available: false }, 'UTC+1', false]);
  });

  test('panel: current = the trigger the permit names (it exists in this user\'s triggers): every, start time, next run in the sheet\'s zone', () => {
    const i = scenario({ permit: permit(), triggers: ['t1'] }).info();
    assert.deepStrictEqual(i.current, { foreign: false, every: '1 dzień', startAt: '17:30', next: '2026-11-02 18:00:00 UTC+1' });
    const h = scenario({ permit: permit({ intervalHours: 3, startAt: null, nextRefresh: NOW + HOUR }), triggers: ['t1'] }).info();
    assert.deepStrictEqual([h.current.every, h.current.startAt], ['3 h', null]);
  });

  test('panel: a permit whose trigger is not this user\'s: used lately -> shown as another user\'s (foreign); not used for a long time -> nothing', () => {
    const lately = scenario({ permit: permit({ lastRun: NOW - 2 * HOUR }), triggers: [] }).info();
    assert.strictEqual(lately.current.foreign, true);
    assert.strictEqual(lately.current.every, '1 dzień');
    const old = scenario({ permit: permit({ lastRefresh: NOW - 100 * HOUR, lastRun: NOW - 90 * HOUR }), triggers: [] }).info();
    assert.strictEqual(old.current, null);
  });

  test('panel: the next run of a stale estimate is rolled forward by the interval', () => {
    const i = scenario({ permit: permit({ nextRefresh: NOW - 30 * 60000, intervalHours: 3, startAt: null }), triggers: ['t1'] }).info();
    assert.strictEqual(i.current.next, '2026-11-02 13:30:00 UTC+1');           // 09:30 UTC + 3 h = 12:30 UTC = 13:30 in UTC+1
  });

  test('panel: the last run = time, duration and the result sheets recorded on the permit by a scheduled run', () => {
    const sc = scenario({ permit: permit({ issuedFor: 'trig-9', intervalHours: 6, startAt: null }), triggers: ['trig-9'] });
    sc.ex.eval(`autoRefreshHandler({ triggerUid: 'trig-9' })`);
    sc.save();
    const stored = sc.stored().refreshPermit;
    assert.strictEqual(stored.lastDurationMs, 27 * 60000 + 11000);
    assert.deepStrictEqual(stored.lastSheets, ['Dane K1', 'Dane K3']);
    const i = sc.info();
    assert.strictEqual(i.last.duration, '27 m 11 s');
    assert.deepStrictEqual(i.last.sheets, ['Dane K1', 'Dane K3']);
    assert.ok(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\+1$/.test(i.last.at));
  });

  test('panel: a retired trigger records nothing; a permit with no run has no "last" part', () => {
    const sc = scenario({ permit: permit(), triggers: ['t1', 'old'] });
    sc.ex.eval(`autoRefreshHandler({ triggerUid: 'old' })`);
    sc.save();
    assert.strictEqual(sc.stored().refreshPermit.lastRun, undefined);
    assert.strictEqual(sc.info().last, null);
  });

  test('panel: the button is active only when the settings sheet asks for something other than what is set', () => {
    const base = { permit: permit(), triggers: ['t1'] };
    const differs = sheet => scenario(Object.assign({ sheet }, base)).info().sheet;
    const same = differs({ freq: { freq: 1, unit: 'days' }, at: { hour: 17, minute: 30 } });
    assert.deepStrictEqual([same.available, same.differs, same.off, same.every, same.startAt], [true, false, false, '1 dzień', '17:30']);
    assert.strictEqual(differs({ freq: { freq: 2, unit: 'days' }, at: { hour: 17, minute: 30 } }).differs, true, 'other frequency');
    assert.strictEqual(differs({ freq: { freq: 24, unit: 'hrs' }, at: { hour: 17, minute: 30 } }).differs, false, '24 h is 1 day');
    assert.strictEqual(differs({ freq: { freq: 1, unit: 'days' }, at: { hour: 18, minute: 0 } }).differs, true, 'other time of day');
    assert.strictEqual(differs({ freq: { freq: 1, unit: 'days' }, at: null }).differs, true, 'time of day removed');
    const off = differs({ freq: { freq: '', unit: 'hrs' } });
    assert.deepStrictEqual([off.off, off.differs], [true, true], 'off in the sheet, still set up');
    const offAndOff = scenario({ sheet: { freq: { freq: '', unit: 'hrs' } } }).info().sheet;
    assert.deepStrictEqual([offAndOff.off, offAndOff.differs], [true, false], 'off in the sheet, nothing set up: nothing to change');
    const none = scenario({ sheet: { freq: { freq: 1, unit: 'days' } } }).info().sheet;
    assert.deepStrictEqual([none.differs, none.next.slice(0, 4)], [true, '2026'], 'something to set up');
  });

  test('panel: the button is an ordinary run that sets the trigger up from the sheet (job settings.refreshApply)', () => {
    const sc = scenario({ sheet: { freq: { freq: 1, unit: 'days' } } });
    sc.ex.eval(`globalThis.__jobs = []; Controller.intent = n => __jobs.push(n)`);
    sc.ex.eval(`applyRefreshSettings()`);
    assert.deepStrictEqual(plain(sc.log), [['setRefreshTrigger']]);
    assert.deepStrictEqual(plain(sc.ex.eval(`__jobs`)), ['settings.refreshApply']);
  });

  test('panel: info carries what current() looked at (permit, triggers, token) for the "Szczegóły techniczne" fold', () => {
    const d = scenario({ permit: permit({ issuedBy: 'me' }), triggers: ['t1', 'other'] }).info().diag;
    assert.deepStrictEqual([d.permitFor, d.named, d.off, d.hasToken, d.issuedByMe, d.triggers], ['t1', true, false, true, false, ['t1', 'other']]);
    assert.strictEqual(scenario().info().diag.permitFor, null);
  });

  test('schedule: the permit is saved by the set-up itself (the status message takes seconds; the sidebar polls the permit meanwhile)', () => {
    const sc = scenario({ permit: permit(), triggers: ['t1'], sheet: null });
    sc.ex.eval(`ScheduleRefresh.setUp({ freq: 2, unit: 'days' })`);
    assert.ok(sc.stored().refreshPermit.issuedFor !== 't1', 'stored without waiting for the closing actions');
    assert.strictEqual(sc.stored().refreshPermit.intervalHours, 48);
  });

  // ---- the list of the user's time triggers ("Arkusze, które odświeżasz automatycznie") ---------------------------------------------------------
  const rec = (over) => Object.assign({ docId: 'doc-A', docName: 'Zestawienie A', url: 'https://docs.google.com/spreadsheets/d/doc-A/edit', gid: 5, docTz: 'Europe/Warsaw', intervalHours: 24, startAt: '17:30',
    timeZone: 'Europe/Warsaw', setAt: NOW - 50 * HOUR, nextRefresh: NOW + 7 * HOUR, lastRun: NOW - 17 * HOUR, lastDurationMs: 454000, seenAt: NOW }, over);
  const setRecord = (sc, id, r) => { sc.p.props.user['refreshTrigger:' + id] = JSON.stringify(r); };
  const records = sc => Object.keys(sc.p.props.user).filter(k => k.startsWith('refreshTrigger:')).sort();
  const items = sc => sc.info().triggers.items;

  test('list: ALL clock triggers are listed - known ones by their record (document, link to its settings sheet, how often, last refresh), unknown ones with what the trigger itself says', () => {
    const sc = scenario({ permit: permit({ issuedFor: 'tHere' }), triggers: ['tHere', 'tA', 'tOld', 'tUnknown'] });
    sc.p.triggers.find(x => x.id === 'tOld').fn = 'autoRefresh';
    sc.p.triggers.push({ id: 'agent', fn: 'sheetEdit', type: 'ON_EDIT', source: 'ss-1', params: {} });
    setRecord(sc, 'tA', rec({}));
    setRecord(sc, 'tOld', rec({ docId: 'doc-B', docName: 'Archiwum', url: 'https://docs.google.com/spreadsheets/d/doc-B/edit', gid: undefined, intervalHours: 3, startAt: undefined, timeZone: undefined, lastRun: undefined, lastDurationMs: undefined }));
    const list = sc.info().triggers;
    assert.strictEqual(list.error, null);
    assert.deepStrictEqual(list.items.map(x => x.id), ['tOld', 'tHere', 'tA', 'tUnknown'], 'known ones by document name (the agent, an edit trigger, is not a clock trigger), unknown last');
    const by = Object.fromEntries(list.items.map(x => [x.id, x]));
    assert.deepStrictEqual(Object.keys(by).sort(), ['tA', 'tHere', 'tOld', 'tUnknown']);
    assert.deepStrictEqual([by.tA.name, by.tA.url, by.tA.every, by.tA.duration, by.tA.here], ['Zestawienie A', 'https://docs.google.com/spreadsheets/d/doc-A/edit#gid=5', '1 dzień o 17:30 (UTC+1)', '7 m 34 s', false]);
    assert.strictEqual(by.tA.last, '2026-11-01 18:00:00 UTC+1');
    assert.deepStrictEqual([by.tOld.name, by.tOld.url, by.tOld.every, by.tOld.last, by.tOld.handler], ['Archiwum', 'https://docs.google.com/spreadsheets/d/doc-B/edit', '3 h', null, 'autoRefresh']);
    assert.deepStrictEqual([by.tUnknown.known, by.tUnknown.name, by.tUnknown.every, by.tUnknown.last, by.tUnknown.handler], [false, null, null, null, 'autoRefreshHandler']);
    assert.strictEqual(by.tHere.here, true);
    assert.strictEqual(by.tHere.name, 'Faktury 2026', 'this document: the record made from the permit');
  });

  test('list: the trigger of this document made before the registry existed gets its record from the permit (document, interval, time of day, last run) and the other triggers stay unknown', () => {
    const sc = scenario({ permit: permit({ issuedFor: 'tHere', lastRun: NOW - HOUR, lastDurationMs: 61000, timeZone: 'Europe/Warsaw' }), triggers: ['tHere', 'tX'], sheet: { freq: { freq: 1, unit: 'days' } } });
    assert.deepStrictEqual(records(sc), []);
    const it = items(sc);
    assert.deepStrictEqual(it.map(x => [x.id, x.known]), [['tHere', true], ['tX', false]]);
    assert.deepStrictEqual([it[0].every, it[0].duration, it[0].url], ['1 dzień o 17:30 (UTC+1)', '1 m 1 s', 'https://docs.google.com/spreadsheets/d/ss-1/edit#gid=7']);
    assert.deepStrictEqual(records(sc), ['refreshTrigger:tHere'], 'kept for the next time (and for the other documents\' lists)');
    assert.strictEqual(JSON.parse(sc.p.props.user['refreshTrigger:tHere']).docName, 'Faktury 2026');
  });

  test('list: this document\'s trigger - the user\'s record is brought up to date from the document\'s permit when it differs (settings) or is older (last run); a current record is left alone; seenAt is kept', () => {
    const sc = scenario({ permit: permit({ issuedFor: 'tHere', intervalHours: 48, startAt: '9:15', timeZone: 'Europe/Warsaw', lastRun: NOW - HOUR, lastDurationMs: 5000, lastSheets: ['R1'] }), triggers: ['tHere'], sheet: { freq: { freq: 1, unit: 'days' } } });
    setRecord(sc, 'tHere', rec({ docName: 'Stara nazwa', intervalHours: 24, startAt: '17:30', lastRun: NOW - 40 * HOUR, seenAt: NOW - 5 * 60000 }));
    const it = items(sc)[0];
    assert.deepStrictEqual([it.name, it.every, it.duration], ['Faktury 2026', '2 dni o 9:15 (UTC+1)', '5 s'], 'the permit is where this document\'s trigger is true');
    const stored = JSON.parse(sc.p.props.user['refreshTrigger:tHere']);
    assert.deepStrictEqual([stored.intervalHours, stored.startAt, stored.lastRun, stored.seenAt], [48, '9:15', NOW - HOUR, NOW - 5 * 60000]);
    // a record that is as new as the permit is not rewritten
    const same = scenario({ permit: permit({ issuedFor: 'tHere', lastRun: NOW - HOUR }), triggers: ['tHere'] });
    setRecord(same, 'tHere', rec({ docName: 'Nazwa z rekordu', lastRun: NOW - HOUR, seenAt: NOW }));
    assert.strictEqual(items(same)[0].name, 'Nazwa z rekordu');
  });

  test('list: the permit of this document names a trigger that is not among the user\'s (set up by another user, used lately): it is listed from the document\'s data, marked foreign, and no record of it is made in the user\'s properties; a permit unused for long is not listed', () => {
    const sc = scenario({ permit: permit({ issuedFor: 'theirs', lastRun: NOW - 2 * HOUR, lastDurationMs: 90000, issuedBy: 'someone-else' }), triggers: ['mine'], sheet: { freq: { freq: 1, unit: 'days' } } });
    const list = items(sc);
    assert.deepStrictEqual(list.map(x => [x.id, x.foreign, x.known]), [['theirs', true, true], ['mine', false, false]]);
    assert.deepStrictEqual([list[0].name, list[0].every, list[0].duration, list[0].here, list[0].handler], ['Faktury 2026', '1 dzień o 17:30', '1 m 30 s', true, null]);
    assert.ok(!records(sc).includes('refreshTrigger:theirs'));
    const old = scenario({ permit: permit({ issuedFor: 'theirs', lastRefresh: NOW - 100 * HOUR, lastRun: NOW - 90 * HOUR, issuedBy: 'someone-else' }), triggers: ['mine'] });
    assert.deepStrictEqual(items(old).map(x => x.id), ['mine']);
    const off = scenario({ permit: permit({ issuedFor: 'theirs', lastRun: NOW - HOUR, off: true }), triggers: [] });
    assert.deepStrictEqual(items(off), []);
  });

  test('list: a record whose trigger is not there is not listed (a record never makes a trigger exist); it is dropped after a week unseen, kept before', () => {
    const sc = scenario({ triggers: ['tA'] });
    setRecord(sc, 'tA', rec({}));
    setRecord(sc, 'tGone', rec({ docName: 'Usunięty', seenAt: NOW - 2 * 24 * HOUR }));
    setRecord(sc, 'tLong', rec({ docName: 'Dawno', seenAt: NOW - 9 * 24 * HOUR }));
    assert.deepStrictEqual(items(sc).map(x => x.id), ['tA']);
    assert.deepStrictEqual(records(sc), ['refreshTrigger:tA', 'refreshTrigger:tGone'], 'only the one unseen for more than a week is dropped');
  });

  test('list: seenAt is renewed at most once an hour (no write per opening of the tab)', () => {
    const sc = scenario({ triggers: ['tA'] });
    setRecord(sc, 'tA', rec({ seenAt: NOW - 10 * 60000 }));
    const before = sc.p.calls.length;
    sc.info();
    assert.ok(!sc.p.calls.slice(before).some(c => /properties\.set user refreshTrigger:tA/.test(c)));
    setRecord(sc, 'tA', rec({ seenAt: NOW - 2 * HOUR }));
    sc.info();
    assert.strictEqual(JSON.parse(sc.p.props.user['refreshTrigger:tA']).seenAt, NOW);
  });

  test('list: only a Google spreadsheet address becomes a link; the name is plain text otherwise; the list works when the registry cannot be read', () => {
    const sc = scenario({ triggers: ['tA', 'tB'] });
    setRecord(sc, 'tA', rec({ url: 'javascript:alert(1)' }));
    setRecord(sc, 'tB', rec({ docName: 'B', url: 'https://evil.example/spreadsheets/d/x' }));
    assert.deepStrictEqual(items(sc).map(x => x.url), [null, null]);
    const broken = scenario({ triggers: ['tA'] });
    broken.p.props.user['refreshTrigger:tA'] = '{not json';
    assert.deepStrictEqual(items(broken).map(x => [x.id, x.known]), [['tA', false]]);
  });

  test('registry: a set-up writes the record of the new trigger (document, interval, time of day, zone, next run) and removes the record of the replaced one; switching off removes it; a retiring trigger removes its own', () => {
    const sc = scenario({ permit: permit({ issuedFor: 'old' }), triggers: ['old'] });
    setRecord(sc, 'old', rec({}));
    sc.ex.eval(`ScheduleRefresh.setUp({ freq: 2, unit: 'days' }, { hour: 9, minute: 15, timeZone: 'Europe/Warsaw' })`);
    assert.deepStrictEqual(records(sc), ['refreshTrigger:trig-1']);
    const r = JSON.parse(sc.p.props.user['refreshTrigger:trig-1']);
    assert.deepStrictEqual([r.docName, r.url, r.gid, r.intervalHours, r.startAt, r.timeZone, typeof r.setAt, typeof r.nextRefresh], ['Faktury 2026', 'https://docs.google.com/spreadsheets/d/ss-1/edit', undefined, 48, '9:15', 'Europe/Warsaw', 'number', 'number']);
    sc.save();
    sc.ex.eval(`ScheduleRefresh.setUp({ freq: '', unit: 'days' })`);
    assert.deepStrictEqual(records(sc), [], 'off');
    const retire = scenario({ permit: permit({ issuedFor: 'other' }), triggers: ['mine'] });
    setRecord(retire, 'mine', rec({}));
    retire.ex.eval(`autoRefreshHandler({ triggerUid: 'mine' })`);
    assert.deepStrictEqual(records(retire), []);
  });

  test('registry: a scheduled run puts its time, duration, sheets and the next planned run on the record (and the record is made from the permit if there was none)', () => {
    const planned = Date.now() - 60000;
    const sc = scenario({ permit: permit({ issuedFor: 'trig-9', intervalHours: 24, nextRefresh: planned, startAt: '17:30' }), triggers: ['trig-9'] });
    sc.ex.eval(`autoRefreshHandler({ triggerUid: 'trig-9' })`);
    const r = JSON.parse(sc.p.props.user['refreshTrigger:trig-9']);
    assert.deepStrictEqual([r.docName, r.intervalHours, r.startAt, r.lastDurationMs, r.lastSheets, r.nextRefresh, typeof r.lastRun], ['Faktury 2026', 24, '17:30', 27 * 60000 + 11000, ['Dane K1', 'Dane K3'], planned + 24 * HOUR, 'number']);
  });

  test('registry: a failing registry never fails a set-up or a run', () => {
    const sc = scenario({ permit: permit({ issuedFor: 'trig-9' }), triggers: ['trig-9'] });
    sc.ex.eval(`RefreshRegistry.register = () => { throw new Error('props down'); }; RefreshRegistry.touch = () => { throw new Error('props down'); }; RefreshRegistry.remove = () => { throw new Error('props down'); };`);
    sc.ex.eval(`autoRefreshHandler({ triggerUid: 'trig-9' })`);
    sc.ex.eval(`ScheduleRefresh.setUp({ freq: 2, unit: 'days' })`);
    assert.strictEqual(sc.p.triggers.length, 1);
  });

  test('page: the order of the tab - current settings (with the button to change them, no header of its own), the last refresh, the list of triggers, the zone, and the technical details at the very bottom', () => {
    const html = fs.readFileSync(path.join(ROOT, 'New Status Sidebar.html'), 'utf8');
    const body = html.slice(html.indexOf('function showRefreshInfo(info)'), html.indexOf('function renderTriggerList'));
    const at = t => { const i = body.indexOf(t); assert.ok(i >= 0, t); return i; };
    const order = ['Aktualne ustawienia:', 'id="applyRefreshBtn"', 'id="applyRefreshError"', 'Ostatnio odświeżone:', 'Arkusze, które odświeżasz automatycznie:', 'Strefa czasowa:', 'Szczegóły techniczne'].map(at);
    assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
    assert.ok(!/Zmień ustawienia/.test(html), 'no separate header for changing the settings');
  });

  test('page: the section "Arkusze, które odświeżasz automatycznie:" shows the document as a link in a new tab, under it how often and the last refresh; everything is escaped', () => {
    const html = fs.readFileSync(path.join(ROOT, 'New Status Sidebar.html'), 'utf8');
    assert.ok(/Arkusze, które odświeżasz automatycznie:/.test(html) && /renderTriggerList\(info\.triggers\)/.test(html));
    assert.ok(/'<a href="' \+ escapeHtml\(t\.url\) \+ '" target="_blank" rel="noopener">'/.test(html));
    assert.ok(/Odświeżanie co: /.test(html) && /Ostatnio odświeżone: /.test(html));
    assert.ok(/Trigger innego użytkownika \(dane z dokumentu\)/.test(html));
    assert.ok(/escapeHtml\(t\.id\)/.test(html) && /escapeHtml\(t\.handler\)/.test(html) && /escapeHtml\(t\.name\)/.test(html));
  });

  test('panel: reading it never writes (no permit saved, no trigger changed)', () => {
    const sc = scenario({ permit: permit(), triggers: ['t1'], sheet: { freq: { freq: 2, unit: 'days' } } });
    const before = JSON.stringify([sc.p.props.document, sc.p.triggers]);
    sc.info(); sc.info();
    sc.save();
    assert.strictEqual(JSON.stringify([sc.p.props.document, sc.p.triggers]), before);
  });

  test('page: the tab "Auto-odświeżanie" reads when it is opened, on the refresh button and after applying; no polling; only the latest answer is shown; the apply button is disabled when nothing differs', () => {
    const html = fs.readFileSync(path.join(ROOT, 'New Status Sidebar.html'), 'utf8');
    assert.ok(/data-tab="refresh" onclick="selectTab\('refresh'\)">Auto-odświeżanie</.test(html));
    assert.ok(/if \(tabId === 'refresh'\) loadRefreshInfo\(\);/.test(html), 'on opening the tab');
    assert.ok(/id="reloadRefreshBtn" onclick="loadRefreshInfo\(\)"/.test(html), 'the refresh button');
    assert.ok(/withSuccessHandler\(function \(\) \{ loadRefreshInfo\(\); \}\)/.test(html), 'after applying');
    assert.ok(/var id = \+\+refreshLoadId;/.test(html) && /if \(id === refreshLoadId\) showRefreshInfo\(info\)/.test(html), 'an older answer is dropped');
    assert.ok(!/setInterval|REFRESH_POLL|refreshPoll/.test(html), 'no polling');
    assert.ok(/\(sh\.differs \? '' : ' disabled'\)/.test(html));
    assert.ok(/Odświeżanie ustawione przez innego użytkownika - poniższe informacje mogą zawierać błędy\./.test(html));
    assert.ok(!/escapeHtml\(info\.last\.sheets/.test(html) && /escapeHtml\(n\)/.test(html), 'sheet names are escaped');
  });
};
