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
  protected profile!: IFanvueProfile;
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

  public async createPost(title: string, mediaId: string) {
    try {
      const params = {
        json: {
          availableToGroupId: 1,
          contentCollectionUuids: [],
          expiresAt: null,
          mediaPreviewUuid: null,
          mediaUuids: [mediaId],
          price: null,
          publishAt: null,
          text: title,
        },
        meta: {
          values: {
            expiresAt: ["undefined"],
            mediaPreviewUuid: ["undefined"],
            price: ["undefined"],
            publishAt: ["undefined"],
          },
        },
      };
      const resp = await this.page.request.post(
        "https://www.fanvue.com/trpc/post.createPost",
        {
          headers: this.headers,
          data: params,
        }
      );
      if (!resp.ok())
        throw new BotError("create post failed", {
          where: "FanvueBrowser::createPost",
          method: "POST",
          endpoint: "https://www.fanvue.com/trpc/post.createPost",
          params: JSON.stringify(params),
          status: resp.statusText(),
          response: await resp.text(),
        });
      const respData = await resp.json();
      return respData.result?.data?.json?.uuid;
    } catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("create post failed", {
        where: "FanvueBrowser::createPost",
        error: error.message,
        stack: error.stack,
      });
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
}
