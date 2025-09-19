import { FanslyBrowser } from "../browser/fansly-browser";
import { PostApiService } from "../services/post-service";
import { IBotConfig } from "../types/interface";
import { Logger } from "../utils/logger";
import { BotError } from '../utils/error';
import { LikeBot } from "./like-bot";
import { LikeApiService } from "../services/like-service";
import { Platform } from "../types/constant";

export class FanslyLikeBot extends LikeBot {
  protected browser!: FanslyBrowser;
  protected service!: LikeApiService;

  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  protected async initBrowser(): Promise<void> {
    this.browser = new FanslyBrowser(this.config, this.logger)
    await super.initBrowser();
  }

  protected async initService(): Promise<void> {
    this.service = new LikeApiService(this.config, this.logger)
    await super.initService();
  }

  protected async initAccount(): Promise<void> {
    await super.initAccount();
    if (!this.settings.proxy) {
      await this.service.changeProxy();
      throw new BotError("no proxy", {
        where: "FanslyLikeBot::initAccount",
        error: "no proxy for the account",
      });
    }
    const proxy = this.parseProxy(this.settings.proxy);
    if (!proxy) {
      await this.service.changeProxy();
      throw new BotError("invalid proxy", {
        where: "FanslyLikeBot::initAccount",
        error: "invalid proxy for the account"
      });
    }
    this.proxy = proxy;
    if (!this.settings.device || this.settings.device == "")
      this.settings.verified = false;
    this.logger.info("init account success");
  }


  protected async verifyAfterRegister(): Promise<void> {
    try {
      const since = new Date();
      await this.emailReader.connect();
      let verificationLink = undefined;
      for (var i = 0; i < 3; i++) {
        await this.browser.waitForTimeout(3000);
        const links = await this.emailReader.getVerifyLinksForFansly(since);
        if (links.length > 0) {
          verificationLink = links[links.length - 1];
          break
        }
      }
      this.logger.info(`get verification link(${verificationLink})`)
      if (!verificationLink)
        throw new BotError("verification failed", {
          where: "FanslyLikeBot::verify",
          error: "cannot receive verification mail",
        })
      await this.browser.verify(verificationLink);
      await this.service.verifyAccount();
      this.settings.verified = true
      this.logger.info("verify account");
      await this.browser.refreshHome();
      if (!this.settings.device) {
        const device = await this.browser.setupAuthentication();
        await this.service.setDevice(device || "");
        this.logger.info("setup authentication");
      }
    } catch (error: any) {
      console.error(error);
      if (error instanceof BotError)
        throw error;
      throw new BotError("verification failed", {
        where: "FanslyLikeBot::verify",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  protected async verifyAfterLogin(): Promise<void> {
    try {
      const since = new Date();
      // first send verification main
      const needVerify = await this.browser.sendVerificationMail();
      if (!needVerify) {
        await this.service.verifyAccount();
        this.settings.verified = true
        return;
      }
      this.logger.info("send verification mail");
      await this.emailReader.connect();
      let verificationLink = undefined;
      for (var i = 0; i < 3; i++) {
        await this.browser.waitForTimeout(3000);
        const links = await this.emailReader.getVerifyLinksForFansly(since);
        if (links.length > 0) {
          verificationLink = links[links.length - 1];
          break
        }
      }
      this.logger.info(`get verification link(${verificationLink})`)
      if (!verificationLink)
        throw new BotError("verification failed", {
          where: "FanslyLikeBot::verify",
          error: "cannot receive verification mail",
        })
      await this.browser.verify(verificationLink);
      await this.service.verifyAccount();
      this.settings.verified = true
      await this.service.createHistory("verify account");
      await this.browser.refreshHome();
      if (!this.settings.device) {
        const device = await this.browser.setupAuthentication();
        await this.service.setDevice(device || "");
        await this.service.createHistory("setup authentication");
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("verification failed", {
        where: "FanslyLikeBot::verify",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  protected async doFollow(): Promise<boolean> {
    try {
      let followCount = 0;
      const models = await this.service.getTeamModels(Platform.FANSLY);
      const modelIds = models.map(model => model.identifier);
      const followings = await this.browser.getFollowings();
      const followingIds = followings.map(following => following.id);
      this.logger.info(`${followings.length} followings among ${models.length} models`)
      for (var model of models) {
        if (followingIds.includes(model.identifier))
          continue;
        const success = await this.browser.followModel(model.identifier);
        if (success) {
          followCount += 1;
          await this.service.createHistory(`follow ${model.alias}`);
        }
      }
      for (var followingId of followingIds) {
        if (modelIds.includes(followingId))
          continue;
        await this.browser.unfollowModel(followingId);
        followCount -= 1;
        await this.service.createHistory(`unfollow model(${followingId})`);
      }
      await this.service.updateFollowSettings(followCount);
      return true;
    } catch (error: any) {
      await this.service.setLastError(error.message);
      await this.logger.notifyError(error)
      return false;
    }
  }

  private async commentPost(postId: string, comment: string): Promise<boolean> {
    try {
      await this.browser.commentPost(postId, comment);
      await this.service.createHistory(`comment post(${postId})`);
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  protected async doLike(): Promise<boolean> {
    try {
      const likeMaxCount = this.settings.params?.likeLimit || 1;
      let likeCount = 0, commentCount = 0;
      const posts = await this.browser.getPosts();
      const offset = Math.floor(Math.random() * (posts.length - 1));
      const comments = await this.service.pickComments(likeMaxCount);
      console.log(comments);
      for (var i = 0; i < posts.length; i++) {
        const postIndex = (offset + i) % posts.length;
        const post = posts[postIndex]
        if (post.liked)
          continue;
        await this.browser.likePost(post.id);
        await this.service.createHistory(`like post(${post.id})`);
        for (var attachment of post.attachments) {
          if (attachment.contentId)
            await this.browser.likeMedia(attachment.contentId);
        }
        if (comments.length > commentCount) {
          if (await this.commentPost(post.id, comments[commentCount]))
            commentCount += 1
        }
        likeCount += 1
        if (likeCount >= likeMaxCount)
          break;
      }
      await this.service.updateLikeSettings(likeCount, commentCount);
      return true;
    } catch (error: any) {
      await this.service.setLastError(error.message);
      await this.logger.notifyError(error)
      return false;
    }
  }

  protected async doTest(): Promise<boolean> {
    try {
      return true;
    } catch (error: any) {
      console.error(error);
      return false;
    }
  }
}