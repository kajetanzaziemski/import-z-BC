// ---------------------------------------------------------------------------
// AGENT RECONCILER: decides what to do with every trigger id that any of the three records knows about. Pure: no platform call, no log access,
// no global - it gets three maps and returns a plan; Agents.cleanUp() (Agents.js) reads the maps and carries the plan out.
// States: user / document log: 'ON' | 'OFF' | 'X' (not logged); project triggers: 'V' (the trigger exists) | 'X'.
// docs/agent-lifecycle.md explains the rows; tests/agents.test.js pins the outcome of every combination (one combination has no row: ON|OFF|V).
// ---------------------------------------------------------------------------

// key = `${userState}|${docState}|${scriptState}`
// value = actions to take: null means "no action"
const ACTION_TABLE = {
  'ON|ON|V':   { user: null,        doc: null,     script: null },
  'ON|ON|X':   { user: 'Remove',    doc: 'Remove', script: null },
  'ON|OFF|X':  { user: 'Remove',    doc: 'Remove', script: null },
  'ON|X|V':    { user: null,    doc: null,     script: null },
  'ON|X|X':    { user: 'Remove',    doc: null,     script: null },
  'OFF|ON|V':  { user: 'Remove',    doc: 'Remove', script: 'Uninstall' },
  'OFF|ON|X':  { user: 'Remove',    doc: 'Remove', script: null },
  'OFF|OFF|V': { user: 'Remove',    doc: 'Remove', script: 'Uninstall' },
  'OFF|OFF|X': { user: 'Remove',    doc: 'Remove', script: null },
  'OFF|X|V':   { user: 'Remove',    doc: null,     script: 'Uninstall' },
  'OFF|X|X':   { user: 'Remove',    doc: null,     script: null },
  'X|ON|V':    { user: 'Reinstate', doc: null,     script: null },
  'X|ON|X':    { user: null,        doc: null,     script: null },
  'X|OFF|V':   { user: null,        doc: 'Remove', script: 'Uninstall' },
  'X|OFF|X':   { user: null,        doc: null,     script: null },
  'X|X|V':     { user: null,        doc: null,     script: null },
  'X|X|X':     { user: null,        doc: null,     script: null },
};

const AgentReconciler = {
  /**
   * @param userLog {Map<String,String>} trigger id -> 'ON' | 'OFF'
   * @param docLog {Map<String,String>} trigger id -> 'ON' | 'OFF'
   * @param scriptLog {Map<String,Boolean>} trigger id -> true for every existing project trigger
   * @returns {{itemId: String, key: String, actions: Object|undefined}[]} one entry per id, in the order user log, document log, project triggers;
   *   `actions` is undefined for a combination the table has no row for.
   */
  plan(userLog, docLog, scriptLog) {
    const allItemIds = new Set([...userLog.keys(), ...docLog.keys(), ...scriptLog.keys()]);   // union of every item id logged anywhere
    const plan = [];
    for (const itemId of allItemIds) {
      const userState = userLog.has(itemId) ? userLog.get(itemId) : 'X';
      const docState = docLog.has(itemId) ? docLog.get(itemId) : 'X';
      const scriptState = scriptLog.has(itemId) ? 'V' : 'X';
      const key = `${userState}|${docState}|${scriptState}`;
      plan.push({ itemId: itemId, key: key, actions: ACTION_TABLE[key] });
    }
    return plan;
  }
};
