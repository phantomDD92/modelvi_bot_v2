import { OnlyFansBrowser } from '../browser/onlyfans-browser';
import { PostApiService } from '../services/post-service';
import { ActionType, PostType, ScheduleStatus } from '../types/constant';
import { IBotConfig, ISchedulePost, IScheduleResult } from '../types/interface';
import { Logger } from '../utils/logger';
import { PostBot } from './post-bot';

export class OnlyFansBot extends PostBot {
  protected browser!: OnlyFansBrowser;
  protected service!: PostApiService;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new OnlyFansBrowser(this.config, this.logger);
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

  // bot action for posting
  protected async doPost(): Promise<boolean> {
    return Promise.resolve(true);
  }


  private async checkPublishedSchedules(schedules: ISchedulePost[]): Promise<IScheduleResult[]> {
    const postIds = await this.browser.getSelfPosts();
    const schedulePostIds = schedules.filter(element => element.post != undefined).map(element => element.post);
    if (schedulePostIds.length == 0) {
      this.logger.info(`no published posts among ${postIds.length} posts`);
      return []
    }
    const publishedPosts = postIds.filter(postId => schedulePostIds.includes(postId));
    const results = publishedPosts.map(post => {
      const schedule = schedules.find(element => element.post == post)
      return ({ id: schedule?._id, post: schedule?.post, status: ScheduleStatus.FINISHED });
    })
    this.logger.info(`${results.length} published posts among ${postIds.length} posts`);
    return results;
  }

  private async publishSchedule(post: ISchedulePost): Promise<void> {
    const schedule = post.schedule;
    console.log(schedule);
    let medias: string[] = []
    try {
      for (var medium of schedule.medias) {
        const media = await this.downloadFile(medium.name)
        medias.push(media);
      }
      const postId = await this.browser.schedulePost(medias, new Date(schedule.scheduledAt), schedule.title, schedule.type, schedule.price)
      await this.service.createLog({ success: true, action: ActionType.SCHEDULE, message: `create schedule post(${schedule.title})`, target: postId });
      await this.service.updateScheduleResult({ id: post._id, post: postId, status: ScheduleStatus.SCHEDULED })
    } catch (error) {
      this.logger.notifyError(error);
      await this.service.createLog({ success: false, action: ActionType.SCHEDULE, message: `failed to create schedule post(${schedule.title})` });
      await this.service.updateScheduleResult({ id: post._id, status: ScheduleStatus.FAILED, reason: "internal error" })
    }
  }

  protected async doSchedule(): Promise<boolean> {
    try {
      let results: IScheduleResult[] = [];
      // update next schedule time and get schedule list
      const schedules = await this.service.updateScheduleSetting();
      const waitingSchedules = schedules.filter(schedule => schedule.status == ScheduleStatus.WAITING);
      const scheduledSchedules = schedules.filter(schedule => schedule.status == ScheduleStatus.SCHEDULED);
      this.logger.info(`waiting posts: ${waitingSchedules.length}, scheduled posts: ${scheduledSchedules.length}`);
      // check published schedules
      if (scheduledSchedules.length > 0)
        results = await this.checkPublishedSchedules(scheduledSchedules);
      // update schedules status
      if (results.length > 0) {
        await this.service.updateScheduleResults(results);
        this.logger.info(`update ${results.length} scheduled posts`)
      }
      // schedule waiting schedules
      let count = 0;
      for (var schedule of waitingSchedules) {
        await this.publishSchedule(schedule);
        count += 1;
        if (count >= 3)
          break;
      }
      return true;
    } catch (error) {
      this.logger.notifyError(error);
      return false;
    }
  }
  public async doTest(): Promise<boolean> {
    try {
      const postIds = await this.browser.getSelfPosts();
      console.log(postIds)
      return true;
    } catch (error: any) {
      console.error(error);
      return false;
    }
  }

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

  protected needCalibrate(): boolean {
    return false
  }

  protected needStory(): boolean {
    return false
  }

  protected needChat(): boolean {
    return false;
  }


}