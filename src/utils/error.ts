export class BotError extends Error {
  public reason: any;
  constructor(message: string, reason: any = undefined) {
    super(message); // Call the parent constructor with the message
    this.name = "BotError"; // Set the error name
    this.reason = reason;
  }
}

export class SessionTimeoutError extends BotError {
  public reason: any;
  constructor(message: string, reason: any = undefined) {
    super(message, reason); // Call the parent constructor with the message
    this.name = "SessionTimeoutError";
  }
}

export class ProxyError extends BotError {
  public reason: any;
  constructor(message: string, reason: any = undefined) {
    super(message, reason); // Call the parent constructor with the message
    this.name = "ProxyError";
  }
}

export class ApiError extends Error {
  public path: string;
  constructor(message: string, path: string) {
    super(message); // Call the parent constructor with the message
    this.name = "ApiError"; // Set the error name
    this.path = path
  }
}

