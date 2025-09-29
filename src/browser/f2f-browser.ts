import moment from "moment";
import { EUROTOUSD as EURO_TO_USD, F2F_PRICE_MIN, F2FStoryType, PostType } from "../types/constant";
import { IF2fChat, IF2fExplore, IF2fFolder, IF2fMedia, IF2fMessage, IF2fPost, IF2fProfile, IF2FRevenue, IF2fStory } from "../types/f2f";
import { IAccountID, IAccountSettings, IBotConfig, } from "../types/interface";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";
import { AuthError, BotError, ProxyError } from "../utils/error";
import { HttpStatusCode } from "axios";

interface IF2FPricingMedia {
  pk: number,
  premium: boolean
};

interface IF2FPricingPayload {
  media: IF2FPricingMedia[],
  round_prices: boolean,
  ppp_price?: number,
  ppp_fan_price?: number,
}
export class F2fBrowser extends BaseBrowser {

  protected profile!: IF2fProfile;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // browser action for home page
  public async home(): Promise<void> {
    try {
      await this.page.goto("https://f2f.com", { waitUntil: "domcontentloaded", timeout: 120000 });
      this.logger.info("open home page");
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "F2fBrowser::home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  // browser action for login
  public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
    try {
      await this.page.goto("https://f2f.com/login/", { timeout: 120000 });

      // input login credentials
      await this.page.locator('input[name="username"]').fill(setting.email);
      await this.page.locator('input[name="password"]').fill(setting.password);
      await this.page.waitForTimeout(1000);

      // prepare wait response
      const loginPromise = this.page.waitForResponse(response => {
        return response.url() === "https://f2f.com/api/auth/login/" && response.request().method() === "POST"
      }, { timeout: 120000 });
      const mePromise = this.page.waitForResponse(response =>
        response.url() === "https://f2f.com/api/users/me/" && response.status() == 200, { timeout: 120000 });
      // click login button
      await this.page.getByRole('button', { name: 'Login', exact: true }).click();

      // check login api response
      const loginResp = await loginPromise;
      if (loginResp.status() != 200) {
        throw new AuthError("wrong credentials", {
          where: "F2fBrowser::login",
          error: "login request failed",
          response: await loginResp.json(),
        });
      }
      const meResp = await mePromise;
      if (meResp.status() != 200) {
        throw new BotError("login failed", {
          where: "F2fBrowser::login",
          error: "profile request failed",
          response: await meResp.text(),
        });
      }
      this.headers = await meResp.request().allHeaders();
      const meData = await meResp.json();
      this.profile = meData;
      if (!meData.creator)
        throw new AuthError("not creator account", {
          where: "F2fBrowser::login",
          error: "not creator account",
          response: await meResp.text(),
        })
      return { alias: meData.username, id: meData.username };
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("login failed", {
        where: "F2fBrowser::login",
        error: error.message,
        stack: error.stack,
      });
    }
  }


  // get folders media
  public async findMediaInFolder(folderId: string, mediaId: string): Promise<string | undefined> {
    try {
      let endpoint = `https://f2f.com/api/media/folders/${folderId}/media/?q=`;
      while (endpoint) {
        let resp = await this.page.request.get(endpoint, { headers: this.headers });
        if (!resp.ok())
          throw new BotError("find media failed", {
            where: "F2fBrowser::findMediaInFolder",
            method: "GET",
            endpoint,
            status: resp.statusText(),
            response: await resp.text(),
          })
        let respData = await resp.json();
        let results: IF2fMedia[] = respData.results || [];
        let media = results.find(item => item.uuid = mediaId);
        if (media)
          return media.uuid;
        endpoint = respData.next;
      }
      return undefined;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("find media failed", {
        where: "F2fBrowser::findMediaInFolder",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  // browser action for creating folder
  public async createFolder(folderName: string): Promise<string> {
    try {
      const resp = await this.page.request.post(
        "https://f2f.com/api/media/folders/", {
        headers: this.headers, data: { name: folderName, parent: null }
      });
      if (!resp.ok()) {
        throw new BotError("create folder failed", {
          where: "F2fBrowser::createFolder",
          method: "POST",
          endpoint: "https://f2f.com/api/media/folders/",
          params: { name: folderName, parent: null },
          status: resp.statusText(),
          response: await resp.text(),
        })
      }
      const folder: IF2fFolder = await resp.json();
      if (!folder.uuid)
        throw new BotError("create folder failed", {
          where: "F2fBrowser::createFolder",
          method: "POST",
          endpoint: "https://f2f.com/api/media/folders/",
          params: { name: folder, parent: null },
          status: resp.statusText(),
          response: await resp.text(),
        });
      return folder.uuid;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create folder failed", {
        where: "F2fBrowser::createFolder",
        error: error.message,
        stack: error.stack
      })
    }
  }

  // browser action for deleting folder
  public async deleteFolder(folderId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(
        `https://f2f.com/api/media/folders/${folderId}/`,
        { headers: this.headers });
      if (!resp.ok()) {
        throw new BotError("delete folder failed", {
          where: "F2fBrowser::deleteFolder",
          method: "DELETE",
          endpoint: `https://f2f.com/api/media/folders/${folderId}/`,
          status: resp.statusText(),
          response: await resp.text(),
        })
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete folder failed", {
        where: "F2fBrowser::deleteFolder",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  // get folders
  public async findFolder(folderName: string): Promise<string | undefined> {
    try {
      let endpoint = "https://f2f.com/api/media/folders/subfolders/?q="
      while (endpoint) {
        let resp = await this.page.request.get(endpoint, { headers: this.headers });
        if (!resp.ok())
          throw new BotError("find folder failed", {
            where: "F2fBrowser::findFolder",
            method: "GET",
            endpoint,
            status: resp.statusText(),
            response: await resp.text(),
          });
        let respData = await resp.json();
        let folders: IF2fFolder[] = respData.results || [];
        let folder = folders.find(item => item.name.toLowerCase() == folderName.toLowerCase());
        if (folder)
          return folder.uuid;
        endpoint = respData.next;
      }
      return undefined;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("find folder failed", {
        where: "F2FBrowser::findFolder",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    let postIds: string[] = [];
    try {
      let page = 0;
      let endpoint = `https://f2f.com/api/creators/${this.profile.username}/posts/?`
      // let posts: IF2fPost[] = [];
      while (endpoint) {
        let resp = await this.page.request.get(endpoint, {
          headers: this.headers
        });
        if (!resp.ok())
          throw new BotError("get posts failed", {
            where: "F2fBrowser::getSelfPosts",
            method: "GET",
            endpoint,
            status: resp.statusText(),
            response: await resp.text(),
          });
        let respData = await resp.json();
        let results: IF2fPost[] = respData.results || [];
        postIds.push(...results.map(item => item.uuid));
        page += 1;
        if (page >= 5)
          break;
        endpoint = respData.next;
      }
      return postIds;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "F2fBrowser::getSelfPosts",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  // public async getSelfFreePosts(): Promise<IF2fPost[]> {
  //   const posts = await this.getSelfPosts();
  //   return posts.filter(post => post.access.label === "free");
  // }

  // browser action for get explores
  public async getExplores(): Promise<IF2fExplore[]> {
    try {
      const resp = await this.page.request.get(`https://f2f.com/api/explore/?`, {
        headers: this.headers
      });
      if (!resp.ok())
        throw new BotError("get explores failed", {
          where: "F2fBrowser::getExplores",
          method: "GET",
          endpoint: `https://f2f.com/api/explore/?`,
          status: resp.statusText(),
          response: await resp.text(),
        })
      const respData = await resp.json();
      return respData.results || [];
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get explores failed", {
        where: "F2fBrowser::getExplores",
        error: error.message,
        stack: error.stack,
      })
    }
  }


  public async commentPost(explore: IF2fExplore, comment: string): Promise<void> {
    try {
      const resp = await this.page.request.post(
        `https://f2f.com/api/creators/${explore.creator}/posts/${explore.uuid}/comments/`,
        { headers: this.headers, data: { content: comment } }
      );
      if (!resp.ok()) {
        throw new BotError("comment post failed", {
          where: "F2FBrowser::commentPost",
          method: "POST",
          endpoint: `https://f2f.com/api/creators/${explore.creator}/posts/${explore.uuid}/comments/`,
          params: { content: comment },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("comment post failed", {
        where: "F2fBrowser::commentPost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  // browser action for follow post
  public async followPost(explore: IF2fExplore): Promise<boolean> {
    try {
      // like
      const resp = await this.page.request.post(
        `https://f2f.com/api/creators/${explore.creator}/posts/${explore.uuid}/like/`,
        { headers: this.headers });
      if (!resp.ok()) {
        throw new BotError("follow post failed", {
          where: "F2FBrowser::followPost",
          method: "POST",
          endpoint: `https://f2f.com/api/creators/${explore.creator}/posts/${explore.uuid}/like/`,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const { liked } = await resp.json();
      // if like is false, retry like
      if (!liked) {
        const resp = await this.page.request.post(`https://f2f.com/api/creators/${explore.creator}/posts/${explore.uuid}/like/`);
        if (!resp.ok()) {
          throw new BotError("follow post failed", {
            where: "F2FBrowser::followPost",
            endpoint: "POST",
            path: `https://f2f.com/api/creators/${explore.creator}/posts/${explore.uuid}/like/`,
            status: resp.statusText(),
            response: await resp.text(),
          });
        }
        return false
      }
      return true;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("follow post failed", {
        where: "F2fBrowser::followPost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  // browser action for deleting post
  public async deletePost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(`https://f2f.com/api/posts/${postId}/`,
        { headers: this.headers });
      if (!resp.ok)
        throw new BotError(`delete post failed`, {
          where: "F2fBrowser::deletePost",
          method: "DELETE",
          endpoint: `https://f2f.com/api/posts/${postId}/`,
          status: resp.statusText(),
          reponse: await resp.text(),
        })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete post failed", {
        where: "F2fBrowser::deletePost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async createEmptyPost(mediaIds: string[]): Promise<string> {
    try {
      // create post
      let resp = await this.page.request.post("https://f2f.com/api/posts/",
        { headers: this.headers, data: { media: mediaIds } });
      if (!resp.ok()) {
        throw new BotError("create post failed", {
          where: "F2fBrowser::createEmptyPost",
          method: "POST",
          endpoint: "https://f2f.com/api/posts/",
          params: { media: mediaIds },
          status: resp.statusText(),
          response: await resp.json()
        });
      }
      const respData = await resp.json();
      return respData.uuid;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create post failed", {
        where: "F2fBrowser::createEmptyPost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async setPostTitle(postId: string, title: string, tags: string[]): Promise<boolean> {
    try {
      let tagStr = tags.map(tag => `#[${tag}]`).join(" ");
      tagStr = tagStr.toLowerCase();
      const text = `${title}\n\n${tagStr}`;
      const resp = await this.page.request.patch(`https://f2f.com/api/posts/${postId}/`,
        { headers: this.headers, data: { content: text } });
      if (!resp.ok()) {
        const { prohibited } = await resp.json();
        if (prohibited)
          return false;
        throw new BotError("set post title failed", {
          where: "F2fBrowser::setPostTitle",
          method: "PATCH",
          endpoint: `https://f2f.com/api/posts/${postId}/`,
          status: resp.statusText(),
          response: await resp.text()
        });
      }
      return true;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("set post title failed", {
        where: "F2fBrowser::setPostTitle",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async setPostPrice(postId: string, type: number, price?: number) {
    try {
      // get price info
      let resp = await this.page.request.get(
        `https://f2f.com/api/posts/${postId}/pricing/`,
        { headers: this.headers });
      if (!resp.ok())
        throw new BotError("set post price failed", {
          where: "F2fBrowser::setPostPrice",
          method: "GET",
          endpoint: `https://f2f.com/api/posts/${postId}/pricing/`,
          status: resp.statusText(),
          response: await resp.text()
        })
      const respData = await resp.json();
      const media: IF2FPricingMedia[] = respData.media;
      // prepare price info from content
      const payload: IF2FPricingPayload = {
        media: media.map(element => ({ pk: element.pk, premium: true })),
        round_prices: false,
      };
      switch (type) {
        case PostType.FANS:
          break;
        case PostType.PAID:
          if ((price || 0) < F2F_PRICE_MIN)
            throw new BotError("set post price failed", {
              where: "F2fBrowser::setPostPrice",
              error: "fan price or follower price is not set or less than minimum",
              postType: "paid for everyone"
            });
          payload["ppp_price"] = price;
          payload["ppp_fan_price"] = price;
          break;
        default:
          return;
      }
      // set price
      resp = await this.page.request.patch(
        `https://f2f.com/api/posts/${postId}/pricing/`,
        { headers: this.headers, data: payload });
      if (!resp.ok())
        throw new BotError("set post price failed", {
          where: "F2fBrowser::setPostPrice",
          method: "PATCH",
          endpoint: `https://f2f.com/api/posts/${postId}/pricing/`,
          params: payload,
          status: resp.statusText(),
          response: await resp.text()
        });
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("set post price failed", {
        where: "F2fBrowser::setPostPrice",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async schedulePost(postId: string, date: Date): Promise<boolean> {
    try {
      const resp = await this.page.request.patch(
        `https://f2f.com/api/posts/${postId}/publish`,
        {
          headers: this.headers,
          data: { available_from: moment().isAfter(date, "hour") ? moment().add(1, "hour").toDate().toISOString() : date.toISOString() }
        });
      if (!resp.ok()) {
        const data2 = await resp.json();
        if (data2.error && data2.error[0] === "reached-post-limit")
          return false;
        throw new BotError("schedule post failed", {
          where: "F2fBrowser::schedulePost",
          method: "PATCH",
          endpoint: `https://f2f.com/api/posts/${postId}/publish`,
          params: { available_from: moment().isAfter(date, "hour") ? moment().add(1, "hour").toDate().toISOString() : date.toISOString() },
          status: resp.statusText(),
          response: await resp.text()
        });
      }
      return true;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("schedule post failed", {
        where: "F2fBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async publishPost(postId: string): Promise<boolean> {
    try {
      const resp = await this.page.request.patch(`https://f2f.com/api/posts/${postId}/publish`,
        { headers: this.headers, data: { now: true } });
      if (!resp.ok()) {
        const respData = await resp.json();
        if (respData.error && respData.error[0] === "reached-post-limit")
          return false;
        throw new BotError("publish post failed", {
          where: "F2fBrowser::publishPost",
          method: "PATCH",
          endpoint: `https://f2f.com/api/posts/${postId}/publish`,
          status: resp.statusText(),
          response: await resp.json()
        });
      }
      return true;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("publish post failed", {
        where: "F2fBrowser::publishPost",
        error: error.message,
        stack: error.stack,
      })
    }
  }


  public async gotoHome(): Promise<void> {
    try {
      await this.page.goto("https://fansly.com/home");
      this.logger.info("go to home page");
    } catch (error: any) {
      throw new BotError("go to home failed", {
        function: "F2fBrowser::createPost",
        error: error.message,
        stack: error.stack
      })
    }
  }

  public async uploadMedia(folderId: string, path: string): Promise<string> {
    try {
      await this.page.goto(`https://f2f.com/library/${folderId}/`, { waitUntil: 'domcontentloaded' });
      await this.page.locator("div#content-container g#Add").first().click({ timeout: 60000 });
      await this.page.waitForTimeout(1000);
      await this.page.locator("div.aOJr-W_menu > div.aOJr-W_item").last().click();
      const uploadPromise = this.page.waitForResponse(response => response.request().url().indexOf("complete?key=") >= 0 && response.ok(), { timeout: 300000 })
      await this.page.locator("input.uppy-Dashboard-input").first().setInputFiles(path);
      await this.page.waitForTimeout(3000);
      await this.page.locator("//button[contains(@class , 'uppy-StatusBar-actionBtn--upload')]").scrollIntoViewIfNeeded();
      await this.page.locator("//button[contains(@class , 'uppy-StatusBar-actionBtn--upload')]").click();
      const uploadResp = await uploadPromise;
      const reqUrl = uploadResp.request().url();
      const mediaUuid = reqUrl.substring(reqUrl.length - 36, reqUrl.length);
      if (!mediaUuid)
        throw new BotError("upload media failed", {
          where: "F2fBrowser::uploadMedia",
          error: "empty media uuid",
          response: reqUrl,
        });
      return mediaUuid
    } catch (error: any) {
      if (error instanceof BotError)
        throw error
      throw new BotError("upload media failed", {
        where: "F2fBrowser::uploadMedia",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const resp = await this.page.request.get(
        "https://f2f.com/api/statistics/performance/detailedrevenue/",
        { headers: this.headers }
      );
      const respData = await resp.json();
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.NotFound)
          return 0;
        throw new BotError("get detailed revenue failed", {
          where: "F2fBrowser::getMonthlyEarnings",
          method: "GET",
          endpoint: "https://f2f.com/api/statistics/performance/detailedrevenue/",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const transactions: IF2FRevenue[] = respData;
      const items = transactions.filter(item => moment().diff(moment(item.date), "days") <= 30)
      let revenue = 0
      for (let item of items) {
        revenue += (item.message_revenue + item.post_revenue + item.referral_revenue + item.subscription_revenue + item.tip_revenue)
      }
      return revenue * EURO_TO_USD;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get earnings failed", {
        where: "F2fBrowser::getMonthlyEarnings",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getChats(): Promise<IF2fChat[]> {
    try {
      const resp = await this.page.request.get(
        "https://f2f.com/api/chats/?ordering=newest-first",
        { headers: this.headers }
      );
      if (!resp.ok())
        throw new BotError("get chats failed", {
          where: "F2fBrowser::getChats",
          method: "GET",
          endpoint: "https://f2f.com/api/chats/?ordering=newest-first",
          status: resp.statusText(),
          response: await resp.text(),
        })
      const respData = await resp.json();
      return respData.results || [];
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get chats failed", {
        where: "F2fBrowser::getChats",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getChatMessages(chatId: string): Promise<IF2fMessage[]> {
    try {
      const resp = await this.page.request.get(
        `https://f2f.com/api/chats/${chatId}/messages/`,
        { headers: this.headers }
      );

      if (!resp.ok())
        throw new BotError("get chat messages failed", {
          where: "F2fBrowser::getChatMessages",
          method: "GET",
          endpoint: `https://f2f.com/api/chats/${chatId}/messages/`,
          status: resp.statusText(),
          response: await resp.text(),
        })
      const respData = await resp.json();
      return respData.results;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get chat messages failed", {
        where: "F2fBrowser::getChatMessages",
        error: error.message,
        stack: error.stack,
      })
    }
  }


  public async getSelfStories(): Promise<string[]> {
    try {
      const resp = await this.page.request.get(
        `https://f2f.com/api/creators/${this.profile.username}/stories/`,
        { headers: this.headers }
      );
      if (!resp.ok())
        throw new BotError("get stories failed", {
          where: "F2fBrowser::getStories",
          method: "GET",
          endpoint: `https://f2f.com/api/creators/${this.profile.username}/stories/`,
          status: resp.statusText(),
          response: await resp.text(),
        })
      const respData = await resp.json();
      const result = respData[0];
      return result?.stories || [];
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get stories failed", {
        where: "F2fBrowser::getSelfStories",
        error: error.messsage,
        stack: error.stack,
      })
    }
  }

  public async createStory(mediaId: string, storyType: number): Promise<string> {
    try {
      let target = "fans-and-followers"
      switch (storyType) {
        case F2FStoryType.FANS:
          target = "fans-only";
          break;
        case F2FStoryType.FOLLOWERS:
          target = "followers-only"
          break;
        default:
          break;
      }
      const resp = await this.page.request.post(
        `https://f2f.com/api/stories/`,
        {
          headers: this.headers,
          data: { media: mediaId, target }
        }
      );
      if (!resp.ok())
        throw new BotError("create story failed", {
          where: "F2fBrowser::createStory",
          method: "POST",
          endpoint: `https://f2f.com/api/stories/`,
          params: { media: mediaId, target },
          status: resp.statusText(),
          response: await resp.text(),
        })
      const respData = await resp.json();
      return respData.uuid;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create story failed", {
        where: "F2fBrowser::createStory",
        error: error.message,
        stack: error.stack
      })
    }

  }

  public async deleteStory(storyId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(
        `https://f2f.com/api/stories/${storyId}`,
        { headers: this.headers }
      );
      if (!resp.ok())
        throw new BotError("delete story failed", {
          where: "F2fBrowser::deleteStory",
          method: "DELETE",
          endpoint: `https://f2f.com/api/stories/${storyId}`,
          status: resp.statusText(),
          response: await resp.text(),
        })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete story failed", {
        where: "F2fBrowser::deleteStory",
        error: error.message,
        stack: error.stack
      })
    }
  }
}