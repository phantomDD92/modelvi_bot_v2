import { BestFansBrowser } from '../browser/bestfans-browser';
import { FakePostService } from '../services/fake-service';
import { PostApiService } from '../services/post-service';
import { IBotConfig } from '../types/interface';
import { Logger } from '../utils/logger';
import { PostBot } from './post-bot';

export class BestFansBot extends PostBot {
  protected browser!: BestFansBrowser;
  protected service!: PostApiService;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new BestFansBrowser(this.config, this.logger);
    await super.initBrowser();
  }

  // init api service
  protected async initService(): Promise<void> {
    this.service = new PostApiService(this.config, this.logger)
    await super.initService();
  }

  protected async initAccount(): Promise<void> {
    await super.initAccount();
    this.logger.info("init account success");
  }

  // check if need test, true when testing bots
  protected needTest(): boolean {
    if (!this.tested) {
      this.tested = true;
      return true;
    }
    return false;
  }

  protected needPost(): boolean {
    return false;
  }

  protected needComment(): boolean {
    return false;
  }

  protected needSchedule(): boolean {
    return false
  }

  protected needCalibrate(): boolean {
    return false
  }

  protected needStory(): boolean {
    return false
  }

  protected needChat(): boolean {
    return false;
  }

  protected needUpdate(): boolean {
    return false;
  }

  // bot action for testing
  protected async doTest(): Promise<boolean> {
    try {
      await this.browser.waitForTimeout(10000);
      const revenue = await this.browser.getMonthlyEarnings();
      console.log("Revenue :", revenue);
      const contents = this.settings.params?.contents;
      if (!contents || contents.length == 0)
        return true;
      // const content = contents[0];
      // await this.browser.createPost("I don’t fake reactions. Ever.");
      return true;
    } catch (error: any) {
      console.error(error)
      return false;
    }
  }

  // bot action for posting
  protected async doPost(): Promise<boolean> {
    return Promise.resolve(true);
  }
}