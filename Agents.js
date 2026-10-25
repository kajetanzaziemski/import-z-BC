// ---------------------------------------------------------------------------
// AGENTS: the one door to the agent service. "Agent" = the pair of installable triggers (sheetEdit + sheetChange) of one user in one document.
// docs/agent-lifecycle.md says when they are created, replaced and destroyed; docs/agent-service.md is the plan this file is the first step of.
//
// Everything outside asks THIS object (the use cases, Quick Start.js, Main Settings.js); it uses the parts behind it, which only it may call:
//   AgentManager (Trigger Manager.js)    the pool: install, limit 5 pairs per user, evict, delete
//   TriggerLog / DocumentTriggerLog / UserTriggerLog   the registers
//   TriggerGateway = TriggerGateway      the only caller of ScriptApp for the agents
//   AgentReconciler (Agent Reconciler.js)  pure: which log entry / trigger goes (the table)
//   the detector (Track onEdit Triggers.js)  recordInstallableSeen / waitForInstallable ... , judged through verifyEdit()
// No sheet and no UI here (the alert and the sidebars are StatusManager's, the verdict is acted on in Verify Agent.js).
// ---------------------------------------------------------------------------

const Agents = {
  /** Does the document log say that an edit agent and a change agent are powered ON? (It never asks the platform.) */
  isActive() {
    return getAgentManager().checkIfActive();
  },

  /** The status check: install agents when they are not active. */
  ensureActive() {
    if (!Agents.isActive()) Agents.repair();
  },

  /** Is the trigger with this id logged in this document as powered ON? (Unknown id: false.) */
  isPowered(triggerId) {
    return getDocumentTriggerLog().getPowerInfo(triggerId) ?? false;
  },

  /** An agent ran: mark its trigger as used in both logs. */
  markUsed(triggerId) {
    TriggerGateway.logTriggerUsed(triggerId);
  },

  /** { editTriggers, changeTriggers } of this document's log (all, powered or not). */
  info() {
    return getAgentManager().getAgentInfo();
  },

  powerOffAll() {
    getDocumentTriggerLog().powerOffAll();
  },

  deleteAll() {
    getAgentManager().deleteAll();
  },

  /** Powers off every agent of this file, cleans the three trigger logs up and installs a working agent. Returns the id of the edit trigger. */
  repair() {
    dbgLog("Running forceAgentRefresh. Powering off all agents...");
    Agents.powerOffAll();
    dbgLog("Agents powered OFF. Clenup...");
    Agents.cleanUp();
    dbgLog("Cleanup complete. Repairing status...");
    return Agents.install();
  },

  /** Makes sure an agent pair exists (installs one, evicting the oldest when the user has 5). Returns the id of the edit trigger. */
  install() {
    let editTrigId = getAgentManager().recruitAgent();
    dbgLog("New agent installed. Edit Trigger Id = "+editTrigId);
    if(editTrigId) Controller.registerClosing(() => clearAgentSuspect(null,"agents repaired"));
    return editTrigId;
  },

  /** Brings the three records (user log, document log, project triggers) in line with each other, following AgentReconciler's plan. */
  cleanUp() {
    AgentReconciler.plan(Agents.userLogStates_(), Agents.docLogStates_(), Agents.projectTriggerIds_()).forEach(({itemId, key, actions}) => {
      dbgLog(`Cleanup for item id ${itemId}. Signature ${key} (U|D|S).`);
      dbgLog(`Actions for this item`+JSON.stringify(actions));

      if (!actions) {
        // (Every combination has a row; this is only for a table that was edited.)
        dbgLog(`No rule found for item ${itemId}, state ${key}`);
        return;
      }

      if (actions.user === 'PowerOff') {
        dbgLog(`Powering the user log entry of ${itemId} off.`);
        getUserTriggerLog().setPowerOn(itemId,false);
      }
      if (actions.user === 'Remove') {
        dbgLog(`Removing item with id ${itemId} from user log.`);
        getAgentManager().delete(itemId);
        getUserTriggerLog().deleteEntryWithTriggerId(itemId);
      }
      if (actions.user === 'Reinstate') {
        dbgLog(`Unlogged trigger found. Creating new user entry with id ${itemId}`);
        TriggerGateway.logTriggerWithId(itemId);
      }

      if (actions.doc === 'Remove') {
        dbgLog(`Removing item with id ${itemId} from document log.`);
        getAgentManager().delete(itemId);
        getDocumentTriggerLog().deleteEntryWithTriggerId(itemId);
      }
      // (Table never asks to reinstate Document — only User.)

      if (actions.script === 'Uninstall') {
        dbgLog(`Removing (uninstalling) trigger with id ${itemId} from the project.`);
        TriggerGateway.deleteTrigger(itemId);
      }
    });
  },

  userLogStates_() {
    const map = new Map();
    getUserTriggerLog().getTriggerArray().forEach(entry => map.set(entry.triggerId, entry.powerOn ? 'ON' : 'OFF'));
    return map;
  },

  docLogStates_() {
    const map = new Map();
    getDocumentTriggerLog().getTriggerArray().forEach(entry => map.set(entry.triggerId, entry.powerOn ? 'ON' : 'OFF'));
    return map;
  },

  projectTriggerIds_() {
    const map = new Map();
    TriggerGateway.getProjectTriggers().forEach(trigger => map.set(trigger.getUniqueId(), true));
    return map;
  },

  // - - - - - - - - the detector - - - - - - - -

  /** Called by the installable trigger for every edit, before the power check: leaves the record the simple trigger waits for. */
  recordEdit(e) {
    recordInstallableSeen(e);
  },

  /**
   * Called by the simple trigger: waits for the installable trigger's record of the edit at `fp` ("sheet!cell") and judges.
   * Decides and logs the decision, does NOT act on it (Verify Agent.js does). Returns
   *   { verdict: 'ok' }                    the record was there: the agent lives
   *   { verdict: 'suspect' }               first miss: the suspect flag is now set
   *   { verdict: 'dead' }                  second miss without an installable run in between, and the agents were still powered on
   *   { verdict: 'dead-known' }            second (or later) miss, the agents are already powered off
   */
  verifyEdit(fp) {
    agentLog("SIMPLE",fp,`Simple onEdit fired. Waiting up to ${INSTAL_WAIT_MS} ms (polling every ${INSTAL_POLL_MS} ms) for the installable trigger to report the same edit.`);
    const start = Date.now();
    if(waitForInstallable(fp,INSTAL_WAIT_MS)) {
      agentLog("SIMPLE",fp,`OK: installable trigger reported this edit (found after ${Date.now()-start} ms). Agent is alive, nothing to do.`);
      return { verdict: 'ok' };
    }
    agentLog("SIMPLE",fp,`NO REPORT from the installable trigger within ${Date.now()-start} ms. Raising the alarm.`);
    return judgeMissingRecord(fp);
  },

  // - - - - - - - - what the sidebars show - - - - - - - -

  /**
   * One plain object per trigger id that the document log, the user log or the project knows, in that order of preference for the facts
   * (document log first, then user log, then the project trigger): { triggerId, event, function, created, lastUsed, ssId, powerOn,
   * inDocLog, inUserLog, inProject }. `powerOn` is the document log's or else the user log's value (not set for a trigger only the project knows).
   */
  snapshot() {
    const fromEntry = entry => ({ triggerId: entry.triggerId, event: entry.trigEventType, function: entry.trigFunction, created: entry.dateCreated,
      lastUsed: entry.lastUsed, ssId: entry.SsId, powerOn: entry.powerOn });
    const docEntries = getDocumentTriggerLog().getTriggerArray().map(fromEntry);
    const userEntries = getUserTriggerLog().getTriggerArray().map(fromEntry);
    const projectEntries = TriggerGateway.getProjectTriggers().map(trigger => ({ triggerId: trigger.getUniqueId(), event: trigger.getEventType(),
      function: trigger.getHandlerFunction(), created: "unknown", lastUsed: "unknown", ssId: trigger.getTriggerSourceId(), powerOn: null }));

    const ids = new Set([...docEntries.map(x => x.triggerId), ...userEntries.map(x => x.triggerId), ...projectEntries.map(x => x.triggerId)]);
    const find = (list, id) => list.find(x => x.triggerId == id);
    const items = [];
    ids.forEach(id => {
      const doc = find(docEntries, id), usr = find(userEntries, id), prj = find(projectEntries, id);
      const item = Object.assign({}, doc ?? usr ?? prj);
      item.inDocLog = doc != null;
      item.inUserLog = usr != null;
      item.inProject = prj != null;
      item.powerOn = doc?.powerOn || usr?.powerOn;
      dbgLog(`Table data id=${id} powerOn: doc = ${doc?.powerOn == null ? "null" : (doc.powerOn ? "ON" : "OFF")}, usr = ${usr?.powerOn == null ? "null" : (usr.powerOn ? "ON" : "OFF")}`);
      items.push(item);
    });
    return items;
  }
};
