class ConnectionError extends Error{

}

class SimpleError extends Error{

}

function userSafe(action){
  try{
    action();
  }
  catch(e){
    if(e instanceof ConnectionError){
      startAuthFlow();
      SpreadsheetApp.getUi().alert("Połączenie z Business Central jest nieaktywne. Nawiąż połączenie i spróbuj ponownie.");
    }
    else if(e instanceof SimpleError){
      reportError("Simple error. Message: "+e.message);
    }
    else if(e instanceof UnknownError){ 
      //SpreadsheetApp.getUi().alert(e.message);
      reportError("Unknown error. Message: "+e.message);
      throw e.getUnknownError();
    }
    else throw e;
  }
}

function reportError(errorMessage){
  dbgLog(errorMessage);
}

class UnknownError extends Error{
  constructor(message,error){
    super(message);
    this.unknownError = error ?? new SimpleError(message);
  }

  getUnknownError(){
    return this.unknownError;
  }
}