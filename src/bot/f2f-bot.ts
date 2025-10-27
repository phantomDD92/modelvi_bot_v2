
import { PostBot } from './post-bot';
import { ActionType, DEFAULT_LIVING_POSTS, DEFAULT_STORY_MAX_COUNT, F2FStoryType, PostResultType, PostType, ScheduleStatus } from '../types/constant';
import { IBotConfig, IChatMessage, ICommentParams, IContent, IMedia, ISchedulePost, IScheduleResult } from '../types/interface';
import { F2fBrowser } from '../browser/f2f-browser';
import { Logger } from '../utils/logger';
import { PostApiService } from '../services/post-service';
import moment from 'moment';

export class F2fBot extends PostBot {
  // headless browser for f2f bot
  protected browser!: F2fBrowser;
  // api service for f2f bot
  protected service!: PostApiService;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    this.browser = new F2fBrowser(this.config, this.logger);
    await super.initBrowser();
  }

  // init api service
  protected async initService(): Promise<void> {
    this.service = new PostApiService(this.config, this.logger)
    await super.initService();
  }

  // init account for f2f bot
  protected async initAccount(): Promise<void> {
    await super.initAccount();
    this.logger.info("init account success");
  }

  private async removePosts(): Promise<string[]> {
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

  private async getFolder(folderName: string): Promise<string> {
    // find a folder from content
    let folderId = await this.browser.findFolder(folderName);
    // if folder does not exist, create the folder
    if (!folderId) {
      folderId = await this.browser.createFolder(folderName);
      this.logger.info(`create a folder(${folderName})`);
    }
    return folderId;
  }

  private async getMedia(folderName: string, media: IMedia): Promise<string> {
    const folderId = await this.getFolder(folderName);
    let mediaId: string | undefined = undefined;
    // check if media already exists in folder
    if (media.uuid)
      mediaId = await this.browser.findMediaInFolder(folderId, media.uuid);

    // if media does not exist in folder, upload a media
    if (!mediaId) {
      const path = await this.downloadFile(media.name);
      this.logger.info(`download media(${media.name})`);
      mediaId = await this.browser.uploadMedia(folderId, path);
    }
    return mediaId;
  }

  private async uploadMedia(folderName: string, media: IMedia[]): Promise<string[]> {
    const folderId = await this.getFolder(folderName);
    const mediaId: string[] = []
    for (var medium of media) {
      const path = await this.downloadFile(medium.name);
      this.logger.info(`download media(${medium.name})`);
      try {
        const mediumId = await this.browser.uploadMedia(folderId, path);
        mediaId.push(mediumId)
      } catch (error: any) {
        this.logger.notifyError(error);
      }
    }
    return mediaId;
  }

  // private async createPublicPost(content: IContent, postIndex: number, mediaId: string): Promise<string | undefined> {
  //   const postId = await this.browser.createEmptyPost(mediaId);
  //   let success = await this.browser.setPostTitle(postId, content.title, content.postTags);
  //   if (!success) {
  //     await this.service.createLog({ success: false, action: ActionType.POST, message: `prohibited to create ${postIndex + 1}st post`, description: content.title, target: postId });
  //     return undefined;
  //   }
  //   success = await this.browser.publishPost(postId)
  //   if (!success) {
  //     await this.service.createLog({ success: false, action: ActionType.POST, message: `limited to create ${postIndex + 1}st post`, description: content.title, target: postId });
  //     return undefined;
  //   }
  //   await this.service.createLog({ success: true, action: ActionType.POST, message: `create ${postIndex + 1}st post`, description: content.title, target: postId });
  //   return postId;
  // }

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
      deleteIds = await this.removePosts();
      if (deleteIds.length > 0) {
        await this.service.createLog({ success: true, action: ActionType.POST, message: `delete ${deleteIds.length} posts`, targets: deleteIds });
      }
      // first check media
      if (!media.name) {
        await this.service.createLog({ success: true, action: ActionType.POST, message: `skip to create ${postIndex + 1}st post(${content.title})` });
        await this.service.updatePostResult(PostResultType.PROHIBITED, undefined, deleteIds);
        return true
      }
      // open content media
      const mediaId = await this.getMedia(content.folder, media);
      if (media.uuid != mediaId) {
        await this.service.updateContentMedia(postIndex, mediaId);
        await this.service.createLog({ success: true, action: ActionType.POST, message: `upload ${postIndex + 1}st media(${content.title})`, target: mediaId });
      }
      // create a post
      const postId = await this.browser.createEmptyPost([mediaId]);
      let success = await this.browser.setPostTitle(postId, content.title, content.postTags);
      if (!success) {
        await this.service.createLog({ success: false, action: ActionType.POST, message: `prohibited to create ${postIndex + 1}st post(${content.title})`, target: postId });
        await this.service.updatePostResult(PostResultType.PROHIBITED, undefined, deleteIds);
        return true;
      }
      success = await this.browser.publishPost(postId)
      if (!success) {
        await this.service.createLog({ success: false, action: ActionType.POST, message: `limited to create ${postIndex + 1}st post(${content.title})`, target: postId });
        await this.service.updatePostResult(PostResultType.SUCCESS, undefined, deleteIds, moment().add(1, "day").startOf("day").toDate());
        return true;
      }
      await this.service.createLog({ success: true, action: ActionType.POST, message: `create ${postIndex + 1}st post(${content.title})`, target: postId });
      await this.service.updatePostResult(PostResultType.SUCCESS, postId, deleteIds);
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.updatePostResult(PostResultType.FAILED, undefined, deleteIds);
      await this.service.createLog({ success: false, action: ActionType.POST, message: `failed to create ${postIndex + 1}st post(${content.title})` });
      return false;
    }
  }

  protected async doComment(): Promise<boolean> {
    // get comment
    try {
      const params: ICommentParams = await this.service.updateCommentSetting();
      if (params.comments.length === 0)
        return true;
      const explores = await this.browser.getExplores();
      let success = false;
      for (var explore of explores) {
        if (explore.creator != this.config.alias && !params.block_users.includes(explore.creator)) {
          success = await this.browser.followPost(explore);
          if (success) {
            const comment = this.pickup(params.comments);
            await this.browser.commentPost(explore, comment);
            await this.service.createLog({ success: true, action: ActionType.COMMENT, message: `comment ${explore.creator}'s post`, target: explore.uuid });
            break;
          }
        }
      }
      return true;
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.createLog({ success: false, action: ActionType.COMMENT, message: `failed to comment a post` });
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
      this.logger.notifyError(error);
      this.logger.warn(`check balance failed`);
      return false;
    }
  }

  private async getUnreadMessages(): Promise<IChatMessage[]> {
    const chats = await this.browser.getChats();
    const unreadChats = chats.filter(item => item.unread_message_count > 0 && item.message.received);
    return unreadChats.map(item => ({ user: item.custom_chat_name, message: item.message.content, time: new Date(item.message.datetime) }))
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
    try {
      let success;
      // const mediaId = await this.getMedia(post.schedule.folder, post.schedule.media);
      const mediaIds = await this.uploadMedia(post.schedule.folder, post.schedule.medias)
      this.logger.info(`upload media for schedule post(${post.schedule.title})`);
      const postId = await this.browser.createEmptyPost(mediaIds);
      this.logger.info(`create schedule post(${postId})`);
      success = await this.browser.setPostTitle(postId, post.schedule.title, post.schedule.tags);
      if (!success) {
        await this.service.createLog({ success: false, action: ActionType.SCHEDULE, message: `prohibited to create schedule post(${post.schedule.title})` });
        await this.service.updateScheduleResult({ id: post._id, post: postId, status: ScheduleStatus.FAILED, reason: "prohibited" });
        return;
      }
      this.logger.info(`set post title(${post.schedule.title})`);
      await this.browser.setPostPrice(postId, post.schedule.type, post.schedule.price);
      this.logger.info(`set post price`);
      success = await this.browser.schedulePost(postId, new Date(post.scheduledAt));
      if (!success) {
        await this.service.createLog({ success: false, action: ActionType.SCHEDULE, message: `limited to create schedule post(${post.schedule.title})` });
        await this.service.updateScheduleResult({ id: post._id, post: postId, status: ScheduleStatus.FAILED, reason: "rate limited" });
        return;
      }
      await this.service.createLog({ success: true, action: ActionType.SCHEDULE, message: `create schedule post(${post.schedule.title})`, target: postId });
      await this.service.updateScheduleResult({ id: post._id, post: postId, status: ScheduleStatus.SCHEDULED })
    } catch (error) {
      this.logger.notifyError(error);
      await this.service.createLog({ success: false, action: ActionType.SCHEDULE, message: `failed to create schedule post(${post.schedule.title})` });
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

  protected async doStory(): Promise<boolean> {
    const contents = this.settings.params?.contents || []
    let storyIndex = this.settings.params?.storyIndex || 0;
    const storyMaxCount = this.settings.params?.storyMaxCount || DEFAULT_STORY_MAX_COUNT;
    try {
      const stories = await this.browser.getSelfStories();
      this.logger.info(`stories : ${stories.length} : ${storyMaxCount}`)
      let countDeleted = 0
      while (stories.length >= storyMaxCount) {
        const storyDeleting = stories.shift();
        if (storyDeleting) {
          await this.browser.deleteStory(storyDeleting);
          this.logger.info(`delete a story(${storyDeleting})`)
          countDeleted = 0;
        }
      }
      if (countDeleted > 0) {
        await this.service.createLog({ success: true, action: ActionType.STORY, message: `delete ${countDeleted} stories`, });
      }
      // find next story content
      if (storyIndex >= contents.length)
        storyIndex = 0;
      let index = (storyIndex + 1) % contents.length;
      let content;
      while (index != storyIndex) {
        const contentChecked = contents[index];
        if (contentChecked.f2fStoryType && contentChecked.f2fStoryType > F2FStoryType.NONE && contentChecked.media[0].name) {
          content = contents[index]
          storyIndex = index
          break;
        }
        index = (index + 1) % contents.length;
      }
      if (!content) {
        this.logger.info(`there is no content for story`);
        await this.service.updateStorySetting(storyIndex)
        return true
      }
      const media: IMedia = content.media[0];
      const mediaId = await this.getMedia(content.folder, media);
      if (media.uuid != mediaId) {
        await this.service.updateContentMedia(storyIndex, mediaId);
        await this.service.createLog({ success: true, action: ActionType.STORY, message: `upload ${storyIndex + 1}st story media` });
      }
      // create story
      const storyId = await this.browser.createStory(mediaId, content.f2fStoryType || F2FStoryType.PUBLIC);
      await this.service.createLog({ success: true, action: ActionType.STORY, message: `create ${storyIndex + 1}th story`, target: storyId });
      await this.service.updateStorySetting(storyIndex)
      return true;
    } catch (error) {
      await this.service.createLog({ success: false, action: ActionType.STORY, message: `failed to create ${storyIndex + 1}th story` });
      await this.service.updateStorySetting(storyIndex)
      this.logger.notifyError(error);
      return false;
    }
  }

  public async doChat(): Promise<boolean> {
    try {
      let messages: IChatMessage[] = [];
      await this.service.updateChatSetting();
      const chats = await this.browser.getChats();
      const unreadChats = chats.filter(chat => chat.unread_message_count > 0);
      if (unreadChats.length == 0)
        return true;
      this.logger.info(`find ${unreadChats.length} unread chats`);
      for (var chat of unreadChats) {
        const message = chat.message;
        if (message.received && !message.read && message.message_type == "text") {
          messages.push({
            user: chat.custom_chat_name || chat.title,
            message: message.content,
            time: new Date(message.datetime)
          })
        }
      }
      if (messages.length > 0) {
        this.logger.info(`find ${messages.length} unread messages`);
        await this.sendChatNotification(messages);
      }
      return true
    } catch (error) {
      this.logger.notifyError(error);
      return true;
    }
  }

  protected async doTest(): Promise<boolean> {
    try {
      let success
      const mediaIds:string[] = ["fd692999-fc95-4aa2-bfdd-fff24043b0f7", "46edd559-399e-444b-8ca2-393eec73f12f", "a953a027-c964-4e81-9557-fac0f4fbf699"];
      const postId = await this.browser.createEmptyPost(mediaIds);
      this.logger.info(`create schedule post(${postId})`);
      success = await this.browser.setPostTitle(postId, "You want it? Come get it.", []);
      if (!success) {
        this.logger.info(`prohibited to create schedule post`);
        return false;
      }
      this.logger.info(`set post title`);
      await this.browser.setPostPrice(postId, PostType.PAID, 10);
      this.logger.info(`set post price`);
      success = await this.browser.schedulePost(postId, new Date("2026-10-31"));
      if (!success) {
        this.logger.info(`limited to create schedule post`);
        return false;
      }
      this.logger.info(`create schedule post(${postId})`);
      return true
    } catch (error: any) {
      console.error(error);
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