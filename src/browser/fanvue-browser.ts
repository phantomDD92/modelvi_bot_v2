import moment from "moment";
import fs from "fs";
import { AuthError, BotError, ProxyError } from "../utils/error";
import {
  IFanvueChat,
  IFanvueEarning,
  IFanvueFolder,
  IFanvuePost,
  IFanvueProfile,
  IFanvueVault,
} from "../types/fanvue";
import {
  IAccountID,
  IAccountSettings,
  IBotConfig,
  IChatMessage,
} from "../types/interface";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "./base-browser";
import { format, toZonedTime } from "date-fns-tz";
import { PostType } from "../types/constant";
declare global {
  interface Window {
    cfCallback?: (token: any) => void; // or appropriate function signature
  }
}

export class FanvueBrowser extends BaseBrowser {
  public profile!: IFanvueProfile;
  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger);
  }

  protected async setFilter(): Promise<void> {
    await super.setFilter();
    //media.fanvue.com/public/1598a279-a18c-4f23-a51b-03399db3089d/blurred-images/9685a1c3-5d04-478c-b1f7-485946ea9cb8
    https: await this.context.route(
      /https:\/\/media\.fanvue\.com\/.*/,
      (route) =>
        route.request().method() == "GET" ? route.abort() : route.continue()
    );
  }

  public async home(): Promise<void> {
    try {
      await this.page.route(/.+\.js/, async (route) => {
        if (
          route
            .request()
            .url()
            .includes("https://challenges.cloudflare.com/turnstile/v0/api.js")
        ) {
          this.logger.info("install captcha solver");
          const response = await route.fetch();
          const body = fs.readFileSync("./data/fanvue.dat");
          route.fulfill({
            response,
            body: body,
            headers: response.headers(),
          });
        } else {
          route.continue();
        }
      });
      this.page.on("console", async (msg) => {
        if (msg.text().includes("intercepted-params:")) {
          const params = JSON.parse(
            msg.text().replace("intercepted-params:", "")
          );
          const res = await this.solver.cloudflareTurnstile({
            pageurl: params.pageurl,
            sitekey: params.sitekey,
            action: params.action,
          });
          this.logger.info("solve captcha...");
          await this.page.evaluate((token) => {
            window.cfCallback?.(token);
          }, res.data);
        }
      });
      await this.page.goto("https://www.fanvue.com/", {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "FanvueBrowser::home",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async login(
    setting: IAccountSettings
  ): Promise<IAccountID | undefined> {
    try {
      // goto signin page
      await this.page.goto("https://www.fanvue.com/signin", {
        timeout: 120000,
      });
      // set email and password
      await this.page.locator("input#email").waitFor();
      await this.page.locator("input#email").fill(setting.email);
      await this.page.locator("input#password").fill(setting.password);
      // wait for captcha solved
      let captchaSolved = false;
      for (var i = 0; i < 10; i++) {
        const disabled = await this.page
          .getByRole("button", { name: "Sign In", exact: true })
          .isDisabled();
        if (!disabled) {
          captchaSolved = true;
          break;
        }
        await this.page.waitForTimeout(10000);
      }
      if (!captchaSolved) throw new BotError("login failed");

      // wait login success
      const loginPromise = this.page.waitForResponse(
        (response) => {
          return (
            response
              .url()
              .includes(
                "https://www.fanvue.com/api/auth/callback/credentials"
              ) && response.request().method() === "POST"
          );
        },
        { timeout: 180000 }
      );
      const profilePromise = this.page.waitForResponse(
        (response) => {
          return (
            response
              .url()
              .includes("https://www.fanvue.com/trpc/user.getOwnProfile") &&
            response.request().method() === "GET"
          );
        },
        { timeout: 180000 }
      );
      await this.page
        .getByRole("button", { name: "Sign In", exact: true })
        .click();
      // check login api response
      const loginResp = await loginPromise;
      if (!loginResp.ok())
        throw new AuthError("wrong credentials", {
          where: "FanvueBrowser::login",
          method: "POST",
          endpoint: "https://www.fanvue.com/api/auth/callback/credentials",
          status: loginResp.statusText(),
        });
      const profileResp = await profilePromise;
      const profileData = await profileResp.json();
      if (profileResp.status() != 200) {
        throw new AuthError("wrong credentials", {
          where: "FanvueBrowser::login",
          method: "GET",
          endpoint: "https://www.fanvue.com/trpc/user.getOwnProfile",
          response: JSON.stringify(profileData),
        });
      }
      this.headers = await profileResp.request().allHeaders();
      this.profile = profileData.result?.data?.json;
      if (!this.profile.is_creator)
        throw new AuthError("not creator account", {
          where: "FanvueBrowser::login",
          profile: JSON.stringify(profileData.result?.data?.json),
        });
      return { alias: this.profile.handle, id: this.profile.uuid };
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("login failed", {
        where: "FanvueBrowser::login",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const resp = await this.page.request.get(
        "https://www.fanvue.com/trpc/invoice.getEarningsList",
        {
          headers: this.headers,
          params: { input: JSON.stringify({ json: { direction: "forward" } }) },
        }
      );
      const respData = await resp.json();
      if (!resp.ok()) {
        throw new BotError("get earnings failed", {
          where: "FanvueBrowser::getMonthlyEarnings",
          method: "GET",
          endpoint: "https://www.fanvue.com/trpc/invoice.getEarningsList",
          status: resp.statusText(),
          response: JSON.stringify(respData),
        });
      }
      const items: IFanvueEarning[] = respData.result?.data?.json?.items || [];
      const lastMonth = moment().subtract(30, "day").startOf("day").toDate();
      const revenue = items
        .filter((item) => new Date(item.paid_at) >= lastMonth)
        .reduce((sum, item) => (sum += item.creator_net), 0);
      return revenue / 100;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get earnings failed", {
        where: "FanvueBrowser::getMonthlyEarnings",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async createFolder(folderName: string) {
    try {
      const resp = await this.page.request.post(
        "https://www.fanvue.com/trpc/vault.createVaultFolder",
        {
          headers: this.headers,
          data: { json: { folderName } },
        }
      );
      if (!resp.ok()) {
        throw new BotError("create folder failed", {
          where: "FanvueBrowser::createFolder",
          method: "POST",
          endpoint: "https://www.fanvue.com/trpc/vault.createVaultFolder",
          params: { json: { folderName } },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("create folder failed", {
        where: "FanvueBrowser::createFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getFolders(): Promise<string[]> {
    try {
      const resp = await this.page.request.get(
        "https://www.fanvue.com/trpc/vault.getVaultFolders",
        {
          headers: this.headers,
          params: {
            input: JSON.stringify({
              json: null,
              meta: { values: ["undefined"] },
            }),
          },
        }
      );
      if (!resp.ok()) {
        throw new BotError("get folders failed", {
          where: "FanvueBrowser::getFolders",
          method: "GET",
          endpoint: "https://www.fanvue.com/trpc/vault.getVaultFolder",
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      const folders: IFanvueFolder[] = respData.result?.data?.json || [];
      return folders.map((folder) => folder.folder_name);
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get folders failed", {
        where: "FanvueBrowser::getFolders",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async findVaultInFolder(
    folderName: string,
    vaultId: string
  ): Promise<string | undefined> {
    try {
      let vault;
      let cursor;
      while (true) {
        const resp = await this.page.request.get(
          "https://www.fanvue.com/trpc/vault.getVaultMediaList",
          {
            headers: this.headers,
            params: {
              input: JSON.stringify({
                json: {
                  mediaType: null,
                  folderName: folderName,
                  usageFilter: null,
                  onlyPurchased: null,
                  cursor: cursor,
                  markMediaAsPurchasedByUserUuid: null,
                  direction: "forward",
                },
                meta: {
                  values: {
                    mediaType: ["undefined"],
                    usageFilter: ["undefined"],
                    onlyPurchased: ["undefined"],
                    markMediaAsPurchasedByUserUuid: ["undefined"],
                  },
                },
              }),
            },
          }
        );
        const respData = await resp.json();
        if (!resp.ok()) {
          throw new BotError("get vaults failed", {
            where: "FanvueBrowser::getVaultsInFolder",
            method: "GET",
            endpoint: "https://www.fanvue.com/trpc/vault.getVaultMediaList",
            status: resp.statusText(),
            response: JSON.stringify(respData),
          });
        }
        const items: IFanvueVault[] = respData.result?.data?.json?.items || [];
        vault = items.find((item) => item.uuid == vaultId);
        if (vault) break;
        if (!respData.result?.data?.json?.nextCursor) break;
        cursor = respData.result?.data?.json?.nextCursor;
      }
      return vault?.uuid;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("find vault failed", {
        where: "FanvueBrowser::findVaultInFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async moveVaultToFolder(
    vaultId: string,
    folderName: string
  ): Promise<void> {
    try {
      const resp = await this.page.request.post(
        "https://www.fanvue.com/trpc/vault.moveMediaToFolder",
        {
          headers: this.headers,
          data: {
            json: {
              sourceFolderName: null,
              targetFolderName: folderName,
              mediaUuids: [vaultId],
            },
            meta: { values: { sourceFolderName: ["undefined"] } },
          },
        }
      );
      if (!resp.ok()) {
        throw new BotError("move vault failed", {
          where: "FanvueBrowser::moveVaultToFolder",
          method: "POST",
          endpoint: "https://www.fanvue.com/trpc/vault.moveMediaToFolder",
          params: {
            json: {
              sourceFolderName: null,
              targetFolderName: folderName,
              mediaUuids: [vaultId],
            },
            meta: { values: { sourceFolderName: ["undefined"] } },
          },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("move vault failed", {
        where: "FanvueBrowser::moveVaultToFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async uploadVault(mediaPath: string): Promise<string> {
    try {
      await this.page.goto("https://www.fanvue.com/vault", { timeout: 180000 });
      const createUploadPromise = this.page.waitForResponse(
        (response) => {
          return (
            response
              .url()
              .includes(
                "https://www.fanvue.com/trpc/media.createMediaMultipartUpload"
              ) && response.request().method() === "POST"
          );
        },
        { timeout: 600000 }
      );
      const finalUploadPromise = this.page.waitForResponse(
        (response) => {
          return (
            response
              .url()
              .includes("https://www.fanvue.com/trpc/media.finaliseMedia") &&
            response.request().method() === "POST"
          );
        },
        { timeout: 600000 }
      );
      await this.page.locator("input#files").first().setInputFiles(mediaPath);
      const [createUploadResp, finalUploadResp] = await Promise.all([
        createUploadPromise,
        finalUploadPromise,
      ]);
      const uploadData = await createUploadResp.json();
      if (!createUploadResp.ok() || !finalUploadResp.ok())
        throw new BotError("upload vault failed", {
          where: "FanvueBrowser::uploadVault",
          method: "POST",
          endpoint:
            "https://www.fanvue.com/trpc/media.createMediaMultipartUpload",
          status1: createUploadResp.statusText(),
          status2: finalUploadResp.statusText(),
          response1: await createUploadResp.text(),
          response2: await finalUploadResp.text(),
        });
      return uploadData.result?.data?.json?.media_uuid;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("upload vault failed", {
        where: "FanvueBrowser::uploadVault",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async deleteVault(mediaId: string) {
    try {
      const resp = await this.page.request.post(
        "https://www.fanvue.com/trpc/vault.deleteMediaFromVault",
        {
          headers: this.headers,
          data: { json: { mediaUuids: [mediaId] } },
        }
      );
      if (!resp.ok()) {
        throw new BotError("move media to folder failed", {
          where: "FanvueBrowser::moveVaultToFolder",
          method: "POST",
          endpoint: "https://www.fanvue.com/trpc/vault.deleteMediaFromVault",
          params: { json: { mediaUuids: [mediaId] } },
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete vault failed", {
        where: "FanvueBrowser::deleteVault",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  private getZoneTime(time: Date): string {
    const timezone = "Europe/Amsterdam";
    const zonedDate = toZonedTime(time, timezone);
    const pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX";
    const formattedDate = format(zonedDate, pattern, { timeZone: timezone });
    return formattedDate;
  }

  public async schedulePost(
    scheduledAt: Date,
    title: string,
    mediaIds: string[],
    postType: number,
    price?: number
  ) {
    try {
      let params;
      switch (postType) {
        case PostType.FANS:
          params = {
            json: {
              availableToGroupId: 0,
              contentCollectionUuids: [],
              expiresAt: null,
              mediaPreviewUuid: null,
              mediaUuids: mediaIds,
              price: null,
              publishAt: this.getZoneTime(scheduledAt),
              text: title,
            },
            meta: {
              values: {
                expiresAt: ["undefined"],
                mediaPreviewUuid: ["undefined"],
                price: ["undefined"],
              },
            },
          };
          break;
        case PostType.PAID:
          if (!price || price < 3)
            throw new BotError("schedule post failed", {
              where: "FanvueBrowser::schedulePost",
              error: "price is less than minimum value",
            });
          params = {
            json: {
              availableToGroupId: 0,
              contentCollectionUuids: [],
              expiresAt: null,
              mediaPreviewUuid: null,
              mediaUuids: mediaIds,
              price: price * 100,
              publishAt: this.getZoneTime(scheduledAt),
              text: title,
            },
            meta: {
              values: {
                expiresAt: ["undefined"],
                mediaPreviewUuid: ["undefined"],
                price: ["undefined"],
              },
            },
          };
          break;
        default:
          params = {
            json: {
              availableToGroupId: 1,
              contentCollectionUuids: [],
              expiresAt: null,
              mediaPreviewUuid: null,
              mediaUuids: mediaIds,
              price: null,
              publishAt: this.getZoneTime(scheduledAt),
              text: title,
            },
            meta: {
              values: {
                expiresAt: ["undefined"],
                mediaPreviewUuid: ["undefined"],
                price: ["undefined"],
              },
            },
          };
          break;
      }
      const resp = await this.page.request.post(
        "https://www.fanvue.com/trpc/post.createPost",
        {
          headers: this.headers,
          data: params,
        }
      );
      const respData = await resp.json();
      if (!resp.ok())
        throw new BotError("schedule post failed", {
          where: "FanvueBrowser::schedulePost",
          method: "POST",
          endpoint: "https://www.fanvue.com/trpc/post.createPost",
          params: JSON.stringify(params),
          status: resp.statusText(),
          response: JSON.stringify(respData),
        });
      return respData.result?.data?.json?.uuid;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("schedule post failed", {
        where: "FanvueBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    try {
      let postIds = [];
      let cursor;
      let page = 1;
      while (true) {
        const params = {
          input: JSON.stringify({
            json: {
              creatorUuid: this.profile.uuid,
              contentCollectionKey: 0,
              contentCollectionUuid: null,
              cursor: cursor,
              direction: "forward",
            },
            meta: {
              values: {
                contentCollectionUuid: ["undefined"],
              },
            },
          }),
        };
        const resp = await this.page.request.get(
          "https://www.fanvue.com/trpc/post.getPosts",
          {
            headers: this.headers,
            params,
          }
        );
        if (!resp.ok())
          throw new BotError("get posts failed", {
            where: "FanvueBrowser::getPosts",
            method: "GET",
            endpoint:
              "https://https://www.fanvue.com/trpc/post.getPosts.fanvue.com/trpc/post.createPost",
            params,
            status: resp.statusText(),
            response: await resp.text(),
          });
        const respData = await resp.json();
        const posts: IFanvuePost[] = respData.result?.data?.json?.items || [];
        postIds.push(...posts.map((post) => post.uuid));
        if (!respData.result?.data?.json?.nextCursor) break;
        page += 1;
        if (page > 5) break;
        cursor = respData.result?.data?.json?.nextCursor;
      }
      return postIds;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get posts failed", {
        where: "FanvueBrowser::getSelfPosts",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async createPost(title: string, mediaIds: string | string[]) {
    try {
      const mediaUuids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];

      if (mediaUuids.length === 0) {
        throw new BotError("create post failed", {
          where: "FanvueBrowser::createPost",
          error: "no media UUIDs provided"
        });
      }

      this.logger.info(`[createPost] Creating post via UI with ${mediaUuids.length} media, UUIDs: ${mediaUuids.join(', ')}`);

      // Navigate to the creator's home/feed page
      await this.page.goto("https://www.fanvue.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.page.waitForTimeout(3000);
      // Click Feed tab if visible (some accounts default to Dashboard which has no compose)
      try {
        const feedTab = this.page.locator('button:has-text("Feed"), a:has-text("Feed"), [role="tab"]:has-text("Feed")').first();
        if (await feedTab.isVisible({ timeout: 2000 })) {
          await feedTab.click();
          this.logger.info('[createPost] Clicked Feed tab');
          await this.page.waitForTimeout(2000);
        }
      } catch (e) { }
      // Set up interceptor to capture the actual createPost API call
      const createPostPromise = this.page.waitForResponse(
        response => response.url().includes('post.createPost') && response.request().method() === 'POST',
        { timeout: 120000 }
      ).catch(() => null);

      // Step 1: Find the compose textarea
      let composeElement = null;
      const composeSelectors = [
        'textarea[placeholder*="Write"]',
        'textarea[placeholder*="write"]',
        'textarea[placeholder*="post"]',
        'div[contenteditable="true"]',
        'textarea',
      ];

      // Check if compose area is already visible
      for (const selector of composeSelectors) {
        try {
          const el = this.page.locator(selector).first();
          if (await el.isVisible({ timeout: 2000 })) {
            composeElement = el;
            this.logger.info(`[createPost] Found compose area: ${selector}`);
            break;
          }
        } catch (e) { }
      }

      // If not found, click "Create" button to open compose area
      if (!composeElement) {
        const createSelectors = [
          'a[href*="create"]',
          'button:has-text("Create")',
          'button:has-text("New Post")',
          '[data-testid="create-post"]',
        ];
        for (const selector of createSelectors) {
          try {
            const btn = this.page.locator(selector).first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              this.logger.info(`[createPost] Clicked create button: ${selector}`);
              await this.page.waitForTimeout(3000);
              break;
            }
          } catch (e) { }
        }

        // Search for compose area again
        for (const selector of composeSelectors) {
          try {
            const el = this.page.locator(selector).first();
            if (await el.isVisible({ timeout: 3000 })) {
              composeElement = el;
              this.logger.info(`[createPost] Found compose area after click: ${selector}`);
              break;
            }
          } catch (e) { }
        }
      }

      if (!composeElement) {
        throw new BotError("create post failed", {
          where: "FanvueBrowser::createPost",
          error: "Could not find compose textarea",
        });
      }

      // Type the post text
      await composeElement.click();
      await this.page.waitForTimeout(500);
      await composeElement.fill(title || "");
      this.logger.info(`[createPost] Typed post text: "${title?.substring(0, 50)}"`);

      // Step 2: Click "Add from vault" to open vault picker
      let vaultPickerOpened = false;
      try {
        const addFromVaultBtn = this.page.locator('button:has-text("Add from vault")');
        await addFromVaultBtn.waitFor({ state: 'visible', timeout: 5000 });
        await addFromVaultBtn.click();
        this.logger.info(`[createPost] Clicked "Add from vault" button`);
        vaultPickerOpened = true;
        await this.page.waitForTimeout(3000);
      } catch (e) {
        this.logger.warn(`[createPost] "Add from vault" not found, trying other approaches`);
      }

      if (!vaultPickerOpened) {
        // Try media button
        const mediaBtn = this.page.locator('button[aria-label*="Media"], button[aria-label*="media"], button[aria-label*="Attach"]').first();
        try {
          if (await mediaBtn.isVisible({ timeout: 2000 })) {
            await mediaBtn.click();
            this.logger.info(`[createPost] Clicked media button`);
            await this.page.waitForTimeout(2000);
            const vaultOpt = this.page.locator('button:has-text("vault"), li:has-text("vault"), a:has-text("vault"), [role="menuitem"]:has-text("vault")').first();
            if (await vaultOpt.isVisible({ timeout: 2000 })) {
              await vaultOpt.click();
              this.logger.info(`[createPost] Clicked vault option`);
              vaultPickerOpened = true;
              await this.page.waitForTimeout(2000);
            }
          }
        } catch (e) { }
      }

      // Step 3: Select media items in vault picker
      let mediaSelected = 0;

      // Try to find items by UUID match first
      for (const uuid of mediaUuids) {
        const found = await this.page.evaluate((targetUuid: string) => {
          const dialog = document.querySelector('[role="dialog"]') || document;
          const allElements = dialog.querySelectorAll('div, span, img, p');
          for (const el of allElements) {
            const text = el.textContent || '';
            const src = (el as HTMLImageElement).src || '';
            const allAttrs = Array.from(el.attributes || []).map(a => a.value).join(' ');
            if (text.includes(targetUuid) || src.includes(targetUuid) || allAttrs.includes(targetUuid)) {
              let parent = el.closest('[class*="MuiGrid"], [class*="MuiCard"], [class*="item"], div') as HTMLElement | null;
              for (let i = 0; i < 5 && parent; i++) {
                const selectBtn = parent.querySelector('button[aria-label="Select media"]') as HTMLButtonElement;
                if (selectBtn && !selectBtn.disabled) {
                  selectBtn.click();
                  return true;
                }
                parent = parent.parentElement;
              }
            }
          }
          return false;
        }, uuid);

        if (found) {
          mediaSelected++;
          this.logger.info(`[createPost] Selected media by UUID match: ${uuid}`);
          await this.page.waitForTimeout(500);
        }
      }

      // Fallback: select first N "Select media" buttons
      if (mediaSelected === 0) {
        const selectButtons = this.page.locator('button[aria-label="Select media"]');
        const count = await selectButtons.count();
        this.logger.info(`[createPost] No UUID match, found ${count} "Select media" buttons, selecting first ${mediaUuids.length}`);

        for (let i = 0; i < Math.min(count, mediaUuids.length); i++) {
          try {
            await selectButtons.nth(i).click();
            mediaSelected++;
            this.logger.info(`[createPost] Selected media item ${i + 1}`);
            await this.page.waitForTimeout(500);
          } catch (e) {
            this.logger.warn(`[createPost] Failed to click Select media button ${i + 1}`);
          }
        }
      }

      this.logger.info(`[createPost] Total media selected: ${mediaSelected}`);

      if (mediaSelected === 0) {
        throw new BotError("create post failed", {
          where: "FanvueBrowser::createPost",
          error: "Could not select any media in vault picker",
        });
      }

      // Step 4: Click "Add Media" button to confirm vault selection
      await this.page.waitForTimeout(1000);
      let addMediaClicked = false;
      try {
        const addMediaBtn = this.page.locator('button:has-text("Add Media")');
        await addMediaBtn.waitFor({ state: 'visible', timeout: 5000 });
        for (let i = 0; i < 10; i++) {
          if (!(await addMediaBtn.isDisabled())) break;
          await this.page.waitForTimeout(500);
        }
        if (!(await addMediaBtn.isDisabled())) {
          await addMediaBtn.click();
          this.logger.info(`[createPost] Clicked "Add Media" button`);
          addMediaClicked = true;
          await this.page.waitForTimeout(2000);
        }
      } catch (e) {
        this.logger.warn(`[createPost] "Add Media" button not found`);
      }

      if (!addMediaClicked) {
        for (const text of ['Add', 'Confirm', 'Done', 'Apply']) {
          try {
            const btn = this.page.locator(`button:has-text("${text}"):not([disabled])`).first();
            if (await btn.isVisible({ timeout: 1000 })) {
              await btn.click();
              this.logger.info(`[createPost] Clicked "${text}" button (alternative)`);
              await this.page.waitForTimeout(1000);
              break;
            }
          } catch (e) { }
        }
      }

      // Step 5: Close vault dialog if still open
      await this.page.waitForTimeout(1000);
      try {
        const closeBtn = this.page.locator('button[aria-label="Close dialog"], button[aria-label="Close"], [role="dialog"] button:first-child, button:near(:text("Vault"))').first();
        if (await closeBtn.isVisible({ timeout: 2000 })) {
          await closeBtn.click();
          this.logger.info('[createPost] Closed vault dialog via button');
          await this.page.waitForTimeout(1500);
        }
      }
      catch (e) { }
      // Press Escape to ensure any open dialogs are closed
      try {
        const dialog = this.page.locator('[role="dialog"]').first();
        if (await dialog.isVisible({ timeout: 1000 })) {
          await this.page.keyboard.press('Escape');
          this.logger.info('[createPost] Pressed Escape to close dialog');
          await this.page.waitForTimeout(1500);
        }
      }
      catch (e) { }

      // Step 6: Click "Create post" button to submit
      let posted = false;
      try {
        const createPostBtn = this.page.locator('button:has-text("Create post")');
        await createPostBtn.waitFor({ state: 'visible', timeout: 10000 });
        for (let i = 0; i < 10; i++) {
          if (!(await createPostBtn.isDisabled())) break;
          await this.page.waitForTimeout(1000);
        }
        await createPostBtn.click();
        this.logger.info(`[createPost] Clicked "Create post" button`);
        posted = true;
      } catch (e) {
        // Fallback to other post button labels
        for (const text of ['Post', 'Publish', 'Submit', 'Share', 'Send']) {
          try {
            const btn = this.page.locator(`button:has-text("${text}")`).first();
            if (await btn.isVisible({ timeout: 1000 }) && !(await btn.isDisabled())) {
              await btn.click();
              this.logger.info(`[createPost] Clicked "${text}" button (fallback)`);
              posted = true;
              break;
            }
          } catch (e2) { }
        }
      }

      if (!posted) {
        throw new BotError("create post failed", {
          where: "FanvueBrowser::createPost",
          error: "Could not find post/submit button",
        });
      }

      // Step 7: Wait for the createPost API response
      await this.page.waitForTimeout(3000);
      let capturedPostUuid: string | undefined;
      const createPostResp = await createPostPromise;
      if (createPostResp) {
        if (createPostResp.ok()) {
          try {
            const respText = await createPostResp.text();
            const respData = JSON.parse(respText);
            const data = Array.isArray(respData) ? respData[0] : respData;
            capturedPostUuid = data.result?.data?.json?.uuid;
            this.logger.info(`[createPost] Post created successfully: ${capturedPostUuid}`);
          } catch (e) {
            this.logger.warn(`[createPost] Could not parse createPost response`);
          }
        } else {
          this.logger.warn(`[createPost] API responded with ${createPostResp.status()}`);
        }
      } else {
        this.logger.warn(`[createPost] createPost API response not captured (timeout)`);
      }

      return capturedPostUuid;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create post failed", {
        where: "FanvueBrowser::createPost",
        error: error.message,
        stack: error.stack,
      })
    }
  }


  public async deletePost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.post(
        "https://www.fanvue.com/trpc/post.deletePost",
        {
          headers: this.headers,
          data: { json: { postUuid: postId } },
        }
      );
      if (!resp.ok())
        throw new BotError("delete post failed", {
          where: "FanvueBrowser::deletePost",
          method: "POST",
          endpoint: "https://www.fanvue.com/trpc/post.deletePost",
          params: { json: { postUuid: postId } },
          status: resp.statusText(),
          response: await resp.text(),
        });
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("delete post failed", {
        where: "FanvueBrowser::deletePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getUnreadChats(): Promise<IChatMessage[]> {
    try {
      const params = {
        input: JSON.stringify({
          json: {
            searchTerm: "",
            sortBy: "most_recent_messages",
            filterBy: [0],
            direction: "forward",
          },
        }),
      };
      const resp = await this.page.request.get(
        "https://www.fanvue.com/trpc/chat.getChatList",
        {
          headers: this.headers,
          params,
        }
      );
      if (!resp.ok())
        throw new BotError("get chats failed", {
          where: "FanvueBrowser::getUnreadChats",
          method: "GET",
          endpoint: "https://www.fanvue.com/trpc/chat.getChatList",
          params,
          status: resp.statusText(),
          response: await resp.text(),
        });
      const respData = await resp.json();
      const chats: IFanvueChat[] = respData.result?.data?.json?.items || [];
      return chats.map((chat) => ({
        user: chat.displayName,
        time: new Date(chat.lastMessage.sentAt),
        message: chat.lastMessage.text || "[image]",
      }));
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get chats failed", {
        where: "FanvueBrowser::getUnreadChats",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getFeed() {
    try {
      const params = {
        input: JSON.stringify({
          "json": {
            "cursor": null,
            "direction": "forward"
          },
          "meta": {
            "values": {
              "cursor": ["undefined"]
            }
          }
        })
      };
      const resp = await this.page.request.get("https://www.fanvue.com/trpc/post.getFeed", {
        headers: this.headers,
        params
      });
      if (!resp.ok())
        throw new BotError("get feed failed", {
          where: "FanvueBrowser::getFeed",
          method: "GET",
          endpoint: "https://www.fanvue.com/trpc/post.getFeed",
          status: resp.statusText(),
          response: await resp.text(),
        });
      const respData = await resp.json();
      return respData.result?.data?.json?.items || [];
    }
    catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("get feed failed", {
        where: "FanvueBrowser::getFeed",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async commentPost(postId: string, comment: string) {
    try {
      const batchPayload = { "0": { postId: postId, text: comment } };
      const fetchResult = await this.page.evaluate(async (payload) => {
        const response = await fetch("https://www.fanvue.com/trpc/post.createComment?batch=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return { status: response.status, statusText: response.statusText, body: await response.text() };
      }, batchPayload);
      if (fetchResult.status !== 200) {
        throw new BotError("comment post failed", {
          where: "FanvueBrowser::commentPost",
          status: fetchResult.statusText,
          response: fetchResult.body
        });
      }
      return JSON.parse(fetchResult.body);
    }
    catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("comment post failed", { where: "FanvueBrowser::commentPost", error: error.message, stack: error.stack });
    }
  }

  public async likePost(postId: string) {
    try {
      const batchPayload = { "0": { postId: postId } };
      const fetchResult = await this.page.evaluate(async (payload) => {
        const response = await fetch("https://www.fanvue.com/trpc/post.likePost?batch=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return { status: response.status, statusText: response.statusText, body: await response.text() };
      }, batchPayload);
      if (fetchResult.status !== 200) {
        throw new BotError("like post failed", {
          where: "FanvueBrowser::likePost",
          status: fetchResult.statusText,
          response: fetchResult.body
        });
      }
      return JSON.parse(fetchResult.body);
    }
    catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("like post failed", { where: "FanvueBrowser::likePost", error: error.message, stack: error.stack });
    }
  }
}
