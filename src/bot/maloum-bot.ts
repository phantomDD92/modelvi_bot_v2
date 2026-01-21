import moment from "moment";
import { MaloumBrowser } from "../browser/maloum-browser";
import { PostApiService } from "../services/post-service";
import {
  ActionType,
  DEFAULT_LIVING_POSTS,
  POST_LIMITED,
  PostResultType,
  ScheduleStatus,
} from "../types/constant";
import {
  IBotConfig,
  ICommentParams,
  IContent,
  IMedia,
  ISchedulePost,
  IScheduleResult,
} from "../types/interface";
import { BotError, SessionTimeoutError } from "../utils/error";
import { Logger } from "../utils/logger";
import { PostBot } from "./post-bot";

export class MaloumBot extends PostBot {
  protected browser!: MaloumBrowser;
  protected service!: PostApiService;

  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger);
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new MaloumBrowser(this.config, this.logger);
    await super.initBrowser();
  }

  // init api service
  protected async initService(): Promise<void> {
    this.service = new PostApiService(this.config, this.logger);
    await super.initService();
  }

  // init account for f2f bot
  protected async initAccount(): Promise<void> {
    await super.initAccount();
    // check account proxy
    this.logger.info("init account success");
  }

  private async deleteOldPosts() {
    let deleteIds = [];
    try {
      // get all free posts
      const postCount = this.settings.params?.postCount || DEFAULT_LIVING_POSTS;
      const postIds: string[] = await this.browser.getSelfFreePosts();
      this.logger.info(`published posts: ${postIds.length}`);
      while (postIds.length > postCount) {
        const postDeleting = postIds.pop();
        if (postDeleting) {
          await this.browser.deletePost(postDeleting);
          deleteIds.push(postDeleting);
          this.logger.info(`delete the post(${postDeleting})`);
        }
      }
      return deleteIds;
    } catch (error: any) {
      if (error instanceof SessionTimeoutError)
        await this.browser.refreshSession();
      this.logger.notifyError(error);
      return deleteIds;
    }
  }

  private async getMedia(folderName: string, media: IMedia): Promise<string> {
    // const folder = await this.browser.getFolder(folderName);
    // let mediaId = media?.uuid;
    // if (mediaId)
    //   mediaId = await this.browser.findMediaInFolder(folder, mediaId);
    // if (!mediaId) {
    //   const image = await this.downloadFile(media.name);
    //   this.logger.info(`download media(${media.name})`);
    //   mediaId = await this.browser.uploadMediaInFolder(folder, image);
    // }
    // if (!mediaId) throw new BotError("get media failed");
    // return mediaId;
    const image = await this.downloadFile(media.name);
    this.logger.info(`download media(${media.name})`);
    let mediaId = await this.browser.uploadMediaInFolder(folderName, image);
    if (!mediaId) throw new BotError("get media failed");
    return mediaId;
  }

  protected async doPost(): Promise<boolean> {
    let postId;
    let deleteIds: string[] = [];
    if (
      !this.settings.params?.contents ||
      this.settings.params.contents.length == 0
    ) {
      this.logger.info(`account has no content to post`);
      await this.service.updatePostResult(
        PostResultType.SUCCESS,
        postId,
        deleteIds,
      );
      return true;
    }
    const contents = this.settings.params.contents;
    let postIndex = this.settings.params.postContentIndex || 0;
    if (postIndex >= contents.length) postIndex = 0;
    const content: IContent = contents[postIndex];
    const media = content.media[0];
    try {
      // await this.browser.refreshSession();

      deleteIds = await this.deleteOldPosts();
      if (deleteIds.length > 0) {
        await this.service.createLog({ success: true, action: ActionType.POST, message: `delete ${deleteIds.length} posts`, targets: deleteIds });
      }
      
      let folderName = content.folder;
      let mediaId = await this.getMedia(folderName, media);
      if (mediaId != media.uuid) {
        await this.service.createLog({
          success: true,
          action: ActionType.POST,
          message: `upload ${postIndex + 1}st media(${content.title})`,
          target: mediaId,
        });
        await this.service.updateContentMedia(postIndex, mediaId);
      }
      const result = await this.browser.publishPost(
        content.title,
        content.postTags,
        mediaId,
      );
      if (result == POST_LIMITED) {
        await this.service.createLog({
          success: false,
          action: ActionType.POST,
          message: `limited to create ${postIndex + 1}st post(${content.title})`,
          target: postId,
        });
        await this.service.updatePostResult(
          PostResultType.SUCCESS,
          undefined,
          deleteIds,
          moment().add(1, "day").startOf("day").toDate(),
        );
        return true;
      }
      await this.service.createLog({
        success: true,
        action: ActionType.POST,
        message: `create ${postIndex + 1}st post(${content.title})`,
        target: postId,
      });
      this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds);
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.updatePostResult(
        PostResultType.FAILED,
        undefined,
        deleteIds,
      );
      await this.service.createLog({
        success: false,
        action: ActionType.POST,
        message: `failed to create ${postIndex + 1}st post(${content.title})`,
      });
      return false;
    }
  }

  protected async doComment(): Promise<boolean> {
    // get comment
    let post;
    try {
      const params: ICommentParams = await this.service.updateCommentSetting();
      if (params.comments.length === 0) return true;
      await this.browser.refreshSession();
      let posts = await this.browser.getRecentPosts();
      posts = posts.reverse();
      let success = false;
      for (post of posts) {
        if (
          post.createdBy?.contentSettings?.canCreatorsComment &&
          post.createdBy.username != this.config.alias &&
          !params.block_users.includes(post.createdBy.username)
        ) {
          await this.browser.followPost(post._id);
          const comment = this.pickup(params.comments);
          await this.browser.commentPost(post._id, comment);
          await this.service.createLog({
            success: true,
            action: ActionType.COMMENT,
            message: `comment ${post.createdBy.username}'s post`,
            target: post._id,
          });
          success = true;
          break;
        }
      }
      if (success) return true;
      for (post of posts) {
        if (
          !post.createdBy?.contentSettings?.canCreatorsComment &&
          post.createdBy.username != this.config.alias &&
          !params.block_users.includes(post.createdBy.username)
        ) {
          await this.browser.followPost(post._id);
          await this.service.createLog({
            success: true,
            action: ActionType.COMMENT,
            message: `follow ${post.createdBy.username}'s post`,
            target: post._id,
          });
          success = true;
          break;
        }
      }
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.createLog({
        success: false,
        action: ActionType.COMMENT,
        message: "failed to create a comment",
      });
      if (error instanceof SessionTimeoutError)
        await this.browser.refreshSession();
      return false;
    }
  }

  public async doChat(): Promise<boolean> {
    try {
      await this.service.updateChatSetting();
      const messages = await this.browser.getUnreadChats();
      if (messages.length > 0) {
        this.logger.info(`find ${messages.length} unread messages`);
        await this.sendChatNotification(messages);
      }
      return true;
    } catch (error) {
      this.logger.notifyError(error);
      if (error instanceof SessionTimeoutError)
        await this.browser.refreshSession();
      return true;
    }
  }

  protected async doCalibrate(): Promise<boolean> {
    try {
      const revenue = await this.browser.getMonthlyEarnings();
      const available = await this.service.checkBalance(revenue);
      if (!available)
        await this.service.createLog({
          success: false,
          action: ActionType.LOGIN,
          message: `bot closed due to no balance`,
          error: "no balance",
          notified: true,
        });
      return available;
    } catch (error: any) {
      this.logger.notifyError(error);
      return false;
    }
  }

  private async checkPublishedSchedules(
    schedules: ISchedulePost[],
  ): Promise<IScheduleResult[]> {
    const postIds = await this.browser.getSelfPosts();
    const schedulePostIds = schedules
      .filter((element) => element.post != undefined)
      .map((element) => element.post);
    if (schedulePostIds.length == 0) {
      this.logger.info(`no published posts among ${postIds.length} posts`);
      return [];
    }
    const publishedPosts = postIds.filter((postId) =>
      schedulePostIds.includes(postId),
    );
    const results = publishedPosts.map((post) => {
      const schedule = schedules.find((element) => element.post == post);
      return {
        id: schedule?._id,
        post: schedule?.post,
        status: ScheduleStatus.FINISHED,
      };
    });
    this.logger.info(
      `${results.length} published posts among ${postIds.length} posts`,
    );
    return results;
  }

  private async publishSchedule(post: ISchedulePost): Promise<void> {
    const schedule = post.schedule;
    let mediaIds: string[] = [];
    try {
      for (var medium of schedule.medias) {
        try {
          const mediaId = await this.getMedia(schedule.folder, medium);
          mediaIds.push(mediaId);
        } catch (error: any) {
          this.logger.notifyError(error);
        }
      }
      if (mediaIds.length == 0)
        throw new BotError("publish schedule failed", {
          where: "MaloumBot::publishSchedule",
          error: "no media uploaded",
        });
      await this.service.createLog({
        success: true,
        action: ActionType.SCHEDULE,
        message: `upload ${mediaIds.length}/${schedule.medias.length} schedule media(${schedule.title})`,
        targets: mediaIds,
      });
      const postId = await this.browser.schedulePost(
        new Date(post.scheduledAt),
        schedule.title,
        schedule.tags,
        mediaIds,
        schedule.type,
      );
      await this.service.createLog({
        success: true,
        action: ActionType.SCHEDULE,
        message: `create schedule post(${schedule.title})`,
        // target: postId,
      });
      await this.service.updateScheduleResult({
        id: post._id,
        // post: postId,
        status: ScheduleStatus.FINISHED,
      });
    } catch (error) {
      this.logger.notifyError(error);
      await this.service.createLog({
        success: false,
        action: ActionType.SCHEDULE,
        message: `failed to create schedule post(${schedule.title})`,
      });
      await this.service.updateScheduleResult({
        id: post._id,
        status: ScheduleStatus.FAILED,
        reason: "internal error",
      });
    }
  }

  protected async doSchedule(): Promise<boolean> {
    try {
      let results: IScheduleResult[] = [];
      // update next schedule time and get schedule list
      const schedules = await this.service.updateScheduleSetting();
      const waitingSchedules = schedules.filter(
        (schedule) => schedule.status == ScheduleStatus.WAITING,
      );
      const scheduledSchedules = schedules.filter(
        (schedule) => schedule.status == ScheduleStatus.SCHEDULED,
      );
      this.logger.info(
        `waiting posts: ${waitingSchedules.length}, scheduled posts: ${scheduledSchedules.length}`,
      );
      // // check published schedules
      // if (scheduledSchedules.length > 0)
      //   results = await this.checkPublishedSchedules(scheduledSchedules);
      // // update schedules status
      // if (results.length > 0) {
      //   await this.service.updateScheduleResults(results);
      //   this.logger.info(`update ${results.length} scheduled posts`);
      // }
      // schedule waiting schedules
      let count = 0;
      for (var schedule of waitingSchedules) {
        await this.publishSchedule(schedule);
        count += 1;
        if (count >= 3) break;
      }
      return true;
    } catch (error) {
      this.logger.notifyError(error);
      return false;
    }
  }

  protected needStory(): boolean {
    return false;
  }

  protected needComment(): boolean {
    return false;
  }

  // protected needTest(): boolean {
  //   if (this.tested) return false;
  //   this.tested = true;
  //   return true;
  // }

  // protected needPost(): boolean {
  //   return false;
  // }

  // protected needSchedule(): boolean {
  //   return false;
  // }

  protected async doTest(): Promise<boolean> {
    try {
      await this.deleteOldPosts();
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }
}
