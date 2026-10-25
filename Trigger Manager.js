class AgentManager{
	constructor(key,limit=5){
		this.agentStorage = Store.array(key,"user");
		this.limit = limit;
		dbgLog(`Array ${key} pulled from store:`);
		dbgLog(this.agentStorage.storageArray);
	}

	checkIfActive(){
		let editTriggers = getDocumentTriggerLog().getAllOfFunction("sheetEdit",true);
		if(editTriggers.length <= 0) return false;
		let changeTriggers = getDocumentTriggerLog().getAllOfFunction("sheetChange",true);
		if(changeTriggers.length <= 0) return false;
		return true;
	}

	getAgentInfo(){
		return {
			editTriggers: getDocumentTriggerLog().getAllOfFunction("sheetEdit",null),
			changeTriggers: getDocumentTriggerLog().getAllOfFunction("sheetChange",null)
		}
	}

	deleteAllInDocument(){
		let editTriggers = getDocumentTriggerLog().getAllOfFunction("sheetEdit",null);
		editTriggers.forEach({

		});
	}

	deleteAll() {
		let allIds = this.agentStorage.storageArray.map(elem => elem[0]);
		allIds.forEach(id => {
			dbgLog(`Trying to delete item with id ${id}`);
			this.delete(id);
		});
	}

	recruitAgent(){
		if(this.checkIfActive()) {
			dbgLog("AgentManager::recruitAgent(): Agent active. No need to recruit.");
			return getDocumentTriggerLog().getAllOfFunction("sheetEdit",true)[0].triggerId;
		}
		dbgLog("AgentManager::recruitAgent(): No of regeistered agents: "+this.agentStorage.storageArray.length);
		if(this.agentStorage.storageArray.length >= this.limit) return this.reclaimAgent();
		return this.installNew();
	}

	reclaimAgent(){
		dbgLog(`AgentManager::reclaimAgent() running...`);
		return this.deleteOldest().installNew();
	}

	installNew(){
		TriggerGateway.deleteAllUserEditTriggersInDocument().deleteAllUserChangeTriggersInDocument();
		let editId = TriggerGateway.createOnEditTrigger("sheetEdit");
		let changeId = TriggerGateway.createOnChangeTrigger("sheetChange");
		this.saveToStorageArray(editId,changeId);
		return editId;
	}

	saveToStorageArray(editId,changeId){
		this.agentStorage.storageArray.push([editId,changeId]);
		dbgLog(`Saved values [${editId}],[${changeId}]. Array now reads:`);
		dbgLog(this.agentStorage.storageArray);
	}

	delete(editId){
		let agentIdPair = this.agentStorage.storageArray.find(elem => elem.includes(editId));
		if(!agentIdPair){
			dbgLog("No agent with this editId. Quitting.");
			return this;
		}
		let changeId = agentIdPair.filter(elem => elem != editId)[0];
		dbgLog("ChangeId indentified as "+changeId);
		TriggerGateway.deleteTrigger(editId).deleteTrigger(changeId);
		let agentIdPairIndex = this.agentStorage.storageArray.findIndex(elem => elem.includes(editId));
		this.agentStorage.storageArray.splice(agentIdPairIndex,1);
		return this;
	}

	deleteOldest(){
		let trigId = getUserTriggerLog().getOldest(ScriptApp.EventType.ON_EDIT)?.triggerId;
		dbgLog(`AgentManager::deleteOldest(): Oldest trigger ${trigId ?? 'NULL'}`);
	  	return this.delete(trigId);
	}
}

function deleteAllAgents() {
	Controller.run("requestDeleteAllAgents",()=>getAgentManager().deleteAll());
}

class TriggerManager{

}

class TriggerGateway{
	/** 
	 * This function is intended as PRIVATE. Do not call this from outside the class.
	 * 
	 * _safeRun wraps unknow erros in UnknownError Error Type with message that should indicate where the error occured.
	 */
	static _safeRun(action, errorMessage){
		try{
			return action();
		} catch (e) {
			if(e instanceof SimpleError) throw e;
			throw new UnknownError(errorMessage,e);
		}
	}

	static createOnChangeTrigger(targetFunction){
  		if(this.getUserTriggers().find(trigger => trigger.getEventType() === ScriptApp.EventType.ON_CHANGE)) throw new SimpleError("Nie można utworzyć OnChange Trigger, ponieważ inny OnChange Trigger już istnieje dla tego arkusza i użytkownika.");
  		let newTrigger = this._safeRun(
  			() => ScriptApp.newTrigger(targetFunction).forSpreadsheet(this.getActiveSpreadsheet()).onChange().create(),
  			"Unknown Error occured when creating onChange Trigger with "+targetFunction+ ". There was no other onChange triggers for this user and spreadsheet."
  		);
	    this.logNewTrigger(newTrigger);
  		return newTrigger.getUniqueId();
  	}

