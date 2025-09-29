import moment from 'moment';
import { FancentroBrowser } from '../browser/fancentro-browser';
import { PostBot } from './post-bot';
import { IBotConfig, IContent, IMedia, ISchedulePost, IScheduleResult } from '../types/interface';
import { ActionType, DEFAULT_LIVING_POSTS, PostResultType, PostType, ScheduleStatus } from '../types/constant';
import { PostApiService } from '../services/post-service';
import { Logger } from '../utils/logger';
import { BotError } from '../utils/error';

export class FancentroBot extends PostBot {
  protected browser!: FancentroBrowser;
  protected service!: PostApiService;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new FancentroBrowser(this.config, this.logger);
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


  private async removePosts(): Promise<string[]> {
    try {
      // get all free posts
      const postCount = this.settings.params?.postCount || DEFAULT_LIVING_POSTS;
      const postRemains = this.settings.params?.postRemains || [];
      const postIds = await this.browser.getPosts();
      const postsPublished = postRemains.filter(postId => postIds.includes(`${postId}`));
      this.logger.info(`submitted posts: ${postRemains.length}, account posts: ${postIds.length}, published posts: ${postsPublished.length}`);
      const deleteIds = [];
      while (postsPublished.length > postCount) {
        const postDeleting = postsPublished.shift()
        if (postDeleting) {
          await this.browser.deletePost(postDeleting);
          deleteIds.push(postDeleting)
          this.logger.info(`delete the post(${postDeleting})`);
        }
      }
      return deleteIds;
    } catch (error: any) {
      this.logger.notifyError(error)
      return []
    }
  }


