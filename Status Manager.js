class StatusManager{
	static lightStatusCheck(){
		if(this.basicStatusCheck()) return true;
		this.lightFailInfo();
	}

	// The agent service is Agents (Agents.js); these names stay as forwarders for the callers and tests that use them.
	static getAgentInfo(){ return Agents.info(); }

	static basicStatusCheck(){ return Agents.isActive(); }

	static lightFailInfo() {
		Controller.registerClosingOnce(()=>SpreadsheetApp.getUi().alert("Kreator importu z BC nie jest w pełni skonfigurowany dla tego arkusza! Wybierz \"Stan konfiguracji\" z menu dodatku, żeby wznowić poprawne działanie arkusza."),"userAlert");
	}

	static fullStatusCheck(){ Agents.ensureActive(); }

	static powerOffAllAgentsInFile(){ Agents.powerOffAll(); }

	static logCleanUp(){ Agents.cleanUp(); }

	/** Powers off every agent of this file, cleans the three trigger logs up and installs a working agent. Returns the id of the edit trigger. */
	static forceRefresh(){ return Agents.repair(); }

	static repairStatus(){ return Agents.install(); }

	static checkTriggerPower(triggerId){ return Agents.isPowered(triggerId); }

	/** The rows of the "Wszystkie triggery" table (the first row is the header; the cells are HTML). The facts come from Agents.snapshot(). */
	static getAllProjectTriggers(eventType){
		let res = Agents.snapshot().map(item => new ExtTrigInfo(item.triggerId,item.event,item.function,item.created,item.lastUsed,item.ssId,item.powerOn)
			.setField("docTriggers",item.inDocLog).setField("usrTriggers",item.inUserLog).setField("scriptTriggers",item.inProject)
			.getEntryAsArray());

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