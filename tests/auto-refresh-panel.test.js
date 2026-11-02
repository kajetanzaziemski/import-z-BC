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
  'Settings Grid.js', 'RefreshAll.js', 'ScheduleRefresh.js', 'Auto Refresh Panel.js'];

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
      SpreadsheetApp.getActiveSpreadsheet = () => ({ getId: () => 'ss-1', getSpreadsheetTimeZone: () => 'Europe/Warsaw', getSheetByName: n => (__cfg.sheet && n === 'Ustawienia') ? {} : null });
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

  test('panel: reading it never writes (no permit saved, no trigger changed)', () => {
    const sc = scenario({ permit: permit(), triggers: ['t1'], sheet: { freq: { freq: 2, unit: 'days' } } });
    const before = JSON.stringify([sc.p.props.document, sc.p.triggers]);
    sc.info(); sc.info();
    sc.save();
    assert.strictEqual(JSON.stringify([sc.p.props.document, sc.p.triggers]), before);
  });

  test('page: the tab "Auto-odświeżanie" polls getAutoRefreshInfo only while it is open, one call at a time, and the button is disabled when nothing differs', () => {
    const html = fs.readFileSync(path.join(ROOT, 'New Status Sidebar.html'), 'utf8');
    assert.ok(/data-tab="refresh" onclick="selectTab\('refresh'\)">Auto-odświeżanie</.test(html));
    assert.ok(/if \(tabId === 'refresh'\) startRefreshPolling\(\); else stopRefreshPolling\(\);/.test(html));
    assert.ok(/withSuccessHandler\(function \(info\) \{ if \(gen !== refreshPollGen\) return; showRefreshInfo\(info\); scheduleRefreshPoll\(gen\); \}\)/.test(html), 'the next call waits for the answer; an answer to a call made before a restart is dropped (no second chain of calls)');
    assert.ok(/function stopRefreshPolling\(\) \{\s*refreshPollOn = false;\s*refreshPollGen\+\+;/.test(html) && /refreshPollOn = true;\s*refreshPollGen\+\+;/.test(html));
    assert.ok(/REFRESH_POLL_MS = 2000/.test(html));
    assert.ok(/\(sh\.differs \? '' : ' disabled'\)/.test(html));
    assert.ok(/Odświeżanie ustawione przez innego użytkownika - poniższe informacje mogą zawierać błędy\./.test(html));
    assert.ok(!/escapeHtml\(info\.last\.sheets/.test(html) && /escapeHtml\(n\)/.test(html), 'sheet names are escaped');
  });
};
