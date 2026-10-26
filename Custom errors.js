class ConnectionError extends Error{

}

class SimpleError extends Error{

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