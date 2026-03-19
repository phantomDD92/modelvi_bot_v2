import { BestFansBrowser } from '../browser/bestfans-browser';
import { FakePostService } from '../services/fake-service';
import { PostApiService } from '../services/post-service';
import { ActionType, PostResultType, PostType } from '../types/constant';
import { IBotConfig, IContent } from '../types/interface';
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
    // if (!this.tested) {
    //   this.tested = true;
    //   return true;
    // }
    return false;
  }

  protected async doPost(): Promise<boolean> {
    let postId;
    let deleteIds: string[] = [];
    if (!this.settings.params?.contents || this.settings.params.contents.length == 0) {
      this.logger.info(`account has no content to post`);
      await this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds,);
      return true;
    }
    const contents = this.settings.params.contents;
    let postIndex = this.settings.params.postContentIndex || 0;
    if (postIndex >= contents.length) postIndex = 0;
    const content: IContent = contents[postIndex];
    const media = content.media[0];
    try {
      const image = await this.downloadFile(media.name);
      await this.browser.createPost(content.title, image);
      await this.service.createLog({ success: true, action: ActionType.POST, message: `create ${postIndex + 1}st post(${content.title})`, target: postId, });
      this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds);
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.updatePostResult(PostResultType.FAILED, undefined, deleteIds);
      await this.service.createLog({ success: false, action: ActionType.POST, message: `failed to create ${postIndex + 1}st post(${content.title})`, });
      return false;
    }
  }

  protected needComment(): boolean {
    return false;
  }

  protected needSchedule(): boolean {
    return false
  }

  protected async doCalibrate(): Promise<boolean> {
    try {
      const revenue = await this.browser.getMonthlyEarnings();
      const available = await this.service.checkBalance(revenue);
      if (!available)
        await this.service.createLog({ success: false, action: ActionType.LOGIN, message: `bot closed due to no balance`, error: "no balance", notified: true, });
      return available;
    } catch (error: any) {
      this.logger.notifyError(error);
      return false;
    }
  }

  protected needStory(): boolean {
    return false
  }

  protected needChat(): boolean {
    return false;
  }


  // bot action for testing
  protected async doTest(): Promise<boolean> {
    try {
      // await this.browser.waitForTimeout(10000);
      // const revenue = await this.browser.getMonthlyEarnings();
      // console.log("Revenue :", revenue);
      // const contents = this.settings.params?.contents;
      // if (!contents || contents.length == 0)
      //   return true;
      // const content = contents[0];
      // await this.browser.createPost("I don’t fake reactions. Ever.", "c:/1.webp", PostType.PAID, 5);
      return true;
    } catch (error: any) {
      console.error(error)
      return false;
    }
  }

}