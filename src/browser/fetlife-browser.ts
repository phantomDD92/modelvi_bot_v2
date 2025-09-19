import fs from 'fs'
import { BotError } from "../utils/error";
import { IAccountID, IAccountSettings, IBotConfig } from "../types/interface";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";
import { IFetLifePicture, IFetLifeProfile } from '../types/fetlife';

declare global {
  interface Window {
    cfCallback?: (token: any) => void, // or appropriate function signature
    FL: { user: any }
  }
}

export class FetLifeBrowser extends BaseBrowser {

  protected profile!: IFetLifeProfile;
  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  public async home(): Promise<void> {
    try {
      await this.page.route(/.+api\.js.+/, async (route) => {
        this.logger.info('install captcha solver');
        const body = fs.readFileSync("./data/fetlife.dat");
        const response = await route.fetch();
        route.fulfill({
          response,
          body: body,
          headers: response.headers(),
        });
      });
      this.page.on("console", async (msg) => {
        if (msg.text().includes("intercepted-params:")) {
          const params = JSON.parse(msg.text().replace("intercepted-params:", ""));
          const code = await this.solveTurnstileCaptcha(params);
          this.logger.info("solve captcha...")
          await this.page.evaluate((token) => {
            window.cfCallback?.(token);
          }, code);
        }
      });
      await this.page.goto("https://fetlife.com/login", { waitUntil: "domcontentloaded" });
      this.logger.info("open home page");
    } catch (error: any) {
      throw new BotError("proxy blocked", {
        where: "FetLifeBrowser::home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  private async getUser(): Promise<IFetLifeProfile | undefined> {
    const user = await this.page.evaluate(() => {
      return window.FL.user;
    });
    return user;
  }

  public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
    try {
      // await this.page.goto("https://fetlife.com/login", { waitUntil: "domcontentloaded" });
      await this.page.locator("input#user_login").waitFor({ timeout: 90000 });
      await this.page.locator("input#user_login").fill(setting.alias);
      await this.page.locator("input#user_password").fill(setting.password);

      await this.page.locator("main form button").click();

      const homePromise = this.page.waitForResponse(response => {
        return response.url() === "https://fetlife.com/home" && response.request().method() === "POST"
      }, { timeout: 120000 });
      await this.page.waitForURL("https://fetlife.com/home", { waitUntil: "domcontentloaded" });
      const homeResp = await homePromise;
      if (!homeResp.ok())
        throw new BotError("login failed", {
          where: "FetLifeBrowser::login",
          method: "POST",
          endpoint: "https://fetlife.com/home",
          response: await homeResp.text(),
        });
      this.headers = await homeResp.allHeaders()
      await this.page.waitForURL("https://fetlife.com/home", { waitUntil: "domcontentloaded" });
      const user = await this.getUser()
      if (!user)
        return undefined
      this.profile = user;
      return { id: user.id.toString(), alias: user.nickname };
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      const flashTagCount = await this.page.locator("div#static-flash-container").count()
      if (flashTagCount > 0) {
        const flashText = await this.page.locator("div#static-flash-container").textContent();
        if (flashText && flashText.includes("Email or Password is incorrect")) {
          throw new BotError("wrong credentials", {
            where: "FetLifeBrowser::login",
          })
        } else if (flashText && flashText.includes("we have a problem")) {
          throw new BotError("account blocked", {
            where: "FetLifeBrowser::login",
          })
        }
      }
      throw new BotError("login failed", {
        where: "FetLifeBrowser::login",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async register(settings: IAccountSettings) {
    try {
      // go to join page
      await this.page.goto("https://fetlife.com/join");
      // set user data
      // await this.page.locator("input#user_nickname").fill(settings.alias);
      await this.page.locator('input[type="text"]').nth(1).pressSequentially(settings.gender || "male", { delay: 100 });
      await this.page.locator('input[type="text"]').nth(1).press("Enter");
      // await genderElement.locator('xpath=preceding-sibling::*').first().fill(settings.gender || "male");
      await this.page.waitForTimeout(60000);
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("register failed", {
        where: "FetLifeBrowser::register",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async createPostWithImage(imagePath: string, title: string, tags: string[]) {
    try {
      // click upload picture menu
      await this.page.goto("https://fetlife.com/pictures/new");

      await this.page.locator("input#fileInput").setInputFiles(imagePath);
      // set title
      await this.page.locator("textarea#caption").fill(title)

      // set tags
      const tagDiv = this.page.locator("form div.tags-input-root").nth(1)
      const tagLocator = tagDiv.locator("input[type='text']").first();
      for (var tag of tags) {
        await tagLocator.pressSequentially(tag, { delay: 300 })
        await tagLocator.press("Enter", { delay: 300 });
        await this.page.waitForTimeout(1000);
      }
      // set checked
      await this.page.locator('input[name="picture[is_certified]"]').first().setChecked(true);

      const createPromise = this.page.waitForResponse(`https://fetlife.com/${this.profile.nickname}/pictures`, { timeout: 300000 });
      await this.page.locator("form button").last().click();
      const createResp = await createPromise;
      if (!createResp.ok())
        throw new BotError("create post failed", {
          where: "FetLifeBrowser::createPost",
          method: "POST",
          endpoint: `https://fetlife.com/${this.profile.nickname}/pictures`,
          params: createResp.request().postData(),
          response: await createResp.text(),
        });
      await this.page.waitForURL(/https:\/\/fetlife\.com\/.+\/pictures\/\d+/);
      const url = this.page.url();
      console.log(url);
      const segments = url.split("/")
      return segments[segments.length - 1];
      // console.log(url);
    } catch (error: any) {
      console.error(error)
      if (error instanceof BotError)
        throw error;
      throw new BotError("create post failed", {
        where: "FetlifeBrowser::createPost",
        error: error.message,
      })
    }
  }

  public async createPostWithVideo(videoPath: string, title: string, tags: string[]) {
    try {
      // click upload picture menu
      await this.page.goto("https://fetlife.com/videos/new");

      await this.page.locator("input#fileInput").setInputFiles(videoPath);
      // set title
      await this.page.locator("input#title").fill(title)

      // set tags
      const tagDiv = this.page.locator("form div.tags-input-root").nth(1)
      const tagLocator = tagDiv.locator("input[type='text']").first();
      for (var tag of tags) {
        await tagLocator.pressSequentially(tag, { delay: 300 })
        await tagLocator.press("Enter", { delay: 300 });
        await this.page.waitForTimeout(1000);
      }
      // set checked
      await this.page.locator('input[name="video[is_certified]"]').first().setChecked(true);

      const createPromise = this.page.waitForResponse(`https://fetlife.com/${this.profile.nickname}/pictures`, { timeout: 300000 });
      await this.page.locator("form button").last().click();
      const createResp = await createPromise;
      if (!createResp.ok())
        throw new BotError("create post failed", {
          where: "FetLifeBrowser::createPost",
          method: "POST",
          endpoint: `https://fetlife.com/${this.profile.nickname}/pictures`,
          params: createResp.request().postData(),
          response: await createResp.text(),
        });
      await this.page.waitForURL(/https:\/\/fetlife\.com\/.+\/pictures\/\d+/);
      const url = this.page.url();
      console.log(url);
      const segments = url.split("/")
      return segments[segments.length - 1];
      // console.log(url);
    } catch (error: any) {
      console.error(error)
      if (error instanceof BotError)
        throw error;
      throw new BotError("create post failed", {
        where: "FetlifeBrowser::createPost",
        error: error.message,
      })
    }
  }

  public async deletePost(postId: string) {
    try {
      await this.page.goto(`https://fetlife.com/${this.profile.nickname}/pictures/${postId}`, { waitUntil: "domcontentloaded" });
      await this.page.locator("a[title='More']").first().click();
      await this.page.locator("a", { hasText: "Delete" }).click();
      await this.page.locator("div#general-modal button", { hasText: "Delete Picture" }).click();
      // await this.page.request.post(`https://fetlife.com/pictures/199152222`)
      // const authenticity_token = await this.page.locator('meta[name="csrf-token"]').getAttribute('content');
      // const deleteResp = await this.page.request.post(`https://fetlife.com/fruts/pictures/${postId}`, {
      //   headers: this.headers,
      //   form: {
      //     authenticity_token: authenticity_token || "",
      //     _method: "DELETE",
      //   }
      // });
      // if (!deleteResp.ok())
      //   throw new BotError("delete post failed", {
      //     where: "FetLifeBrowser::deletePost",
      //     method: "POST",
      //     endpoint: `https://fetlife.com/fruts/pictures/${postId}`,
      //     params: {
      //       authenticity_token: authenticity_token || "",
      //       _method: "DELETE",
      //     },
      //     status: await deleteResp.statusText(),
      //   });

    } catch (error: any) {
      // if (error instanceof BotError)
      //   throw error;
      // throw new BotError("delete post failed", {
      //   where: "FetlifeBrowser::deletePost",
      //   error: error.message,
      //   stack: error.stack,
      // })
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    try {
      let postIds: string[] = [];
      let page = 2;
      while (page < 5) {
        const resp = await this.page.request.get(`https://fetlife.com/${this.profile.nickname}/pictures`, {
          headers: this.headers,
          params: { page, order: "newest", filter: "all" }
        });
        if (!resp.ok()) {
          throw new BotError("get posts failed", {
            where: "FetlifeBrowser::getSelfPosts",
            method: "GET",
            endpoint: `https://fetlife.com/${this.profile.nickname}/pictures`,
            params: { page, order: "newest", filter: "all" },
            status: resp.statusText(),
            response: await resp.text()
          })
        }
        const respData = await resp.json();
        const posts: IFetLifePicture[] = respData.entries || [];
        postIds.push(...posts.map(post => `${post.id}`));
        page++;
        if (respData.total_pages < page)
          break;
      }
      return postIds
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "FetlifeBrowser::getSelfPosts",
        error: error.message,
        stack: error.stack,
      })
    }
  }
}
