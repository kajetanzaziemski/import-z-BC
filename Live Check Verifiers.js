/**
 * Live check helpers - the expectations.
 *
 * One verifier per entry point (see LIVE_CHECK_ENTRY_POINTS in "Live Check.js"). A verifier gets a LiveCheckContext `c`
 * once the entry point and its closing actions are done and compares the outcome with what the current code is meant to
 * produce. The expected values (formats, dropdown lists, property names, header layout) are deliberately written down
 * again here instead of being read from the code under test.
 *
 * Rules for the verifiers:
 *  - crude, not exhaustive: check that the thing happened and has the right shape, not that every value is right;
 *  - never call Business Central (no ODataConnection, no metadata download, no token refresh). Whatever the metadata cache
 *    holds may be used, a missing cache entry means the check is skipped;
 *  - long calculations (refresh) are judged by their outcome only: sheet exists, size matches the stored estimate,
 *    column formats are uniform / right for the cached data types, activity indicators are back to idle;
 *  - FAIL = the add-on did not do what it should. WARN = suspicious, or tied to a defect listed in
 *    docs/trigger-management-todo.md. SKIP = cannot be checked in this context.
 */

// - - - - - - - - expected values (copied from the code as it is now) - - - - - - - -

const LC_QUERY_OPTIONS = ["select","filter","filterLogic","orderBy","limit"];
const LC_OPERATORS = ["<",">","=","<>","<=",">=","endswith","startswith","contains"];
const LC_FILTER_LOGICS = ["AND","OR"];
const LC_SORTING_ORDERS = ["asc","desc"];
const LC_EMPTY_LIST_NOTE = 'Pusta lista może wynikać z braku połączenia z BC. Spróbuj nawiązać połączenie i wywołaj opcję "Analizuj zapytanie" dla tego arkusza';
const LC_IDLE_BACKGROUND = "#cccccc";
const LC_IDLE_FONT = "#999999";
const LC_SETTINGS_SIGNATURES = ["Opis linii","headerSheetList"];   // B2 of a genuine settings sheet
const LC_LIMIT_AGENT_SETS = 5;

// Data type -> number format written to the result sheet.
const LC_FORMATS = {
  "Edm.Guid": "@", "Edm.Int64": "#", "Edm.String": "@", "Edm.Stream": "General", "Edm.Int32": "#",
  "Edm.DateTimeOffset": "yyyy-mm-dd hh:mm", "Edm.Boolean": "General", "Edm.Decimal": "#,##0.00", "Edm.Date": "yyyy-mm-dd"
};

// Layout of a freshly created config sheet, rows 1-4, columns A-G.
const LC_CONFIG_HEADER = {
  values: [["","Zapytanie do bazy danych BC","","","","",""],["","Analiza zapytania","Pobieranie z bazy danych","Wstawianie danych do arkusza","Szacowana liczba wierszy:","",""],["","Linie zapytania","Kolejne składowe linii zapytania","","","",""],["","Opis linii",1,2,3,4,""]],
  backgrounds: [["#cccccc","#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"],["#cccccc","#cccccc","#cccccc","#cccccc","#cccccc","#cccccc","#cccccc"],["#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"],["#cccccc","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#cccccc"]],
  fontWeights: [["normal","bold","normal","normal","normal","normal","normal"],["normal","normal","normal","normal","normal","normal","normal"],["normal","bold","bold","normal","normal","normal","normal"],["normal","bold","bold","bold","bold","bold","normal"]],
  merges: ["B1:F1","C3:F3"]
};

const LC_KNOWN_NESTED_RUN = "known issue: nested Controller.run (docs/trigger-management-todo.md)";
const LC_KNOWN_UNLOGGED_TRIGGERS = "known issue: SettingsSheet creates unlogged triggers (docs/trigger-management-todo.md #6)";
const LC_KNOWN_LOST_UPDATES = "known issue: whole-snapshot saves of trigger logs (docs/trigger-management-todo.md #1)";

// - - - - - - - - readers (independent of the add-on's own classes) - - - - - - - -

function lcImportSettings_(){
  return JSON.parse(PropertiesService.getDocumentProperties().getProperty("importSettingsArray") || "{}");
}

function lcDocLog_(){
  return JSON.parse(PropertiesService.getDocumentProperties().getProperty("docTriggerArray") || "[]");
}

function lcUserLog_(){
  return JSON.parse(PropertiesService.getUserProperties().getProperty("usrTriggerArray") || "[]");
}

/** Same rule as AgentManager.checkIfActive(): a powered-on edit trigger and a powered-on change trigger are logged. */
function lcAgentsActive_(log){
  const on = fn => log.some(t => t.trigFunction === fn && t.powerOn === true);
  return on("sheetEdit") && on("sheetChange");
}

/** Project triggers of the current user that are bound to this spreadsheet. */
function lcDocTriggers_(){
  const id = SpreadsheetApp.getActiveSpreadsheet().getId();
  return ScriptApp.getProjectTriggers().filter(t => t.getTriggerSourceId() === id);
}

/** The settings sheet as the add-on lays it out: B..E of every row, labels in column B. */
function lcReadSettingsSheet_(){
  const out = {name: null, exists: false, b2: null, configs: [], lastRefreshRow: null, lastRefresh: null, lastRefreshTz: null, freqRow: null, freq: null, unit: null};
  out.name = lcImportSettings_().importSheetName ?? null;
  if(!out.name) return out;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(out.name);
  if(!sheet) return out;
  out.exists = true;
  const lastRow = sheet.getLastRow();
  if(lastRow < 1) return out;
  const values = sheet.getRange(1,2,lastRow,4).getValues();
  out.b2 = values[1] ? values[1][0] : null;
  values.forEach((row,i) => {
    const r = i + 1;
    switch(row[0]){
      case "configSheet": out.configs.push({row: r, config: row[1], result: row[2], refresh: row[3]}); break;
      case "lastRefresh": out.lastRefreshRow = r; out.lastRefresh = row[2]; out.lastRefreshTz = row[3]; break;
      case "refreshFrequency": out.freqRow = r; out.freq = row[2]; out.unit = row[3]; break;
    }
  });
  return out;
}

/** A config sheet: rows from row 6, columns B..F. */
function lcReadConfigSheet_(name){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if(!sheet) return null;
  const n = Math.max(sheet.getLastRow() - 5,0);
  const range = n > 0 ? sheet.getRange(6,2,n,5) : null;
  const rows = range ? range.getValues() : [];
  const labelled = label => rows.find(r => r[0] === label);
  return {
    sheet: sheet,
    rows: rows,
    dvs: range ? range.getDataValidations() : [],
    notes: range ? range.getNotes() : [],
    table: labelled("table")?.[1] || null,
    extend: labelled("extend")?.[1] || null
  };
}

