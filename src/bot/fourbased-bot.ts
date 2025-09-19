import moment from "moment";
import { FourBasedBrowser } from "../browser/fourbased-browser";
import { PostApiService } from "../services/post-service";
import { IBotConfig, IContent, IMedia, ISchedulePost, IScheduleResult } from "../types/interface";
import { Logger } from "../utils/logger";
import { PostBot } from "./post-bot";
import { BotError } from '../utils/error';
import { DEFAULT_LIVING_POSTS, ScheduleStatus } from "../types/constant";

export class FourBasedBot extends PostBot {
  protected browser!: FourBasedBrowser;
  protected service!: PostApiService;


  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new FourBasedBrowser(this.config, this.logger);
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

  public async doCalibrate(): Promise<boolean> {
    try {
      const revenue = await this.browser.getMonthlyEarnings();
      const available = await this.service.checkBalance(revenue)
      return available;
    } catch (error) {
      this.logger.notifyError(error);
      return false;
    }
  }

  private async deleteOldPosts() {
    try {
      // get all free posts
      const postCount = this.settings.params?.postCount || DEFAULT_LIVING_POSTS;
      const postRemains = this.settings.params?.postRemains || [];
      const postIds: string[] = await this.browser.getSelfPosts();
      const postsPublished = postIds.filter(postId => postRemains.includes(postId));
      this.logger.info(`submitted posts: ${postRemains.length}, account posts: ${postIds.length}, published posts: ${postsPublished.length}`);
      const deleteIds = [];
      while (postsPublished.length > postCount) {
        const postDeleting = postsPublished.pop()
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

  private async getMedia(folderName: string, media: IMedia): Promise<string> {
    // find or create folder
    await this.browser.getFolder(folderName);
    let mediaId = media.uuid;
    // if media had already uploaded, check if it exists.
    if (mediaId)
      mediaId = await this.browser.findVaultInFolder(folderName, mediaId);
    if (!mediaId) {
      const image = await this.downloadFile(media.name);
      this.logger.info(`download media(${media.name})`);
      mediaId = await this.browser.createVault(image);
      if (!mediaId)
        throw new BotError("get media failed")
      await this.browser.moveVaultToFolder(mediaId, folderName)
    }
    return mediaId
  }

  protected async doPost(): Promise<boolean> {
    if (!this.settings.params?.contents || this.settings.params.contents.length == 0) {
      this.logger.info(`account has no content to post`);
      await this.service.updatePostSetting(true, undefined, []);
      return true;
    }
    const contents = this.settings.params.contents;
    let postIndex = this.settings.params.postContentIndex || 0;
    if (postIndex >= contents.length)
      postIndex = 0;
    const content: IContent = contents[postIndex];
    const media = content.media[0];
    try {
      let folderName = content.folder;
      if (!folderName || folderName == "")
        folderName = "Posts";
      let mediaId = await this.getMedia(folderName, media)
      if (mediaId != media.uuid) {
        await this.service.createHistory(`upload ${postIndex + 1}st media(${mediaId})`);
        await this.service.updateContentMedia(postIndex, mediaId);
      }
      const postId = await this.browser.schedulePost(moment().add(1, "minute").toDate(), content.title, mediaId);
      if (postId) {
        await this.service.createHistory(`create ${postIndex + 1}st post(${postId}, ${content.title})`);
      }
      const deleteIds = await this.deleteOldPosts();
      if (deleteIds.length > 0) {
        await this.service.createHistory(`delete ${deleteIds.length} old posts`);
      }
      this.service.updatePostSetting(true, postId, deleteIds);
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.updatePostSetting(true, undefined, []);
      await this.service.createHistory(`create ${postIndex + 1}st post(${content.title}) failed`);
      return false;
    }
  }

  private async checkPublishedSchedules(schedules: ISchedulePost[]): Promise<IScheduleResult[]> {
    const postIds = await this.browser.getSelfPosts();
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

  private async publishSchedule(post: ISchedulePost): Promise<void> {
    const schedule = post.schedule;
    try {
      const mediaId = await this.getMedia(schedule.folder, schedule.media);
      await this.service.createHistory(`upload media(${mediaId}, ${schedule.media.name}) for schedule post(${schedule.title})`);
      const postId = await this.browser.schedulePost(new Date(schedule.scheduledAt), schedule.title, mediaId, schedule.type, schedule.price)
      await this.service.createHistory(`create scheduled post(${postId}, ${schedule.title})`);
      await this.service.updateScheduleResult({ id: post._id, post: postId, status: ScheduleStatus.SCHEDULED })
    } catch (error) {
      this.logger.notifyError(error);
      await this.service.createHistory(`create scheduled post(${schedule.title}) failed`);
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
        if (count >= 2)
          break;
      }
      return true;
    } catch (error) {
      this.logger.notifyError(error);
      return false;
    }
  }

  protected async doChat(): Promise<boolean> {
    try {
      await this.service.updateChatSetting();
      const messages = await this.browser.getUnreadChats();
      if (messages.length > 0) {
        this.logger.info(`get ${messages.length} unread messages`);
        await this.sendChatNotification(messages);
      }
      return true;
    } catch (error) {
      this.logger.notifyError(error);
      return false;
    }
  }

  protected needTest(): boolean {
    return false
  }

}