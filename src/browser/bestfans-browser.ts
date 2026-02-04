import moment from "moment";
import { IAccountSettings, IAccountID } from "../types/interface";
import { BotError, ProxyError } from "../utils/error";
import { BaseBrowser } from "./base-browser";
import { IBestfansProfile } from "../types/bestfans";

declare global {
  interface document { }
}
export class BestFansBrowser extends BaseBrowser {
  private profile!: IBestfansProfile;

  public async home(): Promise<void> {
    try {
      // go to home page
      await this.page.goto("https://www.bestfans.com/", { waitUntil: "domcontentloaded", });
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "BestFansBrowser:home",
        message: error.message,
      });
    }
  }

  public async afterHome(): Promise<void> {
    try {
      // close cookie banner dialog
      await this.page.locator("div#cookiebanner button").last().click({ timeout: 3000 });
      this.logger.info("close cookie banner modal");
    } catch (error: any) { }
  }

  private async solveCaptcha() {
    try {
      await this.page.solveRecaptchas();
      const token = await this.solveRecaptchav2(
        this.page.url(),
        "6LeWV9YUAAAAAC9_GlCpLPliiQ1FITKhBOzRjHvw",
      );
      this.logger.info("captcha solved");
      return token;
    } catch (error: any) {
      throw new BotError("captcha solve failed", {
        where: "BestFansBrowser::solveCaptcha",
        message: error.message,
      });
    }
  }

  public async login(setting: IAccountSettings,): Promise<IAccountID | undefined> {
    try {
      // set email and click login button
      await this.page.locator("input#login-email").fill(setting.email);
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();

      // set password and click login button
      await this.page.locator("input#login-password").waitFor();
      await this.page.locator("input#login-password").fill(setting.password);
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();

      // wait recaptcha and solve it
      await this.page.locator('iframe[title="reCAPTCHA"]').first().waitFor();
      this.logger.info("start to solve captcha...");
      const token = await this.solveCaptcha();
      
      // set recaptcha response
      await this.page.evaluate((token) => {
        (document.querySelector('[name="recaptcha_token_v2"]',) as HTMLTextAreaElement).value = token;
      }, token);

      // install profile response waiter
      const profilePromise = this.page.waitForResponse((response) =>
        response.request().url().includes("https://www.bestfans.com/profile/header/") && response.request().method() == "POST",
      );
      // click login button
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();
      const profileResp = await profilePromise;
      this.headers = await profileResp.request().allHeaders();

      // get request headers, alias, name
      await this.page.waitForLoadState("domcontentloaded");
      const name = this.getLastPathFromUrl(profileResp.request().url());
      const alias = this.getLastPathFromUrl(this.page.url());
      this.profile = { alias, name, };
      this.logger.info("get profile success");
      return { id: alias, alias };
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("login failed", {
        where: "BestFansBrowser:login",
        message: error.message,
      });
    }
  }

  public async afterLogin(): Promise<void> {
    try {
      // close enable notification dialog
      await this.page.locator("div.modal-dialog button#pushSubscriptionPermissionModalDeclineButton",).last().click({ timeout: 3000 });
      this.logger.info("close push subscription permission modal");
    } catch (error: any) { }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      // go to statistics page
      const from = moment().subtract(30, "day").format("YYYY-MM-DD");
      const to = moment().format("YYYY-MM-DD");
      await this.page.goto(`https://www.bestfans.com/payment/statistics/details-payout/revenue-range/${from}/${to}`, { waitUntil: "domcontentloaded" },);
      // extract summary text
      const summaryText = await this.page.locator("section.payment-statistics-summary > div.row").last().textContent();
      if (!summaryText) return 0;
      // parse summary text
      const matches = summaryText.match(/\d+\,\d+/g);
      if (!matches || matches?.length == 0) return 0;
      const revenueText = matches[0].replace(",", "");
      return parseFloat(revenueText) / 100;
    } catch (error: any) {
      throw new BotError("get earnings failed", {
        where: "BestFansBrowser::getMonthlyEarnings",
        message: error.message,
      });
    }
  }

  public async createPost(title: string, image: string): Promise<void> {
    try {
      // go to dashboard page
      await this.page.goto(`https://www.bestfans.com/${this.profile.alias}`, { waitUntil: "domcontentloaded", });

      // click create-post button
      await this.page.locator("div.main-container > section.cta-section a.btn").first().click();
      // set post title
      await this.page.locator("form#posting_upload textarea#post-create-textarea").first().fill(title);
      // set post type public
      await this.page.locator("form#posting_upload div[data-type='visibilityselector'] input#flexRadioDefault0").first().click();
      await this.page.locator("form#posting_upload div[data-type='public_post'] input#public_post").first().click();
      await this.page.locator("form#posting_upload div#configuration_btns button").last().click();
      await this.page.locator("form#tags_form input#free").first().click();
      await this.page.locator("form#tags_form button.btn--submit").last().click();
      // upload image
      const [fileChooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        this.page.locator("form#posting_upload div.upload-container--btn button", { hasText: "Upload media", }).click(),
      ]);
      await fileChooser.setFiles(image);
    } catch (error: any) {
      throw new BotError("create post failed", {
        where: "BestFansBrowser::createPost",
        message: error.message,
      })
    }
  }
}
