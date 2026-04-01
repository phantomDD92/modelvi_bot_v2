import moment from "moment";
import { IAccountSettings, IAccountID } from "../types/interface";
import { BotError, ProxyError } from "../utils/error";
import { BaseBrowser } from "./base-browser";
import { IBestfansProfile, IBestfansUpload } from "../types/bestfans";
import { PostType } from "../types/constant";

declare global {
  interface document { }
}
export class BestFansBrowser extends BaseBrowser {

  private profile!: IBestfansProfile;

  protected async setFilter(): Promise<void> {
    await super.setFilter();
    await this.context.route(
      /https:\/\/www\.bestfans\.com\/video\/get\/.*/,
      (route) => route.abort(),
    );
  }
  public async home(): Promise<void> {
    try {
      // go to home page
      await this.page.goto("https://www.bestfans.com/", { waitUntil: "domcontentloaded", });
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "BestFansBrowser:home",
        error: error.message,
      });
    }
  }

  private async closeSubscriptionModal(): Promise<void> {
    try {
      await this.page.locator("button#pushSubscriptionPermissionModalAcceptButton").last().click({ timeout: 30000 });
      this.logger.info("close subscription modal");
    } catch (error: any) {
      this.logger.info("no subscription modal");
    }
  }

  private async closeCookieBannerModal(): Promise<void> {
    try {
      await this.page.locator("div#cookiebanner button").last().click({ timeout: 10000 });
      this.logger.info("close cookie banner modal");
    } catch (error: any) {
      this.logger.info("no cookie banner modal");
    }
  }

  public async afterHome(): Promise<void> {
    await this.closeCookieBannerModal();
  }

  private async solveCaptcha() {
    try {
      // await this.page.solveRecaptchas();
      const token = await this.solveRecaptchav2(
        this.page.url(),
        "6LeWV9YUAAAAAC9_GlCpLPliiQ1FITKhBOzRjHvw",
      );
      this.logger.info("captcha solved");
      return token;
    } catch (error: any) {
      throw new BotError("captcha solve failed", {
        where: "BestFansBrowser::solveCaptcha",
        error: error.message,
      });
    }
  }

  public async login(setting: IAccountSettings,): Promise<IAccountID | undefined> {
    try {
      // set email and click login button
      await this.page.locator("input#login-email").fill(setting.email);
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();
      //--- append by ai
      // Wait for password field to appear (it may be in DOM but initially hidden)
      await this.page.locator("input#login-password").waitFor({ state: 'attached', timeout: 30000 });
      await this.page.waitForTimeout(2000);
      // Force the password field to be visible if hidden
      await this.page.evaluate(() => {
        var pwField = document.querySelector('input#login-password') as HTMLInputElement;
        if (pwField) {
          pwField.removeAttribute('hidden');
          pwField.style.display = '';
          pwField.style.visibility = 'visible';
          pwField.style.opacity = '1';
          var parent = pwField.parentElement;
          while (parent && parent !== document.body) {
            parent.style.display = '';
            parent.style.visibility = 'visible';
            parent.style.opacity = '1';
            parent = parent.parentElement;
          }
        }
      });
      await this.page.waitForTimeout(500);
      // Fill password using evaluate to bypass visibility checks
      await this.page.evaluate(function (password) {
        var pwField = document.querySelector('input#login-password');
        if (pwField) {
          // var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          // nativeInputValueSetter.call(pwField, password);
          pwField.dispatchEvent(new Event('input', { bubbles: true }));
          pwField.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, setting.password);
      // Set up response interceptor to capture profile headers
      let capturedHeaders = null;
      let capturedProfileName = null;
      const responseHandler = async (response: any) => {
        if (response.request().url().includes("https://www.bestfans.com/profile/header/")) {
          capturedHeaders = await response.request().allHeaders();
          capturedProfileName = this.getLastPathFromUrl(response.request().url());
        }
      };
      this.page.on('response', responseHandler);
      await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();
      this.logger.info("password submitted, checking for captcha...");
      // Solve reCAPTCHA if it appears - try multiple selectors with 15s window
      let captchaSolved = false;
      try {
        // Wait for captcha to appear (try iframe selector with longer timeout)
        await this.page.waitForSelector('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"], iframe[title*="recaptcha"], [name="recaptcha_token_v2"]', { timeout: 15000 });
        this.logger.info("captcha detected, solving...");
        const token = await this.solveCaptcha();
        await this.page.evaluate((token) => {
          const el = document.querySelector('[name="recaptcha_token_v2"]') as HTMLInputElement;
          if (el) el.value = token;
        }, token);
        captchaSolved = true;
        this.logger.info("captcha solved, clicking submit...");
        await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();
      } catch (captchaErr) {
        this.logger.info("no captcha detected (15s timeout), proceeding without captcha solve");
      }
      // Wait for navigation away from login page
      this.logger.info("waiting for login navigation...");
      try {
        await this.page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 120000 });
      } catch (navErr) {
        // Check current URL to provide better error message
        const currentUrl = this.page.url();
        const pageTitle = await this.page.title().catch(() => 'unknown');
        throw new Error('login navigation timeout - still on: ' + currentUrl + ' | title: ' + pageTitle + ' | captchaSolved: ' + captchaSolved);
      }
      await this.page.waitForLoadState("domcontentloaded");
      this.page.off('response', responseHandler);
      // Extract alias from current URL
      const alias = this.getLastPathFromUrl(this.page.url());
      const name = capturedProfileName || alias;
      if (capturedHeaders) {
        this.headers = capturedHeaders;
      }
      //--- append by ai
      this.profile = { alias, name, };
      this.logger.info("get profile success");
      return { id: alias, alias };
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("login failed", {
        where: "BestFansBrowser:login",
        error: error.message,
      });
    }
  }

  public async afterLogin(): Promise<void> {
    await this.closeSubscriptionModal();
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
        error: error.message,
      });
    }
  }

  public async createPost(title: string, image: string, postType?: number, postPrice?: number): Promise<void> {
    try {

      // go to dashboard page
      await this.page.goto(`https://www.bestfans.com/${this.profile.alias}`, { waitUntil: "domcontentloaded", });
      await this.page.waitForTimeout(3000);
      await this.closeSubscriptionModal();

      // click create-post button
      await this.page.locator("div.main-container > section.cta-section a.btn").first().click();

      // click reset button
      await this.page.locator("form#posting_upload div.posting-configuration--navigation button#post_reset_button").first().click();

      // set post title
      await this.page.waitForTimeout(3000);
      await this.page.locator("form#posting_upload textarea#post-create-textarea").first().fill(title);

      //--- append by ai
      // // set posting period
      // await this.page.locator("form#posting_upload div#configuration_btns button").nth(1).click();
      // await this.page.locator("form#time_settings_form label.radio-block").nth(1).click();
      // await this.page.locator("form#time_settings_form button.btn--submit").last().click();
      // this.logger.info("set time period");
      await this.page.locator("form#posting_upload div#configuration_btns button").last().click({ force: true, timeout: 10000 });
      await this.page.locator("form#tags_form").waitFor({ state: "visible", timeout: 15000 });
      await this.page.waitForTimeout(1000);
      this.logger.info("createPost: form#tags_form opened");
      //--- append by  ai

      // set post type
      switch (postType) {
        case PostType.FANS:
          await this.page.locator("form#posting_upload div#configuration_btns button").last().click();
          await this.page.selectOption("#subscribed_price_EUR", { value: "" });
          await this.page.locator("form#tags_form button.btn--submit").last().click();
          break;
        case PostType.PAID:
          if (!postPrice)
            throw new BotError("price absent for paid posting");
          const price = this.findProperPrice(postPrice);
          await this.page.locator("form#posting_upload div#configuration_btns button").last().click();
          await this.page.selectOption("#subscribed_price_EUR", { value: price.toFixed(4) });
          await this.page.locator("form#tags_form button.btn--submit").last().click();
          break;
        default:
          //--- append by ai
          // await this.page.locator("form#posting_upload div#configuration_btns button").last().click();
          // await this.page.locator("form#tags_form input#free").first().click();
          //--- append by ai
          await this.page.locator("form#tags_form button.btn--submit").last().click();
          break;
      }
      this.logger.info("set post type");
      // upload image
      const uploadPromise = this.page.waitForResponse("https://www.bestfans.com/file/upload", { timeout: 120000 });
      const [fileChooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        this.page.locator("form#posting_upload div.upload-container--btn button[validation-name='uploads']").first().click(),
      ]);
      await fileChooser.setFiles(image);
      const uploadResp = await uploadPromise;
      if (!uploadResp.ok()) {
        throw new BotError("upload media failed", {
          where: "BestFansBrowser::createPost",
          endpoint: "https://www.bestfans.com/file/upload",
          method: "POST",
          status: uploadResp.statusText(),
          response: await uploadResp.text(),
        });
      }
      const uploadData: IBestfansUpload = await uploadResp.json();
      this.logger.info(`upload image(${uploadData.fileData?.id})`);

      // unlock comment lockr
      // await this.page.locator("form#posting_upload input#comments_locked").first().check();

      // click save button
      //--- append by ai
      // const storePromise = this.page.waitForResponse("https://www.bestfans.com/post/store");
      const storePromise = this.page.waitForResponse(
        (resp) => resp.request().method() !== "GET" && (
          resp.request().url().includes("/post/store") ||
          resp.request().url().includes("/content-impressions/create") ||
          resp.request().url().includes("/post/create") ||
          resp.request().url().includes("/posting")
        ),
        { timeout: 120000 }
      );
      //--- append by ai
      await this.page.locator("form#posting_upload div.posting-configuration--navigation button[type='submit']").first().click();
      const storeResp = await storePromise;
      if (!storeResp.ok()) {
        throw new BotError("create post failed", {
          where: "BestFansBrowser::createPost",
          endpoint: "https://www.bestfans.com/post/store",
          method: "POST",
          status: uploadResp.statusText(),
          response: (await uploadResp.text()).substring(0, 200),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create post failed", {
        where: "BestFansBrowser::createPost",
        error: error.message,
      })
    }
  }

  public async schedulePost(scheduleAt: Date, title: string, images: string[], postType?: number, postPrice?: number): Promise<void> {
    try {
      // go to dashboard page
      await this.page.goto(`https://www.bestfans.com/${this.profile.alias}`, { waitUntil: "domcontentloaded", });
      await this.page.waitForTimeout(3000);
      await this.closeSubscriptionModal();

      // click create-post button
      await this.page.locator("div.main-container > section.cta-section a.btn").first().click();

      // click reset button
      await this.page.locator("form#posting_upload div.posting-configuration--navigation button#post_reset_button").first().click();

      // set post title
      await this.page.waitForTimeout(3000);
      await this.page.locator("form#posting_upload textarea#post-create-textarea").first().fill(title);

      // select time
      await this.page.locator("form#posting_upload div#configuration_btns button").first().click();
      await this.page.waitForSelector("form#time_settings_form");
      const timestamp = scheduleAt.getTime().toString();
      await this.page.evaluate((ts) => {
        const input = document.querySelector('#datetimepicker1Input') as HTMLInputElement;
        input.value = ts;
        input.setAttribute('value', ts);
        console.log("### : ", input.getAttribute('value'));
      }, timestamp);
      await this.page.waitForTimeout(1000);
      await this.page.evaluate((ts) => {
        const input = document.querySelector('#datetimepicker1Input') as HTMLInputElement;
        input.value = ts;
        input.setAttribute('value', ts);
        console.log("$$$ : ", input.getAttribute('value'));
      }, timestamp);
      await this.page.locator("form#time_settings_form button.btn--submit").last().click();
      this.logger.info("set schedule time");

      // set post type
      switch (postType) {
        case PostType.FANS:
          await this.page.locator("form#posting_upload div#configuration_btns button").last().click();
          await this.page.selectOption("#subscribed_price_EUR", { value: "" });
          await this.page.locator("form#tags_form button.btn--submit").last().click();
          break;
        case PostType.PAID:
          if (!postPrice)
            throw new BotError("price absent for paid posting");
          const price = this.findProperPrice(postPrice);
          await this.page.locator("form#posting_upload div#configuration_btns button").last().click();
          await this.page.selectOption("#subscribed_price_EUR", { value: price.toFixed(4) });
          await this.page.locator("form#tags_form button.btn--submit").last().click();
          break;
        default:
          await this.page.locator("form#posting_upload div#configuration_btns button").last().click();
          await this.page.locator("form#tags_form input#free").first().click();
          await this.page.locator("form#tags_form button.btn--submit").last().click();
          break;
      }
      this.logger.info("set post type");
      // upload image
      const uploadPromise = this.page.waitForResponse("https://www.bestfans.com/file/upload", { timeout: 120000 });
      const [fileChooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        this.page.locator("form#posting_upload div.upload-container--btn button[validation-name='uploads']").first().click(),
      ]);
      await fileChooser.setFiles(images);
      const uploadResp = await uploadPromise;
      if (!uploadResp.ok()) {
        throw new BotError("upload media failed", {
          where: "BestFansBrowser::createPost",
          endpoint: "https://www.bestfans.com/file/upload",
          method: "POST",
          status: uploadResp.statusText(),
          response: await uploadResp.text(),
        });
      }
      const uploadData: IBestfansUpload = await uploadResp.json();
      this.logger.info(`upload image(${uploadData.fileData?.id})`);

      const storePromise = this.page.waitForResponse("https://www.bestfans.com/post/store");
      await this.page.locator("form#posting_upload div.posting-configuration--navigation button[type='submit']").first().click();
      const storeResp = await storePromise;
      if (!storeResp.ok()) {
        throw new BotError("create post failed", {
          where: "BestFansBrowser::createPost",
          endpoint: "https://www.bestfans.com/post/store",
          method: "POST",
          status: uploadResp.statusText(),
          response: await uploadResp.text(),
        });
      }
    } catch (error: any) {
      throw new BotError("create post failed", {
        where: "BestFansBrowser::createPost",
        message: error.message,
      })
    }
  }

  private findProperPrice(price: number) {
    const PRICE_PLANS: number[] = [1.9500, 2.9500, 3.9500, 4.9500, 5.9500, 6.9500, 7.9500, 8.9500, 9.9500, 10.9500,
      11.9500, 12.9500, 13.9500, 14.9500, 15.9500, 16.9500, 17.9500, 18.9500, 19.9500, 20.9500,
      21.9500, 22.9500, 23.9500, 24.9500, 25.9500, 26.9500, 27.9500, 28.9500, 29.9500, 30.9500,
      31.9500, 32.9500, 33.9500, 34.9500, 35.9500, 36.9500, 37.9500, 38.9500, 39.9500, 40.9500,
      41.9500, 42.9500, 43.9500, 44.9500, 45.9500, 46.9500, 47.9500, 48.9500, 49.9500, 54.9500,
      59.9500, 64.9500, 69.9500, 74.9500, 79.9500, 84.9500, 89.9500, 94.9500, 99.9500, 109.9500,
      119.9500, 129.9500, 139.9500, 149.9500,];
    if (price <= PRICE_PLANS[0])
      return PRICE_PLANS[0];
    for (var i = 1; i < PRICE_PLANS.length; i++) {
      if (price > PRICE_PLANS[i - 1] && price <= PRICE_PLANS[i])
        return PRICE_PLANS[i];
    }
    return PRICE_PLANS[PRICE_PLANS.length - 1];
  }
}
