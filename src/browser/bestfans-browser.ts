import { IAccountSettings, IAccountID } from "../types/interface";
import { BotError } from "../utils/error";
import { BaseBrowser } from "./base-browser";

declare global {
  interface document {}
}
export class BestFansBrowser extends BaseBrowser {
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
      this.logger.info("start to solve captcha...")
      await this.page.solveRecaptchas();
      
      const token = await this.solveRecaptchav2(
        this.page.url(),
        "6LeWV9YUAAAAAC9_GlCpLPliiQ1FITKhBOzRjHvw",
      );
      this.logger.info("captcha solved")
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
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();

      return undefined;
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
    } catch (error: any) {}
  }
}
