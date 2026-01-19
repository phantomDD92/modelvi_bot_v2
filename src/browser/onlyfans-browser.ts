import { AuthError, BotError, ProxyError } from "../utils/error";
import { IAccountID, IAccountSettings, IBotConfig } from "../types/interface";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";
import fs from "fs";
import {
  IOnlyFansCategory,
  IOnlyFansPost,
  IOnlyFansProfile,
} from "../types/onlyfans";
import moment from "moment";
import { PostType } from "../types/constant";

declare global {
  interface Window {
    cfCallback?: (token: any) => void; // or appropriate function signature
  }
}

export class OnlyFansBrowser extends BaseBrowser {
  protected profile!: IOnlyFansProfile;
  protected captchaSolved: boolean;
  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger);
    this.captchaSolved = false;
  }

  protected async setFilter() {
    // filter images
    // await this.context.route(/(\.png(\?.*)?$)|(\.jpg(\?.*)?$)|(\.webp(\?.*)?$)|(\.jpeg(\?.*)?$)|(blob(.*)?$)/, route => route.abort())
    // filter google analytics
    await this.context.route(
      /https:\/\/www\.google-analytics\.com\/.*/,
      (route) => route.abort()
    );
  }

  public async home(): Promise<void> {
    try {
      await this.page.route(
        /https:\/\/challenges\.cloudflare\.com\/turnstile\/.+\/api.js/,
        async (route) => {
          this.logger.info("install captcha solver");
          const response = await route.fetch();
          const body = fs.readFileSync("./data/onlyfans.dat");
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
      await this.page.goto("https://onlyfans.com", {
        waitUntil: "domcontentloaded",
      });
      const errorCount = await this.page
        .locator("div#cf-error-details")
        .count();
      if (errorCount > 0)
        throw new ProxyError("proxy blocked", {
          where: "OnlyFansBrowser::home",
        });
      this.logger.info("open home page");
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "OnlyFansBrowser::home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  private async tryLogin(): Promise<boolean> {
    // click login button
    const loginPromise = this.page.waitForResponse(
      "https://onlyfans.com/api2/v2/users/login",
      { timeout: 120000 }
    );
    await this.page.waitForTimeout(1000);
    await this.page.locator('div.login_content button[type="submit"]').click();
    const loginResp = await loginPromise;
    // await this.page.waitForTimeout(600000);
    const loginData = await loginResp.json();
    if (loginResp.ok()) return true;
    if (loginData.error?.code == 102) return false;
    if (loginData.error?.message?.includes("Wrong email or password")) {
      throw new AuthError("wrong credentials", {
        where: "OnlyFansBrowser::login",
        method: "GET",
        endpoint: "https://onlyfans.com/api2/v2/users/login",
        status: loginResp.statusText(),
        response: await loginResp.text(),
      });
    } else {
      throw new BotError("login failed", {
        where: "OnlyFansBrowser::login",
        method: "GET",
        endpoint: "https://onlyfans.com/api2/v2/users/login",
        status: loginResp.statusText(),
        response: await loginResp.text(),
      });
    }
  }

  public async login(
    setting: IAccountSettings
  ): Promise<IAccountID | undefined> {
    try {
      this.logger.info("start login");
      await this.page.goto("https://onlyfans.com", {
        waitUntil: "domcontentloaded",
      });
      await this.page
        .locator('div.login_content input[name="email"]')
        .waitFor();

      // input login credentials
      await this.page
        .locator('div.login_content input[name="email"]')
        .fill(`${setting.email}`);
      await this.page
        .locator('div.login_content input[name="password"]')
        .fill(`${setting.password}`);
      const result = await this.tryLogin();
      if (!result) {
        for (var i = 0; i < 10; i++) {
          if (this.captchaSolved) {
            await this.tryLogin();
            break;
          }
          console.log("waiting : ", i * 2000);
          await this.page.waitForTimeout(2000);
        }
      }
      const mePromise = this.page.waitForResponse(
        "https://onlyfans.com/api2/v2/users/me"
      );
      const meResponse = await mePromise;
      if (!meResponse.ok())
        throw new BotError("get profile failed", {
          where: "OnlyFansBrowser::login",
          method: "GET",
          endpoint: "https://onlyfans.com/api2/v2/users/me",
          status: meResponse.statusText(),
          response: await meResponse.text(),
        });
      const meData = await meResponse.json();
      this.profile = meData;
      this.headers = await meResponse.request().allHeaders();
      return { id: `${this.profile.id}`, alias: this.profile.username };
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("login failed", {
        where: "OnlyFansBrowser::login",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const endDate = moment().endOf("day");
      const startDate = moment().subtract(30, "day").startOf("date");
      const resp = await this.page.request.get(
        "https://onlyfans.com/api2/v2/users/me/stats/overview",
        {
          headers: this.headers,
          params: {
            startDate: startDate.format("YYYY-MM-DD HH:mm:ss"),
            endDate: endDate.format("YYYY-MM-DD HH:mm:ss"),
          },
        }
      );
      if (!resp.ok())
        throw new BotError("get earnings failed", {
          where: "OnlyFansBrowser::getMonthlyEarnings",
          method: "GET",
          endpoint: "https://onlyfans.com/api2/v2/users/me/stats/overview",
          params: {
            startDate: startDate.format("YYYY-MM-DD HH:mm:ss"),
            endDate: endDate.format("YYYY-MM-DD HH:mm:ss"),
          },
          status: resp.statusText(),
          response: await resp.text(),
        });
      const respData = await resp.json();
      return respData.earning?.total || 0;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get earnings failed", {
        where: "OnlyFansBrowser::getMonthlyEarnings",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async findFolder(folderName: string): Promise<number | undefined> {
    try {
      const resp = await this.page.request.get(
        "https://onlyfans.com/api2/v2/vault/lists",
        {
          headers: this.headers,
          params: { view: "main", offset: 0, limit: 10 },
        }
      );
      if (!resp.ok())
        throw new BotError("find folder failed", {
          where: "OnlyFansBrowser::findFolder",
          method: "GET",
          endpoint: "https://onlyfans.com/api2/v2/vault/lists",
          status: resp.statusText(),
          response: await resp.text(),
        });
      const respData = await resp.json();
      const folders: IOnlyFansCategory[] = respData.list || [];
      const target = folders.find(
        (folder) => folder.name.toLowerCase() == folderName.toLowerCase()
      );
      return target?.id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("find folder failed", {
        where: "OnlyFansBrowser::findFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async createFolder(folderName: string): Promise<number> {
    try {
      const resp = await this.page.request.post(
        "https://onlyfans.com/api2/v2/vault/lists",
        {
          headers: this.headers,
          params: { name: folderName },
        }
      );
      if (!resp.ok())
        throw new BotError("create folder failed", {
          where: "OnlyFansBrowser::createFolder",
          method: "POST",
          endpoint: "https://onlyfans.com/api2/v2/vault/lists",
          status: resp.statusText(),
          response: await resp.text(),
        });
      const respData = await resp.json();
      if (!respData?.id)
        throw new BotError("create folder failed", {
          where: "OnlyFansBrowser::createFolder",
          method: "POST",
          endpoint: "https://onlyfans.com/api2/v2/vault/lists",
          status: resp.statusText(),
          response: await resp.text(),
        });
      return respData.id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("create folder failed", {
        where: "OnlyFansBrowser::createFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async uploadMedia(image: string): Promise<number> {
    try {
      await this.page.goto("https://onlyfans.com/posts/create", {
        timeout: 120000,
      });
      console.log("go to create page");
      await this.page
        .locator("div.stories-list button.m-create")
        .waitFor({ timeout: 120000 }); // your upload button's selector
      console.log("find upload button");
      // await this.page.waitForTimeout(10000);
      // upload media
      const [fileChooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        this.page.click("button#attach_file_photo"),
      ]);
      const uploadPromise = this.page.waitForResponse((response) => {
        console.log(response.url());
        return response
          .url()
          .includes("https://onlyfans.com/api2/v2/vault/media/hash");
      });
      await fileChooser.setFiles(image);
      const uploadResp = await uploadPromise;
      if (!uploadResp.ok()) {
        throw new BotError("upload media failed", {
          where: "OnlyFansBrowser::uploadMedia",
          status: uploadResp.statusText(),
          response: await uploadResp.text(),
        });
      }
      const uploadData = await uploadResp.json();
      if (!uploadData.id)
        throw new BotError("upload media failed", {
          where: "OnlyFansBrowser::uploadMedia",
          status: uploadResp.statusText(),
          response: await uploadResp.text(),
        });
      return uploadData.id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("upload media failed", {
        where: "OnlyFansBrowser::uploadMedia",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async schedulePost(
    images: string[],
    scheduledAt: Date,
    title: string,
    postType?: number,
    postPrice?: number
  ): Promise<string> {
    try {
      await this.page.goto(
        `https://onlyfans.com/posts/create?scheduleDate=${moment(scheduledAt)
          .utc()
          .toDate()
          .toISOString()}`,
        { timeout: 120000 }
      );
      console.log("go to create page");
      await this.page
        .locator("div.stories-list button.m-create")
        .first()
        .waitFor(); // your upload button's selector
      console.log("find upload button");
      await this.page.waitForTimeout(3000);
      // upload media
      const [fileChooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        this.page.click("button#attach_file_photo"),
      ]);
      let seen = 0;
      const uploadPromise = this.page.waitForResponse(
        (response) => {
          if (
            response
              .url()
              .includes("https://onlyfans.com/api2/v2/vault/media/hash")
          )
            seen += 1;
          if (seen == images.length) return true;
          return false;
        },
        { timeout: 120000 * images.length }
      );
      await fileChooser.setFiles(images);
      try {
        await uploadPromise;
      } catch (error: any) {
        if (seen == 0)
          throw new BotError("schedule post failed", {
            where: "OnlyFansBrowser::schedulePost",
            error: "upload media failed",
          });
      }
      await this.page
        .locator("div.input-text-editor div.tiptap")
        .pressSequentially(title);
      if (postType == PostType.PAID) {
        await this.page.locator("button[at-attr='price_btn']").click();
        await this.page
          .locator("div#ModalPostPrice input[at-attr='input']")
          .pressSequentially("" + postPrice);
        await this.page
          .locator("div#ModalPostPrice footer > button")
          .last()
          .click();
      }
      const createPromise = this.page.waitForResponse(
        "https://onlyfans.com/api2/v2/posts"
      );
      await this.page
        .locator("div.g-page__header button.g-btn", { hasText: "Save" })
        .click();
      const createResp = await createPromise;
      const createData = await createResp.json();
      return "" + createData.id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("schedule post failed", {
        where: "OnlyFansBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async deletePost(postId: string) {
    try {
      const resp = await this.page.request.delete(
        `https://onlyfans.com/api2/v2/posts/${postId}`,
        {
          headers: this.headers,
        }
      );
      if (!resp.ok())
        throw new BotError("delete post failed", {
          where: "OnlyFansBrowser::deletePost",
          method: "DELETE",
          endpoint: `https://onlyfans.com/api2/v2/posts/${postId}`,
          status: resp.statusText(),
          response: await resp.text(),
        });
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete post failed", {
        where: "OnlyFansBrowser::deletePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    try {
      const postsPromise = this.page.waitForResponse((response) =>
        response
          .url()
          .includes(
            `https://onlyfans.com/api2/v2/users/${this.profile.id}/posts?`
          )
      );
      await this.page.goto(`https://onlyfans.com/${this.profile.username}`);
      const postsResp = await postsPromise;
      const postsData = await postsResp.json();
      const posts: IOnlyFansPost[] = postsData.list || [];
      return posts.map((post) => "" + post.id);
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get posts failed", {
        where: "OnlyFansBrowser::getSelfPosts",
        error: error.message,
        stack: error.stack,
      });
    }
  }
}