  	static createOnEditTrigger(targetFunction){
  		if(this.getUserTriggers().find(trigger => trigger.getEventType() === ScriptApp.EventType.ON_EDIT)) throw new SimpleError("Nie można utworzyć OnEdit Trigger, ponieważ inny OnEdit Trigger już istnieje dla tego arkusza i użytkownika.");
  		let newTrigger = this._safeRun(
  			() => ScriptApp.newTrigger(targetFunction).forSpreadsheet(this.getActiveSpreadsheet()).onEdit().create(),
  			"Unknown Error occured when creating onEdit Trigger with "+targetFunction+ ". There was no other onEdit triggers for this user and spreadsheet."
  		);
	    this.logNewTrigger(newTrigger);
  		return newTrigger.getUniqueId();
  	}

  	static deleteTrigger(trigId){
  		dbgLog(`deleteTrigger called with trigId = ${trigId}. Typeof trigId ${typeof(trigId)}.`);
  		dbgLog(`Project triggers: ` + this.getProjectTriggers().map(trig => trig.getUniqueId()).join('\n'));
  		let trigger = typeof(trigId)=='string' ? this.getProjectTriggers().find(trig => trig.getUniqueId() == trigId) : trigId;
  		if(!trigger){  			
  			dbgLog("No trigger with id "+trigId+" found. Nothing to delete. Deleting Trigger Log entries and quitting.");
  		}
  		else this._safeRun(
  			() => ScriptApp.deleteTrigger(trigger),
  			"Unknown Error occured when attempting to delete trigger "+trigId
  		);
  		if(getDocumentTriggerLog().deleteEntryWithTriggerId(trigId,true)) getUserTriggerLog().deleteEntryWithTriggerId(trigId);
  		return this;
  	}

  	static deleteAllUserEditTriggersInDocument(){
  		return this.deleteAllUserTriggersInDocument(ScriptApp.EventType.ON_EDIT);
  	}

  	static deleteAllUserChangeTriggersInDocument(){
  		return this.deleteAllUserTriggersInDocument(ScriptApp.EventType.ON_CHANGE);  		
  	}

  	static deleteAllUserTriggersInDocument(eventType){
  		this.getUserTriggers().filter(trigger => trigger.getEventType() === eventType).forEach(trigger => this.deleteTrigger(trigger));
  		return this;
  	}

  	static logNewTrigger(newTrigger){
  		getDocumentTriggerLog().logNewTrigger(newTrigger);
  		getUserTriggerLog().logNewTrigger(newTrigger);
  	}

  	static logTriggerWithId(trigId){
  		let trigger = this.getUserTriggers().find(trigger => trigger.getUniqueId() === trigId);
  		if(!trigger){
  			dbgLog(`Tried to log trigger with id ${trigId}. No such trigger found. Quitting.`);
  			return;
  		}
  		this.logNewTrigger(trigger);
  	}

  	static getUserTriggers(){
  		return this._safeRun(
  			() => ScriptApp.getUserTriggers(SpreadsheetApp.getActiveSpreadsheet()),
  			"Unknown Error occured when accessing ScriptApp.getUserTrigers() for spreadsheet" + SpreadsheetApp.getActiveSpreadsheet().getId()
  		);
  	}

  	static getProjectTriggers(){
  		return this._safeRun(
  			() => ScriptApp.getProjectTriggers(),
  			"Unknown Error occured when accessing ScriptApp.getProjectTriggers()."
  		);
  	}

  	static getActiveSpreadsheet(){
  		return this._safeRun(
  			() => SpreadsheetApp.getActiveSpreadsheet(),
  			"Unknown Error occued when accessing Active Spreadsheet."
  		)
  	}

  	static logTriggerUsed(trigId){
  		dbgLog("Log trigger Used, id = "+trigId);
  		if(!trigId) return;
  		getDocumentTriggerLog().markLastUsed(trigId);
  		dbgLog("Document Trigger Log updated. Now reads:"+getDocumentTriggerLog().getTriggerArray().map(entry => JSON.stringify(entry)));
  		getUserTriggerLog().markLastUsed(trigId);
  		dbgLog("User Trigger Log updated. Now reads:"+getUserTriggerLog().getTriggerArray().map(entry => JSON.stringify(entry)));
  	}

  	static triggerPowerOff(trigId){
  		getDocumentTriggerLog().setPowerOn(trigId,false);
  		getUserTriggerLog().setPowerOn(trigId,false);
  		return this;
  	}
}

class TriggerLog{
	constructor(){
		this.triggerArray = this.recreateFromStore();
		Controller.registerClosingOnce(()=>this.saveTriggerLog(),this.constructor.name);
		dbgLog(`${this.constructor.name} on construction:`);
    	dbgLog(this.getTriggerArray().map(entry => JSON.stringify(entry)).join("\n"));
	}

