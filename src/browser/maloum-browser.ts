import moment from "moment";
import fs from "fs";
import { HttpStatusCode } from "axios";
import { AuthError, BotError, ProxyError, SessionTimeoutError, } from "../utils/error";
import { POST_LIMITED, PostType } from "../types/constant";
import { IAccountID, IAccountSettings, IBotConfig, IChatMessage, } from "../types/interface";
import { IMaloumChat, IMaloumFolder, IMaloumMediaInfo, IMaloumPost, IMaloumProfile, } from "../types/maloum";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";

interface IMaloumTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
}

export class MaloumBrowser extends BaseBrowser {
  protected captchaSolved: boolean;
  protected profile!: IMaloumProfile;

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger);
    this.captchaSolved = false;
  }

  public async home(): Promise<void> {
    try {
      await this.page.route(
        /https:\/\/challenges\.cloudflare\.com\/turnstile\/.+\/api.js/,
        async (route) => {
          this.logger.info("install captcha solver");
          const response = await route.fetch();
          const body = fs.readFileSync("./data/maloum.dat");
          route.fulfill({
            response, body: body, headers: response.headers(),
          });
        },
      );
      // Track last captcha solve time to avoid rapid solving
      let lastCaptchaSolveTime = 0;

      this.page.on("console", async (msg) => {
        if (msg.text().includes("intercepted-params:")) {
          // Cooldown: only solve captcha once per 30 seconds
          const now = Date.now();
          if (now - lastCaptchaSolveTime < 30000) {
            this.logger.info("captcha solve skipped (cooldown active)");
            return;
          }
          lastCaptchaSolveTime = now;
          this.logger.info("solving captcha...");
          this.captchaSolved = false;
          const params = JSON.parse(
            msg.text().replace("intercepted-params:", ""),
          );
          this.logger.info(`captcha params: pageurl=${params.pageurl}, sitekey=${params.sitekey}, action=${params.action}, data=${params.data}, pagedata=${params.pagedata}`);
          try {
            // Build params object with all available data
            const solverParams: any = {
              pageurl: params.pageurl,
              sitekey: params.sitekey,
            };
            if (params.action) solverParams.action = params.action;
            if (params.data) solverParams.data = params.data;
            if (params.pagedata) solverParams.pagedata = params.pagedata;

            const res = await this.solver.cloudflareTurnstile(solverParams);
            this.logger.info(`solve captcha... token length: ${res.data?.length || 0}`);

            // Try multiple methods to inject the token
            try {
              const injectionResult = await this.page.evaluate((token) => {
                const results: string[] = [];

                // Method 1: Call cfCallback
                if (typeof window.cfCallback === 'function') {
                  window.cfCallback(token);
                  results.push('cfCallback called');
                } else {
                  results.push('cfCallback not found');
                }

                // Method 2: Set turnstile response input if exists
                const turnstileInput = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;
                if (turnstileInput) {
                  turnstileInput.value = token;
                  results.push('turnstile input set');
                }

                // Method 3: Look for any form with turnstile and submit
                const forms = document.querySelectorAll('form');
                forms.forEach((form, i) => {
                  const cfInput = form.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;
                  if (cfInput) {
                    cfInput.value = token;
                    results.push(`form ${i} turnstile input set`);
                  }
                });

                // Method 4: Check for turnstile widget and try to trigger complete
                const widgets = document.querySelectorAll('[data-widget-id]');
                if (widgets.length > 0) {
                  results.push(`found ${widgets.length} turnstile widgets`);
                }

                return results.join(', ');
              }, res.data);

              this.captchaSolved = true;
              this.logger.info(`captcha token injected: ${injectionResult}`);
            } catch (injectError: any) {
              this.logger.info(`captcha token injection failed: ${injectError.message}`);
              // Still mark as solved since we have the token
              this.captchaSolved = true;
            }
          } catch (captchaError: any) {
            this.logger.info(`captcha solve failed: ${captchaError.message}`);
            this.captchaSolved = false;
            // Don't throw - let the operation fail naturally due to page not loading
          }
        }
      });

      await this.page.goto("https://maloum.com/", { waitUntil: "domcontentloaded", timeout: 60000, });
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "MaloumBrowser::home",
        message: error.message,
      });
    }
  }

  public async afterHome(): Promise<void> {
    await this.closeConsentModal();
  }

  private async closeConsentModal() {
    try {
      await this.page.locator("div#cmpbox span#cmpwelcomebtnyes > a.cmpboxbtnyes ").first().click({ timeout: 10000 });
      this.logger.info("close consent modal");
    } catch (error: any) { }
  }

  public async refreshSession(): Promise<void> {
    try {
      const mePromise = this.page.waitForResponse(
        "https://api.maloum.com/users/current",
        { timeout: 120000 },
      );
      await this.page.goto("https://app.maloum.com/", { timeout: 600000 });
      const meResp = await mePromise;
      this.headers = await meResp.request().allHeaders();
    } catch (error: any) {
      throw new BotError("refresh session failed", {
        where: "MaloumBrowser::refreshSession",
        message: error.message,
      });
    }
  }

  // set content filter
  protected async setFilter() {
    // filter images
    // await this.context.route(
    //   /(\.png(\?.*)?$)|(\.jpg(\?.*)?$)|(\.webp(\?.*)?$)|(\.jpeg(\?.*)?$)|(blob(.*)?$)/,
    //   (route) => route.abort()
    // );
    // filter google analytics
    await this.context.route(
      /https:\/\/www\.google-analytics\.com\/.*/,
      (route) => route.abort(),
    );
    // set token filter
    this.page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes(
          "https://srswgacczfgjttwdpuia.supabase.co/auth/v1/token",
        ) &&
        response.request().method() == "POST" &&
        response.status() == 200
      ) {
        const respData: IMaloumTokenResponse = await response.json(); // get response body as Buffer
        this.headers["Authorization"] = `Bearer ${respData.access_token}`;
        this.logger.info("refresh access token");
      }
    });
  }

  public async login(
    setting: IAccountSettings,
  ): Promise<IAccountID | undefined> {
    try {
      // go to login page
      await this.page.goto("https://app.maloum.com/login?returnPath=/", { waitUntil: "domcontentloaded", timeout: 60000, });
      this.closeConsentModal();
      // input email and password
      await this.page.locator("form input[name='usernameOrEmail']").waitFor();
      await this.page.locator("form input[name='usernameOrEmail']").first().fill(setting.email);
      await this.page.locator("form input[name='password']").first().fill(setting.password);

      const loginPromise = this.page.waitForResponse("https://api.maloum.com/user-management/login", { timeout: 60000 });
      // click sign-in button
      await this.page.locator("form button", { hasText: "Login" }).first().click();
      const loginResp = await loginPromise;

      const loginBody = await loginResp.text();
      if (loginResp.status() == HttpStatusCode.Unauthorized)
        throw new AuthError("wrong credentials", {
          where: "MaloumBrowser::login",
          response: loginBody.substring(0, 500),
        });

      let loginData;
      try {
        loginData = JSON.parse(loginBody);
      } catch {
        throw new BotError("login failed", {
          where: "MaloumBrowser::login",
          response: loginBody.substring(0, 500),
        });
      }

      if (!loginData.accessToken) {
        throw new BotError("login failed", {
          where: "MaloumBrowser::login",
          response: loginBody.substring(0, 500),
        });
      }

      this.logger.info("login API success");

      // Store token in headers
      this.headers["Authorization"] = `Bearer ${loginData.accessToken}`;

      // Parse JWT to get user info
      const jwtParts = loginData.accessToken.split(".");
      const payloadJson = Buffer.from(jwtParts[1], "base64").toString("utf-8");
      const jwt = JSON.parse(payloadJson);

      this.profile = {
        _id: jwt.app_metadata?.userId || jwt.sub,
        username: jwt.app_metadata?.username || jwt.email?.split("@")[0],
        email: jwt.email,
        isCreator: jwt.app_metadata?.roles?.includes("creator"),
        hasCompletedSetup: true,
        isAgeVerified: true,
        isTrusted: true,
        isVerified: true,
        language: "en",
        madeProductPurchase: false,
        madeProductSale: false,
        needsAgeVerification: false,
        registeredAt: new Date().toISOString(),
        subscriptionPrice: 0,
      };

      this.logger.info(`user: ${this.profile.username}, isCreator: ${this.profile.isCreator}`);

      if (!this.profile.isCreator)
        throw new AuthError("not creator account", { where: "MaloumBrowser::login" });

      // Set tokens in localStorage to establish session for app.maloum.com
      this.logger.info("injecting auth token into localStorage...");
      try {
        await this.page.evaluate((tokenData) => {
          // Supabase auth token storage format
          const supabaseKey = 'sb-srswgacczfgjttwdpuia-auth-token';
          const authData = {
            access_token: tokenData.accessToken,
            refresh_token: tokenData.refreshToken || '',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: tokenData.userId,
              email: tokenData.email,
              app_metadata: { roles: ['creator'], userId: tokenData.userId }
            }
          };
          localStorage.setItem(supabaseKey, JSON.stringify(authData));
        }, {
          accessToken: loginData.accessToken,
          refreshToken: loginData.refreshToken || '',
          userId: this.profile._id,
          email: this.profile.email
        });
        this.logger.info("auth token injected into localStorage");
      } catch (e: any) {
        this.logger.info("failed to inject token: " + e.message);
      }
      // Stay on maloum.com domain to maintain context for API requests
      // (about:blank can break page.request context)
      this.logger.info("stabilizing session...");
      try {
        // Just wait for page to settle instead of navigating away
        await this.page.waitForTimeout(2000);
      } catch (e: any) {
        // Ignore errors
      }

      // Wait for initial Cloudflare challenge to be solved
      this.logger.info("waiting for captcha to be solved...");
      const startWait = Date.now();
      const maxWaitTime = 60000; // 60 seconds max wait
      while (!this.captchaSolved && (Date.now() - startWait) < maxWaitTime) {
        await this.page.waitForTimeout(1000);
        if ((Date.now() - startWait) % 5000 < 1000) {
          this.logger.info(`still waiting for captcha... (${Math.floor((Date.now() - startWait) / 1000)}s)`);
        }
      }

      if (this.captchaSolved) {
        this.logger.info("captcha solved, waiting for Cloudflare validation...");
        try {
          // Wait for Cloudflare to validate and clear the challenge
          await this.page.waitForTimeout(5000);

          // Check if challenge is still present
          let challengeCleared = false;
          for (let i = 0; i < 10; i++) {
            const pageContent = await this.page.content();
            if (!pageContent.includes("turnstile") && !pageContent.includes("challenge-platform")) {
              challengeCleared = true;
              this.logger.info("Cloudflare challenge cleared");
              break;
            }
            this.logger.info("waiting for Cloudflare validation... (" + (i + 1) + ")");
            await this.page.waitForTimeout(2000);
          }

          if (!challengeCleared) {
            this.logger.info("Cloudflare still showing challenge, reloading...");
            await this.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
            await this.page.waitForTimeout(5000);
          }

          this.logger.info("session ready");
        } catch (reloadErr: any) {
          this.logger.info("session setup failed: " + reloadErr.message);
        }
      } else {
        this.logger.info("captcha not solved within timeout, proceeding anyway");
      }

      return { alias: this.profile.username, id: this.profile._id };
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("login failed", {
        where: "MaloumBrowser::login",
        message: error.message,
      });
    }
  }

  public async getFolder(folderName: string): Promise<IMaloumFolder> {
    try {
      let folder;
      // find folder
      const resp = await this.page.request.get("https://api.maloum.com/vault/folders", { headers: this.headers, params: { limit: 15 }, });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getFolder",
          });
        throw new BotError("get folders failed", {
          where: "MaloumBrowser::getFolder",
          method: "GET",
          endpoint: "https://api.maloum.com/vault/folders",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      const folders: IMaloumFolder[] = respData.data || [];
      folder = folders.find((item) => item.name.toLowerCase() == folderName.toLowerCase());
      if (folder)
        return folder;
      const resp1 = await this.page.request.post("https://api.maloum.com/vault/folders",
        { headers: this.headers, data: { name: folderName } },
      );
      if (!resp1.ok()) {
        if (resp1.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getFolder",
          });
        throw new BotError("create folder failed", {
          where: "MaloumBrowser::getFolder",
          method: "POST",
          endpoint: "https://api.maloum.com/vault/folders",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      folder = await resp1.json();
      return folder;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get folder failed", {
        where: "MaloumBrowser::getFolder",
        message: error.message,
      });
    }
  }

  public async deleteFolder(folderId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(
        `https://api.maloum.com/vault/folders/${folderId}`,
        {
          headers: this.headers,
          params: { deleteMedia: false },
        },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::deleteFolder",
          });
        throw new BotError("delete folder failed", {
          where: "MaloumBrowser::deleteFolder",
          method: "DELETE",
          endpoint: `https://api.maloum.com/vault/folders/${folderId}`,
          params: { deleteMedia: false },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete folder failed", {
        where: "MaloumBrowser::deleteFolder",
        message: error.message,
      });
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    try {
      // install get posts hook
      await this.page.route(
        /https:\/\/api\.maloum\.com\/posts\/me\?.*/,
        async (route) => {
          await this.page.unroute(/https:\/\/api\.maloum\.com\/posts\/me\?.*/);
          await route.continue({
            url: "https://api.maloum.com/posts/me?limit=30",
          });
        },
      );
      const mePromise = this.page.waitForResponse(
        /https:\/\/api\.maloum\.com\/posts\/me\?.*/,
      );
      // go to account page
      await this.page.goto(
        `https://app.maloum.com/creator/${this.profile.username}`,
        { waitUntil: "domcontentloaded" },
      );
      const meResp = await mePromise;
      if (!meResp.ok())
        throw new BotError("get posts failed", {
          where: "MaloumBrowser::getPosts",
          method: "GET",
          endpoint: meResp.request().url(),
          status: meResp.statusText(),
          response: await meResp.text(),
        });
      const meData = await meResp.json();
      const posts: IMaloumPost[] = meData.data || [];
      return posts
        .filter(
          (post) =>
            moment().isAfter(post.publishedAt) &&
            post.categories.findIndex((cat) => cat.name == "public") >= 0 &&
            post.public,
        )
        .map((post) => post._id);
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get posts failed", {
        where: "MaloumBrowser::getSelfPosts",
        message: error.message,
      });
    }
  }

  public async getSelfFreePosts(): Promise<string[]> {
    try {
      // Use direct API call with authorization token
      const resp = await this.page.request.get(
        "https://api.maloum.com/posts/me?limit=30",
        {
          headers: this.headers,
        }
      );

      if (!resp.ok()) {
        this.logger.info(`getSelfFreePosts failed: ${resp.status()}`);
        return [];
      }

      const meData = await resp.json();
      const posts: IMaloumPost[] = meData.data || [];
      return posts
        .filter(
          (post) =>
            moment().isAfter(post.publishedAt) &&
            post.categories.findIndex((cat) => cat.name == "public") >= 0 &&
            post.public,
        )
        .map((post) => post._id);
    } catch (error: any) {
      this.logger.info(`getSelfFreePosts error: ${error.message}`);
      return [];
    }
  }

  public async getRecentPosts(page: number = 0): Promise<IMaloumPost[]> {
    try {
      const resp = await this.page.request.get(
        "https://api.maloum.com/content/discovery",
        {
          headers: this.headers,
          params: { next: page * 30, limit: 30 },
        },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getRecentPosts",
          });
        throw new BotError("get recent posts failed", {
          where: "MaloumBrowser::getRecentPosts",
          method: "GET",
          endpoint: "https://api.maloum.com/content/discovery",
          params: { next: page * 30, limit: 30 },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      return respData.data;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get posts failed", {
        where: "MaloumBrowser::getRecentPosts",
        message: error.message,
      });
    }
  }

  public async findMediaInFolder(
    folder: IMaloumFolder,
    mediaId: string,
  ): Promise<string | undefined> {
    try {
      const resp = await this.page.request.get(
        `https://api.maloum.com/vault/folders/${folder._id}/media`,
        {
          headers: this.headers,
          params: { limit: 50 },
        },
      );
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::findMediaInFolder",
          });
        throw new BotError("find media failed", {
          where: "MaloumBrowser::findMediaInFolder",
          method: "GET",
          endpoint: `https://api.maloum.com/vault/folders/${folder._id}/media`,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      const items: IMaloumMediaInfo[] = respData.data || [];
      const result = items.find((item) => item.media?.uploadId == mediaId);
      return result ? result.media.uploadId : undefined;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("find media failed", {
        where: "MaloumBrowser::findMediaInFolder",
        message: error.message,
      });
    }
  }

  public async deletePost(postId: string): Promise<void> {
    try {
      // install get posts hook
      await this.page.route(
        /https:\/\/api\.maloum\.com\/posts\/[0-9a-fA-F]{24}/,
        async (route) => {
          await this.page.unroute(
            /https:\/\/api\.maloum\.com\/posts\[0-9a-fA-F]{24}/,
          );
          await route.continue({
            url: `https://api.maloum.com/posts/${postId}`,
          });
        },
      );
      const deletePromise = this.page.waitForResponse(
        /https:\/\/api\.maloum\.com\/posts\/[0-9a-fA-F]{24}/,
        {
          timeout: 5000,
        },
      );
      // click first post delete button
      await this.page
        .locator("button[data-testid='modify-item']")
        .first()
        .click();
      await this.page.locator("div[data-testid='delete-post']").first().click();
      await this.page
        .locator("div[data-testid='confirm-delete-post']")
        .first()
        .click();
      const deleteResp = await deletePromise;
      if (!deleteResp.ok())
        throw new BotError("delete post failed", {
          where: "MaloumBrowser::deletePost",
          method: "GET",
          endpoint: deleteResp.request().url(),
          status: deleteResp.statusText(),
          response: await deleteResp.text(),
        });
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete post failed", {
        where: "MaloumBrowser::deletePost",
        message: error.message,
      });
    }
  }

  public async followPost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.post(
        `https://api.maloum.com/posts/${postId}/like`,
        {
          headers: this.headers,
        },
      );
      if (!resp.ok()) {
        if (resp.status() == 401)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::followPost",
          });
        else
          throw new BotError("follow post failed", {
            where: "MaloumBrowser::followPost",
            method: "POST",
            endpoint: `https://api.maloum.com/posts/${postId}/like`,
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("follow post failed", {
        where: "MaloumBrowser::followPost",
        message: error.message,
      });
    }
  }

  public async commentPost(postId: string, text: string): Promise<void> {
    try {
      const resp = await this.page.request.post(
        `https://api.maloum.com/posts/${postId}/comments`,
        {
          headers: this.headers,
          data: { text },
        },
      );
      if (!resp.ok()) {
        if (resp.status() == 401)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::commentPost",
          });
        else
          throw new BotError("comment post failed", {
            where: "MaloumBrowser::commentPost",
            method: "POST",
            endpoint: `https://api.maloum.com/posts/${postId}/comments`,
            params: { text },
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("comment post failed", {
        where: "MaloumBrowser::commentPost",
        message: error.message,
      });
    }
  }

  public async getUnreadChats(): Promise<IChatMessage[]> {
    try {
      const resp = await this.page.request.get("https://api.maloum.com/chats", {
        headers: this.headers,
        params: { filter: "unread", limit: 15 },
      });
      const respData = await resp.json();
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getUnreadChats",
          });
        else
          throw new BotError("get unread chats failed", {
            where: "MaloumBrowser::commentPost",
            method: "GET",
            endpoint: `https://api.maloum.com/chats?filter=unread`,
            status: resp.statusText(),
            response: await resp.text(),
          });
      }
      const chats: IMaloumChat[] = respData.data || [];
      return chats
        .map((chat) => ({
          user: chat.chatPartner.username,
          message: chat.lastRelevantMessage.text,
          time: new Date(chat.lastRelevantMessage.sentAt),
        }))
        .filter((chat) => chat.user != "maloum.official");
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get chats failed", {
        where: "MaloumBrowser::getUnreadChats",
        message: error.message,
      });
    }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      this.logger.info("getting monthly earnings...");
      // Use direct API call to avoid page navigation and Cloudflare
      const resp = await this.page.request.get(
        "https://api.maloum.com/users/balance",
        { headers: this.headers, timeout: 30000 }
      );

      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "MaloumBrowser::getMonthlyEarnings",
          });
        // For other errors, just return 0 to avoid crashing
        this.logger.info(`getMonthlyEarnings failed: ${resp.status()}`);
        return 0;
      }

      const respData = await resp.json();
      this.logger.info(`earnings: ${respData.balance?.payoutAmount || 0}`);
      return respData.balance?.payoutAmount || 0;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      this.logger.info(`getMonthlyEarnings error: ${error.message}`);
      return 0;  // Return 0 instead of throwing to avoid breaking the bot
    }
  }

  public async schedulePost(
    scheduledAt: Date,
    title: string,
    tags: string[],
    mediaIds: string[],
    type?: number,
  ): Promise<void> {
    try {
      let free = true;
      if (type == PostType.FANS || type == PostType.PAID) free = false;
      // --- go to create post page
      await this.page.goto("https://app.maloum.com/post/create");
      // --- set media for post
      // click add media button
      await this.page
        .locator("form button", { hasText: "Add media" })
        .first()
        .click();
      await this.waitAndLog(1000, "add media click");
      // select all medias folder
      await this.page.locator("div[title='All media']").first().click();
      // select first image
      await this.page
        .locator("div#rightColumn > div > div > div > div.grid > div")
        .first()
        .locator("button")
        .last()
        .click();

      // click next button
      await this.page
        .locator("div#rightColumn button", { hasText: "Next" })
        .first()
        .click();
      await this.waitAndLog(1000, "select first image");
      // set post title
      await this.page.locator("textarea[name='caption']").first().fill(title);
      await this.waitAndLog(1000, "set post title");
      // select category
      await this.page
        .locator("div[data-testid='select-categories-button']")
        .first()
        .click();
      await this.waitAndLog(1000, "select category");
      await this.page.locator("input").last().fill("Boots");
      await this.page.locator("button", { hasText: "Boots" }).first().click();
      await this.page.locator("button", { hasText: "Save" }).first().click();
      await this.waitAndLog(1000, "set category public");
      // install request hook
      await this.page.route("https://api.maloum.com/posts", async (route) => {
        const postData = route.request().postDataJSON();
        await this.page.unroute("https://api.maloum.com/posts");
        await route.continue({
          postData: {
            ...postData,
            public: free,
            mediaIds: mediaIds,
            scheduledAt: moment().isAfter(scheduledAt, "hour")
              ? moment().add(1, "hour").utc().toISOString()
              : moment(scheduledAt).utc().toISOString(),
          },
        });
      });
      const respPromise = this.page.waitForResponse(
        "https://api.maloum.com/posts",
      );
      // click publish button
      await this.page
        .locator("button[data-testid='create-post-button']")
        .first()
        .click();
      const resp = await respPromise;
      if (!resp.ok()) {
        throw new BotError("schedule post failed", {
          where: "MaloumBrowser::schedulePost",
          method: "POST",
          endpoint: "https://api.maloum.com/posts",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("schedule post failed", {
        where: "MaloumBrowser::schedulePost",
        message: error.message,
      });
    }
  }

  public async publishPost(
    title: string,
    tags: string[],
    mediaId: string,
    type?: number,
  ): Promise<string> {
    try {
      let free = true;
      if (type == PostType.FANS || type == PostType.PAID) free = false;
      // --- go to create post page
      await this.page.goto("https://app.maloum.com/post/create");
      // --- set media for post
      // click add media button
      await this.page
        .locator("form button", { hasText: "Add media" })
        .first()
        .click();
      await this.waitAndLog(1000, "add media click");
      // select all medias folder
      await this.page.locator("div[title='All media']").first().click();
      // select first image
      await this.page
        .locator("div#rightColumn > div > div > div > div.grid > div")
        .first()
        .locator("button")
        .last()
        .click();

      // click next button
      await this.page
        .locator("div#rightColumn button", { hasText: "Next" })
        .first()
        .click();
      await this.waitAndLog(1000, "select first image");
      // set post title
      await this.page.locator("textarea[name='caption']").first().fill(title);
      await this.waitAndLog(1000, "set post title");
      // select category
      await this.page
        .locator("div[data-testid='select-categories-button']")
        .first()
        .click();
      await this.waitAndLog(1000, "select category");
      await this.page.locator("input").last().fill("Public");
      await this.page.locator("button", { hasText: "Public" }).first().click();
      await this.page.locator("button", { hasText: "Save" }).first().click();
      await this.waitAndLog(1000, "set category public");
      // install request hook
      await this.page.route("https://api.maloum.com/posts", async (route) => {
        const postData = route.request().postDataJSON();
        await this.page.unroute("https://api.maloum.com/posts");
        await route.continue({
          postData: {
            ...postData,
            public: free,
            mediaIds: [mediaId],
          },
        });
      });
      const respPromise = this.page.waitForResponse(
        "https://api.maloum.com/posts",
      );
      // click publish button
      await this.page
        .locator("button[data-testid='create-post-button']")
        .first()
        .click();
      const resp = await respPromise;
      if (!resp.ok()) {
        const respData = await resp.json();
        if (respData.statusCode == 429) return POST_LIMITED;
        throw new BotError("publish post failed", {
          where: "MaloumBrowser::publishPost",
          method: "POST",
          endpoint: "https://api.maloum.com/posts",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      return "";
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("publish post failed", {
        where: "MaloumBrowser::publishPost",
        message: error.message,
      });
    }
  }

  public async verifyPostVisibility(postId: string, postType: number) {
    try {
      const resp = await this.page.request.fetch(`https://api.maloum.com/posts/${postId}`, {
        headers: { 'Accept': 'application/json', },
      });
      if (!resp.ok()) {
        return { verified: false, actual: 'not_found', expected: postType === PostType.FREE ? 'public' : 'paid' };
      }
      const postData = await resp.json();
      const isPublic = postData.public === true;
      const expected = postType === PostType.FREE ? 'public' : 'paid';
      const actual = isPublic ? 'public' : 'paid';
      return {
        verified: actual === expected,
        actual: actual,
        expected: expected,
      };
    } catch (error: any) {
      return { verified: false, actual: 'error: ' + error.message, expected: postType === PostType.FREE ? 'public' : 'paid' };
    }
  }

  public async uploadMediaInFolder(folder: string, image: string,): Promise<string> {
    try {
      // First check if the browser/page is still valid
      try {
        const testUrl = this.page.url();
        if (!testUrl) {
          this.logger.info("Browser page invalid - skipping upload");
          return "";
        }
      } catch (e: any) {
        this.logger.info("Browser context closed - skipping upload: " + e.message);
        return "";
      }

      // Try to navigate to vault - if it fails, skip upload
      try {
        // Reset captcha flag for vault navigation
        this.captchaSolved = false;

        // First check if we're already on vault page
        const currentUrl = this.page.url();
        if (!currentUrl.includes("/vault")) {
          this.logger.info("Vault navigation URL: " + currentUrl + " -> https://app.maloum.com/vault");

          // Navigate with domcontentloaded (faster) and handle interruption
          try {
            await this.page.goto("https://app.maloum.com/vault", {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
          } catch (navErr: any) {
            // Handle navigation interruption (e.g. Cloudflare redirect)
            if (navErr.message.includes("interrupted by another navigation")) {
              this.logger.info("Navigation interrupted - waiting for page to settle...");
              await this.page.waitForTimeout(5000);
            } else {
              throw navErr;
            }
          }
        }

        // Wait for page to stabilize
        await this.page.waitForTimeout(3000);

        // Wait for Cloudflare challenge to be cleared
        const startWait = Date.now();
        const maxWait = 45000;
        while ((Date.now() - startWait) < maxWait) {
          try {
            const pageContent = await this.page.content();
            // Check if challenge is gone (no turnstile iframe or challenge text)
            const hasTurnstile = pageContent.includes("turnstile") ||
              pageContent.includes("cf-turnstile") ||
              pageContent.includes("challenge-platform");
            if (!hasTurnstile) {
              this.logger.info("Cloudflare challenge cleared");
              break;
            }
            this.logger.info("waiting for Cloudflare to clear...");
            await this.page.waitForTimeout(3000);
          } catch (e: any) {
            this.logger.info("Page content check failed: " + e.message);
            break;
          }
        }

        const url = this.page.url();
        this.logger.info(`Vault navigation URL: ${url}`);

        // Check if we're on login page (session not valid)
        if (url.includes("/login")) {
          this.logger.info("Redirected to login - session not established");
          return "";
        }

        // Check if we actually reached vault
        if (!url.includes("/vault")) {
          this.logger.info("Vault page not reachable, skipping upload");
          return "";
        }

        // Wait for vault UI to load (check for folder search or any content)
        try {
          await this.page.waitForSelector("div#leftColumn", { timeout: 30000 });
          this.logger.info("Vault UI loaded successfully");
          // Wait for page to stabilize after captcha resolution
          await this.page.waitForTimeout(5000);
        } catch (e: any) {
          this.logger.info("Vault UI not loading - might be Cloudflare challenge");
          // Take screenshot for debug
          const pageContent = await this.page.content();
          if (pageContent.includes("turnstile") || pageContent.includes("challenge")) {
            this.logger.info("Cloudflare challenge detected on vault page");
          }
          return "";
        }
      } catch (e: any) {
        this.logger.info(`Vault navigation blocked by Cloudflare: ${e.message}`);
        // Go back to app home to keep browser alive
        try {
          await this.page.goto("https://app.maloum.com/", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
        } catch { }
        return "";
      }
      // search folder
      this.logger.info("searching for folder: " + folder);
      try {
        await this.page
          .locator("div#leftColumn input[placeholder='Search for folder']")
          .first()
          .fill(folder.toLocaleLowerCase());
        await this.wait(3000);
        this.logger.info("folder search completed");
      } catch (searchErr: any) {
        this.logger.info("folder search error: " + searchErr.message);
        throw searchErr;
      }
      const count = await this.page
        .locator("div#leftColumn div.truncate")
        .count();
      // if not find folder, create folder
      if (count == 0) {
        await this.page
          .locator("div#leftColumn button", {
            hasText: "New folder",
          })
          .first()
          .click();
        await this.page
          .locator("div[role='dialog'] form input[name='folderName']")
          .first()
          .fill(folder);
        await this.page
          .locator("div[role='dialog'] form button", {
            hasText: "Create folder",
          })
          .first()
          .click();
        await this.wait(500);
      } else {
        // if not match, create folder, or if match select folder
        const searchedFolder: string =
          (await this.page
            .locator("div#leftColumn div.truncate")
            .first()
            .textContent()) || "";
        if (searchedFolder.toLocaleLowerCase() != folder.toLocaleLowerCase()) {
          await this.page
            .locator("div#leftColumn button", {
              hasText: "New folder",
            })
            .first()
            .click();
          await this.page
            .locator("div[role='dialog'] form input[name='folderName']")
            .first()
            .fill(folder);
          await this.page
            .locator("div[role='dialog'] form button", {
              hasText: "Create folder",
            })
            .first()
            .click();
          await this.wait(500);
        } else {
          this.logger.info("clicking on folder: " + searchedFolder);
          await this.page
            .locator("div#leftColumn div.truncate")
            .first()
            .click();
          // Wait for the right panel to update with folder contents
          await this.page.waitForTimeout(2000);
        }
      }

      // Wait for file input to appear (folder selection should trigger this)
      this.logger.info("waiting for upload UI to load...");

      // Check if a HeadlessUI modal opened after clicking folder
      const modalOpen = await this.page.locator("[data-headlessui-state='open']").count() > 0;
      this.logger.info(`modal detected: ${modalOpen}`);

      if (modalOpen) {
        // Close the modal first by pressing Escape
        this.logger.info("closing modal to access vault directly...");
        await this.page.keyboard.press("Escape");
        await this.page.waitForTimeout(1000);
      }

      // Wait for vault UI to stabilize
      await this.page.waitForTimeout(2000);

      this.logger.info("setting up upload listeners...");
      // create api response listener with shorter timeout
      const uploadPromise = this.page.waitForResponse(
        (response) => {
          return (
            response
              .url()
              .includes("https://api.maloum.com/uploads/generate-upload-url") &&
            response.request().method() === "POST"
          );
        },
        { timeout: 90000 },  // 1.5 minute timeout
      );
      const completePromise = this.page.waitForResponse(
        (response) =>
          response.url().includes("https://api.maloum.com/vault/folders/"),
        { timeout: 180000 },  // 3 minutes
      );
      // upload image using direct file input method
      this.logger.info("uploading file: " + image);
      try {
        // Find all file inputs
        const fileInput = this.page.locator("input[type='file']").first();
        const fileInputCount = await fileInput.count();
        this.logger.info("file inputs found: " + fileInputCount);

        if (fileInputCount === 0) {
          throw new Error("No file input found on page");
        }

        // Set files directly on the input using Playwright's setInputFiles
        this.logger.info("setting file on input...");
        await fileInput.setInputFiles(image);
        this.logger.info("file set on input");

        // For React file inputs, we need to ensure the component processes the file
        // Dispatch both change and input events with proper bubbling
        const dispatchResult = await this.page.evaluate(() => {
          const input = document.querySelector('input[type="file"]') as HTMLInputElement;
          if (!input || !input.files || input.files.length === 0) {
            return "no file in input after setInputFiles";
          }

          const fileName = input.files[0].name;
          const fileSize = input.files[0].size;

          // Create and dispatch events that React listens for
          const nativeInputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true
          });
          input.dispatchEvent(nativeInputEvent);

          const nativeChangeEvent = new Event('change', {
            bubbles: true,
            cancelable: true
          });
          input.dispatchEvent(nativeChangeEvent);

          // Also try to trigger React's onChange via descriptor
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          );
          // For file inputs, we can't set value, but the files property should be set

          return `events dispatched for ${fileName} (${fileSize} bytes)`;
        });
        this.logger.info("dispatch result: " + dispatchResult);

        // Wait for the upload to be triggered
        this.logger.info("waiting for upload API call...");
        await this.page.waitForTimeout(5000);
      } catch (fileErr: any) {
        this.logger.info("file input error: " + fileErr.message);
        throw fileErr;
      }
      const uploadResp = await uploadPromise;
      if (!uploadResp.ok()) {
        throw new BotError("upload media failed", {
          where: "MaloumBrowser::uploadMediaInFolder",
          method: "POST",
          endpoint: `https://api.maloum.com/uploads/generate-upload-url`,
          status: uploadResp.statusText(),
          response: await uploadResp.text(),
        });
      }
      const uploadData = await uploadResp.json();
      await completePromise;
      await this.page.waitForTimeout(10000);
      return uploadData.id;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("upload media failed", {
        where: "MaloumBrowser::uploadMediaInFolder",
        message: error.message,
      });
    }
  }
}
