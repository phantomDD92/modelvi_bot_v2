import moment from "moment";
import { APIResponse } from "playwright";
import { AuthError, BotError, ProxyError, SessionTimeoutError } from "../utils/error";
import { IAccountID, IAccountSettings, IApiInfo, IBotConfig } from "../types/interface";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";
import { ILoyalFansMedia, ILoyalFansPost, ILoyalFansProfile, ILoyalFansStory } from "../types/loyalfans";
import { PostType } from "../types/constant";
import { HttpStatusCode } from "axios";

export class LoyalFansBrowser extends BaseBrowser {

  protected profile!: ILoyalFansProfile
  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // set content filter
  protected async setFilter() {
    // filter images
    // await this.context.route(/(\.png(\?.*)?$)|(\.jpg(\?.*)?$)|(\.webp(\?.*)?$)|(\.jpeg(\?.*)?$)|(blob(.*)?$)/, route => route.abort())
    // filter google analytics
    await this.context.route(/(https:\/\/public-cdn2\.loyalfans\.com\/images.*)|(https:\/\/www\.google-analytics\.com\/.*)/, route => route.abort());
  }

  public async home(): Promise<void> {
    try {
      await this.page.goto("https://loyalfans.com", { waitUntil: "domcontentloaded", timeout: 120000 });
      this.logger.info("open home page");
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "LoyalFansBrowser::home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async afterHome(): Promise<void> {
    try {
      await this.page.locator("app-uawarn > mat-dialog-actions button.btn-primary").click({ timeout: 3000 });
      this.logger.info("close age gate modal")
    } catch (error: any) {
      this.logger.info("skip age gate modal")
    }
  }

  public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
    try {
      await this.page.locator("app-homepage-login").waitFor();
      this.logger.info("start login");
      await this.page.locator("app-homepage-login input[name='username']").fill(setting.email);
      await this.page.locator("app-homepage-login input[name='password']").fill(setting.password);

      // click login
      const loginPromise = this.page.waitForResponse("https://www.loyalfans.com/api/v2/auth/login?ngsw-bypass=true", { timeout: 300000 });
      await this.page.locator("app-homepage-login form > button").click();
      await this.page.solveRecaptchas();
      this.logger.info("solve recaptcha");
      const loginResp = await loginPromise;
      if (!loginResp.ok()) {
        const loginData = await loginResp.json();
        if ((loginData?.message || "").includes("Wrong"))
          throw new AuthError("wrong credentials", {
            where: "LoyalFansBrowser::login",
            method: "POST",
            endpoint: "https://www.loyalfans.com/api/v2/auth/login?ngsw-bypass=true",
            params: loginResp.request().postData(),
            status: loginResp.statusText(),
            response: await loginResp.text(),
          })
        throw new BotError("login failed", {
          where: "LoyalFansBrowser::login",
          method: "POST",
          endpoint: "https://www.loyalfans.com/api/v2/auth/login?ngsw-bypass=true",
          params: loginResp.request().postData(),
          status: loginResp.statusText(),
          response: await loginResp.text(),
        })
      }
      const mePromise = this.page.waitForResponse("https://www.loyalfans.com/api/v1/auth/user/me?ngsw-bypass=true", { timeout: 120000 });
      const meResp = await mePromise;
      if (!meResp.ok())
        throw new BotError("get profile failed", {
          where: "LoyalFansBrowser::login",
          method: "GET",
          endpoint: "https://www.loyalfans.com/api/v1/auth/user/me?ngsw-bypass=true",
          status: meResp.statusText(),
          response: await meResp.text(),
        })
      const meData = await meResp.json();
      this.headers = await meResp.request().allHeaders();
      this.profile = meData.response;
      return { id: this.profile.user.uid, alias: this.profile.user.slug };
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("login failed", {
        where: "LoyalFansBrowser::login",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const to = moment().format("YYYY-MM-DD")
      const from = moment().subtract(30, "day").startOf("day").format("YYYY-MM-DD");
      const params = {
        "date_from": from,
        "date_to": to,
        "debug": true
      }
      const resp = await this.page.request.post("https://www.loyalfans.com/api/v2/funds/earnings/summary?ngsw-bypass=true", {
        headers: this.headers,
        data: params
      });
      const respData = await this.getResponseData(resp, { function: "getMonthlyEarnings", action: "get earnings", params, method: "POST" });
      return respData.NET?.total || 0;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get earnings failed", {
        where: "LoyalFansBrowser::getMonthlyEarnings",
        error: error.message,
        stack: error.stack
      });
    }
  }

