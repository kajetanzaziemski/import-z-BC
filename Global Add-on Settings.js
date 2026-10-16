// Requires HelperDataStore.checkAvailability() (ie. full access)

const TENTANT_KEY_ = "bc-tenant-id";
const ENVIRONMENT_KEY_ = "bc-environment";
const COMPANY_KEY_ = "bc-company";

class GlobalSettings{
  constructor(){
    this.propertiesCache = {
      document: {},
      user: {},
      script: {}
    };
    Object.keys(this.propertiesCache).forEach(scope => {
      this.getTenantId(scope);
      this.getBCEnvironment(scope);
      this.getCompany(scope);
    })
  }

  setAllPropertiesForScope(scope,tenantid,environment,company){
    this.setTenantId(tenantid,scope)
        .setBCEnvironment(environment,scope)
        .setCompany(company,scope);
    return this;
  }

  setTenantId(value,scope){
    this.setProperty(TENTANT_KEY_,scope,value);
    return this;
  }
  
  setBCEnvironment(value,scope){
    this.setProperty(ENVIRONMENT_KEY_,scope,value);
    return this;
  }

  setCompany(value,scope){
    this.setProperty(COMPANY_KEY_,scope,value);
    return this;
  }

  setProperty(key,scope,value){
    HelperDataStore.setPropertyValue(scope,key,value == "" ? null : value);
    this.propertiesCache[scope][key] = value;
    return this;
  }

  deleteProperty(key,scope){
    HelperDataStore.deleteProperty(scope,key);
    this.propertiesCache[scope][key] = undefined; 
    return this;
  }

  getProperty(key,scope){
    if(!scope) return this.getActiveProperty(key);
    return this.propertiesCache[scope][key] ?? (this.propertiesCache[scope][key] = this.getPropertyFromPropService(key,scope));
  }
  
  getPropertyFromPropService(key,scope){
    return HelperDataStore.getPropertyValue(scope,key);
  }

  getActiveProperty(key){
    // dbgLog(this.getProperty(key,"document") +'\n'+ this.getProperty(key,"user") +'\n'+ this.getProperty(key,"script"));
    return this.getProperty(key,"document") ?? this.getProperty(key,"user") ?? this.getProperty(key,"script");
  }

  getActiveScope(){
    for(let scope of Object.keys(this.propertiesCache)){
      for(let key of Object.keys(this.propertiesCache[scope])){
        if(this.propertiesCache[scope][key]) return scope;
      }
    }
  }

  getTenantId(scope){
    return this.getProperty(TENTANT_KEY_,scope);
  }

  getServiceName(scope){
    return this.getTenantId(scope);
  }

  getBCEnvironment(scope){
    return this.getProperty(ENVIRONMENT_KEY_,scope);
  }

  getCompany(scope){
    return this.getProperty(COMPANY_KEY_,scope);
  }

  getAuthURL(){
    return `https://login.microsoftonline.com/${this.getTenantId()}/oauth2/v2.0/authorize`;
  }

  getTokenURL(){
    return `https://login.microsoftonline.com/${this.getTenantId()}/oauth2/v2.0/token`;
  }

  getODataURL(){
    return `https://api.businesscentral.dynamics.com/v2.0/${this.getTenantId()}/${this.getBCEnvironment()}/ODataV4/`;
  }
}
