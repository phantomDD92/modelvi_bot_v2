import moment from "moment";
import { MymFansBrowser } from "../browser/mymfans-browser";
import { PostApiService } from "../services/post-service";
import { IBotConfig, IContent } from "../types/interface";
import { Logger } from "../utils/logger";
import { PostBot } from "./post-bot";
import { ActionType, DEFAULT_LIVING_POSTS, POST_PROHIBITED, PostResultType } from "../types/constant";
import { BotError, SessionTimeoutError } from "../utils/error";

export class MymFansBot extends PostBot {
  protected browser!: MymFansBrowser;
  protected service!: PostApiService;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new MymFansBrowser(this.config, this.logger);
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

  protected async doCalibrate(): Promise<boolean> {
    try {
      const revenue = await this.browser.getMonthlyEarning();
      const available = await this.service.checkBalance(revenue);
      if (!available)
        await this.service.createLog({ success: false, action: ActionType.LOGIN, message: `bot closed due to no balance`, error: "no balance", notified: true });
      return available;
    } catch (error) {
      this.logger.notifyError(error);
      return false;
    }
  }

  private async deleteOldPosts() {
    // Check if auto-delete is enabled
    if (this.settings.params?.autoDelete === false) return [];
    try {
      // get all free posts
      const postCount = this.settings.params?.postCount || DEFAULT_LIVING_POSTS;
      const maxDelete = this.settings.params?.maxDeletePerCycle ?? 3;
      const postRemains = this.settings.params?.postRemains || [];
      const postIds = await this.browser.getPosts();
      const postsPublished = postIds.filter(postId => postRemains.includes(postId));
      this.logger.info(`submitted posts: ${postRemains.length}, account posts: ${postIds.length}, published posts: ${postsPublished.length}`);
      const deleteIds = [];
      while (postsPublished.length > postCount && deleteIds.length < maxDelete) {
        const postDeleting = postsPublished.pop()
        if (postDeleting) {
          await this.browser.deletePost(postDeleting);
          deleteIds.push(postDeleting)
          this.logger.info(`delete the post(${postDeleting})`);
        }
      }
      return deleteIds;
    } catch (error: any) {
      if (error instanceof SessionTimeoutError)
        throw error;
      this.logger.notifyError(error)
      return [];
    }
  }

  protected async doPost(): Promise<boolean> {
    if (!this.settings.params?.contents)
      return true;
    // check content and image
    const contents = this.settings.params.contents;
    let postIndex = this.settings.params.postContentIndex || 0;
    if (postIndex >= contents.length)
      postIndex = 0;
    const content: IContent = contents[postIndex];
    const media = content.media[0];
    let deleteIds: string[] = [];

    try {
      deleteIds = await this.deleteOldPosts();
      if (deleteIds.length > 0) {
        await this.service.createLog({
          success: true,
          action: ActionType.POST,
          message: `delete ${deleteIds.length} posts`,
          targets: deleteIds,
        });
      }
      let mediaId, postId;
      if (media.uuid) {
        mediaId = await this.browser.findMedia(media.uuid);
        if (mediaId)
          this.logger.info(`find ${postIndex + 1}st media.`)
      }
      if (mediaId) {
        postId = await this.browser.createPublicPostWithMediaId(content.title, mediaId)
        await this.service.createLog({
          success: true,
          action: ActionType.POST,
          message: `create ${postIndex + 1}st post(${content.title})`,
          target: postId,
        });
        this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds);
      } else {
        const mediaPath = await this.downloadFile(media.name)
        this.logger.info(`download ${postIndex + 1}st media.`)
        const { media: media1, post, scheduledAt } = await this.browser.createPublicPost(content.title, mediaPath);
        if (post == POST_PROHIBITED) {
          await this.service.createLog({ success: true, action: ActionType.POST, message: `prohibited to create ${postIndex + 1}st post(${content.title})` });
          this.service.updatePostResult(PostResultType.PROHIBITED, undefined, deleteIds);
          return true;
        }
        mediaId = media1;
        await this.service.updateContentMedia(postIndex, mediaId);
        postId = post;
        if (scheduledAt) {
          await this.service.createLog({
            success: true,
            action: ActionType.POST,
            message: `schedule ${postIndex + 1}st post(${content.title})`,
            target: postId,
            time: new Date(scheduledAt),
          });
          this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds, new Date(scheduledAt));
        } else {
          await this.service.createLog({ success: true, action: ActionType.POST, message: `create ${postIndex + 1}st post(${content.title})`, target: postId, });
          this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds);
        }
      }
      return true;
    } catch (error: any) {
      // if session timeout, restart bot
      if (error instanceof SessionTimeoutError)
        throw error;
      this.logger.notifyError(error);
      await this.service.updatePostResult(PostResultType.FAILED, undefined, deleteIds);
      await this.service.createLog({ success: false, action: ActionType.POST, message: `failed to create ${postIndex + 1}st post(${content.title})`, notified: true });
      return false;
    }
  }

  protected async doTest(): Promise<boolean> {
    try {
      return true;
    } catch (error: any) {
      if (error instanceof SessionTimeoutError)
        throw error;
      return false;
    }
  }


  protected needTest(): boolean {
    // if (!this.tested) {
    //   this.tested = true;
    //   return true;
    // }
    return false;
  }
}
