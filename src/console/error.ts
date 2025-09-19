export class ConsoleError extends Error {
  public reason: any;
  constructor(message: string, reason: any = undefined) {
    super(message); // Call the parent constructor with the message
    this.name = "BotConsoleError"; // Set the error name
    this.reason = reason;
  }
}