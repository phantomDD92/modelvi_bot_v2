import { KnkyBrowser } from "../browser/knky-browser";
import { PostApiService } from "../services/post-service";
import { DEFAULT_LIVING_POSTS, DEFAULT_STORY_MAX_COUNT, KnkyStoryType, ScheduleStatus } from "../types/constant";
import { IBotConfig, IContent, IMedia, ISchedulePost, IScheduleResult } from "../types/interface";
import { Logger } from "../utils/logger";
import { PostBot } from "./post-bot";
import { BotError, SessionTimeoutError } from '../utils/error';
export class KnKyBot extends PostBot {
  protected browser!: KnkyBrowser;
  protected service!: PostApiService;

  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
    this.tested = false;
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new KnkyBrowser(this.config, this.logger);
    await super.initBrowser();
  }

  // init api service
  protected async initService(): Promise<void> {
    this.service = new PostApiService(this.config, this.logger)
    await super.initService();
  }

  protected needComment(): boolean {
    return false
  }

  protected needChat(): boolean {
    return false;
  }

  // init account for knky bot
  protected async initAccount(): Promise<void> {
    await super.initAccount();
    this.logger.info("init account success");
  }

  private async deleteOldPosts() {
    const postCount = this.settings.params?.postCount || DEFAULT_LIVING_POSTS;
    const postRemains = this.settings.params?.postRemains || [];
    const posts = await this.browser.getSelfPosts();
    const postsPublished = posts.filter(post => postRemains.includes(post._id));
    this.logger.info(`submitted posts: ${postRemains.length}, account posts: ${posts.length}, published posts: ${postsPublished.length}`);
    const deleteIds = [];
    while (postsPublished.length > postCount) {
      const postDeleting = postsPublished.pop()
      if (postDeleting) {
        deleteIds.push(postDeleting._id)
        await this.browser.deletePost(postDeleting._id);
        deleteIds.push(postDeleting._id)
        this.logger.info(`delete a post(${postDeleting._id})`);
      }
    }
    return deleteIds;
  }

  // bot action for posting
  protected async doPost(): Promise<boolean> {
    const contents = this.settings.params?.contents || [];
    let postIndex = this.settings.params?.postContentIndex || 0;
    if (postIndex >= contents.length)
      postIndex = 0;
    const content: IContent = contents[postIndex];
    const media: IMedia = content.media[0];
    try {
      // await this.browser.refreshToken();
      // if needs, delete articles
      const deleteIds = await this.deleteOldPosts();
      if (deleteIds.length > 0) {
        await this.service.createHistory(`delete ${deleteIds.length} old posts`);
      }
      // download media
      const path = await this.downloadFile(media.name);
      this.logger.info(`download ${postIndex + 1}st media for post - ${media.name}`);
      // create post
      const postId = await this.browser.createPost(content, path);
      if (postId == "disabled") {
        await this.service.createHistory(`skip ${postIndex + 1}st post(${content.title})`);
        await this.service.updatePostSetting(true, undefined, deleteIds);
      } else {
        await this.service.createHistory(`create ${postIndex + 1}st post(${postId}, ${content.title})`);
        await this.service.updatePostSetting(true, postId, deleteIds);
      }
      // await this.browser.refreshToken();
      return true;
    } catch (error: any) {
      if (error instanceof SessionTimeoutError) {
        await this.browser.refreshToken(this.settings);
        this.logger.info("refresh token");
        return true;
      }
      this.logger.notifyError(error);
      await this.service.updatePostSetting(true, undefined, []);
      await this.service.createHistory(`create ${postIndex + 1}st post failed`);
      return false;
    }
  }

  // bot action for posting
  protected async doStory(): Promise<boolean> {
    const contents = this.settings.params?.contents || [];
    let storyIndex = this.settings.params?.storyIndex || 0;
    try {
      // await this.browser.refreshToken();
      // if needs, delete stories
      const storyMaxCount = this.settings.params?.storyMaxCount || DEFAULT_STORY_MAX_COUNT;
      const stories = await this.browser.getSelfStories();
      this.logger.info(`stories : ${stories.length} : ${storyMaxCount}`)
      let countDeleted = 0
      while (stories.length >= storyMaxCount) {
        const storyDeleting = stories.pop();
        if (storyDeleting) {
          await this.browser.deleteStory(storyDeleting._id);
          this.logger.info(`delete a story(${storyDeleting._id})`)
          countDeleted = 0;
        }
      }
      if (countDeleted > 0) {
        await this.service.createHistory(`delete ${countDeleted} old stories`);
      }
      // find next story content
      if (storyIndex >= contents.length)
        storyIndex = 0;
      let index = (storyIndex + 1) % contents.length;
      let content;
      while (index != storyIndex) {
        const contentChecked = contents[index];
        if (contentChecked.knkyStoryType && contentChecked.knkyStoryType >= KnkyStoryType.PUBLIC) {
          content = contents[index]
          storyIndex = index
          break;
        }
        index = (index + 1) % contents.length;
      }
      if (!content) {
        await this.service.updateStorySetting(storyIndex)
        return true
      }
      const media: IMedia = content.media[0];
      // download media
      const path = await this.downloadFile(media.name);
      this.logger.info(`download ${storyIndex + 1}th media(${media.name}) for story`);
      // create post
      await this.browser.createStory(content, path);
      await this.service.createHistory(`create a story with ${storyIndex + 1}th content`);
      await this.service.updateStorySetting(storyIndex)
      return true;
    } catch (error: any) {
      if (error instanceof SessionTimeoutError) {
        await this.browser.refreshToken(this.settings);
        this.logger.info("refresh token");
        return true;
      }
      this.logger.notifyError(error);
      await this.service.createHistory(`create story failed with ${storyIndex + 1}th content`);
      await this.service.updateStorySetting(storyIndex);
      return false;

    }
  }

  protected async doCalibrate(): Promise<boolean> {
    try {
      const revenue = await this.browser.getMonthlyEarnings();
      const available = await this.service.checkBalance(revenue);
      if (!available)
        await this.service.createHistory(`bot closed due to no balance`);
      return available;
    } catch (error: any) {
      this.logger.warn(`check balance failed`);
      this.logger.notifyError(error);
      return false;
    }
  }

  private async checkPublishedSchedules(schedules: ISchedulePost[]): Promise<IScheduleResult[]> {
    const posts = await this.browser.getSelfPosts();
    const schedulePostIds = schedules.filter(element => element.post != undefined).map(element => element.post);
    if (schedulePostIds.length == 0) {
      this.logger.info(`no published posts among ${posts.length} posts`);
      return []
    }
    const publishedPosts = posts.filter(post => schedulePostIds.includes(post._id));
    const results = publishedPosts.map(post => {
      const schedule = schedules.find(element => element.post == post._id)
      return ({ id: schedule?._id, post: schedule?.post, status: ScheduleStatus.FINISHED });
    })
    this.logger.info(`${results.length} published posts among ${posts.length} posts`);
    return results;
  }

  private async publishSchedule(post: ISchedulePost): Promise<void> {
    const schedule = post.schedule;
    try {
      // download media
      const path = await this.downloadFile(schedule.media.name);
      this.logger.info(`download  media for scheduled post`);
      // create post
      const postId = await this.browser.schedulePost(post, path);
      if (postId == "disabled") {
        await this.service.createHistory(`disable scheduled post(${schedule.title})`);
        await this.service.updateScheduleResult({ id: post._id, post: postId, status: ScheduleStatus.FAILED })
        return;
      }
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
      // await this.browser.refreshToken();
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
      if (error instanceof SessionTimeoutError) {
        await this.browser.refreshToken(this.settings);
        this.logger.info("refresh token");
        return true;
      }
      this.logger.notifyError(error);
      return false;
    }
  }

}
