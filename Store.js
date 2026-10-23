// ---------------------------------------------------------------------------
// STORE: the one door to stored data (document / user / script scope).
//
//   Store.get / set / remove (scope, key)        properties: strings, null deletes (HelperDataStore rules: bad scope / key / value type throw)
//   Store.getJson / setJson (scope, key, ...)    a JSON value kept in one property
//   Store.cache.get / set / remove (scope, key)  CacheService with a lifetime in seconds (set(scope, key, value, ttl))
//   Store.optional.getCache / setCache           the cache when it may be missing: failures give null instead of an error
//   Store.object(key, scope)                     StorageObject: keeps the keys it changed and merges them under a lock (the rule of
//                                                CLAUDE.md: never write a whole snapshot back). One instance per key and scope per run.
//   Store.array(key, scope)                      StorageArray: the WHOLE array is written back (known hazard, see docs/agent-service.md)
//   Store.service(scope, 'properties'|'cache')   the platform service itself, for libraries (OAuth2) that want one
//
// HelperDataStore ("Helper Data Store.js") is the implementation behind it and is called from here only. StorageArray and
// StorageObject were moved here unchanged from "Trigger Manager.js" (they only go through Store now).
// Known smell, left as it is: their constructors register the save with Controller.registerClosingOnce, a dependency on the entry layer.
// ---------------------------------------------------------------------------

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
		return JSON.parse(Store.get(this.store,this.key) || "[]");
	}

	saveArray(){
		dbgLog(`Saving array ${this.key}.${this.store}. Array reads:`);
		dbgLog(JSON.stringify(this.getArray()));
		Store.set(this.store,this.key,JSON.stringify(this.getArray()));
	}

	clearStorage(){
		Store.remove(this.store,this.key);
	}
}

class StorageObject extends StorageArray{
	constructor(key,store){
		super(key,store);
		this.dirtyKeys = new Set();
	}

	recreateFromStore(){
		return JSON.parse(Store.get(this.store,this.key) || "{}");
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
			Store.set(this.store,this.key,JSON.stringify(stored));
			this.storageArray = stored;
			this.dirtyKeys.clear();
		} finally {
			if(locked) lock.releaseLock();
		}
	}
}

const Store = (function () {
  const objects = {};                                      // 'scope|key' -> StorageObject, for this run
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  const cache = {
    get(scope, key) { return HelperDataStore.getCacheValue(scope, key); },
    set(scope, key, value, ttlSeconds) { HelperDataStore.setCacheValue(scope, key, value, ttlSeconds); return Store; },
    remove(scope, key) { HelperDataStore.deleteCache(scope, key); return Store; }
  };

  return {
    scopes: ['document', 'user', 'script'],

    get(scope, key) { return HelperDataStore.getPropertyValue(scope, key); },
    set(scope, key, value) { HelperDataStore.setPropertyValue(scope, key, value); return Store; },     // null deletes
    remove(scope, key) { HelperDataStore.deleteProperty(scope, key); return Store; },

    /** The JSON value kept in the property, or `fallback` when there is none. */
    getJson(scope, key, fallback) {
      const raw = HelperDataStore.getPropertyValue(scope, key);
      return raw ? JSON.parse(raw) : fallback;
    },
    setJson(scope, key, value) { HelperDataStore.setPropertyValue(scope, key, JSON.stringify(value)); return Store; },

    cache: cache,

    optional: {
      getCache(scope, key) { return OptionalDataStore.getCacheValue(scope, key); },
      setCache(scope, key, value, ttlSeconds) { OptionalDataStore.setCacheValue(scope, key, value, ttlSeconds); return Store; }
    },

    object(key, scope) {
      const id = scope + '|' + key;
      return objects[id] || (objects[id] = new StorageObject(key, scope));
    },
    array(key, scope) { return new StorageArray(key, scope); },

    /** The PropertiesService / CacheService object of the scope (throws SimpleError when there is none, like HelperDataStore). */
    service(scope, kind) {
      return HelperDataStore['get' + cap(scope) + cap(kind)]();
    },

    /** true when the services are reachable in the scope (default: all scopes and both services). */
    available(kind, scope) { return HelperDataStore.checkAvailability(kind, scope); }
  };
})();