  // bot action for posting
  protected async doPost(): Promise<boolean> {
    if (!this.settings.params)
      return false
    const { postContentIndex, contents } = this.settings.params;
    // find the proper posting content
    let postIndex = postContentIndex || 0;
    if (postIndex >= contents.length)
      postIndex = 0;
    const content: IContent = contents[postIndex];
    const media = content.media[0]
    let deleteIds: string[] = []
    try {
      if (media.mode.includes("heic")) {
        await this.service.createLog({ success: false, action: ActionType.POST, message: `skip to upload ${postIndex + 1}st media(${content.title})` });
        await this.service.updatePostResult(PostResultType.PROHIBITED, undefined, []);
        return true;
      }
      // const folderId = await this.browser.findOrCreateFolder(content.folder);
      // open content media
      // const mediaId = await this.browser.getVault(folderId, media.name, media.uuid);
      const mediaId = await this.browser.getVault(0, media.name, media.uuid);
      if (media.uuid != mediaId) {
        await this.service.updateContentMedia(postIndex, mediaId);
        await this.service.createLog({ success: true, action: ActionType.UPLOAD, message: `upload ${postIndex + 1}st media(${content.title})`, target: mediaId });
      }
      // create a post
      const postId = await this.browser.schedulePost(moment().add(1, "day").toDate(), [mediaId], content.title, content.postTags);
      if (postId) {
        await this.service.createLog({ success: true, action: ActionType.POST, message: `create ${postIndex + 1}st post(${content.title})`, target: postId });
      }
      deleteIds = await this.removePosts();
      if (deleteIds.length > 0) {
        await this.service.createLog({ success: true, action: ActionType.POST, message: `delete ${deleteIds.length} posts`, targets: deleteIds });
      }
      await this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds);
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.updatePostResult(PostResultType.FAILED, undefined, deleteIds);
      await this.service.createLog({ success: false, action: ActionType.POST, message: `failed to create ${postIndex + 1}st post(${content.title})` });
      return false;
    }
  }

  private async checkPublishedSchedules(schedules: ISchedulePost[]): Promise<IScheduleResult[]> {
    const postIds = await this.browser.getPosts();
    const schedulePostIds = schedules.filter(element => element.post != undefined).map(element => element.post);
    if (schedulePostIds.length == 0) {
      this.logger.info(`no published posts among ${postIds.length} posts`);
      return []
    }
    const publishedPosts = postIds.filter(postId => schedulePostIds.includes(postId));
    const results = publishedPosts.map(postId => {
      const schedule = schedules.find(element => element.post == postId)
      return ({ id: schedule?._id, post: schedule?.post, status: ScheduleStatus.FINISHED });
    })
    this.logger.info(`${results.length} published posts among ${postIds.length} posts`);
    return results;
  }

  private async uploadMedia(media: IMedia): Promise<string | undefined> {
    try {
      const mediaId = await this.browser.getVault(0, media.name, media.uuid);
      return mediaId;
    } catch (error: any) {
      this.logger.notifyError(error);
      return undefined
    }
  }

  private async publishSchedule(post: ISchedulePost): Promise<void> {
    const schedule = post.schedule;
    try {
      let mediaIds = []
      for (var medium of schedule.medias) {
        const mediaId = await this.uploadMedia(medium);
        if (mediaId)
          mediaIds.push(mediaId);
      }
      if (mediaIds.length == 0)
        throw new BotError("publish schedule failed", {
          where: "FancentroBot::publishSchedule",
          error: "no media uploaded"
        });
      const postId = await this.browser.schedulePost(new Date(schedule.scheduledAt), mediaIds, schedule.title, schedule.tags, schedule.type, schedule.price);
      await this.service.createLog({ success: true, action: ActionType.SCHEDULE, message: `create schedule post(${mediaIds.length}/${schedule.medias, length} images, ${schedule.title})`, target: postId });
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
      if (scheduledSchedules.length > 0) {
        results = await this.checkPublishedSchedules(scheduledSchedules);
      }
      // update schedules status
      if (results.length > 0) {
        await this.service.updateScheduleResults(results);
        this.logger.info(`update ${results.length} scheduled posts`)
      }
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
        await this.service.createLog({ success: false, action: ActionType.LOGIN, message: `bot closed due to no balance`, error: "no balance", notified: true });
      return available;
    } catch (error: any) {
      this.logger.warn(`check balance failed`);
      this.logger.notifyError(error);
      return false;
    }
  }

  public async doTest(): Promise<boolean> {
    try {
      const post: ISchedulePost = {
        _id: '1',
        schedule: {
          medias: [
            { "name": "dd7b368f-32ea-4d28-9182-abb3f306532e.jpg", "mode": "image/jpeg", },
            { "name": "52604419-2985-436c-a558-bb924b25c352.jpg", "mode": "image/jpeg", },
            { "name": "57d2c390-265e-41fe-be66-6aa48ddd9018.jpg", "mode": "image/jpeg", },
          ],
          folder: 'SPAM',
          title: 'Join me for fun and pleasure',
          tags: ["gay", "intiem", "spannend",],
          type: PostType.PAID,
          price: 10,
          scheduledAt: "2025-10-30"
        },
        status: 0
      }
      const schedule = post.schedule;
      let mediaIds = []
      for (var medium of schedule.medias) {
        const mediaId = await this.uploadMedia(medium);
        if (mediaId)
          mediaIds.push(mediaId);
      }
      if (mediaIds.length == 0)
        throw new BotError("publish schedule failed", {
          where: "FancentroBot::publishSchedule",
          error: "no media uploaded"
        });
      const postId = await this.browser.schedulePost(new Date(schedule.scheduledAt), mediaIds, schedule.title, schedule.tags, schedule.type, schedule.price);
      console.log({ success: true, action: ActionType.SCHEDULE, message: `create schedule post(${mediaIds.length}/${schedule.medias, length} images, ${schedule.title})`, target: postId });
      return true;
    } catch (error: any) {
      console.error(error);
      return false;
    }
  }

  protected needTest(): boolean {
    if (!this.tested) {
      this.tested = true
      return true;
    }
    return false;
  }

  protected needComment(): boolean {
    return false;
  }

  protected needStory(): boolean {
    return false;
  }

}