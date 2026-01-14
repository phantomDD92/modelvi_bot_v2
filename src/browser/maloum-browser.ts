import {
  AuthError,
  BotError,
  ProxyError,
  SessionTimeoutError,
} from "../utils/error";
import { POST_LIMITED, PostType } from "../types/constant";
import {
  IAccountID,
  IAccountSettings,
  IBotConfig,
  IChatMessage,
  IContent,
} from "../types/interface";
import {
  IMaloumCategory,
  IMaloumChat,
  IMaloumFolder,
  IMaloumMediaInfo,
  IMaloumPost,
} from "../types/maloum";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";
import moment from "moment";
import fs from "fs";
import { HttpStatusCode } from "axios";

interface IMaloumTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
}

export class MaloumBrowser extends BaseBrowser {
  protected captchaSolved: boolean;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger);
    this.captchaSolved = false;
  }

  public async home(): Promise<void> {
    try {
      await this.page.route(
        /https:\/\/challenges\.cloudflare\.com\/turnstile\/.+\/api.js/,
        async (route) => {
          this.logger.info("install captcha solver");
          const response = await route.fetch();
          const body = fs.readFileSync("./data/maloum.dat");
          route.fulfill({
            response,
            body: body,
            headers: response.headers(),
          });
        }
      );
      this.page.on("console", async (msg) => {
        if (msg.text().includes("intercepted-params:")) {
          this.logger.info("solving captcha...");
          this.captchaSolved = false;
          const params = JSON.parse(
            msg.text().replace("intercepted-params:", "")
          );
          const res = await this.solver.cloudflareTurnstile({
            pageurl: params.pageurl,
            sitekey: params.sitekey,
            action: params.action,
          });
          this.logger.info("solve captcha...");
          this.captchaSolved = true;
          await this.page.evaluate((token) => {
            window.cfCallback?.(token);
          }, res.data);
        }
      });
      await this.page.goto("https://maloum.com/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "MaloumBrowser::home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async afterHome(): Promise<void> {
    await this.closeConsentModal();
  }

  private async closeConsentModal() {
    try {
      await this.page
        .locator("div#cmpbox span#cmpwelcomebtnyes > a.cmpboxbtnyes ")
        .first()
        .click({ timeout: 10000 });
      this.logger.info("close consent modal");
    } catch (error: any) {}
  }

  public async refreshSession(): Promise<void> {
    try {
      const mePromise = this.page.waitForResponse(
        "https://api.maloum.com/users/current",
        { timeout: 120000 }
      );
      await this.page.goto("https://app.maloum.com/", { timeout: 600000 });
      const meResp = await mePromise;
      this.headers = await meResp.request().allHeaders();
    } catch (error: any) {
      throw new BotError("refresh session failed", {
        where: "MaloumBrowser::refreshSession",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  // set content filter
  protected async setFilter() {
    // filter images
    await this.context.route(
      /(\.png(\?.*)?$)|(\.jpg(\?.*)?$)|(\.webp(\?.*)?$)|(\.jpeg(\?.*)?$)|(blob(.*)?$)/,
      (route) => route.abort()
    );
    // filter google analytics
    await this.context.route(
      /https:\/\/www\.google-analytics\.com\/.*/,
      (route) => route.abort()
    );
    // set token filter
    this.page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes(
          "https://srswgacczfgjttwdpuia.supabase.co/auth/v1/token"
        ) &&
        response.request().method() == "POST" &&
        response.status() == 200
      ) {
        const respData: IMaloumTokenResponse = await response.json(); // get response body as Buffer
        this.headers["Authorization"] = `Bearer ${respData.access_token}`;
        this.logger.info("refresh access token");
      }
    });
  }

  public async login(
    setting: IAccountSettings
  ): Promise<IAccountID | undefined> {
    try {
      // await this.page.waitForTimeout(60000);
      // go to login page
      await this.page.goto("https://app.maloum.com/login?returnPath=/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      this.closeConsentModal();
      // input email and password
      await this.page.locator("form input[name='usernameOrEmail']").waitFor();
      await this.page
        .locator("form input[name='usernameOrEmail']")
        .first()
        .fill(setting.email);
      await this.page
        .locator("form input[name='password']")
        .first()
        .fill(setting.password);

      // prepare wait login response
      // const mePromise = this.page.waitForResponse(response => {
      //   return response.url() === "https://api.maloum.com/users/me" && response.request().method() === "GET"
      // }, { timeout: 30000 });
      const loginPromise = this.page.waitForResponse(
        "https://api.maloum.com/user-management/login"
      );

      // click sign-in button
      await this.page
        .locator("form button", { hasText: "Login" })
        .first()
        .click();
      const loginResp = await loginPromise;
      if (!loginResp.ok())
        throw new AuthError("wrong credentials", {
          where: "MaloumBrowser::login",
          method: "POST",
          endpoint: "https://api.maloum.com/user-management/login",
          params: loginResp.request().postData(),
          status: loginResp.statusText(),
          response: await loginResp.text(),
        });
      // prepare wait login response
      const mePromise = this.page.waitForResponse(
        "https://api.maloum.com/users/current"
      );
      // // click sign-in button
      // await this.page.locator("form input[type='submit']").first().click();
      // // check login api response
      const meResp = await mePromise;
      if (!meResp.ok()) {
        throw new BotError("login failed", {
          where: "MaloumBrowser::login",
          method: "GET",
          endpoint: "https://api.maloum.com/users/current",
          status: meResp.statusText(),
          response: await meResp.text(),
        });
      }
      this.logger.info("get user profile");

      this.headers = await meResp.request().allHeaders();
      const meData = await meResp.json();
      if (!meData.isCreator)
        throw new AuthError("not creator account", {
          where: "MaloumBrowser::login",
          method: "GET",
          endpoint: "https://api.maloum.com/users/current",
          status: meResp.statusText(),
          response: await meResp.text(),
        });
      return { alias: meData.username, id: meData._id };
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("login failed", {
        where: "MaloumBrowser::login",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getFolder(folderName: string): Promise<IMaloumFolder> {
    try {
      let folder;
      // find folder
      const resp = await this.page.request.get(
        "https://api.maloum.com/vault/folders",
        {
          headers: this.headers,
          params: { limit: 15 },
        }
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getFolder",
          });
        throw new BotError("get folders failed", {
          where: "MaloumBrowser::getFolder",
          method: "GET",
          endpoint: "https://api.maloum.com/vault/folders",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      const folders: IMaloumFolder[] = respData.data || [];
      folder = folders.find(
        (item) => item.name.toLowerCase() == folderName.toLowerCase()
      );
      if (folder) return folder;
      const resp1 = await this.page.request.post(
        "https://api.maloum.com/vault/folders",
        { headers: this.headers, data: { name: folderName } }
      );
      if (!resp1.ok()) {
        if (resp1.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getFolder",
          });
        throw new BotError("create folder failed", {
          where: "MaloumBrowser::getFolder",
          method: "POST",
          endpoint: "https://api.maloum.com/vault/folders",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      folder = await resp1.json();
      return folder;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get folder failed", {
        where: "MaloumBrowser::getFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async deleteFolder(folderId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(
        `https://api.maloum.com/vault/folders/${folderId}`,
        {
          headers: this.headers,
          params: { deleteMedia: false },
        }
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::deleteFolder",
          });
        throw new BotError("delete folder failed", {
          where: "MaloumBrowser::deleteFolder",
          method: "DELETE",
          endpoint: `https://api.maloum.com/vault/folders/${folderId}`,
          params: { deleteMedia: false },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete folder failed", {
        where: "MaloumBrowser::deleteFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    try {
      const postIds: string[] = [];
      let next;
      let page = 0;
      const resp = await this.page.request.get(
        "https://api.maloum.com/posts/me",
        {
          headers: this.headers,
          params: { limit: 30 },
        }
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getSelfPosts",
          });
        throw new BotError("get self posts failed", {
          where: "MaloumBrowser::getSelfPosts",
          method: "GET",
          endpoint: "https://api.maloum.com/posts/me",
          params: { limit: 30 },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      next = respData.next;
      let posts: IMaloumPost[] = respData.data || [];
      postIds.push(...posts.map((post) => post._id));
      while (next) {
        page += 1;
        const respNext = await this.page.request.get(
          "https://api.maloum.com/posts/me",
          {
            headers: this.headers,
            params: { next, limit: 30 },
          }
        );
        if (!respNext.ok()) {
          if (respNext.status() == HttpStatusCode.Unauthorized)
            throw new SessionTimeoutError("session timeout", {
              where: "MaloumBrowser::getSelfPosts",
            });
          throw new BotError("get self posts failed", {
            where: "MaloumBrowser::getSelfPosts",
            method: "GET",
            endpoint: "https://api.maloum.com/posts/me",
            params: { next, limit: 30 },
            status: resp.statusText(),
            response: await resp.text(),
          });
        }
        const respNextData = await respNext.json();
        next = respNextData.next;
        posts = respData.data || [];
        postIds.push(...posts.map((post) => post._id));
        if (page > 5) break;
      }
      return postIds;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get posts failed", {
        where: "MaloumBrowser::getSelfPosts",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getRecentPosts(page: number = 0): Promise<IMaloumPost[]> {
    try {
      const resp = await this.page.request.get(
        "https://api.maloum.com/content/discovery",
        {
          headers: this.headers,
          params: { next: page * 30, limit: 30 },
        }
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getRecentPosts",
          });
        throw new BotError("get recent posts failed", {
          where: "MaloumBrowser::getRecentPosts",
          method: "GET",
          endpoint: "https://api.maloum.com/content/discovery",
          params: { next: page * 30, limit: 30 },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      return respData.data;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get posts failed", {
        where: "MaloumBrowser::getRecentPosts",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async findMediaInFolder(
    folder: IMaloumFolder,
    mediaId: string
  ): Promise<string | undefined> {
    try {
      const resp = await this.page.request.get(
        `https://api.maloum.com/vault/folders/${folder._id}/media`,
        {
          headers: this.headers,
          params: { limit: 50 },
        }
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::findMediaInFolder",
          });
        throw new BotError("find media failed", {
          where: "MaloumBrowser::findMediaInFolder",
          method: "GET",
          endpoint: `https://api.maloum.com/vault/folders/${folder._id}/media`,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      const items: IMaloumMediaInfo[] = respData.data || [];
      const result = items.find((item) => item.media?.uploadId == mediaId);
      return result ? result.media.uploadId : undefined;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("find media failed", {
        where: "MaloumBrowser::findMediaInFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async deletePost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(
        `https://api.maloum.com/posts/${postId}`,
        { headers: this.headers }
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::deletePost",
          });
        throw new BotError("delete post failed", {
          where: "MaloumBrowser::deletePost",
          method: "DELETE",
          endpoint: `https://api.maloum.com/posts/${postId}`,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete post failed", {
        where: "MaloumBrowser::deletePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async uploadMediaInFolder(
    folder: IMaloumFolder,
    image: string
  ): Promise<string> {
    try {
      // go to vault page
      await this.page.goto("https://app.maloum.com/vault", {
        waitUntil: "load",
        timeout: 120000,
      });
      // open folder
      await this.page
        .locator(`div#leftColumn div[title='${folder.name}']`)
        .waitFor();
      await this.page
        .locator(`div#leftColumn div[title='${folder.name}']`)
        .first()
        .click();
      await this.page.waitForTimeout(1000);
      // upload image
      const uploadPromise = this.page.waitForResponse(
        (response) => {
          return (
            response
              .url()
              .includes("https://api.maloum.com/uploads/generate-upload-url") &&
            response.request().method() === "POST"
          );
        },
        { timeout: 600000 }
      );
      await this.page
        .locator("div#rightColumn input[type='file']")
        .first()
        .setInputFiles(image);
      const uploadResp = await uploadPromise;
      if (!uploadResp.ok()) {
        throw new BotError("upload media failed", {
          where: "MaloumBrowser::uploadMediaInFolder",
          method: "POST",
          endpoint: `https://api.maloum.com/uploads/generate-upload-url`,
          status: uploadResp.statusText(),
          response: await uploadResp.text(),
        });
      }
      const uploadData = await uploadResp.json();
      return uploadData.id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("upload media failed", {
        where: "MaloumBrowser::uploadMediaInFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  private async getCategories(): Promise<IMaloumCategory[]> {
    const resp = await this.page.request.get(
      "https://api.maloum.com/categories",
      {
        headers: this.headers,
      }
    );
    if (!resp.ok()) {
      if (resp.status() == HttpStatusCode.Unauthorized)
        throw new SessionTimeoutError("session timeout", {
          where: "MaloumBrowser::getCategories",
        });
      throw new BotError("get categories failed", {
        where: "MaloumBrowser::getCategories",
        method: "GET",
        endpoint: `https://api.maloum.com/categories`,
        status: resp.statusText(),
        response: await resp.text(),
      });
    }
    const respData = await resp.json();
    return respData
      ? respData.filter(
          (item: IMaloumCategory) => item.type == "POST" || item.type == "ALL"
        )
      : [];
  }

  public async followPost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.post(
        `https://api.maloum.com/posts/${postId}/like`,
        {
          headers: this.headers,
        }
      );
      if (!resp.ok()) {
        if (resp.status() == 401)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::followPost",
          });
        else
          throw new BotError("follow post failed", {
            where: "MaloumBrowser::followPost",
            method: "POST",
            endpoint: `https://api.maloum.com/posts/${postId}/like`,
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("follow post failed", {
        where: "MaloumBrowser::followPost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async commentPost(postId: string, text: string): Promise<void> {
    try {
      const resp = await this.page.request.post(
        `https://api.maloum.com/posts/${postId}/comments`,
        {
          headers: this.headers,
          data: { text },
        }
      );
      if (!resp.ok()) {
        if (resp.status() == 401)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::commentPost",
          });
        else
          throw new BotError("comment post failed", {
            where: "MaloumBrowser::commentPost",
            method: "POST",
            endpoint: `https://api.maloum.com/posts/${postId}/comments`,
            params: { text },
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("comment post failed", {
        where: "MaloumBrowser::commentPost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getUnreadChats(): Promise<IChatMessage[]> {
    try {
      const resp = await this.page.request.get("https://api.maloum.com/chats", {
        headers: this.headers,
        params: { filter: "unread", limit: 15 },
      });
      const respData = await resp.json();
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getUnreadChats",
          });
        else
          throw new BotError("get unread chats failed", {
            where: "MaloumBrowser::commentPost",
            method: "GET",
            endpoint: `https://api.maloum.com/chats?filter=unread`,
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
      const chats: IMaloumChat[] = respData.data || [];
      return chats
        .map((chat) => ({
          user: chat.chatPartner.username,
          message: chat.lastRelevantMessage.text,
          time: new Date(chat.lastRelevantMessage.sentAt),
        }))
        .filter((chat) => chat.user != "maloum.official");
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get chats failed", {
        where: "MaloumBrowser::getUnreadChats",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async schedulePost(
    scheduledAt: Date,
    title: string,
    tags: string[],
    mediaIds: string[],
    type?: number
  ): Promise<string> {
    try {
      const categories = await this.getCategories();
      const postTags = (tags || []).map((tag) => tag.toLowerCase());
      postTags.push("public");
      const cats = categories
        .filter((cat) => postTags.includes(cat.name.toLowerCase()))
        .map((cat) => cat._id);
      let free = true;
      if (type == PostType.FANS || type == PostType.PAID) free = false;
      const params = {
        caption: title,
        categories: cats.slice(0, 3),
        public: free,
        mediaIds: mediaIds,
        scheduledAt: moment().isAfter(scheduledAt, "hour")
          ? moment().add(1, "hour").utc().toISOString()
          : moment(scheduledAt).utc().toISOString(),
      };
      console.log(params);
      const resp = await this.page.request.post(
        "https://api.maloum.com/posts",
        {
          headers: this.headers,
          data: params,
        }
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.TooManyRequests) {
          return POST_LIMITED;
        }
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::schedulePost",
          });
        else
          throw new BotError("schedule post failed", {
            where: "MaloumBrowser::schedulePost",
            method: "POST",
            endpoint: `https://api.maloum.com/posts`,
            status: resp.statusText(),
            response: await resp.text(),
            params: JSON.stringify(params),
          });
      }
      const respData: IMaloumPost = await resp.json();
      return respData._id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("schedule post failed", {
        where: "MaloumBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async publishPost(
    title: string,
    tags: string[],
    mediaId: string,
    type?: number
  ): Promise<string> {
    try {
      const categories = await this.getCategories();
      const postTags = (tags || []).map((tag) => tag.toLowerCase());
      postTags.push("public");
      const cats = categories
        .filter((cat) => postTags.includes(cat.name.toLowerCase()))
        .map((cat) => cat._id);
      let free = true;
      if (type == PostType.FANS || type == PostType.PAID) free = false;

      // --- go to create post page
      await this.page.goto("https://app.maloum.com/post/create");
      // --- set media for post
      // click add media button
      await this.page
        .locator("form button", { hasText: "Add media" })
        .first()
        .click();
      // select all medias folder
      await this.page.locator("div[title='All media']").first().click();
      const resp = await this.page.request.post(
        "https://api.maloum.com/posts",
        {
          headers: this.headers,
          data: {
            caption: title,
            categories: cats.slice(0, 3),
            public: free,
            mediaIds: [mediaId],
          },
        }
      );
      // if (!resp.ok()) {
      //   if (resp.status() == HttpStatusCode.TooManyRequests)
      //     return POST_LIMITED;
      //   if (resp.status() == HttpStatusCode.Unauthorized)
      //     throw new SessionTimeoutError("session timeout", {
      //       where: "MaloumBrowser::publishPost",
      //     });

      //   throw new BotError("publish post failed", {
      //     where: "MaloumBrowser::publishPost",
      //     method: "POST",
      //     endpoint: `https://api.maloum.com/posts`,
      //     status: resp.statusText(),
      //     response: await resp.text(),
      //     params: {
      //       caption: title,
      //       categories: cats.slice(0, 3),
      //       public: free,
      //       mediaIds: [mediaId],
      //     },
      //   });
      // }
      const respData: IMaloumPost = await resp.json();
      return respData._id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("publish post failed", {
        where: "MaloumBrowser::publishPost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const balancePromise = this.page.waitForResponse(
        "https://api.maloum.com/users/balance"
      );

      await this.page.goto("https://app.maloum.com/payout", {
        waitUntil: "domcontentloaded",
      });
      const balanceResp = await balancePromise;
      if (!balanceResp.ok()) {
        if (balanceResp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getMonthlyEarnings",
          });
        throw new BotError("get earnings failed", {
          where: "MaloumBrowser::getMonthlyEarnings",
          method: "GET",
          endpoint: "https://api.maloum.com/users/balance",
          status: balanceResp.statusText(),
          response: await balanceResp.text(),
        });
      }
      const respData = await balanceResp.json();
      return respData.balance?.payoutAmount || 0;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get earnings failed", {
        where: "MaloumBrowser::getMonthlyEarnings",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async schedulePostV2(
    scheduledAt: Date,
    title: string,
    tags: string[],
    mediaIds: string[],
    type?: number
  ): Promise<void> {
    try {
      let free = true;
      if (type == PostType.FANS || type == PostType.PAID) free = false;
      // --- go to create post page
      await this.page.goto("https://app.maloum.com/post/create");
      // --- set media for post
      // click add media button
      await this.page
        .locator("form button", { hasText: "Add media" })
        .first()
        .click();
      await this.waitAndLog(1000, "add media click");
      // select all medias folder
      await this.page.locator("div[title='All media']").first().click();
      // select first image
      await this.page
        .locator("div#rightColumn > div > div > div > div.grid > div")
        .first()
        .locator("button")
        .last()
        .click();

      // click next button
      await this.page
        .locator("div#rightColumn button", { hasText: "Next" })
        .first()
        .click();
      await this.waitAndLog(1000, "select first image");
      // set post title
      await this.page.locator("textarea[name='caption']").first().fill(title);
      await this.waitAndLog(1000, "set post title");
      // select category
      await this.page
        .locator("div[data-testid='select-categories-button']")
        .first()
        .click();
      await this.waitAndLog(1000, "select category");
      await this.page.locator("input").last().fill("Public");
      await this.page.locator("button", { hasText: "Public" }).first().click();
      await this.page.locator("button", { hasText: "Save" }).first().click();
      await this.waitAndLog(1000, "set category public");
      // install request hook
      await this.page.route("https://api.maloum.com/posts", async (route) => {
        // console.log("#########################");
        const postData = route.request().postDataJSON();
        // console.log(route.request().postDataJSON());
        await this.page.unroute("https://api.maloum.com/posts");
        // console.log("#########################");
        await route.continue({
          postData: {
            ...postData,
            public: free,
            mediaIds: [mediaIds],
            scheduledAt: moment().isAfter(scheduledAt, "hour")
              ? moment().add(1, "hour").utc().toISOString()
              : moment(scheduledAt).utc().toISOString(),
          },
        });
      });
      const respPromise = this.page.waitForResponse(
        "https://api.maloum.com/posts"
      );
      // click publish button
      await this.page
        .locator("button[data-testid='create-post-button']")
        .first()
        .click();
      const resp = await respPromise;
      if (!resp.ok()) {
        throw new BotError("publish post failed", {
          where: "MaloumBrowser::publishPost",
          method: "POST",
          endpoint: "https://api.maloum.com/users/balance",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("publish post failed", {
        where: "MaloumBrowser::publishPost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async publishPostV2(
    title: string,
    tags: string[],
    mediaId: string,
    type?: number
  ): Promise<void> {
    try {
      let free = true;
      if (type == PostType.FANS || type == PostType.PAID) free = false;
      // --- go to create post page
      await this.page.goto("https://app.maloum.com/post/create");
      // --- set media for post
      // click add media button
      await this.page
        .locator("form button", { hasText: "Add media" })
        .first()
        .click();
      await this.waitAndLog(1000, "add media click");
      // select all medias folder
      await this.page.locator("div[title='All media']").first().click();
      // select first image
      await this.page
        .locator("div#rightColumn > div > div > div > div.grid > div")
        .first()
        .locator("button")
        .last()
        .click();

      // click next button
      await this.page
        .locator("div#rightColumn button", { hasText: "Next" })
        .first()
        .click();
      await this.waitAndLog(1000, "select first image");
      // set post title
      await this.page.locator("textarea[name='caption']").first().fill(title);
      await this.waitAndLog(1000, "set post title");
      // select category
      await this.page
        .locator("div[data-testid='select-categories-button']")
        .first()
        .click();
      await this.waitAndLog(1000, "select category");
      await this.page.locator("input").last().fill("Public");
      await this.page.locator("button", { hasText: "Public" }).first().click();
      await this.page.locator("button", { hasText: "Save" }).first().click();
      await this.waitAndLog(1000, "set category public");
      // install request hook
      await this.page.route("https://api.maloum.com/posts", async (route) => {
        // console.log("#########################");
        const postData = route.request().postDataJSON();
        // console.log(route.request().postDataJSON());
        await this.page.unroute("https://api.maloum.com/posts");
        // console.log("#########################");
        await route.continue({
          postData: {
            ...postData,
            public: free,
            mediaIds: [mediaId],
            // scheduledAt: moment().add(3, "month").utc().toISOString(),
          },
        });
      });
      const respPromise = this.page.waitForResponse(
        "https://api.maloum.com/posts"
      );
      // click publish button
      await this.page
        .locator("button[data-testid='create-post-button']")
        .first()
        .click();
      const resp = await respPromise;
      if (!resp.ok()) {
        throw new BotError("publish post failed", {
          where: "MaloumBrowser::publishPost",
          method: "POST",
          endpoint: "https://api.maloum.com/users/balance",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("publish post failed", {
        where: "MaloumBrowser::publishPost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async uploadMediaInFolderV2(
    folder: string,
    image: string
  ): Promise<string> {
    try {
      // go to vault page
      await this.page.goto("https://app.maloum.com/vault", {
        waitUntil: "load",
        timeout: 120000,
      });
      // search folder
      await this.page
        .locator("div#leftColumn input[placeholder='Search for folder']")
        .first()
        .fill(folder.toLocaleLowerCase());
      await this.wait(3000);
      const count = await this.page
        .locator("div#leftColumn div.truncate")
        .count();
      // if not find folder, create folder
      if (count == 0) {
        await this.page
          .locator("div#leftColumn button", {
            hasText: "New folder",
          })
          .first()
          .click();
        await this.page
          .locator("div[role='dialog'] form input[name='folderName']")
          .first()
          .fill(folder);
        await this.page
          .locator("div[role='dialog'] form button", {
            hasText: "Create folder",
          })
          .first()
          .click();
        await this.wait(500);
      } else {
        // if not match, create folder, or if match select folder
        const searchedFolder: string =
          (await this.page
            .locator("div#leftColumn div.truncate")
            .first()
            .textContent()) || "";
        if (searchedFolder.toLocaleLowerCase() != folder.toLocaleLowerCase()) {
          await this.page
            .locator("div#leftColumn button", {
              hasText: "New folder",
            })
            .first()
            .click();
          await this.page
            .locator("div[role='dialog'] form input[name='folderName']")
            .first()
            .fill(folder);
          await this.page
            .locator("div[role='dialog'] form button", {
              hasText: "Create folder",
            })
            .first()
            .click();
          await this.wait(500);
        } else {
          await this.page
            .locator("div#leftColumn div.truncate")
            .first()
            .click();
        }
      }
      // create api response listener
      const uploadPromise = this.page.waitForResponse(
        (response) => {
          return (
            response
              .url()
              .includes("https://api.maloum.com/uploads/generate-upload-url") &&
            response.request().method() === "POST"
          );
        },
        { timeout: 600000 }
      );
      // upload image
      await this.page
        .locator("div#rightColumn input[type='file']")
        .first()
        .setInputFiles(image);
      // wait uploading api respone
      const uploadResp = await uploadPromise;
      if (!uploadResp.ok()) {
        throw new BotError("upload media failed", {
          where: "MaloumBrowser::uploadMediaInFolder",
          method: "POST",
          endpoint: `https://api.maloum.com/uploads/generate-upload-url`,
          status: uploadResp.statusText(),
          response: await uploadResp.text(),
        });
      }
      const uploadData = await uploadResp.json();
      return uploadData.id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("upload media failed", {
        where: "MaloumBrowser::uploadMediaInFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }
}