  public async getSelfStories(): Promise<string[]> {
    try {
      const resp = await this.page.request.post("https://www.loyalfans.com/api/v2/stories?ngsw-bypass=true", {
        headers: this.headers,
        data: { slug: this.profile.user.slug }
      })
      const respData = await this.getResponseData(resp, { function: "getSelfStories", action: "get stories", method: "POST", params: { slug: this.profile.user.slug } })
      const items: ILoyalFansStory[] = respData.list;
      return items.map(item => item.uid);
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get stories failed", {
        where: "LoyalFansBrowser::getSelfStories",
        error: error.message,
        stack: error.stack
      });
    }
  }

  public async deleteStory(storyId: string) {
    try {
      const resp = await this.page.request.post("https://www.loyalfans.com/api/v2/stories/delete?ngsw-bypass=true", {
        headers: this.headers,
        data: { uid: storyId }
      });
      await this.getResponseData(resp, { function: "deleteStory", action: "delete story", method: "POST", params: { uid: storyId } })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete story failed", {
        where: "LoyalFansBrowser::deleteStory",
        error: error.message,
        stack: error.stack
      });
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    let postIds: string[] = [];
    let pageToken;
    let page = 0;
    try {
      while (true) {
        const params = {
          limit: 10,
          pageToken
        };
        const resp = await this.page.request.post("https://www.loyalfans.com/api/v1/timeline?ngsw-bypass=true", {
          headers: this.headers,
          data: params
        });
        const respData = await this.getResponseData(resp, { function: "getSelfPosts", action: "get posts", method: "POST", params })
        const posts: ILoyalFansPost[] = respData.timeline;
        postIds.push(...posts.map(post => post.uid));
        page += 1;
        if (posts.length < 10 || page > 5)
          break;
        pageToken = respData.page_token
        if (!pageToken)
          break
      }
      return postIds;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "LoyalFansBrowser::getSelfPosts",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getSelfFreePosts(): Promise<string[]> {
    let postIds: string[] = [];
    let pageToken;
    let page = 0;
    try {
      while (true) {
        const params = {
          limit: 4,
          page_token: pageToken
        };
        const resp = await this.page.request.post("https://www.loyalfans.com/api/v1/timeline?ngsw-bypass=true", {
          headers: this.headers,
          data: params
        });
        const respData = await this.getResponseData(resp, { function: "getSelfFreePosts", action: "get posts", method: "POST", params })
        const posts: ILoyalFansPost[] = respData.timeline;
        postIds.push(...posts.filter(post => post.privacy?.privacy_rule == "public" && post.original_content.includes("#modelvi")).map(post => post.uid));
        page += 1;
        if (posts.length < 4 || page > 5)
          break;
        pageToken = respData.page_token
        if (!pageToken)
          break
      }
      return postIds;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "LoyalFansBrowser::getSelfFreePosts",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async createFolder(name: string): Promise<string> {
    try {
      const resp = await this.page.request.post("https://www.loyalfans.com/api/v2/fs/make-folder?ngsw-bypass=true", {
        headers: this.headers,
        data: { name, "parent_uid": null }
      });
      const respData = await this.getResponseData(resp, { function: "createFolder", action: "create folder", method: "POST", params: { name, "parent_uid": null } })
      return respData.folder?.uid;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create folder failed", {
        where: "LoyalFansBrowser::createFolder",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async moveMediaToFolder(mediaId: string, folderId: string) {
    try {
      const resp = await this.page.request.post("https://www.loyalfans.com/api/v2/fs/move?ngsw-bypass=true", {
        headers: this.headers,
        data: { parent_uid: folderId, uid: [mediaId] }
      });
      await this.getResponseData(resp, { function: "moveMediaToFolder", action: "move media", method: "POST", params: { parent_uid: folderId, uid: [mediaId] }, })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("move media failed", {
        where: "LoyalFansBrowser::moveMediaToFolder",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async uploadMedia(path: string): Promise<string> {
    try {
      await this.page.locator("header button.profile").click({ timeout: 120000 });
      await this.page.locator("app-menu-model > div.user-menu > div.wrapper > button", { hasText: "Media Cloud" }).waitFor();
      await this.page.locator("app-menu-model > div.user-menu > div.wrapper > button", { hasText: "Media Cloud" }).click();
      await this.page.waitForTimeout(5000);
      await this.page.locator("app-media-cloud-modal").waitFor();
      // await this.page.locator(`app-media-cloud-modal div#${folderId}`).click();
      // await this.page.waitForTimeout(3000);
      const uploadPromise = this.page.waitForResponse("https://www.loyalfans.com/api/v2/fs/upload?ngsw-bypass=true", { timeout: 300000 });
      await this.page.locator("app-media-cloud-modal > section.header-wrapper > div.header-buttons > button", { hasText: "New" }).click();
      await this.page.locator("app-media-cloud-modal > section.header-wrapper > div.header-buttons > input.ng-star-inserted").setInputFiles(path);
      const uploadResp = await uploadPromise;

      if (!uploadResp.ok())
        throw new BotError("upload media failed", {
          where: "LoyalFansBrowser::uploadMedia",
          method: "POST",
          endpoint: "https://www.loyalfans.com/api/v2/fs/upload?ngsw-bypass=true",
          params: uploadResp.request().postData(),
          status: uploadResp.statusText(),
          response: await uploadResp.text()
        });
      const uploadData = await uploadResp.json();
      await this.page.goto("https://loyalfans.com/profile", { waitUntil: "domcontentloaded" });
      const mediaId = uploadData.file?.uid || uploadData.found?.uid;
      if (!mediaId)
        throw new BotError("upload media failed", {
          where: "LoyalFansBrowser::uploadMedia",
          method: "POST",
          endpoint: "https://www.loyalfans.com/api/v2/fs/upload?ngsw-bypass=true",
          params: uploadResp.request().postData(),
          status: uploadResp.statusText(),
          response: await uploadResp.text()
        });
      return mediaId;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("upload media failed", {
        where: "LoyalFansBrowser::uploadMedia",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async deletePost(postId: string) {
    try {
      const resp = await this.page.request.post("https://www.loyalfans.com/api/v1/post/delete-post?ngsw-bypass=true", {
        headers: this.headers,
        data: { uid: postId }
      });
      await this.getResponseData(resp, { function: "deletePost", action: "delete post", method: "POST", params: { uid: postId } })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete post failed", {
        where: "LoyalFansBrowser::deletePost",
        error: error.message,
        stack: error.stack
      });
    }
  }

  public async findFolder(name: string): Promise<string | undefined> {
    try {
      const params = {
        "sort": "created_at",
        "sort_dir": "desc",
        "limit": 30,
        "ngsw-bypass": true,
      };
      const resp = await this.page.request.get("https://www.loyalfans.com/api/v2/fs/list", {
        headers: this.headers,
        params
      })
      const respData = await this.getResponseData(resp, { function: "findFolder", action: "find folder", params })
      const items: ILoyalFansMedia[] = respData.items;
      const folder = items.find(item => item.type == "folder" && item.name.toLowerCase() == name.toLowerCase())
      return folder?.uid;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("find folder failed", {
        where: "LoyalFansBrowser::findFolder",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async findMediaInFolder(folderId: string, mediaId: string): Promise<string | undefined> {
    try {
      let media;
      let pageToken;
      const params = {
        "folder_uid": folderId,
        "sort": "created_at",
        "sort_dir": "desc",
        "limit": 30,
        "ngsw-bypass": true,
      }
      const resp = await this.page.request.get("https://www.loyalfans.com/api/v2/fs/list", {
        headers: this.headers,
        params: pageToken ? { "page_token": pageToken, ...params } : params,
      });
      const respData = await this.getResponseData(resp, { function: "findMediaInFolder", action: "find media", params })
      const items: ILoyalFansMedia[] = respData.items || []
      media = items.find(item => item.type != "folder" && item.uid == mediaId);
      return media?.uid;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("find media failed", {
        where: "LoyalFansBrowser::findMediaInFolder",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async schedulePost(scheduledAt: Date, title: string, tags: string[], mediaIds: string[], postType?: number, postPrice?: number) {
    try {
      let params;
      let postTags = tags;
      postTags.push("modelvi");
      switch (postType) {
        case PostType.PAID:
          params = {
            title,
            content: postTags.map(tag => `#${tag}`).join(" "),
            images: mediaIds.map(mediaId => ({ type: "MC", value: mediaId })),
            labels: [],
            privacy_coverage: "all",
            privacy_rule: "subscribers",
            price: `${postPrice}`,
            schedule_post_at: moment(scheduledAt).format("YYYY-MM-DD HH:mm:ss"),
            timezone: "UTC",
            user_mentions: [],
          }
          break;
        case PostType.FANS:
          params = {
            title,
            content: tags.map(tag => `#${tag}`).join(" "),
            images: mediaIds.map(mediaId => ({ type: "MC", value: mediaId })),
            labels: [],
            privacy_coverage: "all",
            privacy_rule: "friends",
            schedule_post_at: moment(scheduledAt).format("YYYY-MM-DD HH:mm:ss"),
            timezone: "UTC",
            user_mentions: [],
          }
          break;
        default:
          params = {
            title,
            content: tags.map(tag => `#${tag}`).join(" "),
            images: mediaIds.map(mediaId => ({ type: "MC", value: mediaId })),
            labels: [],
            privacy_coverage: "all",
            privacy_rule: "public",
            schedule_post_at: moment(scheduledAt).format("YYYY-MM-DD hh:mm:ss"),
            timezone: "UTC",
            user_mentions: [],
          }
          break;
      }
      const resp = await this.page.request.post("https://www.loyalfans.com/api/v1/post/create-post?ngsw-bypass=true", {
        headers: this.headers,
        data: params
      });
      await this.getResponseData(resp, { action: "schedule post", function: "schedulePost", method: "POST", params })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("schedule post failed", {
        where: "LoyalFansBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async refreshSession(): Promise<void> {
    try {
      const summaryPromise = this.page.waitForRequest("https://www.loyalfans.com/api/v2/funds/earnings/summary?ngsw-bypass=true", { timeout: 120000 });
      await this.page.goto("https://www.loyalfans.com/settings/earnings/summary", { timeout: 120000 });
      const summaryReq = await summaryPromise;
      this.headers = await summaryReq.allHeaders();
    } catch (error: any) {
      throw new BotError("refresh session failed", {
        where: "LoyalFansBrowser::refreshSession",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  private async getResponseData(resp: APIResponse, info: IApiInfo) {
    const respData = await resp.json();
    if (!resp.ok()) {
      if (resp.status() == HttpStatusCode.Unauthorized)
        throw new SessionTimeoutError("session timeout", {
          where: `LoyalFansBrowser::${info.function}`
        });
      if (resp.status() == HttpStatusCode.InternalServerError)
        if (respData.httpCode == HttpStatusCode.Forbidden)
          throw new SessionTimeoutError("session timeout", {
            where: `LoyalFansBrowser::${info.function}`
          });
      throw new BotError(`${info.action} failed`, {
        where: `LoyalFansBrowser::${info.function}`,
        method: info.method || "GET",
        endpoint: info.endpoint || resp.url(),
        params: info.params,
        status: resp.statusText(),
        response: await resp.text()
      })
    }
    return respData;
  }
}
