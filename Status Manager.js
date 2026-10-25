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

class StatusManager{
	static lightStatusCheck(){
		if(this.basicStatusCheck()) return true;
		this.lightFailInfo();
	}

	static getAgentInfo(){
		return getAgentManager().getAgentInfo();
	}

	static basicStatusCheck(){
		return getAgentManager().checkIfActive();
	}

	static lightFailInfo() {
		Controller.registerClosingOnce(()=>SpreadsheetApp.getUi().alert("Kreator importu z BC nie jest w pełni skonfigurowany dla tego arkusza! Wybierz \"Stan konfiguracji\" z menu dodatku, żeby wznowić poprawne działanie arkusza."),"userAlert");
	}

	static fullStatusCheck(){
		if(!this.basicStatusCheck()) this.forceRefresh();
	}

	static powerOffAllAgentsInFile(){
		getDocumentTriggerLog().powerOffAll();
	}

	/**
	 * Syncs User / Document / Script logs for every item, based on the
	 * combined state of the three logs.
	 *
	 * States:
	 *   User / Document: 'ON' | 'OFF' | 'X'  (X = not logged)
	 *   Script:          'V'  | 'X'          (V = logged/valid, X = not logged)
	 */

	// key = `${userState}|${docState}|${scriptState}`
	// value = actions to take: null means "no action"

	static logCleanUp() {
	  const userLog = this.readUserLog();
	  const docLog = this.readDocLog();
	  const scriptLog = this.readScriptLog();

	  // Union of every item id logged anywhere.
	  const allItemIds = new Set([
	    ...userLog.keys(),
	    ...docLog.keys(),
	    ...scriptLog.keys(),
	  ]);

	  for (const itemId of allItemIds) {
	    const userState = userLog.has(itemId) ? userLog.get(itemId) : 'X';
	    const docState = docLog.has(itemId) ? docLog.get(itemId) : 'X';
	    const scriptState = scriptLog.has(itemId) ? 'V' : 'X';

	    const key = `${userState}|${docState}|${scriptState}`;
	    const actions = ACTION_TABLE[key];

	    dbgLog(`Cleanup for item id ${itemId}. Signature ${key} (U|D|S).`);
	    dbgLog(`Actions for this item`+JSON.stringify(actions));
	    
	    if (!actions) {
	      // Should never happen — all 18 combinations are covered above.
	      dbgLog(`No rule found for item ${itemId}, state ${key}`);
	      continue;
	    }

	    if (actions.user === 'Remove') {
	    	dbgLog(`Removing item with id ${itemId} from user log.`);
	    	getAgentManager().delete(itemId);
	    	getUserTriggerLog().deleteEntryWithTriggerId(itemId);
	    }
	    if (actions.user === 'Reinstate') {
	    	dbgLog(`Unlogged trigger found. Creating new user entry with id ${itemId}`);
	    	TriggerWrapper.logTriggerWithId(itemId);
	    }

	    if (actions.doc === 'Remove'){ 
	    	dbgLog(`Removing item with id ${itemId} from document log.`);
	    	getAgentManager().delete(itemId);
	    	getDocumentTriggerLog().deleteEntryWithTriggerId(itemId);
	    }
	    // (Table never asks to reinstate Document — only User.)

	    if (actions.script === 'Uninstall') {
	    	dbgLog(`Removing (uninstalling) trigger with id ${itemId} from the project.`);
	    	TriggerWrapper.deleteTrigger(itemId);
	    }
	  }
	}

	// ---- TODO: plug in your actual log access -------------------------------
	static readUserLog()   {
		/* return Map<itemId, 'ON'|'OFF'> */ 
		let map = new Map();
		getUserTriggerLog().getTriggerArray().forEach(entry => map.set(entry.triggerId,entry.powerOn ? 'ON' : 'OFF'));
		return map;
	}
	
	static readDocLog()    { 
		/* return Map<itemId, 'ON'|'OFF'> */ 
		let map = new Map();
		getDocumentTriggerLog().getTriggerArray().forEach(entry => map.set(entry.triggerId,entry.powerOn ? 'ON' : 'OFF'));
		return map;
	}

