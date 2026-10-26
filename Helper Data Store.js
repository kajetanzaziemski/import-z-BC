const HDS_SCOPES = ['document','user','script'];
const HDS_SERVICES = ['properties','cache'];

class HelperDataStore{
  /** 
   * This function is intended as PRIVATE. Do not call this from outside the class.
  */
  static _safeRun(action, errorMessage){
    try{
      return action();
    } catch (e) {
      throw e;
      if(e instanceof SimpleError) throw e;
      throw new UnknownError(errorMessage,e);
    }
  }

  /**
   * This function is intended as PRIVATE. Do not call this from outside the class.
   * 
   * @param scope {String} 'user', 'document' or 'script' for respective scope
   * @param service {String} 'propreties' or 'cache' for respective service
   * 
   * @return function name {String} - Function name in chosen GAS Service.
   */
  static _getServiceFunctionName(scope,service){
    if(scope != 'user' && scope != 'document' && scope != 'script') throw new TypeError("Param scope can only be 'user', 'document' or 'script'. Got "+JSON.stringify(scope)+" instead.");
    if(service != 'cache' && service != 'properties') throw new TypeError("Param service can only be 'cache' or 'properties'. Got "+JSON.stringify(service)+" instead.");
    return 'get' + scope.charAt(0).toUpperCase() + scope.slice(1) + service.charAt(0).toUpperCase() + service.slice(1);
  }

  /** 
   * This function is intended as PRIVATE. Do not call this from outside the class.
  */
  static _getService(getFunction){
    if(/Properties/.test(getFunction)) return this._getPropertiesService(getFunction);
    if(/Cache/.test(getFunction)) return this._getCacheService(getFunction);
    throw new TypeError(`Error when accessing services. Unknown getFunction: ${getFunction}.`);
  }
  /** 
   * This function is intended as PRIVATE. Do not call this from outside the class.
  */
  static _getPropertiesService(getFunction){
    var properties = this._safeRun(
      () => PropertiesService[getFunction](),
      'Error when accessing PropertiesService.'
    );
    if(properties === null || properties === undefined){
      if(getFunction=="getDocumentPropertes") throw new SimpleError("PropertiesService returned empty result when calling Document Service. There is no Document in this scope.");
      else throw new SimpleError("PropertiesService returned empty result.");
    }
    return properties;
  }
  
  /** 
   * This function is intended as PRIVATE. Do not call this from outside the class.
  */
  static _getCacheService(getFunction){
    var cache = this._safeRun(
      () => CacheService[getFunction](),
      'Error when accessing CacheService.'
    );
    if(cache === null || cache === undefined){
      if(getFunction=="getDocumentCache") throw new SimpleError("CacheService returned empty result when calling Document Service. There is no Document in this scope.");
      else throw new SimpleError("CacheService returned empty result.");
    }
    return cache;
  }

  static getUserProperties(){
    return this._getPropertiesService("getUserProperties");
  }

  static getDocumentProperties(){
    return this._getPropertiesService("getDocumentProperties");
  }

  static getScriptProperties(){
    return this._getPropertiesService("getScriptProperties");
  }

  static getUserCache(){
    return this._getCacheService("getUserCache");
  }

  static getDocumentCache(){
    return this._getCacheService("getDocumentCache");
  }

  static getScriptCache(){
    return this._getCacheService("getScriptCache");
  }

  /**
   * Set Property value in chosen scope.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param scope {String} Must be "document", "user" or "script".
   * @param key {String} Key to save the value with.
   * @param value {String|null} Value to be saved. Set null to delete property.
   */
  static setPropertyValue(scope,key,value=undefined){
    if(typeof(key)!="string") throw new TypeError("Param key must be string. Got "+typeof(key)+" instead.");
    if(value===null){
      this.deleteProperty(scope,key);
      return this;
    }
    if(typeof(value)!="string") throw new TypeError("Param value must be string or null. Got "+typeof(value)+" instead.");
    // Construct function name. _getServiceFunctionName() also checks if scope is valid.
    let functionName = this._getServiceFunctionName(scope,'properties');
    // dbgLog(`HelperDataStore: Setting ${scope} property ${key} to ${value}`);
    this._safeRun(
      () => this._getPropertiesService(functionName).setProperty(key,value),
      `Error when setting property in ${functionName.slice(3)}. Tried setting ${JSON.stringify(key)} to ${JSON.stringify(value)}`
    );
    return this;
  }