	recreateFromStore(){
		// Empty for inheriting.
	}
	
	saveTriggerLog(){
		// Empty for inheriting.
	}

	// This function might require checks etc. for when trigger is not a proper Trigge class!
	logNewTrigger(trigger,silentFail=true){
		let trigId = trigger.getUniqueId();
		if(this.isTriggerLogged(trigId)) if(silentFail) return; else throw SimpleError("Can't log already existing trigger.");
		this.triggerArray.push(new TriggerInfoEntry(trigger));
	}
	
	deleteEntryWithTriggerId(triggerId,returnSuccess=false){
		let index = this.triggerArray.findIndex(elem => elem.triggerId == triggerId);
		if(index<0){
			dbgLog(`No element with Trigger Id ${triggerId} found. Nothing to delete. Quitting.`);
			if(returnSuccess) return false;
			return this;
		}
		this.triggerArray.splice(index,1);
		if(returnSuccess) return true;
		return this;
	}

	deleteAll(){
		let allIds = this.triggerArray.map(elem => elem.triggerId);
		allIds.forEach(id => this.deleteEntryWithTriggerId(id));
	}

	getTriggerArray(){
		return this.triggerArray;
	}

	getEntryById(triggerId){
		return this.triggerArray.find(entry => entry.triggerId == triggerId);
	}

	isTriggerLogged(triggerId){
    	return this.getEntryById(triggerId) != null;
	}

	markLastUsed(triggerId){
		if(!this.getEntryById(triggerId)) return this;
		this.getEntryById(triggerId).lastUsed = new Date();
		return this;
	}

	setPowerOn(triggerId,powerOn=true){
		let triggerEntry = this.getEntryById(triggerId);
		if(triggerEntry) triggerEntry.powerOn = powerOn;
		return this;
	}

	getAllOfType(triggerEventType){
		return this.triggerArray.filter(elem => elem.trigEventType == triggerEventType);
	}

	getAllOfFunction(triggerFunction,powerOn=true){
		return this.triggerArray.filter(elem => elem.trigFunction == triggerFunction).filter(elem => elem.powerOn == (powerOn ?? elem.powerOn));
	}

	getOldest(triggerEventType){
		return this.getAllOfType(triggerEventType).sort((a,b)=>b.lastUsed-a.lastUsed)[0] ?? null;
	}

	getPowerInfo(triggerId){
		return this.getEntryById(triggerId)?.powerOn;
	}

	powerOffAll(){
		let editTriggers = this.getAllOfFunction("sheetEdit",true);
		editTriggers.forEach(triggerEntry => {
			TriggerGateway.triggerPowerOff(triggerEntry.triggerId);
		});
		let changeTriggers = this.getAllOfFunction("sheetChange",true);
		changeTriggers.forEach(triggerEntry => {
			TriggerGateway.triggerPowerOff(triggerEntry.triggerId);
		});
	}
}

const DOC_TRIG_ARRAY_KEY = "docTriggerArray";

class DocumentTriggerLog extends TriggerLog{
	recreateFromStore(){
		return Store.getJson("document",DOC_TRIG_ARRAY_KEY,[]);
	}

	saveTriggerLog(){
		Store.setJson("document",DOC_TRIG_ARRAY_KEY,this.getTriggerArray());

		dbgLog("DOC After saving Trigger Log:");
  		dbgLog(this.triggerArray);
	}
}

function deleteAllInDocumentTriggerLog() {
	Controller.run("deleteAllInDocumentTriggerLog",()=>getDocumentTriggerLog().deleteAll());
}

const USR_TRIG_ARRAY_KEY = "usrTriggerArray";

class UserTriggerLog extends TriggerLog{
	recreateFromStore(){
		return Store.getJson("user",USR_TRIG_ARRAY_KEY,[]);
	}

	saveTriggerLog(){
		Store.setJson("user",USR_TRIG_ARRAY_KEY,this.getTriggerArray());

		dbgLog("USR After saving Trigger Log:");
  		dbgLog(this.triggerArray);
	}
}

function deleteAllInUserTriggerLog() {
	Controller.run("deleteAllInUserTriggerLog",()=>getUserTriggerLog().deleteAll());
}

class TriggerInfoEntry{
	constructor(trigger){
		this.triggerId = trigger?.getUniqueId();
		this.trigEventType = trigger?.getEventType();
		this.trigFunction = trigger?.getHandlerFunction();
		this.dateCreated = trigger==null ? null : new Date();
		this.lastUsed = trigger==null ? null : new Date();
		this.SsId = trigger==null ? null : SpreadsheetApp.getActiveSpreadsheet().getId();
		this.powerOn = trigger==null ? null : true;
	}
}

/** The old name (Test Functions.js and anything else that still says it). */
const TriggerWrapper = TriggerGateway;
