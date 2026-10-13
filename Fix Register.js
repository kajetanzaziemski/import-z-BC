class Fix{
  constructor(fixKey,position,params,priority=10){
    this.key = fixKey;
    this.rowNumber = position;
    this.params = Array.isArray(params) ? params : [params];
    this.priority = priority;
  }
}

class FixRegister{
  /**
   * 
   */
  constructor(){
    this.register = [];
  }

  /**
   * 
   */
  logFix(fixKey,position,params,priority){
    this.register.push(new Fix(fixKey,position,params,priority));
    return this;
  }

  /**
   * 
   */
  logFixIfNotExists(key,position,params,priority){
    if(!this.exists(key)) this.logFix(key,position,params,priority);
    return this;
  }

  /**
   * 
   */
  logFixOverride(key,position,params,priority){
    let i = this.lastIndex(key);
    if(i>=0) this.register[i] = new Fix(key,position,params,priority);
    else this.logFix(key,position,params);
    return this;
  }

  /**
   * 
   */
  removeLast(key){
    this.register.splice(this.lastIndex(key),1);
    return this;
  }

  /**
   * 
   */
  removeAll(key){
    if(!key) this.register = [];
    else this.register = this.register.filter(item => item.key!=key);
    return this;
  }

  // Read from the Register
  /**
   * 
   */
  exists(key){
    return this.firstIndex(key)>=0;
  }

  /**
   * 
   */
  firstIndex(key){
    return this.register.findIndex(item => item.key==key);
  }

  /**
   * 
   */
  lastIndex(key){
    return this.register.findLastIndex(item => item.key==key);
  }

  /**
   * 
   */
  firstEntry(key){
    return this.register.find(item => item.key==key);
  }

  /**
   * 
   */
  lastEntry(key){
    return this.register.toReversed().find(item => item.key==key);
  }

  /**
   * 
   */
  allEntries(key,byPriority=false){
    if(byPriority){
      if(!key) return this.register.toSorted((a,b) => a.priority-b.priority);
      return this.register.filter(item => item.key==key).toSorted((a,b) => a.priority-b.priority);
    }
    if(!key) return this.register;
    return this.register.filter(item => item.key==key);
  }

  getParams(key,withLineNumber=false){
    if(withLineNumber){
      let entry = this.lastEntry(key);
      return [entry.rowNumber].concat(entry.params);
    }
    return this.lastEntry(key).params;
  }

  /**
   * 
   */
  allKeys(byPriority=false){
    let res = [];
    this.register.forEach(item =>{
      if(!res.includes(item.key)) res.push(item.key);
    });
    if(byPriority) res.sort((a,b) => this.lastEntry(a).priority - this.lastEntry(b).priority);
    return res;
  }

  // Extra functionalities of the Register
  /**
   * 
   */
  lastRowNumber(key){
    return (!this.exists(key)) ? null : this.lastEntry(key).rowNumber;
  }

  /**
   * 
   */
  firstRowNumber(key){
    return (!this.exists(key)) ? null : this.firstEntry(key).rowNumber;
  }

}
