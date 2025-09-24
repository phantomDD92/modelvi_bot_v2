import { FetLifeBrowser } from '../browser/fetlife-browser';
import { PostApiService } from '../services/post-service';
import { ActionType, DEFAULT_LIVING_POSTS, PostResultType } from '../types/constant';
import { IBotConfig, IContent } from '../types/interface';
import { Logger } from '../utils/logger';
import { PostBot } from './post-bot';

export class FetLifeBot extends PostBot {
  protected browser!: FetLifeBrowser;
  protected service!: PostApiService;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new FetLifeBrowser(this.config, this.logger);
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

  // protected needTest(): boolean {
  //   if (!this.tested) {
  //     this.tested = true
  //     return true
  //   }
  //   return false;
  // }

  // protected needPost(): boolean {
  //   return false;
  // }

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
  // bot action for testing
  protected async doTest(): Promise<boolean> {
    try {
      return true
    } catch (error: any) {
      console.error(error)
      return false;
    }
  }

  private async removePosts(): Promise<string[]> {
    try {
      // get all free posts
      const postCount = this.settings.params?.postCount || DEFAULT_LIVING_POSTS;
      const postRemains = this.settings.params?.postRemains || [];
      this.logger.info(`submitted posts: ${postRemains.length}`);
      const deleteIds = [];
      while (postRemains.length > postCount) {
        const postDeleting = postRemains.shift()
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
    if (content.mode != "image") {
      await this.service.createLog({ success: false, action: ActionType.POST, message: `skip to upload ${postIndex + 1}st media(${content.title})` });
      await this.service.updatePostResult(PostResultType.PROHIBITED, undefined, []);
      return true;
    }
    try {
      // open content media
      const imagePath = await this.downloadFile(media.name);
      // create a post
      const postId = await this.browser.createPostWithImage(imagePath, content.title, content.postTags);
      await this.service.createLog({ success: true, action: ActionType.POST, message: `create ${postIndex + 1}st post(${content.title})`, target: postId });
      const deleteIds = await this.removePosts();
      if (deleteIds.length > 0) {
        await this.service.createLog({ success: true, action: ActionType.POST, message: `delete ${deleteIds.length} posts`, targets: deleteIds });
      }
      await this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds);
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.updatePostResult(PostResultType.FAILED, undefined, []);
      await this.service.createLog({ success: false, action: ActionType.POST, message: `failed to create ${postIndex + 1}st post(${content.title})` });
      return false;
    }
  }
}