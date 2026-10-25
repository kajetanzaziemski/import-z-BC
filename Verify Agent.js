// ---------------------------------------------------------------------------
// VERIFY AGENT (use case): a user edited the document and the simple onEdit trigger asks "did the agent (the installable sheetEdit) see this edit too?".
// Agents.verifyEdit() waits for the agent's record and judges; here the verdict is acted on:
//   ok          nothing
//   suspect     first miss: the user is told (alert when the run closes); the agents stay powered on
//   dead        second miss without an installable run in between: all agents of this file are powered OFF, the user is told
//   dead-known  the agents are already powered off (the user was told before): nothing more
// ---------------------------------------------------------------------------

const VerifyAgent = {
  /** @param e {Object} The simple onEdit event. */
  run(e) {
    const fp = fingerprint(e);
    const { verdict } = Agents.verifyEdit(fp);
    if (verdict === 'ok') return;
    if (verdict === 'dead-known') {
      agentLog("SIMPLE",fp,"Agents are already powered off (user has been warned before). Not powering off again, not showing the alert again.");
      return;
    }
    if (verdict === 'dead') {
      agentLog("SIMPLE",fp,"Powering OFF all agents in this file.");
      Agents.powerOffAll();
    }
    agentLog("SIMPLE",fp,"Showing the 'agent not configured' alert to the user (shown when this execution closes).");
    StatusManager.lightFailInfo();
  }
};