  /**
   * Delete Property in chosen scope.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param scope {String} Must be "document", "user" or "script".
   * @param key {String} Key to remove.
   */
  static deleteProperty(scope,key){
    if(typeof(key)!="string") throw new TypeError("Param key must be string. Got "+typeof(key)+" instead.");
    
    // Construct function name to get PropertiesService. _getServiceFunctionName() also checks if scope is valid.
    let functionName = this._getServiceFunctionName(scope,'properties');
    this._safeRun(
      () => this._getPropertiesService(functionName).deleteProperty(key),
      `Error when deleting property in ${functionName.slice(3)}. Tried removing key ${JSON.stringify(key)}.`
    );
    return this;
  }
  
  /**
   * Get Property value from chosen scope.
   * 
   * @return value {String}.
   * 
   * @param scope {String} Must be "document", "user" or "script".
   * @param key {String} Key to read.
   */
  static getPropertyValue(scope,key){
    if(typeof(key)!="string") throw new TypeError("Param key must be string. Got "+typeof(key)+" instead.");
    // Construct function name. _getServiceFunctionName() also checks if scope is valid.
    let functionName = this._getServiceFunctionName(scope,'properties');
    // dbgLog(`HelperDataStore Reading ${scope} property ${key}.`);
    return this._safeRun(
      () => this._getPropertiesService(functionName).getProperty(key),
      `Error when reading property in ${functionName.slice(3)}. Tried reading key ${JSON.stringify(key)}.`
    );
  }
  
  /**
   * Set Cache value in chosen scope.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param scope {String} Must be "document", "user" or "script".
   * @param key {String} Key to save the value with.
   * @param value {String|null} Value to be saved. Set null to delete property.
   */
  static setCacheValue(scope,key,value=undefined,exp=undefined){
    if(typeof(key)!="string") throw new TypeError("Param key must be string. Got "+typeof(key)+" instead.");
    if(value===null){
      this.deleteCache(scope,key);
      return this;
    }
    if(typeof(value)!="string") throw new TypeError("Param value must be string or null. Got "+typeof(value)+" instead.");
    // Construct function name to access CacheService. _getServiceFunctionName() also checks if scope is valid.
    let functionName = this._getServiceFunctionName(scope,'cache');
    this._safeRun(
      () => this._getCacheService(functionName).put(key,value,exp),
      `Error when setting cache in ${functionName.slice(3)}. Tried setting ${JSON.stringify(key)} to ${JSON.stringify(value)}`
    );
    return this;
  }

  /**
   * Delete Cache in chosen scope.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param scope {String} Must be "document", "user" or "script".
   * @param key {String} Key to remove.
   */
  static deleteCache(scope,key){
    if(typeof(key)!="string") throw new TypeError("Param key must be string. Got "+typeof(key)+" instead.");
    
    // Construct function name to get CacheService. _getServiceFunctionName() also checks if scope is valid.
    let functionName = this._getServiceFunctionName(scope,'cache');
    this._safeRun(
      () => this._getCacheService(functionName).remove(key),
      `Error when deleting cache in ${functionName.slice(3)}. Tried removing key ${JSON.stringify(key)}.`
    );
    return this;
  }

  /**
   * Get Cache value in chosen scope.
   * 
   * @return value {String}.
   * 
   * @param scope {String} Must be "document", "user" or "script".
   * @param key {String} Key to read.
   */
  static getCacheValue(scope,key){
    if(typeof(key)!="string") throw new TypeError("Param key must be string. Got "+typeof(key)+" instead.");
    // Construct function name to access CacheService. _getServiceFunctionName() also checks if scope is valid.
    let functionName = this._getServiceFunctionName(scope,'cache');
    return this._safeRun(
      () => this._getCacheService(functionName).get(key),
      `Error when reading cache in ${functionName.slice(3)}. Tried reading key ${JSON.stringify(key)}.`
    );
  }

  // - - - - - - - - Property and Cache functions for predefined scope - - - - - - - -   
  /**
   * set Document Property value.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to save the value with.
   * @param value {String|null} Value to be saved. Set null to delete property.
   */
  static setDocumentPropertyValue(key,value=undefined){
    return this.setPropertyValue('document',key,value); 
  }

