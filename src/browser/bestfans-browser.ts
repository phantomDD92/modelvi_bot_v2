import moment from "moment";
import { IAccountSettings, IAccountID } from "../types/interface";
import { BotError } from "../utils/error";
import { BaseBrowser } from "./base-browser";
import { IBestfansProfile } from "../types/bestfans";

declare global {
  interface document {}
}
export class BestFansBrowser extends BaseBrowser {
  private profile!: IBestfansProfile;

  public async home(): Promise<void> {
    try {
      await this.page.goto("https://www.bestfans.com/", {
        waitUntil: "domcontentloaded",
      });
    } catch (error: any) {
      throw new BotError("proxy blocked", {
        where: "BestFansBrowser:home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async afterHome(): Promise<void> {
    try {
      // close cookie banner dialog
      await this.page
        .locator("div#cookiebanner button")
        .last()
        .click({ timeout: 3000 });
    } catch (error: any) {}
  }

  public async login(
    setting: IAccountSettings,
  ): Promise<IAccountID | undefined> {
    try {
      // input email and
      await this.page.locator("input#login-email").fill(setting.email);
      this.logger.info("set email");
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();

      await this.page.locator("input#login-password").waitFor();
      await this.page.locator("input#login-password").fill(setting.password);
      this.logger.info("set password");
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();

      await this.page.locator('iframe[title="reCAPTCHA"]').first().waitFor();
      this.logger.info("start to solve captcha...");
      await this.page.solveRecaptchas();

      const token = await this.solveRecaptchav2(
        this.page.url(),
        "6LeWV9YUAAAAAC9_GlCpLPliiQ1FITKhBOzRjHvw",
      );
      this.logger.info("captcha solved");
      await this.page.evaluate((token) => {
        (
          document.querySelector(
            '[name="recaptcha_token_v2"]',
          ) as HTMLTextAreaElement
        ).value = token;
      }, token);
      //   await this.page.route("https://www.bestfans.com/login", async (route) => {
      //     const postData = route.request().postDataJSON();
      //     await this.page.unroute("https://www.bestfans.com/login");
      //     await route.continue({
      //       postData: {
      //         ...postData,
      //         recaptcha_token_v2: token,
      //       },
      //     });
      //   });
      this.logger.info("solve recaptcha");
      const profilePromise = this.page.waitForResponse(
        (response) =>
          response
            .request()
            .url()
            .includes("https://www.bestfans.com/profile/header/") &&
          response.request().method() == "POST",
      );
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();
      const profileResp = await profilePromise;
      this.headers = await profileResp.request().allHeaders();
      var url = profileResp.request().url();
      var segs = url.split("/");
      const name = segs[segs.length - 1];
      await this.page.waitForLoadState("domcontentloaded");
      url = this.page.url();
      segs = url.split("/");
      const alias = segs[segs.length - 1];
      this.profile = {
        alias,
        name,
      };
      this.logger.info("get profile success");
      return { id: alias, alias };
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("login failed", {
        where: "BestFansBrowser:login",
        error: error.stack,
        message: error.message,
      });
    }
  }

  public async afterLogin(): Promise<void> {
    try {
      // close enable notification dialog
      await this.page
        .locator(
          "div.modal-dialog button#pushSubscriptionPermissionModalDeclineButton",
        )
        .last()
        .click({ timeout: 3000 });
      this.logger.info("close push subscription permission modal");
    } catch (error: any) {}
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const from = moment().subtract(30, "day").format("YYYY-MM-DD");
      const to = moment().format("YYYY-MM-DD");
      await this.page.goto(
        `https://www.bestfans.com/payment/statistics/details-payout/revenue-range/${from}/${to}`,
        { waitUntil: "domcontentloaded" },
      );
      const summaryText = await this.page
        .locator("section.payment-statistics-summary > div.row")
        .last()
        .textContent();
      if (!summaryText) return 0;
      const matches = summaryText.match(/\d+\,\d+/g);
      if (!matches || matches?.length == 0) return 0;
      const revenueText = matches[0].replace(",", "");
      return parseFloat(revenueText) / 100;
    } catch (error: any) {
      throw new BotError("get earnings failed", {
        where: "BestFansBrowser::getMonthlyEarnings",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async createPost(title: string): Promise<void> {
    try {
      // go to dashboard page
      await this.page.goto(`https://www.bestfans.com/${this.profile.alias}`, {
        waitUntil: "domcontentloaded",
      });
      // click create-post button
      await this.page
        .locator("div.main-container > section.cta-section a.btn")
        .first()
        .click();
      // set post title
      await this.page
        .locator("form#posting_upload textarea#post-create-textarea")
        .first()
        .fill(title);
      // set post type public
      await this.page
        .locator(
          "form#posting_upload div[data-type='visibilityselector'] input#flexRadioDefault0",
        )
        .first()
        .click();
      await this.page
        .locator(
          "form#posting_upload div[data-type='public_post'] input#public_post",
        )
        .first()
        .click();
      await this.page
        .locator("form#posting_upload div#configuration_btns button")
        .last()
        .click();
      await this.page.locator("form#tags_form input#free").first().click();
      await this.page
        .locator("form#tags_form button.btn--submit")
        .last()
        .click();
      // upload image
      const [fileChooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        this.page
          .locator("form#posting_upload div.upload-container--btn button", {
            hasText: "Upload media",
          })
          .click(),
      ]);
      // await fileChooser.setFiles(image);
    } catch (error) {}
  }
}