	static readScriptLog() { 
		/* return Map<itemId, true> */ 
		let map = new Map();
		TriggerWrapper.getProjectTriggers().forEach(trigger => map.set(trigger.getUniqueId(),true));
		return map;
	}

	/** Powers off every agent of this file, cleans the three trigger logs up and installs a working agent. Returns the id of the edit trigger. */
	static forceRefresh(){
		dbgLog("Running forceAgentRefresh. Powering off all agents...");
		this.powerOffAllAgentsInFile();
		dbgLog("Agents powered OFF. Clenup...");
		this.logCleanUp();
		dbgLog("Cleanup complete. Repairing status...");
		return this.repairStatus();
	}

	static repairStatus(){
		let editTrigId = getAgentManager().recruitAgent();
		dbgLog("New agent installed. Edit Trigger Id = "+editTrigId);
		if(editTrigId) Controller.registerClosing(() => clearAgentSuspect(null,"agents repaired"));
		return editTrigId;
	}

	static checkTriggerPower(triggerId){
		return getDocumentTriggerLog().getPowerInfo(triggerId) ?? false;
	}

	static getAllProjectTriggers(eventType){
		let triggersInThisDocument = getDocumentTriggerLog().getTriggerArray().map(entry => new ExtTrigInfo(
																									entry.triggerId,
																									entry.trigEventType,
																									entry.trigFunction,
																									entry.dateCreated,
																									entry.lastUsed,
																									entry.SsId,
																									entry.powerOn
																								));

		let triggers = TriggerWrapper.getProjectTriggers().map(trigger => new ExtTrigInfo(
																							trigger.getUniqueId(),
																							trigger.getEventType(),
																							trigger.getHandlerFunction(),
																							"unknown",
																							"unknown",
																							trigger.getTriggerSourceId(),
																							null
																						));

		let triggersInThisUser = getUserTriggerLog().getTriggerArray().map(entry => new ExtTrigInfo(
																									entry.triggerId,
																									entry.trigEventType,
																									entry.trigFunction,
																									entry.dateCreated,
																									entry.lastUsed,
																									entry.SsId,
																									entry.powerOn
																								));

		let allTriggersIds = new Set([
			...triggersInThisDocument.map(entry => entry.triggerId),
			...triggersInThisUser.map(entry => entry.triggerId),
			...triggers.map(entry => entry.triggerId)
		]);

		let allTriggers = [];
		
		allTriggersIds.forEach(id =>{
			let fullInfo =[];
			fullInfo = triggersInThisDocument.find(trigger => trigger.triggerId == id);
			if(fullInfo) return allTriggers.push(fullInfo);
			fullInfo = triggersInThisUser.find(trigger => trigger.triggerId == id);
			if(fullInfo) return allTriggers.push(fullInfo);
			fullInfo = triggers.find(trigger => trigger.triggerId == id);
			if(fullInfo) return allTriggers.push(fullInfo);
		});

		allTriggers.forEach(trigger => {
			trigger.setField("docTriggers",triggersInThisDocument.find(t => t.triggerId == trigger.triggerId) != null);
			trigger.setField("usrTriggers",triggersInThisUser.find(t => t.triggerId == trigger.triggerId) != null);
			trigger.setField("scriptTriggers",triggers.find(t => t.triggerId == trigger.triggerId) != null);

			let docPowerOn = triggersInThisDocument.find(t => t.triggerId == trigger.triggerId)?.powerOn;
			let usrPowerOn = triggersInThisUser.find(t => t.triggerId == trigger.triggerId)?.powerOn;
			let scriptPowerOn = triggers.find(t => t.triggerId == trigger.triggerId)?.powerOn;
			dbgLog(`Table data id=${trigger.triggerId} powerOn: doc = ${docPowerOn == null ? "null" : (docPowerOn ? "ON" : "OFF")}, usr = ${usrPowerOn == null ? "null" : (usrPowerOn ? "ON" : "OFF")}, script = ${scriptPowerOn == null ? "null" : (scriptPowerOn ? "ON" : "OFF")} (current value ${docPowerOn == null ? "null" : (docPowerOn ? "ON" : "OFF")})`);
			trigger.setField("powerOn",triggersInThisDocument.find(t => t.triggerId == trigger.triggerId)?.powerOn || triggersInThisUser.find(t => t.triggerId == trigger.triggerId)?.powerOn);
		});

		let res = allTriggers.map(entry => entry.getEntryAsArray());
		// dbgLog(res);

		res.unshift(ExtTrigInfo.getHeaders());
		res.forEach((val,i) => val.unshift(i));
		res[0][0] = "No";

		dbgLog("Return table:");
		dbgLog(res);
		return res;
	}

