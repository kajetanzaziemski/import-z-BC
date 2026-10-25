const Controller = (function () {
  const initActions = [];      // registered once, at "load" time (top-level code)
  let closingActions = [];     // reset per run

  const flags = [];
  let depth = 0;               // 1 while a run (its action or its closing actions) is in progress; a run started then would be nested (see run())
  let currentAction = null;
  const MAX_CLOSING_ACTIONS = 200;

  function registerInit(fn) {
    initActions.push(fn);
  }

  function registerClosingOnce(fn,flag) {
    if(flags.includes(flag)) return;
    registerClosing(fn);
    flags.push(flag);
  }

  function registerClosing(fn) {
    // called *during* the action to add a cleanup step for this run
    closingActions.push(fn);
  }

  // Live check helpers ("Live Check.js") are optional: without that file all of the below does nothing.
  function checkBegin(actionName) {
    return typeof liveCheckBegin === "function" ? liveCheckBegin(actionName) : null;
  }

  function checkEnd(check, error, result, note) {
    if(check && typeof liveCheckEnd === "function") liveCheckEnd(check, error, result, note);
  }

  /** Hands the live check of an action what it was called with (event object, arguments). Call right before the action. */
  function checkInput(actionName, data) {
    if(typeof liveCheckInput === "function") liveCheckInput(actionName, data);
  }

  /** Leaves the live check of the running action a note about a decision taken. */
  function checkNote(text) {
    if(typeof liveCheckNote === "function") liveCheckNote(text);
  }

  /**
   * Tells the live check what the running entry point is actually doing (the router calls it): the same technical trigger can mean very different
   * jobs. data = { sheet, changeType }. Nothing happens without the live check files.
   */
  function intent(name, data) {
    if(typeof liveCheckIntent === "function") liveCheckIntent(name, data);
  }

  /**
   * Wraps ONE entry point of the add-on (a trigger, a menu item, a sidebar call, the OAuth callback): the ON/OFF gate, the initial actions, the action,
   * its error handling and the closing actions (the saves of the settings and logs, the alerts). Every platform entry goes through here; the only
   * exception is building the menu in onOpen (it must be fast and work in every auth mode).
   *
   * Entry points do not call each other, so runs do not nest: a run started while another is in progress (from its action or its closing actions) is a
   * mistake. It is reported (console.error "NESTED RUN") and its action is done inline, without a gate, closing list or live-check frame of its own.
   * Shared work belongs in a use case that both callers use.
   *
   * One run per execution is the rule (every platform call is a fresh execution). The state objects (the settings, the trigger logs) live for the
   * execution and register their save when they are built, so a second top-level run in the same execution (the script editor, tests) does not
   * save what those objects change; registerClosingOnce flags last for the execution too.
   *
   * Closing actions registered BEFORE the run (an entry point may touch the settings in its own log line, which builds the settings object and registers
   * its save) belong to it, and so do those registered while the closing actions run (e.g. the saves of the trigger logs when the status check repairs the
   * agents): the closing phase goes on until nothing is left (docs/bugs-todo.md #1, #2).
   */
  function run(actionName, actionFn, e) {
    if(depth > 0) {
      console.error(`NESTED RUN: Controller.run("${actionName}") was called while "${currentAction}" is running. Entry points must not call each other - move the shared work to a use case. Doing it inline.`);
      return actionFn({event: e, actionName: actionName, registerClosing: registerClosing, data: {}});
    }
    const check = checkBegin(actionName);

    dbgLog(`Running ${actionName}. Test returns ${/^menu/.test(actionName)}`);
    if(/^menu/.test(actionName)){ 
      dbgLog(`Truning Addon On...`);
      MainSettings.setAddonStatus("ON");
    }
    if(!MainSettings.getAddonStatus() && !/^request/.test(actionName)) {
      dbgLog("Addon OFF. Quitting.");
      checkEnd(check, undefined, null, "addon-off");
      closingActions = [];      // nothing runs, what was registered before is dropped
      return null;
    }
    dbgLog(`Running ${actionName}...`);

    const ctx = {
      event: e,
      actionName: actionName,
      registerClosing: registerClosing,
      data: {}            // scratch space init/action/closing can share
    };

    let result, error;
    depth++;
    currentAction = actionName;
    try {
      initActions.forEach(fn => fn(ctx));
      result = actionFn(ctx);
    } catch (err) {
      error = err;
      console.error(`[${actionName}]\n ${err.stack || err}`);
      if(e instanceof UnknownError) throw e.unknownError;
    } finally {
      // by index and length read every time: what a closing action registers is run after the ones already queued
      for(let i = 0; i < closingActions.length; i++) {
        if(i >= MAX_CLOSING_ACTIONS) { console.error(`[${actionName}] closing actions: gave up after ${MAX_CLOSING_ACTIONS} (an action keeps registering more?)`); break; }
        try { closingActions[i](ctx, error, result); }
        catch (closeErr) { console.error(`[${actionName}] closing action failed:\n ${closeErr}`); }
      }
      depth--;
      closingActions = [];      // done: the next run starts clean
    }

    checkEnd(check, error, result);
    if (error) throw error; // or swallow, depending on how you want entry points to behave
    return result;
  }

  return { registerInit, registerClosing, registerClosingOnce, run, checkInput, checkNote, intent };
})();