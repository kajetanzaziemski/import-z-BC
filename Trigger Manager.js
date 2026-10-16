class StorageArray{
	constructor(key,store){
		if(!(store=="document"||store=="user"||store=="script")) throw new SimpleError("Storage Array store argument must be 'document','user' or 'script'");
		this.key = key;
		this.store = store;
		this.storageArray = this.recreateFromStore();
		Controller.registerClosingOnce(()=>this.saveArray(),key+store);
	}

	getArray(){
		return this.storageArray;
	}

	recreateFromStore(){
		return JSON.parse(HelperDataStore.getPropertyValue(this.store,this.key) || "[]");
	}

	saveArray(){
		dbgLog(`Saving array ${this.key}.${this.store}. Array reads:`);
		dbgLog(JSON.stringify(this.getArray()));
		HelperDataStore.setPropertyValue(this.store,this.key,JSON.stringify(this.getArray()));
	}

	clearStorage(){
		HelperDataStore.deleteProperty(this.store,this.key);
	}
}

class StorageObject extends StorageArray{
	constructor(key,store){
		super(key,store);
		this.dirtyKeys = new Set();
	}

	recreateFromStore(){
		return JSON.parse(HelperDataStore.getPropertyValue(this.store,this.key) || "{}");
	}

	setProperty(name,value){
		this.storageArray[name]=value;
		this.dirtyKeys.add(name);
		return this;
	}

	getProperty(name){
		return this.storageArray[name];
	}

	/**
	 * Reads a property straight from the store, ignoring the snapshot taken when this object was created.
	 * Use it when a decision must be made on the current value (e.g. a permit that may have been reissued
	 * by another execution while this one was running).
	 */
	getFreshProperty(name){
		return this.recreateFromStore()[name];
	}

	/**
	 * Saves only the keys changed through setProperty(), merged into the current stored object.
	 * Several executions can run concurrently (onEdit + onChange + time triggers) and each holds a snapshot
	 * taken at its start; writing the whole snapshot back would revert changes made meanwhile by the others.
	 */
	saveArray(){
		if(this.dirtyKeys.size == 0) return;
		const lock = LockService.getScriptLock();
		let locked = false;
		try{ locked = lock.tryLock(10000); } catch(e) { dbgLog(`StorageObject ${this.key}: could not acquire lock: ${e}`); }
		try{
			const stored = this.recreateFromStore();
			this.dirtyKeys.forEach(name => stored[name] = this.storageArray[name]);
			dbgLog(`Saving object ${this.key}.${this.store}. Changed keys: ${[...this.dirtyKeys].join(", ")}`);
			HelperDataStore.setPropertyValue(this.store,this.key,JSON.stringify(stored));
			this.storageArray = stored;
			this.dirtyKeys.clear();
		} finally {
			if(locked) lock.releaseLock();
		}
	}
}

class AgentManager{
	constructor(key,limit=5){
		this.agentStorage = new StorageArray(key,"user");
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
		TriggerWrapper.deleteAllUserEditTriggersInDocument().deleteAllUserChangeTriggersInDocument();
		let editId = TriggerWrapper.createOnEditTrigger("sheetEdit");
		let changeId = TriggerWrapper.createOnChangeTrigger("sheetChange");
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
		TriggerWrapper.deleteTrigger(editId).deleteTrigger(changeId);
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

class TriggerWrapper{
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
			TriggerWrapper.triggerPowerOff(triggerEntry.triggerId);
		});
		let changeTriggers = this.getAllOfFunction("sheetChange",true);
		changeTriggers.forEach(triggerEntry => {
			TriggerWrapper.triggerPowerOff(triggerEntry.triggerId);
		});
	}
}

const DOC_TRIG_ARRAY_KEY = "docTriggerArray";

class DocumentTriggerLog extends TriggerLog{
	recreateFromStore(){
		return JSON.parse(HelperDataStore.getDocumentPropertyValue(DOC_TRIG_ARRAY_KEY) || "[]");
	}

	saveTriggerLog(){
		HelperDataStore.setDocumentPropertyValue(DOC_TRIG_ARRAY_KEY,JSON.stringify(this.getTriggerArray()));

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
		return JSON.parse(HelperDataStore.getUserPropertyValue(USR_TRIG_ARRAY_KEY) || "[]");
	}

	saveTriggerLog(){
		HelperDataStore.setUserPropertyValue(USR_TRIG_ARRAY_KEY,JSON.stringify(this.getTriggerArray()));

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