import { FanslyBrowser } from '../browser/fansly-browser';
import { FanslyService } from '../services/fansly-service';
import { DEFAULT_LIVING_POSTS, PostType, ScheduleStatus } from '../types/constant';
import { IFanslyMedia } from '../types/fansly';
import { IBotConfig, IChatMessage, IContent, IMedia, ISchedulePost, IScheduleResult } from '../types/interface';
import { BotError } from '../utils/error';
import { Logger } from '../utils/logger';
import { PostBot } from './post-bot';

export class FanslyBot extends PostBot {
  protected browser!: FanslyBrowser;
  protected service!: FanslyService;

  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  protected async initBrowser(): Promise<void> {
    this.browser = new FanslyBrowser(this.config, this.logger)
    await super.initBrowser();
  }

  protected async initService(): Promise<void> {
    this.service = new FanslyService(this.config, this.logger)
    await super.initService();
  }

  protected async initAccount(): Promise<void> {
    await super.initAccount();
    // // check account proxy
    // const proxyAddr = await this.service.pickProxy();
    // // const proxy = this.parseProxy("cb3ac8e713:zxHGsQ21@163.5.199.154:4444");
    // const proxy = this.parseProxy(proxyAddr);
    // if (!proxy) {
    //   throw new BotError("invalid proxy", {
    //     where: "FanslyBot::initAccount",
    //     error: "there is no proxy for the account"
    //   });
    // }
    // this.proxy = proxy;
    // check device id
    if (!this.settings.device) {
      throw new BotError("no security key", {
        where: "FanslyBot::initAccount",
        error: "there is no security key for the account"
      });
    }
    this.logger.info("init account success");
  }

  protected async uploadMedia(folder: string, albumMedias: IFanslyMedia[], media: IMedia): Promise<string> {
    let uuid;
    if (media.uuid && albumMedias.find(el => el.id === media.uuid)) {
      uuid = media.uuid;
    }
    if (!uuid) {
      const path = await this.downloadFile(media.name);
      this.logger.info(`download media(${path})`);
      uuid = await this.browser.uploadContent(folder, path);
      this.logger.info(`upload media(${uuid})`);
      if (!uuid)
        throw new BotError("cannot upload media");
    }
    return uuid;
  }

  private async removePosts(): Promise<string[]> {
    try {
      const postCount = this.settings.params?.postCount || DEFAULT_LIVING_POSTS;
      const postRemains = this.settings.params?.postRemains || [];
      const postIds = await this.browser.getSelfPosts();
      const postIdsPublished = postIds.filter(postId => postRemains.includes(postId));
      this.logger.info(`submitted posts: ${postRemains.length}, account posts: ${postIds.length}, published posts: ${postIdsPublished.length}`);
      const deleteIds = [];
      while (postIdsPublished.length > postCount) {
        const postIdDeleting = postIdsPublished.pop()
        if (postIdDeleting) {
          await this.browser.deletePost(postIdDeleting);
          deleteIds.push(postIdDeleting)
          this.logger.info(`delete a post(${postIdDeleting})`);
        }
      }
      return deleteIds;
    } catch (error: any) {
      this.logger.notifyError(error)
      return [];
    }
  }

  private async getFolder(folderName: string): Promise<string> {
    const { albums } = await this.browser.getAlbums();
    let album = albums.find(el => el.title === folderName);
    if (!album) {
      album = await this.browser.createAlbum(folderName);
      await this.service.createHistory(`create album(title=${folderName}, id=${album?.id})`);
    }
    if (!album)
      throw new BotError("create album failed");
    return album.id;
  }

  private async getMedia(folderName: string, media: IMedia): Promise<string> {
    let mediaId;
    // get folder
    const albumId = await this.getFolder(folderName);
    // get folder media
    const { media: albumMedias } = await this.browser.getAlbumMedia(albumId);
    if (media.uuid && albumMedias.find(el => el.id === media.uuid)) {
      mediaId = media.uuid;
    }
    // if not uploaded, upload media
    if (!mediaId) {
      const path = await this.downloadFile(media.name);
      this.logger.info(`download media(${path})`);
      mediaId = await this.browser.uploadContent(folderName, path);
    }
    if (!mediaId)
      throw new BotError("get media failed", {
        where: "FanslyBot::getMedia",
        error: "cannot upload media"
      });
    return mediaId;
  }