	static triggerTableSidebar(){
		const html = HtmlService.createTemplateFromFile('Trigger Table').evaluate()
      		.setTitle('Wszystkie Triggery w projekcie');
  		SpreadsheetApp.getUi() // Or DocumentApp or SlidesApp or FormApp.
      		.showSidebar(html);
	}

	static statusSidebar(){
		const html = HtmlService.createTemplateFromFile('New Status Sidebar').evaluate()
      		.setTitle('Konfiguracja');
  		SpreadsheetApp.getUi() // Or DocumentApp or SlidesApp or FormApp.
      		.showSidebar(html);
	}
}

function getAgentStatus(){
  // let trigInfo = StatusManager.getAgentInfo();
  return Controller.run("requestAgentStatus",() => [StatusManager.basicStatusCheck(),MainSettings.getAddonStatus()]);
  let res = StatusManager.basicStatusCheck() ? "Agent active <br />" : "Agent NOT active <br />";
  res += "Edit Triggers:<br />";
  res += trigInfo.editTriggers?.length<=0 ? "- <br />" : trigInfo.editTriggers.map(trigInfo => trigInfo.triggerId + " " + (trigInfo.powerOn ? "ON" : "OFF") + "<br />");
  res += "Change Triggers:<br />";
  res += trigInfo.changeTriggers?.length<=0 ? "- <br />" : trigInfo.changeTriggers.map(trigInfo => trigInfo.triggerId + " " + (trigInfo.powerOn ? "ON" : "OFF") + "<br />");
  return res;  
}

/** Entry point (sidebar button): repairs the agents. The work is StatusManager.forceRefresh(), which the status check after turning the add-on on uses too. */
function forceAgentRefresh(){
  Controller.run("forceAgentRefresh", () => StatusManager.forceRefresh());
}


class ExtTrigInfo{
	constructor(triggerId,trigEventType,trigFunction,dateCreated,lastUsed,SsId,powerOn){
			this.triggerId = triggerId;
			this.trigEventType = trigEventType;
			this.trigFunction = trigFunction;
			this.dateCreated = dateCreated;
			this.lastUsed = lastUsed;
			this.SsId = SsId;
			this.powerOn = powerOn;
			this.docTriggers = null;
			this.usrTriggers = null;
			this.scriptTriggers = null;
	}

	setField(fieldName,fieldValue){
		this[fieldName] = fieldValue;
		return this;
	}

	getEntryAsArray(){
		return [
			this.trigEventType,
			this.triggerId,
			// this.SsId,
			// this.SsId ? SpreadsheetApp.openById(this.SsId).getName() : "-",
		    this.SsId ? "<a href=\""+ SpreadsheetApp.openById(this.SsId).getUrl() + "\"> " + SpreadsheetApp.openById(this.SsId).getName() + "</a>" : "-",
			this.trigFunction,
			
			this.dateCreated,
			this.lastUsed,
			this.powerOn ? "ON" : "OFF",

			this.docTriggers == null ? "?" : (this.docTriggers ? "✓" : "✗"),
			this.usrTriggers == null ? "?" : (this.usrTriggers ? "✓" : "✗"),
			this.scriptTriggers == null ? "?" : (this.scriptTriggers ? "✓" : "✗")
		];
	}

	static getHeaders(){
		return ["Event","Trigger Id","Source",/*,"Source name","Source URL"*/"Function","Created","Last Used","Power","Doc","Usr","Script"];
	}
}