import moment from "moment";
import CryptoJS from "crypto-js";
import {
  AuthError,
  BotError,
  ProxyError,
  SessionTimeoutError,
} from "../utils/error";
import { KnkyStoryType, PostType } from "../types/constant";
import {
  IAccountID,
  IAccountSettings,
  IBotConfig,
  IContent,
  ISchedulePost,
} from "../types/interface";
import {
  IKnkyFolder,
  IKnkyPost,
  IKnkyUser as IKnkyProfile,
  IKnkyRevenue,
  IKnkyStory,
  IKnkyStoryData,
  IKnkyVault,
} from "../types/knky";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";
import { HttpStatusCode } from "axios";

export class KnkyBrowser extends BaseBrowser {
  protected profile!: IKnkyProfile;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger);
  }

  // set content filter
  protected async setFilter() {
    // filter images
    await this.context.route(
      /(\.png(\?.*)?$)|(\.jpg(\?.*)?$)|(\.webp(\?.*)?$)|(\.jpeg(\?.*)?$)|(blob(.*)?$)/,
      (route) =>
        route.request().method() == "GET" ? route.abort() : route.continue(),
    );
    // filter google analytics
    await this.context.route(
      /https:\/\/www\.google-analytics\.com\/.*/,
      (route) => route.abort(),
    );
  }

  public async home(): Promise<void> {
    try {
      await this.page.goto("https://knky.co/", {
        waitUntil: "domcontentloaded",
        timeout: 100000,
      });
      return;
    } catch (error: any) {}
    try {
      await this.page.goto("https://knky.co/", {
        waitUntil: "domcontentloaded",
        timeout: 100000,
      });
      return;
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "KnkyBrowser::home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async afterHome(): Promise<void> {
    try {
      await this.page.locator("div#ageWarningModal").waitFor({ timeout: 3000 });
      await this.page
        .locator("div#ageWarningModal button#age-wraning-close-button")
        .click({ timeout: 1000 });
      this.logger.info("close age warning dialog");
    } catch (error: any) {}
  }

  private parsePayload(payload: string) {
    const decrypted = CryptoJS.AES.decrypt(
      payload,
      "tf-xzqAvxsItJ59feJ2oxlUyOaDnhKPc",
    );
    const plainText = decrypted.toString(CryptoJS.enc.Utf8);
    return JSON.parse(plainText);
  }

  public async login(
    setting: IAccountSettings,
  ): Promise<IAccountID | undefined> {
    try {
      await this.wait(5000);
      await this.page.locator("header button", { hasText: "Sign In" }).click();
      await this.page.locator("div#SignInModal").waitFor();

      await this.page
        .locator("div#SignInModal input[name='username']")
        .fill(setting.email);
      await this.page
        .locator("div#SignInModal input[name='password']")
        .fill(setting.password);
      await this.wait(5000);
      // if (!setting?.device)
      //   throw new BotError("no magic link");
      const authPromise = this.page.waitForResponse((response) => {
        return (
          response.url() === "https://backend.knky.co/v1/users/login" &&
          response.request().method() === "POST"
        );
      });
      await this.page
        .locator("div#SignInModal button", { hasText: "Sign In" })
        .click();
      // await this.page.goto(setting.device);
      const authResp = await authPromise;
      const authData = await authResp.json();
      // const authData = this.parsePayload(authPayload.r)
      if (!authResp.ok()) {
        const message = authData.message;
        if (message.includes("Incorrect"))
          throw new AuthError("wrong credentials", {
            where: "KnkyBrowser::login",
            method: "POST",
            endpoint: "https://backend.knky.co/v1/users/login",
            params: authResp.request().postData(),
            status: authResp.statusText(),
            response: authData,
          });
        else if (message.includes("Wrong password"))
          throw new AuthError("wrong credentials", {
            where: "KnkyBrowser::login",
            method: "POST",
            endpoint: "https://backend.knky.co/v1/users/login",
            params: authResp.request().postData(),
            status: authResp.statusText(),
            response: authData,
          });
        if (message.includes("2FA")) {
          if (!setting.device) throw new AuthError("no security key");
          await this.wait(3000);
          const code = await this.generate2FACode(setting.device);
          await this.page
            .locator("div#otpVerificationModal input")
            .first()
            .fill(code);
          const authPromise1 = this.page.waitForResponse((response) => {
            return (
              response.url() === "https://backend.knky.co/v1/users/login" &&
              response.request().method() === "POST"
            );
          });
          await this.page
            .locator("div#otpVerificationModal button", { hasText: "Verify" })
            .click();
          const authResp1 = await authPromise1;
          const authData1 = await authResp1.json();
          // const authData1 = this.parsePayload(authPayload1.r)
          if (!authResp1.ok()) {
            if (authData1.statusCode == 429) {
              await this.wait(60000);
              throw new BotError("too many request");
            }
            throw new AuthError("invalid security key", {
              where: "KnkyBrowser::login",
              method: "POST",
              endpoint: "https://backend.knky.co/v1/users/login",
              params: authResp1.request().postData(),
              status: authResp1.statusText(),
              response: authData1,
            });
          }
        } else {
          if (authData.statusCode == 429) {
            await this.wait(60000);
            throw new BotError("too many request");
          }
          throw new BotError("login failed", {
            where: "KnkyBrowser::login",
            method: "POST",
            endpoint: "https://backend.knky.co/v1/users/login",
            params: authResp.request().postData(),
            status: authResp.statusText(),
            response: authData,
          });
        }
      } else if (authData.data?.otp_required) {
        if (!setting.device) throw new AuthError("no security key");
        await this.wait(5000);
        const code = await this.generate2FACode(setting.device);
        await this.page
          .locator("div#otpVerificationModal input")
          .first()
          .fill(code);
        const authPromise1 = this.page.waitForResponse((response) => {
          return (
            response.url() ===
              "https://backend.knky.co/v1/users/verify-login-otp" &&
            response.request().method() === "POST"
          );
        });
        await this.page
          .locator("div#otpVerificationModal button", { hasText: "Verify" })
          .click();
        const authResp1 = await authPromise1;
        const authData1 = await authResp1.json();
        // const authData1 = this.parsePayload(authPayload1.r)
        if (!authResp1.ok())
          if (authData1.statusCode == 429) {
            await this.wait(60000);
            throw new BotError("too many request");
          }
        throw new AuthError("invalid security key", {
          where: "KnkyBrowser::login",
          method: "POST",
          endpoint: "https://backend.knky.co/v1/users/verify-login-otp",
          params: authResp1.request().postData(),
          status: authResp1.statusText(),
          response: authData1,
        });
      }
      const profilePromise = this.page.waitForResponse((response) => {
        return (
          response.url() === "https://backend.knky.co/v1/users/profile" &&
          response.request().method() === "GET"
        );
      });
      // get profile
      const profileResp = await profilePromise;
      if (!profileResp.ok()) {
        throw new BotError("login failed", {
          where: "KnkyBrowser::login",
          method: "GET",
          endpoint: "https://backend.knky.co/v1/users/profile",
          status: profileResp.statusText(),
          response: await profileResp.text(),
        });
      }
      const profileData = await profileResp.json();
      // const profileData = this.parsePayload(profilePayload.r);
      this.profile = profileData.data[0];
      this.headers = await profileResp.request().allHeaders();
      return { alias: this.profile.username, id: this.profile._id };
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      else
        throw new BotError("login failed", {
          where: "KnkyBrowser::login",
          error: error.message,
          stack: error.stack,
        });
    }
  }

  public async getFolders(): Promise<IKnkyFolder[]> {
    try {
      const resp = await this.page.request.get(
        "https://backend.knky.co/v1/users/vault/folder",
        { headers: this.headers },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "KnkyBrowser::getFolders",
          });
        else
          throw new BotError("get folders failed", {
            where: "KnkyBrowser::getFolders",
            method: "GET",
            endpoint: "https://backend.knky.co/v1/users/vault/folder",
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
      const respData = await resp.json();
      // const respData = this.parsePayload(respPayload.r);
      if (respData.status != 200) {
        throw new BotError("get folders failed", {
          where: "KnkyBrowser::getFolders",
          error: respData.message,
          response: respData,
        });
      }
      return respData.data || [];
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      else
        throw new BotError("get folders failed", {
          where: "KnkyBrowser::getFolders",
          error: error.message,
          stack: error.stack,
        });
    }
  }

  public async findOrCreateFolder(folder: string): Promise<IKnkyFolder> {
    const folders: IKnkyFolder[] = await this.getFolders();
    const findFolders = folders.filter((item) => item.name == folder);
    if (findFolders.length > 0) return findFolders[0];
    const result = await this.createFolder(folder);
    return result;
  }

  public async createFolder(folder: string): Promise<IKnkyFolder> {
    try {
      const resp = await this.page.request.post(
        "https://backend.knky.co/v1/users/vault/folder",
        { headers: this.headers, data: { name: folder } },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "KnkyBrowser::createFolder",
          });
        else
          throw new BotError("create folder failed", {
            where: "KnkyBrowser::createFolder",
            method: "POST",
            endpoint: "https://backend.knky.co/v1/users/vault/folder",
            params: { name: folder },
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
      const respData = await resp.json();
      // const respData = this.parsePayload(respPayload.r)
      if (respData.status != 201) {
        throw new BotError("create folder failed", {
          where: "KnkyBrowser::createFolder",
          method: "POST",
          endpoint: "https://backend.knky.co/v1/users/vault/folder",
          params: { name: folder },
          error: respData.message,
          response: respData,
        });
      }
      return respData.data;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      else
        throw new BotError("create folder failed", {
          where: "KnkyBrowser::createFolder",
          error: error.message,
          stack: error.stack,
        });
    }
  }

  public async deleteFolder(folder: IKnkyFolder): Promise<void> {
    try {
      const resp = await this.page.request.delete(
        `https://backend.knky.co/v1/users/vault/folder/${folder._id}`,
        { headers: this.headers, data: {} },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "KnkyBrowser::deleteFolder",
          });
        else
          throw new BotError("delete folder failed", {
            where: "KnkyBrowser::deleteFolder",
            method: "DELETE",
            endpoint: `https://backend.knky.co/v1/users/vault/folder/${folder._id}`,
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      else
        throw new BotError("delete folder failed", {
          where: "KnkyBrowser::deleteFolder",
          error: error.message,
          stack: error.stack,
        });
    }
  }

  public async refreshToken(setting: IAccountSettings): Promise<void> {
    try {
      const dataPromise = this.page.waitForResponse(
        (response) => {
          return (
            response.url() ===
              "https://backend.knky.co/v1/users/platform/consumables" &&
            response.request().method() === "GET"
          );
        },
        { timeout: 150000 },
      );
      await this.page.goto("https://knky.co/chat", { timeout: 150000 });
      const dataResp = await dataPromise;
      this.headers = await dataResp.request().allHeaders();
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      else
        throw new BotError("refresh token failed", {
          where: "KnkyBrowser::refreshToken",
          error: error.message,
          stack: error.stack,
        });
    }
  }

  public async getSelfPosts(): Promise<IKnkyPost[]> {
    try {
      const resp = await this.page.request.get(
        "https://backend.knky.co/v1/posts",
        {
          headers: this.headers,
          params: {
            d: "backward",
            limit: 1000,
            user_id: this.profile._id,
            post_type: "published",
          },
          timeout: 60000,
        },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "KnkyBrowser::getSelfPosts",
          });
        throw new BotError("get self posts failed", {
          where: "KnkyBrowser::getSelfPosts",
          method: "GET",
          endpoint: "https://backend.knky.co/v1/posts",
          params: {
            d: "backward",
            limit: 1000,
            user_id: this.profile._id,
            post_type: "published",
          },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      // const respData = this.parsePayload(respPayload.r)
      return respData.data;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      else
        throw new BotError("get vaults failed", {
          where: "KnkyBrowser::getVaults",
          error: error.message,
          stack: error.stack,
        });
    }
  }

  public async getVaults(): Promise<IKnkyVault[]> {
    try {
      const resp = await this.page.request.get(
        "https://backend.knky.co/v1/users/vault/file?",
        { headers: this.headers },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "KnkyBrowser::getVaults",
          });
        throw new BotError("get vaults failed", {
          where: "KnkyBrowser::getVaults",
          method: "GET",
          endpoint: "https://backend.knky.co/v1/users/vault/file?",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      // const respData = this.parsePayload(respPayload.r);
      return respData.data;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      else
        throw new BotError("get vaults failed", {
          where: "KnkyBrowser::getVaults",
          error: error.message,
          stack: error.stack,
        });
    }
  }

  public async findVault(vaultId: string): Promise<IKnkyVault | undefined> {
    const vaults = await this.getVaults();
    return vaults.find((item) => item._id == vaultId);
  }

  public async deletePost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(
        `https://backend.knky.co/v1/posts/${postId}`,
        { headers: this.headers, data: { delete_from_profile: true } },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "KnkyBrowser::deletePost",
          });
        throw new BotError("delete post failed", {
          where: "KnkyBrowser::deletePost",
          method: "DELETE",
          endpoint: `https://backend.knky.co/v1/posts/${postId}`,
          params: { delete_from_profile: true },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete post failed", {
        where: "KnkyBrowser::deletePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  private async checkFirstPost() {
    try {
      const count = await this.page.locator("div.k-modal-content").count();
      console.log("kmodal: ", count);
      await this.page
        .locator("button", {
          hasText: "Start Your First Post",
        })
        .first()
        .click({ timeout: 10000 });
      this.logger.info("accept first post tip");
    } catch (e) {
      this.logger.info("skip first post tip");
    }
  }

  public async schedulePost(
    post: ISchedulePost,
    images: string[],
  ): Promise<string> {
    try {
      const schedule = post.schedule;
      // go to new post page
      switch (schedule.type) {
        case PostType.PAID:
          await this.page.goto("https://knky.co/create/new-post", {
            timeout: 300000,
          });
          await this.checkFirstPost();
          await this.page
            .locator("div.post-type-wrapper div.dropdown > button")
            .first()
            .click();
          // change post audience pay-to-view
          await this.page
            .locator(
              "div.post-type-wrapper div.dropdown > ul > li > label[for='flexCheckDefault-1']",
            )
            .waitFor();
          await this.page
            .locator(
              "div.post-type-wrapper div.dropdown > ul > li > label[for='flexCheckDefault-1']",
            )
            .first()
            .click();
          await this.page
            .locator("input[name='Price to unlock']")
            .first()
            .waitFor();
          await this.page
            .locator("input[name='Price to unlock']")
            .first()
            .fill(`${schedule.price}`);
          break;
        case PostType.FANS:
          if (this.profile.channel_count == 0)
            throw new BotError("skip to scheduled post for fans", {
              where: "KnkyBrowser::schedulePost",
            });
          await this.page.goto(
            "https://knky.co/create/new-post?isChannelPost=true",
            { timeout: 300000 },
          );
          await this.checkFirstPost();
          await this.page
            .locator("div.post-type-wrapper div.dropdown > button")
            .first()
            .click();
          // change post audience prime
          await this.page
            .locator(
              "div.post-type-wrapper div.dropdown > ul > li > label[for='flexCheckDefault-4']",
            )
            .waitFor();
          await this.page
            .locator(
              "div.post-type-wrapper div.dropdown > ul > li > label[for='flexCheckDefault-4']",
            )
            .first()
            .click();
          break;
        default:
          await this.page.goto("https://knky.co/create/new-post", {
            timeout: 300000,
          });
          await this.checkFirstPost();
          await this.page
            .locator("div.post-type-wrapper div.dropdown > button")
            .first()
            .click();
          // change post audience public
          await this.page
            .locator(
              "div.post-type-wrapper div.dropdown > ul > li > label[for='flexCheckDefault-2']",
            )
            .waitFor();
          await this.page
            .locator(
              "div.post-type-wrapper div.dropdown > ul > li > label[for='flexCheckDefault-2']",
            )
            .first()
            .click();
          break;
      }
      // set content
      const tagsStr = schedule.tags.map((tag) => `#${tag}`).join(" ");
      await this.page
        .locator("div.create-post-content div.caption-content textarea")
        .first()
        .fill(`${schedule.title}\n${tagsStr}`);
      // set image
      await this.page
        .locator(
          "div.post-type-wrapper div.post-type-options input.media-input",
        )
        .setInputFiles(images);
      await this.page.waitForTimeout(120000);
      const disabled = await this.page
        .locator("button.createpost-btn")
        .first()
        .isDisabled();
      if (disabled) return "disabled";
      await this.page.locator("button.createpost-btn").first().click();

      // set schedule
      await this.page.locator("input#flexSwitchSchedule").waitFor();
      await this.page
        .locator("input#flexSwitchSchedule")
        .first()
        .setChecked(true);
      await this.page
        .locator("div.schedule-date > input[type='datetime-local']")
        .waitFor();
      if (moment().isAfter(post.scheduledAt, "hour"))
        await this.page
          .locator("div.schedule-date > input[type='datetime-local']")
          .first()
          .fill(moment().add(1, "hour").format("YYYY-MM-DDTHH:MM"));
      else
        await this.page
          .locator("div.schedule-date > input[type='datetime-local']")
          .first()
          .fill(moment(post.scheduledAt).format("YYYY-MM-DDTHH:MM"));
      // check if creating post is enabled
      const createPromise = this.page.waitForResponse(
        (response) => {
          return (
            response.url() ===
              "https://backend.knky.co/v1/posts/create-post-new" &&
            response.request().method() === "POST"
          );
        },
        { timeout: 300000 * images.length },
      );
      await this.page.locator("button.createpost-btn").first().click();
      const createResp = await createPromise;
      if (!createResp.ok()) {
        throw new BotError("schedule post failed", {
          where: "KnkyBrowser::schedulePost",
          method: "POST",
          endpoint: "https://backend.knky.co/v1/posts/create-post-new",
          params: createResp.request().postData(),
          status: createResp.statusText(),
          response: await createResp.text(),
        });
      }
      const createData = await createResp.json();
      // const createData = this.parsePayload(createPayload.r);
      return createData.data.post_id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("schedule post failed", {
        where: "KnkyBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async createPost(content: IContent, image: string): Promise<string> {
    try {
      // go to new post page
      await this.page.goto("https://knky.co/create/new-post");
      await this.checkFirstPost();
      // change post audience public
      await this.page
        .locator("div.post-type-wrapper div.dropdown > button")
        .first()
        .click();
      await this.page
        .locator(
          "div.post-type-wrapper div.dropdown > ul > li > label[for='flexCheckDefault-2']",
        )
        .waitFor();
      await this.page
        .locator(
          "div.post-type-wrapper div.dropdown > ul > li > label[for='flexCheckDefault-2']",
        )
        .first()
        .click();

      // set content
      const tagsStr = content.postTags.map((tag) => `#${tag}`).join(" ");
      await this.page
        .locator("div.create-post-content div.caption-content textarea")
        .first()
        .fill(`${content.title}\n${tagsStr}`);

      // set image
      await this.page
        .locator(
          "div.post-type-wrapper div.post-type-options input.media-input",
        )
        .setInputFiles(image);
      await this.page.waitForTimeout(120000);
      const disabled = await this.page
        .locator("button.createpost-btn")
        .first()
        .isDisabled();
      if (disabled) return "disabled";
      await this.page.locator("button.createpost-btn").first().click();

      // check if creating post is enabled
      const createPromise = this.page.waitForResponse(
        (response) => {
          return (
            response.url() ===
              "https://backend.knky.co/v1/posts/create-post-new" &&
            response.request().method() === "POST"
          );
        },
        { timeout: 300000 },
      );
      await this.page.locator("button.createpost-btn").first().click();
      const createResp = await createPromise;
      if (!createResp.ok()) {
        throw new BotError("create post failed", {
          where: "KnkyBrowser::createPost",
          method: "POST",
          endpoint: "https://backend.knky.co/v1/posts/create-post-new",
          params: createResp.request().postData(),
          status: createResp.statusText(),
          response: await createResp.text(),
        });
      }
      const createData = await createResp.json();
      // const createData = this.parsePayload(createPayload.r);
      return createData.data.post_id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("schedule post failed", {
        where: "KnkyBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async deleteStory(storyId: string): Promise<void> {
    try {
      await this.page.waitForTimeout(3000);
      const resp = await this.page.request.delete(
        `https://backend.knky.co/v1/stories/${storyId}`,
        { headers: { ...this.headers } },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "KnkyBrowser::deleteStory",
          });
        throw new BotError("delete story failed", {
          where: "KnkyBrowser::deleteStory",
          method: "DELETE",
          endpoint: `https://backend.knky.co/v1/stories/${storyId}`,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete story failed", {
        where: "KnkyBrowser::deleteStory",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async createStory(content: IContent, image: string): Promise<string> {
    try {
      // go to new post page
      await this.page.goto("https://knky.co/create/new-story", {
        timeout: 200000,
      });
      this.logger.info("go to story page");
      // change post audience public
      await this.page
        .locator("div.story-content div.dropdown > button")
        .first()
        .click();
      let modeElement;
      if (content.knkyStoryType == KnkyStoryType.PRIME) {
        modeElement = await this.page.locator(
          "div.story-content div.dropdown > ul > li",
          { hasText: "Prime" },
        );
      } else if (content.knkyStoryType == KnkyStoryType.PAYTOVIEW) {
        modeElement = await this.page.locator(
          "div.story-content div.dropdown > ul > li",
          { hasText: "Pay-To-View" },
        );
      } else {
        modeElement = await this.page.locator(
          "div.story-content div.dropdown > ul > li",
          { hasText: "Public" },
        );
      }
      await modeElement.waitFor();
      await modeElement.first().click();
      this.logger.info("select story mode");
      // set image
      await this.page
        .locator(
          "div.story-type-wrapper div.post-type-options input.media-input",
        )
        .setInputFiles(image);
      this.logger.info("upload media");
      try {
        await this.page
          .locator("button.createpost-btn", { hasText: "Done" })
          .waitFor();
        await this.page
          .locator("button.createpost-btn", { hasText: "Done" })
          .first()
          .click();
      } catch (error) {}
      // submit
      await this.page
        .locator("button.createpost-btn", { hasText: "Submit" })
        .waitFor();
      const createPromise = this.page.waitForResponse(
        (response) => {
          return (
            response.url() == "https://backend.knky.co/v1/stories" &&
            response.request().method() === "POST"
          );
        },
        { timeout: 300000 },
      );
      await this.page
        .locator("button.createpost-btn", { hasText: "Submit" })
        .first()
        .click();
      const createResp = await createPromise;
      if (!createResp.ok()) {
        throw new BotError("create story failed", {
          where: "KnkyBrowser::createStory",
          method: "POST",
          endpoint: "https://backend.knky.co/v1/stories",
          params: createResp.request().postData(),
          status: createResp.statusText(),
          response: await createResp.text(),
        });
      }
      const createData = await createResp.json();
      // const createData = this.parsePayload(createPayload.r);
      return createData.data?.story_id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("create story failed", {
        where: "KnkyBrowser::createStory",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getSelfStories(): Promise<IKnkyStory[]> {
    try {
      const resp = await this.page.request.get(
        "https://backend.knky.co/v1/stories/own-story",
        {
          headers: this.headers,
          // params: { page: 1, limit: 100, user_id: this.profile._id }
        },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "KnkyBrowser::getSelfStories",
          });
        else
          throw new BotError("get self stories failed", {
            where: "KnkyBrowser::getSelfStories",
            method: "GET",
            endpoint: "https://backend.knky.co/v1/stories/own-story",
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
      const respData = await resp.json();
      // const respData = this.parsePayload(respPayload.r);
      const stories: IKnkyStoryData[] = respData.data || [];
      const storyData = stories.find((item) => item._id == this.profile._id);
      return (storyData?.story_data || []).filter(
        (story) => story.visibility == "Public",
      );
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get stories failed", {
        where: "KnkyBrowser::getSelfStories",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const fromDate = new Date(
        Date.now() - 3600 * 1000 * 24 * 30,
      ).toISOString();
      const toDate = new Date().toISOString();
      const response = await this.page.request.get(
        `https://backend.knky.co/v1/users/overview?fromDate=${fromDate}&toDate=${toDate}&queryRange=month`,
        { headers: this.headers },
      );
      const respData = await response.json();
      if (!response.ok() || respData.status != 200) {
        throw new BotError("get monthly analysis failed", {
          where: "KnkyBrowser::getMonthlyAnalysis",
          path: `https://backend.knky.co/v1/users/overview?fromDate=${fromDate}&toDate=${toDate}&queryRange=month`,
          response: respData,
        });
      }
      const overview: IKnkyRevenue = respData.data;
      return overview?.total_earning || 0;
    } catch (error: any) {
      console.error(error);
      return 0;
    }
  }
}