  private async createPublishPost(content: IContent, mediaId: string, previewId: string | undefined) {
    const contentId = await this.browser.createContent(mediaId, PostType.FREE, 0, previewId);
    const postId = await this.browser.publishPost(content.title, content.postTags, contentId);
    return postId;
  }

  protected async doPost(): Promise<boolean> {
    let deleteIds: string[] = []
    if (!this.settings.params)
      return false
    const { contents, postContentIndex } = this.settings.params;
    let postIndex = postContentIndex || 0;
    if (postIndex >= contents.length)
      postIndex = 0;
    try {
      // prepare posting parameters
      const content = contents[postIndex];
      const media = content.media[0]
      const preview = content.preview;
      if (!media.name) {
        await this.service.updatePostSetting(true, undefined, []);
        this.logger.info(`skip ${postIndex + 1}st post(${content.title}) due to media absence`);
        await this.service.createHistory(`skip ${postIndex + 1}st post(${content.title}) due to media absence`);
        return true
      }
      const mediaId = await this.getMedia(content.folder, media);
      if (mediaId != media.uuid) {
        await this.service.updateContentMedia(postIndex, mediaId);
        await this.service.createHistory(`upload media(${mediaId}) for ${postIndex + 1}st post`);
      }
      let previewId;
      if (preview && preview.name) {
        previewId = await this.getMedia(content.folder, preview);
        if (previewId != preview.uuid) {
          await this.service.updateContentPreview(postIndex, previewId);
          await this.service.createHistory(`upload preview(${previewId}) for ${postIndex + 1}st post`);
        }
      }
      // create post
      const postId = await this.createPublishPost(content, mediaId, previewId)
      await this.service.createHistory(`create ${postIndex + 1}st post(${postId}, ${content.title})`);
      // if needs, delete articles
      deleteIds = await this.removePosts();
      if (deleteIds.length > 0)
        await this.service.createHistory(`delete ${deleteIds.length} posts(${deleteIds.join(", ")})`);
      await this.service.updatePostSetting(true, postId, deleteIds);
      return true;
    } catch (error: any) {
      this.logger.warn(`create ${postIndex + 1}st post failed`);
      this.logger.notifyError(error);
      await this.service.updatePostSetting(true, undefined, deleteIds);
      await this.service.createHistory(`create ${postIndex + 1}st post failed`);
      return false;
    }
  }


  protected async doChat(): Promise<boolean> {
    try {
      await this.service.updateChatSetting();
      const messages = await this.getUnreadMessages();
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

  protected async doCalibrate(): Promise<boolean> {
    try {
      const revenue = await this.getMonthlyRevenue();
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

  private async getMonthlyRevenue(): Promise<number> {
    const stats = await this.browser.getMonthlyStats();
    return stats.totalNet / 1000;
  }

  private async getUnreadMessages(): Promise<IChatMessage[]> {
    const { data, groups } = await this.browser.getChatMessages();
    let messages: IChatMessage[] = [];
    const filteredData = data.filter(item => item.unreadCount > 0);
    for (var message of filteredData) {
      const group = groups.find(item => item.id == message.groupId);
      if (group && group.lastMessage) {
        messages.push({
          user: message.partnerUsername,
          message: group.lastMessage.content,
          time: new Date(group.lastMessage.createdAt * 1000),
        })
      }
    }
    return messages;
  }

  protected needTest(): boolean {
    return false
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
      await this.service.createHistory(`upload media(${mediaId}) for schedule post(${schedule.title})`);
      let previewId;
      if (schedule.preview && schedule.preview.name) {
        previewId = await this.getMedia(schedule.folder, schedule.preview);
        await this.service.createHistory(`upload preview(${previewId}) for schedule post(${schedule.title})`);
      }
      const contentId = await this.browser.createContent(mediaId, schedule.type, schedule.price, previewId);
      this.logger.info(`create content(${contentId}) for scheduled post`);
      const postId = await this.browser.schedulePost(schedule.title, schedule.tags, contentId, new Date(schedule.scheduledAt));
      this.logger.info(`schedule post(${postId}, ${schedule.title})`);
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
      if (scheduledSchedules.length > 0) {
        results = await this.checkPublishedSchedules(scheduledSchedules);
        // update schedules status
        if (results.length > 0) {
          await this.service.updateScheduleResults(results);
          this.logger.info(`update ${results.length} scheduled posts`)
        }
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
}
