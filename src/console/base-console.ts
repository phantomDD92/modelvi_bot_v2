export abstract class BaseConsole {
  abstract init(): Promise<void>;
  abstract start(): Promise<void>;
  abstract clear(): Promise<void>;
}