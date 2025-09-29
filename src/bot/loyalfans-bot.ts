
import moment from 'moment';
import { LoyalFansBrowser } from '../browser/loyalfans-browser';
import { PostApiService } from '../services/post-service';
import { ActionType, DEFAULT_LIVING_POSTS, PostResultType, ScheduleStatus } from '../types/constant';
import { IBotConfig, IContent, ISchedulePost } from '../types/interface';
import { Logger } from '../utils/logger';
import { PostBot } from './post-bot';
import { BotError, SessionTimeoutError } from '../utils/error';

export class LoyalFansBot extends PostBot {
  protected browser!: LoyalFansBrowser;
  protected service!: PostApiService;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new LoyalFansBrowser(this.config, this.logger);
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


  protected needComment(): boolean {
    return false;
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

      return true;
    } catch (error: any) {
      console.error(error)
      return false;
    }
  }

  private async getMedia(folderName: string, mediaName: string, mediaUuid?: string): Promise<string> {
    let folderId = await this.browser.findFolder(folderName);
    if (!folderId) {
      folderId = await this.browser.createFolder(folderName);
    }
    let mediaId: string | undefined = undefined;
    // check if media already exists in folder
    if (mediaUuid) {
      mediaId = await this.browser.findMediaInFolder(folderId, mediaUuid);
    }
    // if media does not exist in folder, upload a media
    if (!mediaId) {
      const path = await this.downloadFile(mediaName);
      this.logger.info(`download media(${mediaName})`);
      mediaId = await this.browser.uploadMedia(path);
      await this.browser.moveMediaToFolder(mediaId, folderId)
    }
    return mediaId;
  }

  private async removePosts(): Promise<string[]> {
    try {
      // get all free posts
      const postCount = this.settings.params?.postCount || DEFAULT_LIVING_POSTS;
      // const postRemains = this.settings.params?.postRemains || [];
      const postIds = await this.browser.getSelfFreePosts();
      this.logger.info(`submitted posts: ${postIds.length}`);
      const deleteIds = [];
      while (postIds.length > postCount) {
        const postDeleting = postIds.pop()
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
    let deleteIds: string[] = [];
    try {
      // open content media
      const mediaId = await this.getMedia(content.folder, media.name, media.uuid);
      if (media.uuid != mediaId) {
        await this.service.updateContentMedia(postIndex, mediaId);
        await this.service.createLog({ success: true, action: ActionType.POST, message: `upload ${postIndex + 1}st media(${content.title})`, target: mediaId });
      }
      // create a post
      await this.browser.schedulePost(moment().toDate(), content.title, content.postTags, [mediaId]);
      await this.service.createLog({ success: true, action: ActionType.POST, message: `create ${postIndex + 1}st post(${content.title})` })
      deleteIds = await this.removePosts();
      if (deleteIds.length > 0) {
        await this.service.createLog({ success: true, action: ActionType.POST, message: `delete ${deleteIds.length} posts`, targets: deleteIds });
      }
      await this.service.updatePostResult(PostResultType.SUCCESS, undefined, deleteIds);
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.updatePostResult(PostResultType.FAILED, undefined, deleteIds);
      await this.service.createLog({ success: false, action: ActionType.POST, message: `failed to create ${postIndex + 1}st post(${content.title})` });
      if (error instanceof SessionTimeoutError)
        await this.browser.refreshSession()
      return false;
    }
  }

  private async publishSchedule(post: ISchedulePost): Promise<void> {
    const schedule = post.schedule;
    let mediaIds: string[] = []
    try {
      for (var medium of schedule.medias) {
        try {
          const mediaId = await this.getMedia(schedule.folder, medium.name);
          mediaIds.push(mediaId);
        } catch (error: any) {
          this.logger.notifyError(error);
        }
      }
      if (mediaIds.length == 0)
        throw new BotError("publish schedule failed", {
          where: "MaloumBot::publishSchedule",
          error: "no media uploaded"
        })
      await this.service.createLog({ success: true, action: ActionType.SCHEDULE, message: `upload ${mediaIds.length}/${schedule.medias.length} schedule media(${schedule.title})`, targets: mediaIds });
      await this.browser.schedulePost(new Date(schedule.scheduledAt), schedule.title, schedule.tags, mediaIds, schedule.type, schedule.price);
      await this.service.createLog({ success: true, action: ActionType.SCHEDULE, message: `create schedule post(${schedule.title})` });
      await this.service.updateScheduleResult({ id: post._id, post: undefined, status: ScheduleStatus.SCHEDULED });
    } catch (error) {
      this.logger.notifyError(error);
      await this.service.createLog({ success: false, action: ActionType.SCHEDULE, message: `failed to create schedule post(${schedule.title})` });
      await this.service.updateScheduleResult({ id: post._id, status: ScheduleStatus.FAILED, reason: "internal error" });
      if (error instanceof SessionTimeoutError)
        await this.browser.refreshSession()
    }
  }

  protected async doSchedule(): Promise<boolean> {
    try {
      // update next schedule time and get schedule list
      const schedules = await this.service.updateScheduleSetting();
      const waitingSchedules = schedules.filter(schedule => schedule.status == ScheduleStatus.WAITING);
      // const scheduledSchedules = schedules.filter(schedule => schedule.status == ScheduleStatus.SCHEDULED);
      this.logger.info(`waiting posts: ${waitingSchedules.length}`);
      // schedule waiting schedules
      let count = 0;
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
      await this.browser.refreshSession();
      const revenue = await this.browser.getMonthlyEarnings();
      const available = await this.service.checkBalance(revenue);
      if (!available)
        await this.service.createLog({ success: false, action: ActionType.LOGIN, message: `bot closed due to no balance`, error: "no balance", notified: true });
      return available;
    } catch (error: any) {
      this.logger.notifyError(error);
      if (error instanceof SessionTimeoutError)
        await this.browser.refreshSession()
      return false;
    }
  }
}