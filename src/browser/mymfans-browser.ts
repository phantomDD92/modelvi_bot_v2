import { AuthError, BotError, ProxyError, SessionTimeoutError } from "../utils/error";
import { POST_PROHIBITED, PostType } from "../types/constant";
import { IAccountID, IAccountSettings } from "../types/interface";
import { IMymFansMedia, IMymFansPost } from "../types/mymfans";
import { BaseBrowser } from "./base-browser";
import moment from "moment";
import { HttpStatusCode } from "axios";

export class MymFansBrowser extends BaseBrowser {

  protected async setFilter() {
    // filter images
    await this.context.route(/(\.png(\?.*)?$)|(\.jpg(\?.*)?$)|(\.webp(\?.*)?$)|(\.jpeg(\?.*)?$)|(blob(.*)?$)/, route => {
      if (route.request().method() == "PUT")
        route.continue();
      else
        route.abort();
    })
    // filter google analytics
    await this.context.route(/https:\/\/www\.google-analytics\.com\/.*/, route => route.abort());
    await this.context.route(/https:\/\/media\.prod-v2\.mym\.fans\/medias\/.*/, route => route.abort());
  }

  public async home(): Promise<void> {
    try {
      await this.page.goto("https://mym.fans/", { waitUntil: "domcontentloaded", timeout: 120000 });
    } catch (error: any) {
      throw new ProxyError("invalid proxy", {
        where: "MymFansBrowser::home",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
    try {
      await this.page.goto("https://creators.mym.fans/app/login", { timeout: 180000 });
      // set email and password
      await this.page.locator("input#username").fill(setting.email);
      await this.page.locator("input#password").fill(setting.password);

      const profilePromise = this.page.waitForResponse(response => {
        return response.url().includes("https://api.mym.fans/creators/me") && response.request().method() === "GET"
      }, { timeout: 180000 });

      await this.page.getByRole('button', { name: 'Login', exact: true }).click();
      const profileResp = await profilePromise;
      if (profileResp.status() != 200) {
        throw new AuthError("wrong credentials", {
          where: "MymFansBrowser::login",
          method: "GET",
          endpoint: "https://api.mym.fans/creators/me",
          status: profileResp.statusText(),
          response: await profileResp.text(),
        });
      }
      this.headers = await profileResp.request().allHeaders();
      await this.page.waitForURL("https://creators.mym.fans/app/profile", { timeout: 300000 })
      const username = await this.page.locator("div#panel--profil--share").first().getAttribute("username");
      if (username)
        return { alias: username, id: username }
      return undefined;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("login failed", {
        where: "MymFansBrowser::login",
        error: error.message,
        stack: error.stack
      })
    }
  }

  private async closeAdvertisementDialog() {
    try {
      await this.page.locator("dialog.modal_advertisement div.cta_modal_advertisement_close").first().click({ timeout: 3000 });
      this.logger.info("close advertisement dialog");
    } catch (error) {
      this.logger.info("skip advertisement dialog");
    }
  }

  public async afterLogin(): Promise<void> {
    await this.closeAdvertisementDialog();
    // await this.page.waitForTimeout(1200000);
  }

  public async createPublicPost(title: string, mediaPath: string) {
    try {
      await this.page.goto("https://creators.mym.fans/app/post/configuration", { waitUntil: "domcontentloaded", timeout: 180000 });
      // set title
      await this.page.locator("textarea[data-testid='post-creation-form-setup-caption']").first().fill(title);
      await this.page.locator("input[data-testid='post-creation-form-visibility-public-radio']").first().setChecked(true);
      await this.page.locator("input[data-testid='upload-input']").first().setInputFiles(mediaPath);

      // wait media upload for 5 minutes
      const mediaPromise = this.page.waitForResponse("https://api.mym.fans/medias/upload", { timeout: 300000 });
      const postsPromise = this.page.waitForResponse("https://api.mym.fans/posts", { timeout: 300000 });

      // click publish
      await this.page.locator("button[data-testid='post-creation-desktop-submit-button']").first().click();
      const [mediaResp, postsResp] = await Promise.all([mediaPromise, postsPromise]);
      if (!mediaResp.ok()) throw new BotError("upload media failed", {
        where: "MymFansBrowser::createPublicPost",
        method: "POST",
        endpoint: "https://api.mym.fans/posts/media",
        params: mediaResp.request().postData(),
        status: mediaResp.statusText(),
        response: await mediaResp.text()
      });
      if (!postsResp.ok()) throw new BotError("create post failed", {
        where: "MymFansBrowser::createPublicPost",
        method: "POST",
        endpoint: "https://api.mym.fans/posts",
        params: postsResp.request().postData(),
        status: postsResp.statusText(),
        response: await postsResp.text()
      });
      const mediaData = await mediaResp.json();
      const postsData = await postsResp.json();
      return {
        media: mediaData.id,
        post: postsData.id,
        scheduledAt: postsData.scheduledAt
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      const isMediaError = await this.page.locator("p[data-testid='field-error-media']").count()
      if (isMediaError)
        return ({
          post: POST_PROHIBITED
        });
      throw new BotError("create post failed", {
        where: "MymFansBrowser::createPublicPost",
        error: error.message,
        stack: error.stack
      })
    }
  }

  public async createPublicPostWithMediaId(title: string, mediaId: string) {
    try {
      const params = {
        "medias": [mediaId],
        "caption": title,
        "private": false,
        "scheduledAt": new Date().toISOString(),
        "playlists": [],
        "thirdPartyConsent": false
      }
      const resp = await this.page.request.post("https://api.mym.fans/posts", {
        headers: this.headers,
        data: params
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MymFansBrowser::createPublicPostWithMediaId",
          });
        throw new BotError("find media failed", {
          where: "MymFansBrowser::createPublicPostWithMediaId",
          method: "POST",
          endpoint: "https://api.mym.fans/posts",
          params,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      return respData.id;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create post failed", {
        where: "MymFansBrowser::createPublicPostWithMediaId",
        error: error.message,
        stack: error.stack
      })
    }
  }


  public async schedulePost(scheduledAt: Date, title: string, imagePath: string, type?: number) {
    try {
      await this.page.goto("https://creators.mym.fans/app/post/configuration", { timeout: 180000 });
      // set title
      await this.page.locator("textarea[data-testid='post-creation-form-setup-caption']").first().fill(title);
      // set public
      if (!type || type == PostType.FREE)
        await this.page.locator("input[data-testid='post-creation-form-visibility-private-radio']").first().setChecked(true);
      else
        await this.page.locator("input[data-testid='post-creation-form-visibility-public-radio']").first().setChecked(true);
      // set image
      await this.page.locator("input[data-testid='upload-input']").first().setInputFiles(imagePath);

      // click publish
      const mediaPromise = this.page.waitForResponse("https://api.mym.fans/posts/media");
      const postsPromise = this.page.waitForResponse("https://api.mym.fans/posts");

      await this.page.locator("button[data-testid='post-creation-desktop-submit-button']").first().click();
      const mediaResp = await mediaPromise;
      if (!mediaResp.ok()) throw new BotError("upload media failed", {
        where: "MymFansBrowser::createPublicPost",
        method: "POST",
        endpoint: "https://api.mym.fans/posts/media",
        params: mediaResp.request().postData(),
        status: mediaResp.statusText(),
        response: await mediaResp.text()
      });
      const postsResp = await postsPromise;
      if (!postsResp.ok()) throw new BotError("create post failed", {
        where: "MymFansBrowser::createPublicPost",
        method: "POST",
        endpoint: "https://api.mym.fans/posts",
        params: postsResp.request().postData(),
        status: postsResp.statusText(),
        response: await postsResp.text()
      });
      const mediaData = await mediaResp.json();
      const postsData = await postsResp.json();
      return {
        media: mediaData.mediaId,
        post: postsData.id
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("schedule post failed", {
        where: "MymFansBrowser::schedulePost",
        error: error.message,
        stack: error.stack
      })
    }
  }

  public async schedulePostWithMediaId(scheduledAt: Date, title: string, mediaId: string, type?: number) {
    try {
      let privateFlag = false;
      if (type && type != PostType.FREE)
        privateFlag = true;
      const params = {
        "medias": [mediaId],
        "caption": title,
        "private": privateFlag,
        "scheduledAt": scheduledAt.toISOString(),
        "playlists": [],
        "thirdPartyConsent": false
      }
      const resp = await this.page.request.post("https://api.mym.fans/posts", {
        headers: this.headers,
        data: params
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MymFansBrowser::schedulePostWithMediaId",
          });
        throw new BotError("find media failed", {
          where: "MymFansBrowser::schedulePostWithMediaId",
          method: "POST",
          endpoint: "https://api.mym.fans/posts",
          params,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      return respData.id;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("schedule post failed", {
        where: "MymFansBrowser::schedulePostWithMediaId",
        error: error.message,
        stack: error.stack
      })
    }
  }

  public async findMedia(mediaId: string): Promise<string | undefined> {
    try {
      const resp = await this.page.request.get("https://api.mym.fans/creators/medias", {
        headers: this.headers,
        params: { perPage: 20 }
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MymFansBrowser::findMedia",
          });
        throw new BotError("find media failed", {
          where: "MymFansBrowser::findMedia",
          method: "GET",
          endpoint: "https://api.mym.fans/creators/medias",
          params: { perPage: 20 },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      const mediaCount = respData.pagination?.itemsTotal || 0;
      if (mediaCount > 20) throw new BotError("need updating");
      const medias: IMymFansMedia[] = respData.medias || [];
      const media = medias.find(item => item.id == mediaId);
      return media?.id;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("find media failed", {
        where: "MymFansBrowser::findMedia",
        error: error.message,
        stack: error.stack
      })
    }
  }

  public async getPosts(): Promise<string[]> {
    try {
      const resp = await this.page.request.get("https://api.mym.fans/posts", {
        headers: this.headers,
        params: { perPage: 20 }
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MymFansBrowser::getPosts",
          });
        throw new BotError("get posts failed", {
          where: "MymFansBrowser::getPosts",
          method: "GET",
          endpoint: "https://api.mym.fans/creators/posts",
          params: { perPage: 20 },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      const posts: IMymFansPost[] = respData.posts || [];
      return posts.map(post => post.id);
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "MymFansBrowser::getPosts",
        error: error.message,
        stack: error.stack
      })
    }

  }

  public async deletePost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(`https://api.mym.fans/posts/${postId}`, {
        headers: this.headers
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MymFansBrowser::deletePost",
          });
        throw new BotError("delete media failed", {
          where: "MymFansBrowser::deletePost",
          method: "GET",
          endpoint: "https://api.mym.fans/creators/posts",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete post failed", {
        where: "MymFansBrowser::deletePost",
        error: error.message,
        stack: error.stack
      })
    }

  }

  public async getMonthlyEarning(): Promise<number> {
    try {
      await this.page.goto("https://creators.mym.fans/app/incomes", { waitUntil: "domcontentloaded", timeout: 120000 });
      const chartCount = await this.page.locator("div#charts-container").count()
      if (chartCount == 0)
        return 0;
      const chartData = await this.page.locator("div#charts-container").getAttribute("data-charts");
      if (!chartData)
        return 0;
      const earnings = JSON.parse(chartData);
      if (!earnings || !Array.isArray(earnings) || earnings.length == 0)
        return 0;
      let sum = 0;
      const oneMonthAgo = moment().subtract(30, "day").startOf("day");
      for (var i = earnings.length - 1; i >= 0; i--) {
        const earning = earnings[i];
        const time = new Date(earning[0]);
        if (moment(time).isAfter(oneMonthAgo))
          sum += earning[1];
      }
      return sum;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get earnings failed", {
        where: "MymFansBrowser::getMonthlyEarning",
        error: error.message,
        stack: error.stack
      })
    }
  }
}