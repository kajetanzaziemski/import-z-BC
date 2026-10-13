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

  function run(actionName, actionFn, e) {
    closingActions = []; // fresh for this execution

    Logger.log(`Running ${actionName}. Test returns ${/^menu/.test(actionName)}`);
    if(/^menu/.test(actionName)){ 
      Logger.log(`Truning Addon On...`);
      MainSettings.setAddonStatus("ON");
    }
    if(!MainSettings.getAddonStatus() && !/^request/.test(actionName)) {
      Logger.log("Addon OFF. Quitting.");
      return null;
    }
    Logger.log(`Running ${actionName}...`);

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

    if (error) throw error; // or swallow, depending on how you want entry points to behave
    return result;
  }

  return { registerInit, registerClosing, registerClosingOnce, run };
})();