  /**
   * set Document Cache value.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to save the value with.
   * @param value {String|null} Value to be saved. Set null to delete property.
   */
  static setDocumentCacheValue(key,value=undefined,exp=undefined){
    return this.setCacheValue('document',key,value,exp); 
  }

  /**
   * set User Property value.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to save the value with.
   * @param value {String|null} Value to be saved. Set null to delete property.
   */
  static setUserPropertyValue(key,value=undefined){
    return this.setPropertyValue('user',key,value); 
  }

  /**
   * set User Cache value.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to save the value with.
   * @param value {String|null} Value to be saved. Set null to delete property.
   */
  static setUserCacheValue(key,value=undefined){
    return this.setCacheValue('user',key,value); 
  }

  /**
   * set Script Property value.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to save the value with.
   * @param value {String|null} Value to be saved. Set null to delete property.
   */
  static setScriptPropertyValue(key,value=undefined){
    return this.setPropertyValue('script',key,value); 
  }

  /**
   * set Script Cache value.
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to save the value with.
   * @param value {String|null} Value to be saved. Set null to delete property.
   */
  static setScriptCacheValue(key,value=undefined){
    return this.setCacheValue('script',key,value); 
  }

  /**
   * delete Document Property .
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to to delete..
   * 
   */
  static deleteDocumentProperty(key){
    return this.deleteProperty('document',key); 
  }

  /**
   * delete Document Cache .
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to to delete..
   * 
   */
  static deleteDocumentCache(key){
    return this.deleteCache('document',key); 
  }

  /**
   * delete User Property .
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to to delete..
   * 
   */
  static deleteUserProperty(key){
    return this.deleteProperty('user',key); 
  }

  /**
   * delete User Cache .
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to to delete..
   * 
   */
  static deleteUserCache(key){
    return this.deleteCache('user',key); 
  }

  /**
   * delete Script Property .
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to to delete..
   * 
   */
  static deleteScriptProperty(key){
    return this.deleteProperty('script',key); 
  }

  /**
   * delete Script Cache .
   * 
   * @return HelperDataStore for chaining.
   * 
   * @param key {String} Key to to delete..
   * 
   */
  static deleteScriptCache(key){
    return this.deleteCache('script',key); 
  }

  /**
   * get Document Property value.
   * 
   * @return value.
   * 
   * @param key {String} Key to to read..
   * 
   */
  static getDocumentPropertyValue(key){
    return this.getPropertyValue('document',key); 
  }

  /**
   * get Document Cache value.
   * 
   * @return value.
   * 
   * @param key {String} Key to to read..
   * 
   */
  static getDocumentCacheValue(key){
    return this.getCacheValue('document',key); 
  }

  /**
   * get User Property value.
   * 
   * @return value.
   * 
   * @param key {String} Key to to read..
   * 
   */
  static getUserPropertyValue(key){
    return this.getPropertyValue('user',key); 
  }

  /**
   * get User Cache value.
   * 
   * @return value.
   * 
   * @param key {String} Key to to read..
   * 
   */
  static getUserCacheValue(key){
    return this.getCacheValue('user',key); 
  }

  /**
   * get Script Property value.
   * 
   * @return value.
   * 
   * @param key {String} Key to to read..
   * 
   */
  static getScriptPropertyValue(key){
    return this.getPropertyValue('script',key); 
  }

  /**
   * get Script Cache value.
   * 
   * @return value.
   * 
   * @param key {String} Key to to read..
   * 
   */
  static getScriptCacheValue(key){
    return this.getCacheValue('script',key); 
  }

  static checkAvailability(service,scope){
    let scopes = (scope == 'all' || scope == undefined) ? HDS_SCOPES : [scope];
    let services = (service == 'all' || service == undefined) ? HDS_SERVICES : [service];
    try{
      scopes.forEach(scopeItem => services.forEach(serviceItem => this._getService(this._getServiceFunctionName(scopeItem,serviceItem))));
      return true;
    } catch(e) {
      if(e instanceof TypeError) throw e;
      return false;
    }
  }
}

class OptionalDataStore extends HelperDataStore{
  /** 
   * This function is intended as PRIVATE. Do not call this from outside the class.
  */
  static _safeRun(action, errorMessage){
    try{
      return action();
    } catch (e) {
      return null;
    }
  }  
}



