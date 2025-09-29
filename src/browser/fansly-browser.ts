import { AuthError, BotError, ProxyError } from "../utils/error";
import { PostType } from "../types/constant";
import { IFanslyAccount, IFanslyAlbumMediaResponse, IFanslyAlbumResponse, IFanslyGetHomePostResult, IFanslyMessageResult, IFanslyPost, IFanslyProfile, IFanslyStat } from "../types/fansly";
import { IAccountID, IAccountSettings, IBotConfig } from "../types/interface";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";
import * as twoFactor from "node-2fa";
import moment from "moment";
import { PostApiService } from "../services/post-service";

export class FanslyBrowser extends BaseBrowser {

  protected service!: PostApiService
  protected profile!: IFanslyProfile;
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  public async setupAuthentication() {
    try {
      await this.page.goto("https://fansly.com/settings/account");
      await this.closePushEnableModal();
      // setup 2FA click
      await this.page.locator("div.btn", { hasText: "Setup 2 Factor" }).click();
      // 
      await this.page.locator("app-twofa-create-modal").waitFor();
      await this.page.locator("app-twofa-create-modal div.btn", { hasText: "Create 2FA QR" }).click();

      //
      await this.page.locator("app-twofa-create-modal div.modal-content a").first().click();

      let device = await this.page.locator("app-twofa-create-modal div.break-words").first().textContent();

      const twoFaCode = twoFactor.generateToken(device?.trim() || "");
      if (twoFaCode?.token.length != 6)
        throw new BotError("generate 2FA code failed", {
          where: "FanslyBrowser::setupAuthentication",
          twoFaCode,
        });
      const verification = twoFactor.verifyToken(device?.trim() || "", twoFaCode.token);
      if (verification?.delta != 0)
        throw new BotError("generate 2FA code failed", {
          where: "FanslyBrowser::setupAuthentication",
          twoFaCode,
          verification,
        });
      await this.page.locator("app-twofa-create-modal input").first().fill(twoFaCode.token);
      const twofaPromise = this.page.waitForResponse(response => {
        return response.url() == "https://apiv3.fansly.com/api/v1/twofa/verify?ngsw-bypass=true"
      });
      await this.page.locator('app-twofa-create-modal app-button', { hasText: "Verify" }).click();

      const twofaResp = await twofaPromise;
      // const twofaData = await twofaResp.json();
      if (!twofaResp.ok())
        throw new BotError("setup 2FA failed", {
          where: "FanslyBrowser::setupAuthentication",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/twofa/verify?ngsw-bypass=true",
          status: twofaResp.statusText(),
          response: await twofaResp.text(),
        })
      await this.page.locator("app-twofa-create-modal i.fa-xmark").first().click();
      return device?.trim();
    } catch (error: any) {
      console.error(error);
    }
  }

  public async followModel(modelId: string): Promise<boolean> {
    try {
      const resp = await this.page.request.post(`https://apiv3.fansly.com/api/v1/account/${modelId}/followers?ngsw-bypass=true`, {
        headers: this.headers
      });
      if (!resp.ok())
        throw new BotError("follow model failed", {
          where: "followModel",
          method: "POST",
          endpoint: `https://apiv3.fansly.com/api/v1/account/${modelId}/followers?ngsw-bypass=true`,
          status: resp.statusText(),
          response: await resp.text(),
        })
      return true
    } catch (error) {
      // console.error(error);
      return false;
    }
  }

  public async unfollowModel(modelId: string): Promise<boolean> {
    try {
      const resp = await this.page.request.post(`https://apiv3.fansly.com/api/v1/account/${modelId}/followers/remove?ngsw-bypass=true`, {
        headers: this.headers
      });
      if (!resp.ok())
        throw new BotError("follow model failed", {
          where: "followModel",
          method: "POST",
          endpoint: `https://apiv3.fansly.com/api/v1/account/${modelId}/followers/remove?ngsw-bypass=true`,
          status: resp.statusText(),
          response: await resp.text(),
        })
      return true
    } catch (error) {
      // console.error(error);
      return false;
    }
  }