/** Data type of a field from the metadata cache only (never downloads). undefined = cache has no answer. */
function lcCachedDataType_(table,field){
  try{
    const key = getGlobalSettings().getODataURL() + "$metadata_tableInfo_" + table;
    const raw = CacheService.getDocumentCache().get(key);
    if(!raw) return undefined;
    const property = JSON.parse(raw).fields.find(p => p.Name == field);
    return property ? property.Type : null;
  } catch(err) {
    return undefined;
  }
}

function lcIsList_(dv){
  return !!dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST;
}

function lcListValues_(dv){
  const values = dv.getCriteriaValues()[0];
  return Array.isArray(values) ? values.map(v => String(v).replace(/^'/,"")) : values;
}

function lcSameList_(dv,expected){
  return lcIsList_(dv) && JSON.stringify(lcListValues_(dv)) === JSON.stringify(expected);
}

function lcSheetNames_(snapshot){
  return lcHave_(snapshot) ? snapshot.map(s => s.name) : [];
}

// - - - - - - - - shared checks - - - - - - - -

const LC_INDICATORS = {B2: "reading", C2: "connection", D2: "data writing"};

/** Background and font colour of B2:D2 of a config sheet. */
function lcIndicatorLook_(sheet){
  const range = sheet.getRange("B2:D2");
  const backgrounds = range.getBackgrounds()[0], fonts = range.getFontColors()[0];
  const look = {};
  Object.keys(LC_INDICATORS).forEach((a1,i) => look[a1] = {background: backgrounds[i], font: fonts[i]});
  return look;
}

/**
 * B2 / C2 / D2 of a config sheet show what the add-on is doing. After a run:
 *  - a cell the run works with (`touches`: the code lights it and puts it back) must be idle;
 *  - every other cell must look exactly as it did before the run (c.before.indicators). If it was not idle before (e.g. edited by hand) and is
 *    still the same, that is not the run's doing: it passes, and the detail says so. If the run changed it and left it not idle, it fails.
 * Without a "before" for the sheet (new sheet, part not captured) every cell is expected to be idle.
 * @param touches {String[]} Cells the run is supposed to reset; default all three.
 */
function lcVerifyIdleIndicators_(c,sheet,tag,touches){
  touches = touches ?? Object.keys(LC_INDICATORS);
  const name = `${tag} activity indicators back to idle`;
  const now = lcIndicatorLook_(sheet);
  const snapshot = c.before && c.before.indicators;
  const before = snapshot && !snapshot.__unavailable ? snapshot[sheet.getName()] : undefined;
  const isIdle = look => look.background === LC_IDLE_BACKGROUND && look.font === LC_IDLE_FONT;
  const show = look => `background ${look.background}, font ${look.font}`;

  const changed = [], asFound = [];
  Object.keys(LC_INDICATORS).forEach(a1 => {
    const look = now[a1];
    if(isIdle(look)) return;
    const was = before && before[a1];
    const untouched = touches.indexOf(a1) < 0;
    if(untouched && was && was.background === look.background && was.font === look.font) asFound.push(`${LC_INDICATORS[a1]} (${a1}: ${show(look)})`);
    else changed.push(`${LC_INDICATORS[a1]} (${a1}: ${show(look)}${was ? `; before the run: ${show(was)}` : "; no state before the run known"})`);
  });

  if(!changed.length){
    if(asFound.length) c.pass(name,`not idle, but not touched by this run and the same as before it: ${asFound.join(", ")}`);
    else c.pass(name);
    return;
  }
  const others = lcOtherRunsInProgress_(c);
  // Another checked run that has started and not ended may be the one that lights the cell right now (a refresh writes for a long
  // time, and a trigger of the same document can run its check meanwhile): that is not a stuck indicator, but worth a look.
  if(others.length) c.warn(name,`still showing activity: ${changed.join(", ")}; another run is in progress and may be lighting it: ${others.join(", ")}`);
  else c.fail(name,`still showing activity: ${changed.join(", ")}; no other checked run is in progress`);
}

/** Checked runs of OTHER executions that have started and have no result yet (nested runs of this execution do not count). */
function lcOtherRunsInProgress_(c){
  try{
    const mine = lcStack.map(f => f.key);
    return lcStoredResults_()
      .filter(e => e.s == "RUN" && e.k !== c.key && mine.indexOf(e.k) < 0 && Date.now() - Date.parse(e.t) < 10 * 60 * 1000)
      .map(e => `${e.a} since ${String(e.t).slice(11,19)} UTC`);
  } catch(err) {
    return [];
  }
}

/** Header of a config sheet that was created by the add-on. */
function lcVerifyConfigHeader_(c,sheet,tag){
  const g = LC_CONFIG_HEADER;
  const range = sheet.getRange(1,1,4,7);
  c.expectEqual(`${tag} header texts`,range.getValues(),g.values);
  c.expectEqual(`${tag} header backgrounds`,range.getBackgrounds(),g.backgrounds);
  c.expectEqual(`${tag} header font weights`,range.getFontWeights(),g.fontWeights);
  c.expectEqual(`${tag} header merged ranges`,range.getMergedRanges().map(r => r.getA1Notation()).sort(),g.merges);
}

/**
 * Result of the co-editing of a config sheet (header kept, rows completed, dropdowns set, indicators idle).
 * Only shapes are checked: lists that depend on BC metadata only have to be dropdowns.
 */
function lcVerifyConfigCoedit_(c,name){
  const tag = `[${name}]`;
  const cfg = lcReadConfigSheet_(name);
  if(!c.expect(`${tag} config sheet exists`,cfg)) return;

  lcVerifyIdleIndicators_(c,cfg.sheet,tag,["B2"]);                 // a co-edit lights the reading cell and puts it back
  c.expectEqual(`${tag} header intact (B1, B4)`,[cfg.sheet.getRange("B1").getValue(),cfg.sheet.getRange("B4").getValue()],[LC_CONFIG_HEADER.values[0][1],"Opis linii"]);
  c.expect(`${tag} estimate info greyed out`,cfg.sheet.getRange("E2:F2").getFontColors()[0].every(col => col === LC_IDLE_FONT),"E2:F2 font is not grey");

  // rows completed by the co-editing
  const isBlank = (r,from) => r.slice(from).every(v => v === "" || v === null);
  const tableRows = cfg.rows.filter(r => r[0] === "table");
  c.expect(`${tag} has a "table" row`,tableRows.length >= 1,"no row labelled table");
  if(cfg.table){
    c.expect(`${tag} has an "extend" row`,cfg.rows.some(r => r[0] === "extend"),"table is chosen but no extend row was added");
    c.expect(`${tag} has an empty "queryOption" row`,cfg.rows.some(r => r[0] === "queryOption" && isBlank(r,1)),"no empty queryOption row to type in");
  }
  if(cfg.extend) c.expect(`${tag} has an empty "extendOption" row`,cfg.rows.some(r => r[0] === "extendOption" && isBlank(r,1)),"extend is chosen but no empty extendOption row");

  // dropdowns: column index 0..4 = B..F
  if(c.connectionDown){
    c.skip(`${tag} dropdowns match the rows`,"the run ended with a connection error, lists from BC metadata could not be built");
    return;
  }
  const problems = [];
  const COL = ["B","C","D","E","F"];
  cfg.rows.forEach((r,i) => {
    const row = 6 + i;
    const dv = j => cfg.dvs[i] ? cfg.dvs[i][j] : null;
    const note = j => cfg.notes[i] ? cfg.notes[i][j] : "";
    const wantList = (j,expected) => {
      if(expected ? !lcSameList_(dv(j),expected) : !lcIsList_(dv(j))) problems.push(`${COL[j]}${row} should be a ${expected ? expected.slice(0,2).join("/") + "... " : ""}dropdown`);
      else if(lcIsList_(dv(j)) && !expected){
        const empty = lcListValues_(dv(j)).length == 0;
        if(empty && note(j) !== LC_EMPTY_LIST_NOTE) problems.push(`${COL[j]}${row} empty list without the explanation note`);
        if(!empty && note(j) === LC_EMPTY_LIST_NOTE) problems.push(`${COL[j]}${row} has the empty-list note but the list is not empty`);
      }
    };
    switch(r[0]){
      case "queryOption":
      case "extendOption":
        wantList(1,LC_QUERY_OPTIONS);
        if(r[1] === "filter"){ wantList(2); wantList(3,LC_OPERATORS); }
        else if(r[1] === "select") wantList(2);
        else if(r[1] === "filterLogic"){ wantList(2); wantList(3,LC_FILTER_LOGICS); }
        else if(r[1] === "orderBy"){ wantList(2); wantList(3,LC_SORTING_ORDERS); }
        break;
      case "table":
      case "extend":
        wantList(1);
        break;
      default:
        for(let j = 0; j < 5; j++) if(dv(j)) problems.push(`${COL[j]}${row} has a dropdown but the row label "${r[0]}" has none`);
    }
  });
  c.expect(`${tag} dropdowns match the rows (${cfg.rows.length} rows)`,problems.length == 0,problems.slice(0,4).join("; "));
}

/**
 * A result sheet written by a refresh. The data itself is not re-read: size is compared with the estimate kept in
 * F2 of the config sheet, formats with the (cached) data types.
 */
function lcVerifyResultSheet_(c,configName,resultName){
  const tag = `[${configName}]`;
  const cfg = lcReadConfigSheet_(configName);
  if(!cfg) return c.fail(`${tag} config sheet exists`,"the sheet is listed in the settings sheet but missing");
  lcVerifyIdleIndicators_(c,cfg.sheet,tag,["B2","C2","D2"]);      // a refresh works with all three

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(resultName);
  if(!c.expect(`${tag} result sheet "${resultName}" exists`,sheet,"refresh did not create / keep the result sheet")) return;
  const rows = sheet.getLastRow(), cols = sheet.getLastColumn();
  if(!c.expect(`${tag} result sheet is not empty`,rows >= 1 && cols >= 1,`${rows} x ${cols}`)) return;

  const header = sheet.getRange(1,1,1,cols).getValues()[0];
  if(rows == 1 && cols == 1){
    c.pass(`${tag} result is the "no data" message`,header[0]);
    return;
  }
  if(cols == 2 && rows <= 4 && header[0] === "code"){
    c.warn(`${tag} result sheet holds an error answer from BC`,sheet.getRange(1,1,Math.min(rows,2),2).getValues().map(r => r.join(": ")).join(" | "));
    return;
  }
  c.expect(`${tag} every column has a header`,header.every(h => String(h).length > 0),"empty header cell in row 1");

  // size against the estimate stored in F2 (set when the first page arrives)
  const estimate = cfg.sheet.getRange("F2").getValue();
  const dataRows = rows - 1;
  if(typeof estimate === "number" && isFinite(estimate)){
    const diff = Math.abs(dataRows - estimate);
    if(!cfg.extend){
      if(diff == 0) c.pass(`${tag} ${dataRows} data rows = estimate`);
      else if(diff <= Math.max(1,0.05 * estimate)) c.warn(`${tag} data rows differ slightly from the estimate`,`${dataRows} written, ${estimate} estimated (data may have changed meanwhile)`);
      else c.fail(`${tag} data rows differ from the estimate`,`${dataRows} written, ${estimate} estimated`);
    }
    else c.expectSoft(`${tag} data rows close to the estimate (extend in use, so approximate)`,diff <= 0.25 * estimate + 1,`${dataRows} written, ${Math.round(estimate)} estimated`);
  }
  else c.skip(`${tag} data rows vs estimate`,`no numeric estimate in F2 (${JSON.stringify(estimate)})`);

  // formats: uniform down every column, and right for the data type when the metadata cache knows it
  const first = sheet.getRange(1,1,1,cols).getNumberFormats()[0];
  const last = sheet.getRange(rows,1,1,cols).getNumberFormats()[0];
  const ragged = first.map((f,i) => f !== last[i] ? header[i] : null).filter(h => h !== null);
  c.expect(`${tag} number format uniform in every column`,ragged.length == 0,`differs between first and last row: ${ragged.slice(0,5).join(", ")}`);

  const wrong = [];
  let known = 0;
  header.forEach((h,i) => {
    const text = String(h);
    const chain = text.indexOf(".") < 0 ? null : text.split(".").reverse();
    const type = lcCachedDataType_(chain ? chain[1] : cfg.table,chain ? chain[0] : text);
    if(type === undefined || type === null) return;
    known++;
    const expected = LC_FORMATS[type] ?? "General";
    // "General" is reported differently by Sheets (e.g. "0.###############"), so only specific formats are compared.
    if(expected !== "General" && last[i] !== expected) wrong.push(`${text}: ${last[i]} (expected ${expected})`);
  });
  if(known == 0) c.skip(`${tag} number formats vs data types`,"metadata cache has none of the columns");
  else c.expectSoft(`${tag} number formats match data types (${known} columns known)`,wrong.length == 0,wrong.slice(0,3).join("; "));
}

/** Sheets that exist now and did not before, optionally only the ones allowed. */
function lcAddedSheets_(c){
  const before = lcSheetNames_(c.before.sheets);
  return lcSheetNames_(c.now("sheets")).filter(n => !before.includes(n));
}

/** An action that only looked at a sheet that is not a config sheet may have created the settings sheet (getMainSettings()), nothing else. */
function lcVerifyOnlySettingsSheetAdded_(c,settings,name){
  const extra = lcAddedSheets_(c).filter(n => n !== settings.name);
  const removed = lcSheetNames_(c.before.sheets).filter(n => !lcSheetNames_(c.now("sheets")).includes(n));
  c.expect(name,extra.length == 0 && removed.length == 0,`added ${extra.join(", ") || "-"}, removed ${removed.join(", ") || "-"}`);
}

/** Time-based refresh trigger and permit after the refresh frequency cells were edited. */
function lcVerifyRefreshTrigger_(c,settings){
  c.attempt("refresh trigger matches the settings sheet",() => {
    const timers = ScriptApp.getProjectTriggers().filter(t => ["autoRefresh","autoRefreshHandler"].includes(t.getHandlerFunction()));
    const handlers = timers.filter(t => t.getHandlerFunction() === "autoRefreshHandler");
    const permit = c.settings().refreshPermit;
    c.expect("no legacy autoRefresh trigger left",timers.length == handlers.length,"autoRefresh (legacy) trigger still installed");
    const unitOk = settings.unit === "godzin" || settings.unit === "dni";
    if(!settings.freq || !unitOk){
      c.expect("refresh frequency empty / unit unknown: no refresh trigger",timers.length == 0,`${timers.length} refresh trigger(s) installed`);
      return;
    }
    if(!c.expect("exactly one autoRefreshHandler trigger",handlers.length == 1,`${handlers.length} installed`)) return;
    c.expect("trigger is time-based",handlers[0].getEventType() === ScriptApp.EventType.CLOCK,String(handlers[0].getEventType()));
    c.expect("permit issued for the new trigger",!!permit && permit.issuedFor === handlers[0].getUniqueId(),`permit: ${JSON.stringify(permit)}`);
    c.expectEqual("permit interval in hours",permit?.intervalHours,settings.unit === "dni" ? 24 * settings.freq : settings.freq);
  });
}

/** Read-only entry points that only show a sidebar / dialog. */
function lcVerifyNothingChanged_(c,allowedDocKeys=[]){
  c.unchanged("sheets","no sheet added, removed or renamed");
  c.unchanged("docProps","no document property changed",allowedDocKeys);
}

// - - - - - - - - verifiers - - - - - - - -

var lcVerifiers = null;
function liveCheckVerifiers(){
  return lcVerifiers ?? (lcVerifiers = buildLiveCheckVerifiers_());
}

function buildLiveCheckVerifiers_(){
  const menuNoise = ["importSettingsArray","docTriggerArray",/_coedit$/,"agentSuspect"];   // menu actions switch the add-on ON and may repair agents

  return Object.assign(lcJobVerifiers_(),{

    // - - - - - - - - events - - - - - - - -

    onOpen: {
      needs: ["sheets","docProps"],
      verify(c){
        lcVerifyNothingChanged_(c);
        c.skip("menu built","the add-on menu is built before the controller runs and cannot be read back by a script");
        c.skip("warning shown when the agents are not active","the alert cannot be read back by a script");
      }
    },

    simpleOnEdit: {
      needs: ["sheets","docProps"],
      verify(c){
        const e = c.input.e;
        const poweredOff = /Powering OFF all agents/.test(c.notes.join("\n"));
        c.unchanged("sheets","simple onEdit changes no sheet");
        c.unchanged("docProps","only the agent-detection flag (and the power of the agents after a level 2 alarm) may change",poweredOff ? ["agentSuspect","docTriggerArray"] : ["agentSuspect"]);

        const suspect = c.docProp("agentSuspect");
        let flag = null, malformed = false;
        try{ flag = suspect ? JSON.parse(suspect) : null; } catch(err) { malformed = true; }
        c.expect("suspect flag is empty or well formed",!malformed && (flag === null || (!!flag.fp && !isNaN(Date.parse(flag.time)))),String(suspect));

        // The code leaves notes about the path it took (agentLog); the outcome must fit the path.
        const notes = c.notes.join("\n");
        if(!notes) { c.skip("outcome fits the decision taken","no notes (agent log disabled?)"); return; }
        const reported = /OK: installable trigger reported/.test(notes);
        const level1 = /ALARM level 1/.test(notes);
        const level2 = /ALARM level 2/.test(notes);
        c.expect("exactly one outcome was decided",[reported,level1,level2].filter(x => x).length == 1,`reported=${reported} level1=${level1} level2=${level2}`);
        if(level1) c.expect("level 1 alarm left the suspect flag set",!!suspect,"flag is empty");
        if(poweredOff) c.expect("agents powered off after the level 2 alarm",!lcAgentsActive_(lcDocLog_()),"agents still active");
        if(reported) c.expect("alarm was not raised although the agent reported",!level1 && !level2);

        if(e && e.range){
          c.attempt("installable record is consumed or absent",() => {
            const fp = e.range.getSheet().getName() + "!" + e.range.getA1Notation();
            const left = CacheService.getDocumentCache().get("edit:" + fp + "instalTraceKey_");
            c.expect("installable record is consumed or absent",left === null || /^[1-9]\d*$/.test(left),`record reads ${left}`);
          });
        }
      }
    },

    sheetEditAction: {
      needs: ["sheets","docProps","settingsSheet","indicators"],
      verify(c){ lcVerifyAgentRun_(c,"edit"); }
    },

    sheetChangeAction: {
      needs: ["sheets","docProps","settingsSheet","indicators"],
      verify(c){ lcVerifyAgentRun_(c,"change"); }
    },

    requestAutoRefesh: {
      needs: ["sheets","settings","settingsSheet","triggers","indicators"],
      verify(c){
        const e = c.input.e;
        const uid = e && e.triggerUid;
        if(!uid) return c.skip("time trigger event","no triggerUid in the event (manual run?)");
        const beforePermit = c.before.settings?.refreshPermit ?? null;
        // The legacy handler adopts the trigger when there is no permit at all.
        const mine = c.input.legacy ? (!beforePermit || beforePermit.issuedFor === uid) : (!!beforePermit && beforePermit.issuedFor === uid);
        const triggerStillThere = ScriptApp.getProjectTriggers().some(t => t.getUniqueId() === uid);
        const settings = c.now("settingsSheet");

        if(!mine){
          c.expect("trigger without a permit removed itself",!triggerStillThere,"trigger is still installed");
          c.unchanged("sheets","nothing refreshed");
          c.expectEqual("last refresh untouched",settings.lastRefresh && new Date(settings.lastRefresh).getTime(),c.before.settingsSheet.lastRefresh && new Date(c.before.settingsSheet.lastRefresh).getTime());
          c.expectEqual("permit untouched",c.settings().refreshPermit ?? null,beforePermit);
          return;
        }
        c.expect("permitted trigger stays installed",triggerStillThere,"trigger removed itself");
        if(c.error) return;
        const permit = c.settings().refreshPermit;
        c.expect("permit issued for this trigger",!!permit && permit.issuedFor === uid,JSON.stringify(permit));
        c.expect("permit records the run",!!permit && permit.lastRun >= c.startedAt - 2000,`lastRun ${permit?.lastRun}`);
        const last = settings.lastRefresh;
        c.expect("settings sheet shows the refresh time",last instanceof Date && last.getTime() >= c.startedAt - 2000 && last.getTime() <= Date.now() + 2000,`cell reads ${last}`);
        c.expect("refresh time has a time zone label",!!settings.lastRefreshTz,"cell next to the time is empty");
        settings.configs.filter(x => x.refresh === true).forEach(x => {
          const cfg = lcReadConfigSheet_(x.config);
          if(!cfg) return c.fail(`[${x.config}] config sheet exists`,"listed for refresh but missing");
          if(!cfg.table) return c.skip(`[${x.config}] result sheet`,"no table in the config sheet, nothing to refresh");
          lcVerifyResultSheet_(c,x.config,x.result);
        });
      }
    },

    // - - - - - - - - menu - - - - - - - -

    menuAuthFlow: {
      needs: ["sheets","docProps"],
      verify(c){
        const tenant = getGlobalSettings().getServiceName();
        if(!tenant) c.expectError(() => true,"no tenant id configured, so there is no service to authorise");
        lcVerifyNothingChanged_(c,menuNoise);
        c.skip("alert / sidebar shown","the UI cannot be read back by a script");
      }
    },

    menuLogoutFlow: {
      needs: ["sheets","docProps","userProps"],
      verify(c){
        const tenant = getGlobalSettings().getServiceName();
        if(!tenant){ c.expectError(() => true,"no tenant id configured"); return; }
        c.unchanged("sheets","no sheet changed");
        const keys = (c.now("userProps").oauthKeys || "").split(",");
        c.expect("OAuth token of the connection removed",!keys.includes("oauth2." + tenant),"token is still stored");
      }
    },

    menuConnectionSetup: {
      needs: ["sheets","docProps"],
      verify(c){ lcVerifyNothingChanged_(c,menuNoise); c.skip("sidebar shown","the UI cannot be read back by a script"); }
    },

    menuTestItem: {
      needs: ["sheets","docProps"],
      verify(c){ lcVerifyNothingChanged_(c,menuNoise); }
    },

    requestStatusCheck: {
      needs: ["sheets","docProps"],
      verify(c){ lcVerifyNothingChanged_(c); c.skip("sidebar shown","the UI cannot be read back by a script"); }
    },

    requestListAllTriggers: {
      needs: ["sheets","docProps"],
      verify(c){ lcVerifyNothingChanged_(c); c.skip("sidebar shown","the UI cannot be read back by a script"); }
    },

    requestLiveCheckSidebar: {
      needs: ["sheets","docProps"],
      verify(c){ lcVerifyNothingChanged_(c); c.skip("sidebar shown","the UI cannot be read back by a script"); }
    },

    menuInsertImportWizard: {
      needs: ["sheets","settingsSheet"],
      verify(c){
        const before = c.before.settingsSheet;
        const after = c.now("settingsSheet");
        const knownBefore = lcHave_(before) && before.exists;
        const count = knownBefore ? before.configs.length : 0;
        const name = "Konfiguracja " + (count + 1);
        const resultName = "Dane wg. " + name;

        if(!c.expect("settings sheet exists",after.exists && LC_SETTINGS_SIGNATURES.includes(after.b2),`b2 = ${after.b2}`)) return;
        c.expectEqual("one config row added to the settings sheet",after.configs.length,count + 1);
        const lastBefore = knownBefore && before.configs.length ? before.configs[before.configs.length - 1].row : 2;
        const added = after.configs.find(x => x.config === name);
        if(c.expect(`new row for ${name}`,!!added,`rows: ${after.configs.map(x => x.config).join(", ")}`)){
          c.expectEqual("new row sits right after the previous config row",added.row,lastBefore + 1);
          c.expectEqual("result sheet name proposed",added.result,resultName);
          c.expect("refresh switched off",added.refresh === false,String(added.refresh));
          const rule = c.spreadsheet().getSheetByName(after.name).getRange(added.row,5).getDataValidation();
          c.expect("refresh cell is a checkbox",!!rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX,"no checkbox");
        }

        const addedSheets = lcAddedSheets_(c);
        const expectedSheets = knownBefore ? [name] : [after.name,name];
        c.expectEqual("sheets added",addedSheets.sort(),expectedSheets.sort());
        c.expect("result sheet not created before the first refresh",!c.spreadsheet().getSheetByName(resultName),`${resultName} exists`);

        const sheet = c.spreadsheet().getSheetByName(name);
        if(sheet){
          lcVerifyConfigHeader_(c,sheet,`[${name}]`);
          lcVerifyConfigCoedit_(c,name);
        }
      }
    },

    requestCheckConfigSheet: {
      needs: ["sheets","activeSheet","settingsSheet","indicators"],
      verify(c){
        const settings = c.now("settingsSheet");
        const active = c.before.activeSheet;
        if(settings.configs.some(x => x.config === active)) lcVerifyConfigCoedit_(c,active);
        else{
          lcVerifyOnlySettingsSheetAdded_(c,settings,"not a config sheet: nothing changed");
          c.skip("alert shown","the UI cannot be read back by a script");
        }
      }
    },

    menuEstimateForCurrentSheet: {
      needs: ["sheets","activeSheet","settingsSheet","indicators"],
      verify(c){
        const settings = c.now("settingsSheet");
        const active = c.before.activeSheet;
        const entry = settings.configs.find(x => x.config === active) ?? settings.configs.find(x => x.result === active);
        if(!entry){ lcVerifyOnlySettingsSheetAdded_(c,settings,"not a config sheet: nothing changed"); return; }
        const cfg = lcReadConfigSheet_(entry.config);
        if(!c.expect(`[${entry.config}] config sheet exists`,cfg)) return;
        lcVerifyIdleIndicators_(c,cfg.sheet,`[${entry.config}]`,["B2","C2"]);     // an estimate: reading and connection
        if(c.error) return;
        if(!cfg.table){ c.pass("no table in the config sheet: estimate skipped"); return; }
        const cell = cfg.sheet.getRange("F2");
        const value = cell.getValue();
        c.expect("estimate is a number",typeof value === "number" && isFinite(value) && value >= 0,`F2 reads ${JSON.stringify(value)}`);
        c.expectEqual("estimate formatted with thousands separator",cell.getNumberFormat(),"#,##0");
        c.expect("estimate info shown (black)",cfg.sheet.getRange("E2:F2").getFontColors()[0].every(col => col === "#000000"),"E2:F2 is not black");
        c.unchanged("sheets","no sheet added by an estimate");
      }
    },

    menuRefreshCurrentSheet: {
      needs: ["sheets","activeSheet","settingsSheet","indicators"],
      verify(c){
        const settings = c.now("settingsSheet");
        const active = c.before.activeSheet;
        const entry = settings.configs.find(x => x.config === active) ?? settings.configs.find(x => x.result === active);
        if(!entry){
          lcVerifyOnlySettingsSheetAdded_(c,settings,"not a config sheet: nothing changed");
          c.skip("alert shown","the UI cannot be read back by a script");
          return;
        }
        lcVerifyRefreshedConfig_(c,entry);
      }
    },

    menuRefreshAll: {
      needs: ["sheets","settingsSheet","indicators"],
      verify(c){
        const settings = c.now("settingsSheet");
        if(!settings.configs.length){ c.pass("no config sheets listed: nothing to refresh"); return; }
        settings.configs.forEach(entry => lcVerifyRefreshedConfig_(c,entry));
      }
    },

    // - - - - - - - - sidebars - - - - - - - -

    requestAddonStatus: {
      needs: ["sheets","docProps"],
      verify(c){
        lcVerifyNothingChanged_(c);
        c.expect("result is the stored status",c.result === (c.settings().addonStatus ?? false),`result ${JSON.stringify(c.result)}, stored ${JSON.stringify(c.settings().addonStatus)}`);
      }
    },

    requestChangeAddonStatus: {
      needs: ["sheets"],
      verify(c){
        let wanted = c.input.newStatus;
        if(wanted === "on" || wanted === "ON") wanted = true;
        if(wanted === "off" || wanted === "OFF") wanted = false;
        c.unchanged("sheets","no sheet changed");
        const settings = c.settings();
        c.expectEqual("stored status",settings.addonStatus,wanted);
        if(wanted === true){
          c.expect("settings sheet name stored",!!settings.importSheetName,"importSheetName is empty");
          c.expectSoft("agents active after switching ON",lcAgentsActive_(lcDocLog_()),`agents not active - ${LC_KNOWN_NESTED_RUN}`);
        }
      }
    },

    requestSettingsSheetName: {
      needs: ["sheets","docProps"],
      verify(c){
        lcVerifyNothingChanged_(c);
        c.expect("result is the stored name",(c.result ?? null) === (c.settings().importSheetName ?? null),`result ${JSON.stringify(c.result)}`);
      }
    },

    requestSetSettingsSheetName: {
      needs: ["sheets"],
      verify(c){
        const name = c.input.name;
        const stored = c.settings().importSheetName;
        if(name) c.expectEqual("stored name",stored,name);
        else c.expect("a valid name was chosen when none was given",!!stored,"importSheetName is empty");
        c.unchanged("sheets","renaming the setting does not touch sheets");
        const sheet = stored && c.spreadsheet().getSheetByName(stored);
        if(sheet) c.expectSoft("a sheet with this name has the settings signature",LC_SETTINGS_SIGNATURES.includes(sheet.getRange("B2").getValue()),`"${stored}" exists but is not an import settings sheet (B2 = ${sheet.getRange("B2").getValue()})`);
      }
    },

    requestPermitsInfo: {
      needs: ["sheets","docProps"],
      verify(c){
        lcVerifyNothingChanged_(c);
        const permit = c.settings().refreshPermit;
        if(permit) c.expectEqual("result is the stored permit",JSON.parse(c.result),permit);
        else c.expectEqual("result tells there is no permit",c.result,"No permits info ):");
      }
    },

    forceAgentRefresh: {
      needs: ["sheets"],
      verify(c){
        c.unchanged("sheets","no sheet changed");
        c.attempt("agents installed and logged",() => {
          const triggers = lcDocTriggers_();
          const edit = triggers.filter(t => t.getHandlerFunction() === "sheetEdit" && t.getEventType() === ScriptApp.EventType.ON_EDIT);
          const change = triggers.filter(t => t.getHandlerFunction() === "sheetChange" && t.getEventType() === ScriptApp.EventType.ON_CHANGE);
          c.expect("an edit and a change trigger are installed",edit.length >= 1 && change.length >= 1,`edit ${edit.length}, change ${change.length}`);
          c.expectSoft("exactly one edit and one change trigger",edit.length == 1 && change.length == 1,`edit ${edit.length}, change ${change.length} - ${LC_KNOWN_UNLOGGED_TRIGGERS}`);
          if(!edit.length || !change.length) return;
          const ids = [edit[0].getUniqueId(),change[0].getUniqueId()];
          if(c.result) c.expect("returned id is the edit trigger",edit.some(t => t.getUniqueId() === c.result),`returned ${c.result}`);

          const docLog = lcDocLog_();
          // When this run is started from the closing action of another one, its log saves are lost (nested Controller.run).
          const logged = (name,cond,detail) => c.nested ? c.expectSoft(name,cond,`${detail} - ${LC_KNOWN_NESTED_RUN}`) : c.expect(name,cond,detail);
          logged("both triggers logged ON for the document",ids.every(id => docLog.some(t => t.triggerId === id && t.powerOn === true)),"missing / OFF in the document log");
          logged("agents count as active",lcAgentsActive_(docLog),"checkIfActive() would say no");
          c.expectSoft("both triggers logged for the user",ids.every(id => lcUserLog_().some(t => t.triggerId === id)),`missing in the user log - ${LC_KNOWN_NESTED_RUN}`);

          const pairs = JSON.parse(PropertiesService.getUserProperties().getProperty("agentArray") || "[]");
          logged("pair stored in the agent array",pairs.some(p => ids.every(id => p.includes(id))),"agent array has no pair with these ids");
          c.expect(`agent array within the limit of ${LC_LIMIT_AGENT_SETS}`,pairs.length <= LC_LIMIT_AGENT_SETS,`${pairs.length} pairs`);

          const projectIds = ScriptApp.getProjectTriggers().map(t => t.getUniqueId());
          const ghosts = docLog.filter(t => !projectIds.includes(t.triggerId)).map(t => t.triggerId);
          c.expectSoft("no logged trigger is missing from the project",ghosts.length == 0,`document log lists ${ghosts.join(", ")}`);
          c.expectSoft("agent suspect flag cleared",!c.docProp("agentSuspect"),"agentSuspect is still set");
        });
      }
    },

    requestDeleteAllAgents: {
      needs: ["sheets","triggers","userProps"],
      verify(c){
        c.unchanged("sheets","no sheet changed");
        const before = c.before.userProps, triggersBefore = c.before.triggers;
        if(!lcHave_(before) || !lcHave_(triggersBefore)) return c.skip("agents removed","no snapshot");
        const removed = JSON.parse(before.agentArray || "[]").flat();
        const triggersNow = c.now("triggers");
        c.expect("agent array is empty",JSON.parse(PropertiesService.getUserProperties().getProperty("agentArray") || "[]").length == 0,"agent array still has pairs");
        c.expect("agent triggers uninstalled",removed.every(id => !triggersNow.some(t => t.id === id)),"some agent triggers are still installed");
        c.expectEqual("other triggers untouched",triggersNow.map(t => t.id),triggersBefore.map(t => t.id).filter(id => !removed.includes(id)));
        c.expect("document log has no entry of the removed agents",removed.every(id => !lcDocLog_().some(t => t.triggerId === id)),"entries left in the document log");
        c.expectSoft("user log has no entry of the removed agents",removed.every(id => !lcUserLog_().some(t => t.triggerId === id)),`entries left in the user log - ${LC_KNOWN_LOST_UPDATES}`);
      }
    },

    deleteAllInDocumentTriggerLog: {
      needs: ["sheets","triggers"],
      verify(c){
        c.unchanged("sheets","no sheet changed");
        c.unchanged("triggers","log only: no trigger installed or removed");
        c.expectEqual("document trigger log is empty",lcDocLog_(),[]);
      }
    },

    deleteAllInUserTriggerLog: {
      needs: ["sheets","triggers"],
      verify(c){
        c.unchanged("sheets","no sheet changed");
        c.unchanged("triggers","log only: no trigger installed or removed");
        c.expectEqual("user trigger log is empty",lcUserLog_(),[]);
      }
    },

    requestAgentStatus: {
      needs: ["sheets","docProps"],
      verify(c){
        lcVerifyNothingChanged_(c);
        c.expectEqual("result is [agents active, add-on status]",c.result,[lcAgentsActive_(lcDocLog_()),c.settings().addonStatus ?? false]);
      }
    },

    requestListProjectTriggers: {
      needs: ["sheets","docProps"],
      verify(c){
        lcVerifyNothingChanged_(c);
        const table = c.result;
        if(!c.expect("result is a table",Array.isArray(table) && table.length >= 1 && Array.isArray(table[0]),JSON.stringify(table).slice(0,80))) return;
        c.expectEqual("header row",table[0],["No","Event","Trigger Id","Source","Function","Created","Last Used","Power","Doc","Usr","Script"]);
        c.expect("rows are as wide as the header and numbered",table.every((r,i) => r.length == table[0].length && (i == 0 || r[0] === i)),"ragged row or wrong numbering");
        c.attempt("every project trigger is listed",() => {
          const listed = table.slice(1).map(r => r[2]);
          const missing = ScriptApp.getProjectTriggers().map(t => t.getUniqueId()).filter(id => !listed.includes(id));
          c.expect("every project trigger is listed",missing.length == 0,`missing ${missing.join(", ")}`);
        });
      }
    },

    requestSetGlobalSettings: {
      needs: ["sheets"],
      verify(c){
        const form = c.input.form;
        if(!form) return c.skip("settings stored","no form handed over");
        const store = {document: PropertiesService.getDocumentProperties, user: PropertiesService.getUserProperties, script: PropertiesService.getScriptProperties}[form.scope];
        if(!c.expect("known scope",!!store,`scope ${form.scope}`)) return;
        const props = store.call(PropertiesService);
        const keys = {"bc-tenant-id": form.tenantid, "bc-environment": form.environment, "bc-company": form.company};
        Object.keys(keys).forEach(key => {
          if(typeof keys[key] !== "string") return c.skip(`${key} stored`,"value not given");
          c.expect(`${key} stored in the ${form.scope} scope`,keys[key] === "" ? props.getProperty(key) === null : props.getProperty(key) === keys[key],`stored ${JSON.stringify(props.getProperty(key))}`);
        });
        c.unchanged("sheets","no sheet changed");
      }
    },

    requestAuthCallback: {
      needs: ["userProps"],
      verify(c){
        const text = c.result && typeof c.result.getContent === "function" ? c.result.getContent() : "";
        c.expect("a page is returned",text.length > 0,"no HtmlOutput");
        const tenant = getGlobalSettings().getServiceName();
        if(/nawiązane poprawnie/.test(text) && tenant){
          c.expect("OAuth token stored after success",(c.now("userProps").oauthKeys || "").split(",").includes("oauth2." + tenant),"no token stored");
        }
        else c.skip("OAuth token stored","authorisation was denied / no tenant configured");
      }
    }
  });
}

// - - - - - - - - verifiers with more than a few lines - - - - - - - -

/** Menu refresh of one config sheet (also used per sheet by "refresh all"). */
function lcVerifyRefreshedConfig_(c,entry){
  const tag = `[${entry.config}]`;
  const cfg = lcReadConfigSheet_(entry.config);
  if(!c.expect(`${tag} config sheet exists`,cfg)) return;
  if(c.error || !cfg.table){
    lcVerifyIdleIndicators_(c,cfg.sheet,tag,c.error ? ["B2","C2"] : ["B2"]);     // stopped early: reading (and connection), never the writing cell
    if(!c.error) c.expect(`${tag} no table: no result sheet created`,!lcAddedSheets_(c).includes(entry.result),`${entry.result} was created`);
    return;
  }
  lcVerifyResultSheet_(c,entry.config,entry.result);
}

/**
 * sheetEdit (installable onEdit) and sheetChange (installable onChange): the TECHNICAL side of the run - the trigger's bookkeeping and its power.
 * What the run did about the edit is a job of its own (the router names it, see LIVE_CHECK_INTENTS) and is judged by the verifier of that job
 * ("config.coedit", "settings.refreshFrequency" ...). When no job was announced (the run stopped before routing) the content is judged here, as before.
 * @param kind {String} "edit" or "change"
 */
function lcVerifyAgentRun_(c,kind){
  const e = c.input.e;
  if(!e) return c.skip("event","no event handed over");
  const uid = e.triggerUid;
  const log = lcDocLog_();
  const entry = log.find(t => t.triggerId === uid);
  const powerBefore = lcAgentPowerBefore_(c);

  if(entry) c.expectSoft("trigger's last use recorded",Date.parse(entry.lastUsed) >= c.startedAt - 2000,`lastUsed ${entry.lastUsed} - ${LC_KNOWN_LOST_UPDATES}`);
  if(kind == "edit") c.expectSoft("agent suspect flag cleared by the installable run",!c.docProp("agentSuspect"),"agentSuspect is set (a simple trigger of a later edit may have set it again)");

  if(!powerBefore){
    if(kind == "edit"){
      c.unchanged("sheets","power OFF or trigger not logged: edit action skipped, sheets untouched");
      c.unchanged("docProps","power OFF: only logs / flags may change",["docTriggerArray","agentSuspect"]);
    }
    else c.skip("change action skipped","power OFF - sheetChange currently runs the action before looking at the power (docs/trigger-management-todo.md #5), so nothing is asserted");
    return;
  }

  const settings = c.now("settingsSheet");
  if(!c.expect("settings sheet exists with its signature (created on demand)",settings.exists && LC_SETTINGS_SIGNATURES.includes(settings.b2),`name ${settings.name}, B2 = ${settings.b2}`)) return;

  if(!c.intent) lcVerifyAgentContent_(c,kind,settings);
}

/** Was the trigger of this run logged and powered on before the run? */
function lcAgentPowerBefore_(c){
  const uid = c.input.e && c.input.e.triggerUid;
  const beforeLog = lcHave_(c.before.docProps) && c.before.docProps.docTriggerArray ? JSON.parse(c.before.docProps.docTriggerArray) : [];
  return beforeLog.some(t => t[0] === uid && t[2] === true);
}

/** The sheet an edit / change is about, as the verifier sees it (the edited range's sheet for an edit, the active sheet for a change). */
function lcAgentSheet_(c,kind){
  const e = c.input.e;
  return kind == "edit" ? (e.range ? e.range.getSheet().getName() : null) : c.now("activeSheet");
}

/** Did the edit touch the refresh frequency (column D or E of its row in the settings sheet)? */
function lcRefreshFrequencyTouched_(c,settings){
  const e = c.input.e, row = settings.freqRow;
  return !!(e && e.range) && !!row && row >= e.range.getRow() && row <= e.range.getLastRow() && [4,5].some(col => col >= e.range.getColumn() && col <= e.range.getLastColumn());
}

/** The old, complete judgement of what an edit / change led to - used only when no job was announced. */
function lcVerifyAgentContent_(c,kind,settings){
  const e = c.input.e;
  if(kind == "change"){
    const type = String(e.changeType);
    if(type == "EDIT" || type == "FORMAT"){
      c.unchanged("sheets",`${type} change is ignored`);
      c.unchanged("docProps",`${type} change is ignored`,["docTriggerArray","agentSuspect"]);
      return;
    }
  }

  const editedName = lcAgentSheet_(c,kind);
  if(!editedName) return c.skip("edited sheet","not known");

  if(kind == "edit" && editedName === settings.name && e.range){
    if(lcRefreshFrequencyTouched_(c,settings)) lcVerifyRefreshTrigger_(c,settings);
    else c.pass("edit in the settings sheet outside the refresh frequency: nothing to do");
    return;
  }

  if(settings.configs.some(x => x.config === editedName)){
    lcVerifyConfigCoedit_(c,editedName);
    return;
  }

  lcVerifyUnrelatedSheet_(c,settings,kind == "change" ? String(e.changeType) : "");
}

/** Any other sheet: the add-on does nothing there (apart from creating its settings sheet on first use). */
function lcVerifyUnrelatedSheet_(c,settings,type){
  if(type == "INSERT_GRID" || type == "REMOVE_GRID") c.skip("sheets untouched","sheets were added / removed by the change itself");
  else{
    const extra = lcAddedSheets_(c).filter(n => n !== settings.name);
    c.expect("no sheet added in an unrelated sheet's edit",extra.length == 0,`added ${extra.join(", ")}`);
  }
}

// - - - - - - - - jobs (what an edit / change turned out to mean; the router names them) - - - - - - - -
// Each verifier works out its own premise from the event and the settings sheet instead of trusting the router: a wrongly routed edit is a FAIL.

/** A change run by a trigger that was powered off is not asserted (the code runs the action anyway, docs/trigger-management-todo.md #5). */
function lcSkipUnpoweredChange_(c){
  if(c.actionName === "sheetChangeAction" && !lcAgentPowerBefore_(c)){
    c.skip("job not asserted","power OFF - sheetChange runs the action before looking at the power (docs/trigger-management-todo.md #5)");
    return true;
  }
  return false;
}

function lcJobVerifiers_(){
  return {
    "config.coedit": {
      verify(c){
        if(lcSkipUnpoweredChange_(c)) return;
        const kind = lcAgentKind_(c), settings = c.now("settingsSheet"), sheet = c.intentData.sheet;
        c.expect(`${sheet} is a config sheet listed in the settings sheet`,settings.configs.some(x => x.config === sheet),`listed: ${settings.configs.map(x => x.config).join(", ")}`);
        if(kind == "change") c.expect("a structure change, not a cell edit",!["EDIT","FORMAT"].includes(String(c.input.e.changeType)),String(c.input.e.changeType));
        lcVerifyConfigCoedit_(c,sheet);
      }
    },

    "settings.refreshFrequency": {
      verify(c){
        if(lcSkipUnpoweredChange_(c)) return;
        const settings = c.now("settingsSheet");
        if(!c.expect("the edit touched the refresh frequency (number or unit)",lcRefreshFrequencyTouched_(c,settings),"the edited range does not cover the refresh frequency cells")) return;
        lcVerifyRefreshTrigger_(c,settings);
      }
    },

    "settings.edit": {
      verify(c){
        if(lcSkipUnpoweredChange_(c)) return;
        const settings = c.now("settingsSheet");
        c.expect("edit in the settings sheet outside the refresh frequency: nothing to do",!lcRefreshFrequencyTouched_(c,settings),"the edit DID touch the refresh frequency but no time trigger was set up");
      }
    },

    "sheet.ignored": {
      verify(c){
        if(lcSkipUnpoweredChange_(c)) return;
        const kind = lcAgentKind_(c), settings = c.now("settingsSheet"), sheet = lcAgentSheet_(c,kind);
        c.expect("not a config sheet: nothing to do",!settings.configs.some(x => x.config === sheet),`${sheet} is a config sheet`);
        lcVerifyUnrelatedSheet_(c,settings,kind == "change" ? String(c.input.e.changeType) : "");
      }
    },

    "change.ignored": {
      verify(c){
        const type = String(c.input.e && c.input.e.changeType);
        if(!c.expect("only EDIT and FORMAT changes are ignored",type == "EDIT" || type == "FORMAT",type)) return;
        c.unchanged("sheets",`${type} change is ignored`);
        c.unchanged("docProps",`${type} change is ignored`,["docTriggerArray","agentSuspect"]);
      }
    },

    "agent.skipped": {
      verify(c){
        c.expect("the trigger is powered off or not logged",!lcAgentPowerBefore_(c),"the trigger was powered on, but the edit was skipped");
      }
    }
  };
}

function lcAgentKind_(c){ return c.actionName === "sheetChangeAction" ? "change" : "edit"; }
