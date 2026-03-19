import { BestFansBrowser } from '../browser/bestfans-browser';
import { PostApiService } from '../services/post-service';
import { ActionType, PostResultType, ScheduleStatus } from '../types/constant';
import { IBotConfig, IContent, ISchedulePost } from '../types/interface';
import { BotError } from '../utils/error';
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

  private async publishSchedule(post: ISchedulePost): Promise<void> {
    const schedule = post.schedule;
    try {
      let mediaPaths = []
      for (var medium of schedule.medias) {
        const mediaPath = await this.downloadFile(medium.name);
        mediaPaths.push(mediaPath);
      }
      if (mediaPaths.length == 0)
        throw new BotError("publish schedule failed", {
          where: "FancentroBot::publishSchedule",
          error: "no media uploaded"
        });
      await this.browser.schedulePost(new Date(post.scheduledAt), schedule.title, mediaPaths, schedule.type, schedule.price);
      await this.service.createLog({ success: true, action: ActionType.SCHEDULE, message: `create schedule post(${mediaPaths.length}/${schedule.medias.length} images, ${schedule.title})` });
      await this.service.updateScheduleResult({ id: post._id, status: ScheduleStatus.SCHEDULED })
    } catch (error) {
      this.logger.notifyError(error);
      await this.service.createLog({ success: false, action: ActionType.SCHEDULE, message: `failed to create schedule post(${schedule.title})` });
      await this.service.updateScheduleResult({ id: post._id, status: ScheduleStatus.FAILED, reason: "internal error" })
    }
  }

  protected async doSchedule(): Promise<boolean> {
    try {
      // update next schedule time and get schedule list
      const schedules = await this.service.updateScheduleSetting();
      const waitingSchedules = schedules.filter(schedule => schedule.status == ScheduleStatus.WAITING);
      const scheduledSchedules = schedules.filter(schedule => schedule.status == ScheduleStatus.SCHEDULED);
      this.logger.info(`waiting posts: ${waitingSchedules.length}, scheduled posts: ${scheduledSchedules.length}`);
      let count = 0;
      // schedule waiting schedules
      for (var schedule of waitingSchedules) {
        await this.publishSchedule(schedule);
        count += 1;
        if (count >= 2)
          break;
      }

      return true;
    } catch (error) {
      this.logger.notifyError(error);
      return false;
    }
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