  public async sendVerificationMail(): Promise<boolean> {
    try {
      await this.page.goto("https://fansly.com/settings/account");
      await this.closePushEnableModal();
      const warningCount = await this.page.locator("div.warning-1 > span.bold").count();
      if (warningCount > 0) {
        await this.page.locator("div.warning-1 > span.bold").first().click();
        await this.page.locator("app-email-sent-modal").waitFor();
        return true;
      }
      return false;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("send verification mail failed", {
        where: "FanslyBrowser::sendVerificationMail",
        error: error.message,
        stack: error.error.stack,
      })
    }
  }

  public async refreshHome(): Promise<void> {
    try {
      await this.page.goto("https://fansly.com/home");
      await this.closePushEnableModal();
    } catch (error: any) {
      throw new BotError("refresh home failed", {
        where: "FanslyBrowser::refreshHome",
        error: error.message,
        stack: error.error.stack,
      })
    }
  }

  public async verify(veficationLink: string): Promise<void> {
    try {
      const authPromise = this.page.waitForResponse(response => {
        return response.url() === "https://apiv3.fansly.com/api/v1/intercom/authorize?ngsw-bypass=true" && response.request().method() === "GET"
      }, { timeout: 120000 });
      const mePromise = this.page.waitForResponse(response => {
        return response.url() == "https://apiv3.fansly.com/api/v1/account/me?ngsw-bypass=true"
      }, { timeout: 600000 });

      await this.page.goto(veficationLink);
      const authResp = await authPromise;
      if (!authResp.ok())
        throw new BotError("verification failed", {
          where: "FanslyBrowser::verify",
          method: "GET",
          endpoint: "https://apiv3.fansly.com/api/v1/intercom/authorize?ngsw-bypass=true",
          status: authResp.statusText(),
          response: await authResp.text()
        })
      const meResp = await mePromise;
      const meData = await meResp.json();
      this.profile = meData.response?.account;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("verfication failed", {
        where: "FanslyBrowser::verify",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async register(settings: IAccountSettings): Promise<void> {
    try {
      // await this.page.goto("https://fansly.com/application/", {timeout: 120000});
      await this.closeAgeGateModal();
      // // click login & apply now button
      // await this.page.locator("div.sign-up-buttons > div.apply-button").first().click();
      await this.page.locator("div.right-content > div.btn").first().click()
      // fill register modal
      await this.page.locator("app-login-modal").waitFor();
      await this.page.locator("div.login-form div.user-name input#fansly_login").fill(settings.alias || "");
      await this.page.locator("div.login-form div.e-mail input").fill(settings.email);
      await this.page.locator("div.login-form div.password input#fansly_password").fill(settings.password);
      await this.page.locator("div.login-form div.password input#fansly_confirm_password").fill(settings.password);

      // send login request
      const registerPromise = this.page.waitForResponse(response => {
        return response.url() === "https://apiv3.fansly.com/api/v1/registernew?ngsw-bypass=true" && response.request().method() === "POST"
      }, { timeout: 120000 });

      const mePromise = this.page.waitForResponse(response => {
        return response.url() == "https://apiv3.fansly.com/api/v1/account/me?ngsw-bypass=true"
      }, { timeout: 600000 });

      await this.page.locator("app-login-modal app-button").first().click();
      const registerResp = await registerPromise;
      if (!registerResp.ok())
        throw new BotError("register failed", {
          where: "FanslyBrowser::register",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/registernew?ngsw-bypass=true",
          status: registerResp.statusText(),
          response: await registerResp.text(),
        });
      const meResp = await mePromise;
      this.headers = await meResp.request().allHeaders();
      const meData = await meResp.json();

      this.profile = meData.response?.account;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      else throw new BotError("register failed", {
        where: "FanslyBrowser::register",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async home(): Promise<void> {
    try {
      await this.page.goto("https://fansly.com", { timeout: 120000 });
      this.logger.info("open home page");
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "FanslyBrowser::home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async afterHome(): Promise<void> {
    // close age gate modal
    await this.closeAgeGateModal();
  }

  public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
    try {
      if (!setting.device) {
        throw new AuthError("no security key", {
          where: "FanslyBrowser::login"
        });
      }
      // open login modal
      await this.page.locator("div.right-content > div.btn", { hasText: "Login" }).waitFor({ timeout: 600000 })
      await this.page.locator("div.right-content > div.btn", { hasText: "Login" }).first().click();
      await this.page.waitForTimeout(1000);
      await this.page.locator("app-login-modal").waitFor()

      // input login credentials
      await this.page.locator("app-login-modal input#fansly_login").first().fill(setting.email);
      await this.page.locator("app-login-modal input#fansly_password").first().fill(setting.password);
      await this.page.waitForTimeout(1000);

      // send login request
      const loginPromise = this.page.waitForResponse(response => {
        return response.url() === "https://apiv3.fansly.com/api/v1/login?ngsw-bypass=true" && response.request().method() === "POST"
      }, { timeout: 120000 });
      await this.page.locator("app-login-modal app-button").first().click();
      const loginResp = await loginPromise;
      try {
        const loginData = await loginResp.json();
        // check login credentials mismatch
        if (!loginData.success) {
          throw new AuthError("wrong credentials", {
            where: "FanslyBrowser::login",
            url: "https://apiv3.fansly.com/api/v1/login?ngsw-bypass=true",
            response: await loginResp.text(),
          });
        }
        // check 2FA authentication
        if (loginData.response?.twofa) {
          const twoFaCode = twoFactor.generateToken(setting.device || "");
          if (twoFaCode?.token.length != 6)
            throw new AuthError("invalid security key", {
              where: "FanslyBrowser::login",
              error: "2fa code length is not 6",
              code: twoFaCode
            })
          const verification = twoFactor.verifyToken(setting.device || "", twoFaCode.token);
          if (verification?.delta != 0)
            throw new AuthError("invalid security key", {
              where: "FanslyBrowser::login",
              error: "2fa code verification failed",
              code: twoFaCode,
              verification,
            })
          await this.page.locator("input#fansly_twofa").first().fill(twoFaCode.token);
          const twofaPromise = this.page.waitForResponse(response => {
            return response.url() == "https://apiv3.fansly.com/api/v1/login/twofa?ngsw-bypass=true"
          });
          await this.page.click('app-button >> text=Verify');
          const twofaResp = await twofaPromise;
          const twofaData = await twofaResp.json();
          if (!twofaData?.success)
            throw new AuthError("invalid security key", {
              where: "FanslyBrowser::login",
              endpoint: "https://apiv3.fansly.com/api/v1/login/twofa?ngsw-bypass=true",
              status: twofaResp.statusText(),
              response: await twofaResp.text(),
            })
        } else {
          throw new BotError("login failed", {
            where: "FanslyBrowser::login",
            endpoint: "https://apiv3.fansly.com/api/v1/login?ngsw-bypass=true",
            status: loginResp.statusText(),
            response: await loginResp.text(),
          });
        }
      } catch (error: any) {
        if (error instanceof BotError)
          throw error;
      }
      // get profile
      const mePromise = this.page.waitForResponse(response => {
        return response.url() == "https://apiv3.fansly.com/api/v1/account/me?ngsw-bypass=true"
      }, { timeout: 600000 });
      const meResp = await mePromise;
      if (!meResp.ok())
        throw new BotError("get profile failed", {
          where: "FanslyBrowser::login",
          endpoint: "https://apiv3.fansly.com/api/v1/account/me?ngsw-bypass=true",
          status: meResp.statusText(),
          response: await meResp.text(),
        });
      const meData = await meResp.json();
      this.headers = await meResp.request().allHeaders();
      this.profile = meData.response?.account
      return ({
        alias: meData.response?.account?.username,
        id: meData.response?.account?.id
      });
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      else
        throw new BotError("login failed", {
          where: "FanslyBrowser::login",
          error: error.message,
          stack: error.stack,
        });
    }
  }

  private async closeNewVersionModal(): Promise<void> {
    try {
      await this.page.waitForSelector("app-new-version-info-modal", { timeout: 10000 });
      await this.page.locator("app-new-version-info-modal .btn").first().click();
      this.logger.info("close new version info modal");
    } catch (error) {
      this.logger.info("not found new version info modal");
    }
  }

  private async closePushEnableModal(): Promise<void> {
    try {
      await this.page.waitForSelector("app-web-push-enable-modal", { timeout: 10000 });
      await this.page.locator("app-web-push-enable-modal .btn").first().click();
      this.logger.info("close push enable modal");
    } catch (error) {
      this.logger.info("not found push enable modal");
    }
  }

  private async closeRecapStatsModal(): Promise<void> {
    try {
      await this.page.waitForSelector("app-recap-stats-modal", { timeout: 3000 });
      await this.page.mouse.click(200, 200);
      this.logger.info("close recap stats modal");
    } catch (error) {
      this.logger.info("not found recap stats modal");
    }
  }

  private async closeAgeGateModal(): Promise<void> {
    try {
      await this.page.waitForSelector("app-age-gate-modal", { timeout: 3000 });
      await this.page.locator("app-age-gate-modal div.solid-green").first().click();
      this.logger.info("close age gate modal");
    } catch (error) {
      this.logger.info("not found age gate modal");
    }
  }

  public async afterLogin(): Promise<void> {
    await this.closeNewVersionModal();
    await this.closeRecapStatsModal();
    await this.closePushEnableModal();
  }

  public async deletePost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.post(
        `https://apiv3.fansly.com/api/v1/post/${postId}/delete?ngsw-bypass=true`,
        { headers: this.headers });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError(`delete post failed`, {
          where: "FanslyBrowser::deletePost",
          method: "POST",
          endpoint: `https://apiv3.fansly.com/api/v1/post/${postId}/delete?ngsw-bypass=true`,
          status: resp.statusText(),
          response: await resp.text(),
        });
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete post failed", {
        where: "FanslyBrowser::deletePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getAlbumMedia(albumId: string): Promise<IFanslyAlbumMediaResponse> {
    try {
      const resp = await this.page.request.get(
        `https://apiv3.fansly.com/api/v1/media/vaultnew?albumId=${albumId}&mediaType=&search=&before=0&after=0&ngsw-bypass=true`,
        { headers: this.headers });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("get album media failed", {
          where: "FanslyBrowser::getAlbumMedia",
          endpoint: `https://apiv3.fansly.com/api/v1/media/vaultnew?albumId=${albumId}&mediaType=&search=&before=0&after=0&ngsw-bypass=true`,
          status: resp.statusText(),
          response: await resp.text(),
        });
      return respData.response;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      else
        throw new BotError("get album media failed", {
          where: "FanslyBrowser::getAlbumMedia",
          error: error.message,
          stack: error.stack
        })
    }
  }

  public async getAlbums(): Promise<IFanslyAlbumResponse> {
    try {
      const resp = await this.page.request.get(
        "https://apiv3.fansly.com/api/v1/vault/albumsnew?ngsw-bypass=true",
        { headers: this.headers });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("get albums failed", {
          where: "FanslyBrowser::getAlbums",
          method: "GET",
          endpoint: "https://apiv3.fansly.com/api/v1/vault/albumsnew?ngsw-bypass=true",
          status: resp.statusText(),
          response: await resp.text(),
        });
      return respData.response;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      else
        throw new BotError("get albums failed", {
          where: "FanslyBrowser::getAlbums",
          error: error.message,
          stack: error.stack,
        })
    }
  }

  public async deleteAlbumMedia(albumId: string, mediaId: string): Promise<any> {
    try {
      const headers = this.headers;
      const resp = await this.page.request.post(
        "https://apiv3.fansly.com/api/v1/vault/albums/media/delete?ngsw-bypass=true",
        { headers: headers, data: { albumId: albumId, mediaIds: [mediaId] } });
      const data = await resp.json();
      if (!data.success)
        throw new BotError("delete album media failed", {
          where: "FanslyBrowser::deleteAlbumMedia",
          path: "https://apiv3.fansly.com/api/v1/vault/albums/media/delete?ngsw-bypass=true",
          response: data,
        });
      return;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      else
        throw new BotError("delete album media failed", {
          where: "FanslyBrowser::deleteAlbumMedia",
          path: "https://apiv3.fansly.com/api/v1/vault/albums/media/delete?ngsw-bypass=true",
          error: error,
        })
    }
  }

  public async createAlbum(title: string): Promise<any> {
    try {
      const params = { id: null, title: title, description: "", accountId: null, type: 0 };
      const resp = await this.page.request.post(
        "https://apiv3.fansly.com/api/v1/vault/albums?ngsw-bypass=true",
        {
          headers: this.headers,
          data: params
        });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("create album failed", {
          where: "FanslyBrowser::createAlbum",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/vault/albums?ngsw-bypass=true",
          params,
          status: resp.statusText(),
          response: await resp.text(),
        });
      return respData;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create album failed", {
        where: "FanslyBrowser::createAlbum",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async createBundle(mediaIds: string[], type: number, price?: number, previewId: string | undefined = undefined): Promise<string> {
    try {
      let permissions;
      switch (type) {
        case PostType.FREE:
          permissions = { "permissionFlags": [] };
          break;
        case PostType.FANS:
          permissions = { "permissionFlags": [{ "flags": 4 }] }
          break;
        case PostType.PAID:
          if (!price || price < 1)
            throw new BotError("create content failed", {
              where: "FanslyBrowser:createContent",
              error: "Invalid price value",
              params: { mediaIds, type, price, previewId },
            });
          const priceValue = Math.floor(price * 1000);
          permissions = { "permissionFlags": [{ "type": 0, "flags": 1, "metadata": `{\"1\":\"{\\\"price\\\":${priceValue}}\"}`, "price": priceValue }] }
          break;
        default:
          throw new BotError("create content failed", {
            where: "FanslyBrowser:createContent",
            error: "Unknown content type",
            params: { mediaIds, type, price, previewId },
          });
      }
      const params = {
        "accountMediaModels": mediaIds.map(mediaId => ({ mediaId: mediaId, previewId: null, permissionFlags: 0, price: 0, whitelist: [] })),
        "previewId": previewId || null,
        "permissionFlags": 0,
        "price": 0,
        "whitelist": [],
        "permissions": permissions,
        "tags": []
      };
      let resp = await this.page.request.post("https://apiv3.fansly.com/api/v1/account/media/bundle?ngsw-bypass=true", {
        headers: this.headers,
        data: params,
      });
      const respData = await resp.json();
      console.log(respData);
      if (!resp.ok() || !respData.success)
        throw new BotError("create content failed", {
          where: "FanslyBrowser:createContent",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/account/media?ngsw-bypass=true",
          params,
          status: resp.statusText(),
          response: await resp.text(),
        });
      const contentId = respData.response?.accountMediaBundles[0]?.id;
      return contentId;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create content failed", {
        where: "FanslyBrowser::createContent",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async createContent(mediaId: string, type: number, price?: number, previewId: string | undefined = undefined): Promise<string> {
    try {
      let permissions;
      switch (type) {
        case PostType.FREE:
          permissions = { "permissionFlags": [] };
          break;
        case PostType.FANS:
          permissions = { "permissionFlags": [{ "type": 0, "flags": 2, "metadata": null }] }
          break;
        case PostType.PAID:
          if (!price || price < 1)
            throw new BotError("create content failed", {
              where: "FanslyBrowser:createContent",
              error: "Invalid price value",
              params: { mediaId, type, price, previewId },
            });
          const priceValue = Math.floor(price * 1000);
          permissions = { "permissionFlags": [{ "type": 0, "flags": 1, "metadata": `{\"1\":\"{\\\"price\\\":${priceValue}}\"}`, "price": priceValue }] }
          break;
        default:
          throw new BotError("create content failed", {
            where: "FanslyBrowser:createContent",
            error: "Unknown content type",
            params: { mediaId, type, price, previewId },
          });
      }
      let resp = await this.page.request.post("https://apiv3.fansly.com/api/v1/account/media?ngsw-bypass=true", {
        headers: this.headers,
        data: [{
          "mediaId": mediaId,
          "previewId": previewId || null,
          "permissionFlags": 0,
          "price": 0,
          "whitelist": [],
          "permissions": permissions,
          "tags": []
        }]
      });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("create content failed", {
          where: "FanslyBrowser:createContent",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/account/media?ngsw-bypass=true",
          params: [{
            "mediaId": mediaId,
            "previewId": previewId || null,
            "permissionFlags": 0,
            "price": 0,
            "whitelist": [],
            "permissions": permissions,
            "tags": []
          }],
          status: resp.statusText(),
          response: await resp.text(),
        });
      const contentId = respData.response[0].id;
      return contentId;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create content failed", {
        where: "FanslyBrowser::createContent",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async publishPost(title: string, tags: string[], contentId: string): Promise<string | undefined> {
    try {
      const params = {
        "content": tags.length > 0 ? `${title}\n\n${tags.map(tag => `#${tag}`).join(" ")}` : title,
        "fypFlags": 0,
        "inReplyTo": null,
        "quotedPostId": null,
        "attachments": [{ "contentId": contentId, "contentType": 1, "pos": 0 }],
        "scheduledFor": 0,
        "expiresAt": 0,
        "postReplyPermissionFlags": [],
        "pinned": 0,
        "wallIds": []
      }
      const resp = await this.page.request.post(
        "https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true",
        {
          headers: this.headers,
          data: params
        });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("publish post failed", {
          where: "FanslyBrowser::publishPost",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true",
          params,
          status: resp.statusText(),
          response: await resp.text(),
        });
      return respData.response?.id;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("publish post failed", {
        where: "FanslyBrowser::publishPost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async schedulePost(title: string, tags: string[], contentId: string, scheduledAt: Date): Promise<string | undefined> {
    try {
      const params = {
        "content": tags.length > 0 ? `${title}\n\n${tags.map(tag => `#${tag}`).join(" ")}` : title,
        "fypFlags": 0,
        "inReplyTo": null,
        "quotedPostId": null,
        "attachments": [{ "contentId": contentId, "contentType": 2, "pos": 0 }],
        "scheduledFor": moment().isAfter(scheduledAt, "hour") ? moment().add(1, "hour").toDate().getTime() : scheduledAt.getTime(),
        "expiresAt": 0,
        "postReplyPermissionFlags": [],
        "pinned": 0,
        "wallIds": []
      }
      const resp = await this.page.request.post(
        "https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true",
        {
          headers: this.headers,
          data: params
        });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("schedule post failed", {
          where: "FanslyBrowser::schedulePost",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true",
          params,
          status: resp.statusText(),
          response: respData,
        });
      console.log(respData);
      return respData.response?.postId;

    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("schedule post failed", {
        where: "FanslyBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async uploadContent(folder: string, filepath: string): Promise<any> {
    try {
      await this.page.locator(".default-dropdown").first().click();
      await this.page.waitForTimeout(1000);
      await this.page.locator(".default-dropdown > .dropdown-list > .dropdown-item").last().click();
      await this.page.waitForTimeout(1000);
      await this.page.locator("app-media-vault").getByText(folder).first().click();
      await this.page.waitForTimeout(1000);
      await this.page.locator(".close-toggle").first().click();
      await this.page.waitForTimeout(3000);
      const completeResponse = this.page.waitForResponse(
        "https://apiv3.fansly.com/api/v1/vault/albums/media?ngsw-bypass=true",
        { timeout: 1200000 }
      );
      await this.page.locator("app-media-upload-input > input").first().setInputFiles(filepath);
      const resp = await completeResponse;
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("upload content failed", {
          where: "FanslyBrowser::uploadContent",
          method: "GET",
          endpoint: "https://apiv3.fansly.com/api/v1/vault/albums/media?ngsw-bypass=true",
          status: resp.statusText(),
          response: respData,
        });
      await this.page.locator("app-media-vault-picker-modal .actions > i").first().click();
      return respData.response[0]?.mediaId;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      else
        throw new BotError("upload content failed", {
          where: "FanslyBrowser::uploadContent",
          error: error.message,
          stack: error.stack,
        })
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    try {
      let postIds = [];
      let before = "0";
      let count = 0;
      while (true) {
        const resp = await this.page.request.get(`https://apiv3.fansly.com/api/v1/timelinenew/${this.profile.id}?before=${before}&after=0&contentSearch=&ngsw-bypass=true`, {
          headers: this.headers
        });
        const respData = await resp.json();
        if (!resp.ok() || !respData.success)
          throw new BotError("get home posts failed", {
            where: "FanslyBrowser::getHomePosts",
            method: "GET",
            endpoint: "https://apiv3.fansly.com/api/v1/timeline/home?before=0&after=0&mode=0&ngsw-bypass=true",
            status: resp.statusText(),
            response: await resp.text(),
          });
        const posts: IFanslyPost[] = respData.response?.posts;
        postIds.push(...posts.map(post => post.id));
        count += 1
        if (posts.length < 15 || count > 3)
          break;
        before = posts[posts.length - 1].id;
      }
      return postIds;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "FanslyBrowser::getPosts",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getPosts(): Promise<IFanslyPost[]> {
    try {
      const headers = this.headers;
      const resp = await this.page.request.get("https://apiv3.fansly.com/api/v1/timeline/home?before=0&after=0&mode=0&ngsw-bypass=true", {
        headers: headers
      });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("get home posts failed", {
          where: "FanslyBrowser::getHomePosts",
          method: "GET",
          endpoint: "https://apiv3.fansly.com/api/v1/timeline/home?before=0&after=0&mode=0&ngsw-bypass=true",
          status: resp.statusText(),
          response: await resp.text(),
        });
      return respData.response?.posts
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "FanslyBrowser::getPosts",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async commentPost(postId: string, comment: string) {
    try {
      const params = {
        "content": comment,
        "fypFlags": 0,
        "inReplyTo": postId,
        "quotedPostId": null,
        "attachments": [],
        "scheduledFor": 0,
        "expiresAt": 0,
        "postReplyPermissionFlags": [],
        "pinned": 0,
        "wallIds": []
      }
      const resp = await this.page.request.post(
        "https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true",
        {
          headers: this.headers,
          data: params
        });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("comment post failed", {
          where: "FanslyBrowser::commentPost",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true",
          params,
          status: resp.statusText(),
          response: await resp.text(),
        });
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("comment post failed", {
        where: "FanslyBrowser::commentPost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async followPost(postId: string) {
    try {
      const resp = await this.page.request.post("https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true", {
        headers: this.headers,
        data: { "postId": postId, }
      });
      const respData = await resp.json();
      if (!resp.ok() || !respData.success)
        throw new BotError("follow post failed", {
          where: "FanslyBrowser::followPost",
          method: "POST",
          endpoint: "https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true",
          status: resp.statusText(),
          response: await resp.text(),
        });
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("comment post failed", {
        where: "FanslyBrowser::commentPost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getMonthlyStats(): Promise<IFanslyStat> {
    try {
      const resp = await this.page.request.get(
        "https://apiv3.fansly.com/api/v1/account/wallets/earnings/monthlystats?ngsw-bypass=true",
        { headers: this.headers }
      )
      const respData = await resp.json();
      if (!resp.ok() || !respData.success) {
        throw new BotError("get monthly stats failed", {
          where: "FanslyBrowser::getMonthlyStats",
          method: "GET",
          endpoint: "https://apiv3.fansly.com/api/v1/post?ngsw-bypass=true",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      return respData.response[0];
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get monthly stats failed", {
        where: "FanslyBrowser::getMonthlyStats",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getChatMessages(): Promise<IFanslyMessageResult> {
    try {
      const resp = await this.page.request.get("https://apiv3.fansly.com/api/v1/messaging/groups?sortOrder=1&flags=0&subscriptionTierId=&search=&limit=20&offset=0&ngsw-bypass=true",
        { headers: this.headers }
      );
      const respData = await resp.json();
      if (!resp.ok() || !respData.success) {
        throw new BotError("get chat messages failed", {
          where: "FanslyBrowser::getChatMessages",
          method: "GET",
          endpoint: "https://apiv3.fansly.com/api/v1/messaging/groups?sortOrder=1&flags=0&subscriptionTierId=&search=&limit=20&offset=0&ngsw-bypass=true",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      return {
        data: respData.response?.data || [],
        groups: respData.response?.aggregationData?.groups || [],
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get chat messages failed", {
        where: "FanslyBrowser::getChatMessages",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  // public async getHomePosts():Promise<IFanslyPost[]> {
  //   try {
  //     const resp = await this.page.request.get("https://apiv3.fansly.com/api/v1/timeline/home", {
  //       headers: this.headers,
  //       params: { before: 0, after: 0, mode: 0, "ngsw-bypass": true },
  //     });
  //     if (!resp.ok())
  //       throw new BotError("get home info failed", {
  //         where: "FanslyBrowser::getHomeInfo",
  //         method: "GET",
  //         endpoint: "https://apiv3.fansly.com/api/v1/timeline/home",
  //         status: resp.statusText(),
  //         response: await resp.text(),
  //       });
  //     const respData = await resp.json();
  //     const posts = respData.posts || [];
  //     return posts;
  //   } catch (error: any) {
  //     if (error instanceof BotError)
  //       throw error;
  //     throw new BotError("get home info failed", {
  //       where: "FanslyBrowser::getHomeInfo",
  //       error: error.message,
  //       stack: error.stack,
  //     })
  //   }
  // }

  public async likePost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.post(`https://apiv3.fansly.com/api/v1/likes?ngsw-bypass=true`, {
        headers: this.headers,
        data: { postId }
      });
      if (!resp.ok())
        throw new BotError("like post failed", {
          where: "FanslyBrowser::likePost",
          method: "POST",
          endpoint: `https://apiv3.fansly.com/api/v1/likes?ngsw-bypass=true`,
          params: { postId },
          status: resp.statusText(),
          response: await resp.text(),
        })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("like post failed", {
        where: "FanslyBrowser::likePost",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async likeMedia(accountMediaId: string): Promise<void> {
    try {
      const resp = await this.page.request.post(`https://apiv3.fansly.com/api/v1/media/${accountMediaId}/likes?ngsw-bypass=true`, {
        headers: this.headers,
      });
      if (!resp.ok())
        throw new BotError("like media failed", {
          where: "FanslyBrowser::likeMedia",
          method: "POST",
          endpoint: `https://apiv3.fansly.com/api/v1/media/${accountMediaId}/likes?ngsw-bypass=true`,
          status: resp.statusText(),
          response: await resp.text(),
        })
    } catch (error: any) {
      // if (error instanceof BotError)
      //   throw error;
      // throw new BotError("like media failed", {
      //   where: "FanslyBrowser::likeMedia",
      //   error: error.message,
      //   stack: error.stack,
      // })
    }
  }

  public async getFollowings(): Promise<IFanslyAccount[]> {
    try {
      const resp = await this.page.request.get("https://apiv3.fansly.com/api/v1/timeline/home", {
        headers: this.headers,
        params: { before: 0, after: 0, mode: 0, "ngsw-bypass": true },
      });
      if (!resp.ok())
        throw new BotError("get followings failed", {
          where: "FanslyBrowser::getFollowings",
          method: "GET",
          endpoint: "https://apiv3.fansly.com/api/v1/timeline/home",
          status: resp.statusText(),
          response: await resp.text(),
        });
      const respData = await resp.json();
      const accounts = respData.response?.accounts || [];
      return accounts;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get followings failed", {
        where: "FanslyBrowser::getFollowings",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async deleteSchedule(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.post(`https://apiv3.fansly.com/api/v1/post/scheduled/${postId}/cancel?ngsw-bypass=true`, {
        headers: this.headers
      });
      if (!resp.ok())
        throw new BotError("delete schedule failed", {
          where: "FanslyBrowser::deleteSchedule",
          method: "POST",
          endpoint: `https://apiv3.fansly.com/api/v1/post/scheduled/${postId}/cancel?ngsw-bypass=true`,
          status: resp.statusText(),
          response: await resp.text(),
        })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete schedule failed", {
        where: "FanslyBrowser::deleteSchedule",
        error: error.message,
        stack: error.stack,
      })
    }
  }
}
