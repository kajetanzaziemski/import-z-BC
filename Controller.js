const Controller = (function () {
  const initActions = [];      // registered once, at "load" time (top-level code)
  let closingActions = [];     // reset per run

  const flags = [];

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

  /** Live check around an entry point that does not use run(). Passes the result and errors through. */
  function checked(actionName, actionFn, input) {
    if(typeof liveCheckGuard !== "function") return actionFn();
    return liveCheckGuard(actionName, actionFn, input);
  }

  function run(actionName, actionFn, e) {
    closingActions = []; // fresh for this execution
    const check = checkBegin(actionName);

    dbgLog(`Running ${actionName}. Test returns ${/^menu/.test(actionName)}`);
    if(/^menu/.test(actionName)){ 
      dbgLog(`Truning Addon On...`);
      MainSettings.setAddonStatus("ON");
    }
    if(!MainSettings.getAddonStatus() && !/^request/.test(actionName)) {
      dbgLog("Addon OFF. Quitting.");
      checkEnd(check, undefined, null, "addon-off");
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
    try {
      initActions.forEach(fn => fn(ctx));
      result = actionFn(ctx);
    } catch (err) {
      error = err;
      console.error(`[${actionName}]\n ${err.stack || err}`);
      if(e instanceof UnknownError) throw e.unknownError;
    } finally {
      closingActions.forEach((fn,i)=> {
        try { fn(ctx, error, result); }
        catch (closeErr) { console.error(`[${actionName}] closing action failed:\n ${closeErr}`); }
      });
    }

    checkEnd(check, error, result);
    if (error) throw error; // or swallow, depending on how you want entry points to behave
    return result;
  }

  return { registerInit, registerClosing, registerClosingOnce, run, checked, checkInput, checkNote };
})();