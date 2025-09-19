export abstract class BaseBot {
  abstract init(): Promise<void>;
  abstract start(): Promise<void>;
}