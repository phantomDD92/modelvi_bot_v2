import moment from "moment";
import { BaseBrowser } from "./base-browser";
import { PostType } from "../types/constant";
import { IFancentroFeed, IFancentroLabel, IFancentroPost, IFancentroProfile, IFancentroVaultItem } from "../types/fancentro";
import { IAccountID, IAccountSettings, IBotConfig } from "../types/interface";
import { AuthError, BotError, ProxyError, SessionTimeoutError } from "../utils/error";
import { Logger } from "../utils/logger";
import { HttpStatusCode } from "axios";

export class FancentroBrowser extends BaseBrowser {

  protected token!: string;
  protected profile!: IFancentroProfile;
  protected apiHeader!: {};
  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  // set content filter
  protected async setFilter() {
    // filter images
    await this.context.route(/(.*pix\-cdn77-fc\.xrcdn\.com\/.*)|(.*pix\-cdn77\.mainhubcdn\.com\/.*)|(\.png(\?.*)?$)|(\.jpg(\?.*)?$)|(\.webp(\?.*)?$)|(\.jpeg(\?.*)?$)|(blob(.*)?$)/,
      route => route.request().method() == "GET" ? route.abort() : route.continue())
    // filter google analytics
    await this.context.route(/https:\/\/www\.google-analytics\.com\/.*/, route => route.abort());
  }

  public async home(): Promise<void> {
    try {
      await this.page.goto("https://fancentro.com", { waitUntil: "load" });
      this.logger.info("open home page");
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "FancentroBrowser::home",
        error: error.message
      });
    }
  }

  public async afterHome(): Promise<void> {
    try {
      // wait for a age gate modal
      await this.page.locator("button", { hasText: "I AM 18 OR OLDER - ENTER" });
      // close modal
      await this.page.locator("button", { hasText: "I AM 18 OR OLDER - ENTER" }).first().click();
      this.logger.info("close age gate modal");
    } catch (error: any) {
    }
  }


  private async getAuthResult(verify: boolean = false): Promise<string> {
    const authPromise = this.page.waitForResponse(response =>
      response.request().url().includes("https://fancentro.com/api/v1/api/authenticate"), { timeout: 120000 });
    if (verify)
      await this.page.getByRole('button', { name: 'VERIFY' }).click();
    else
      await this.page.getByRole('button', { name: 'LOG IN' }).click();
    const authResp = await authPromise;
    if (!authResp.ok())
      throw new BotError("login failed", {
        where: "FancentroBrowser::getAuthResult",
        method: "POST",
        endpoint: "https://fancentro.com/api/v1/api/authenticate",
        params: authResp.request().postData(),
        status: authResp.statusText(),
        response: await authResp.text(),
      })
    try {
      const respData = await authResp.json();
      const message = respData.message || "";
      if (message.includes("Invalid"))
        throw new AuthError("wrong credentials", {
          where: "FancentroBrowser::login",
          error: "invalid email, password",
        });
      else if (message.includes("Captcha"))
        return "captcha"
      else if (message.includes("Something went wrong"))
        throw new AuthError("something went wrong", {
          where: "FancentroBrowser::getAuthResult",
          error: await authResp.text(),
        });
      else if (message.includes("Account disabled"))
        throw new AuthError("account blocked", {
          where: "FancentroBrowser::getAuthResult",
          error: await authResp.text(),
        });
      if (respData.twoStepVerification) {
        return "twofa";
      }
      throw new BotError("login failed", {
        where: "FancentroBrowser::getAuthResult",
        error: await authResp.text(),
      });
    } catch (error) {
      if (error instanceof BotError)
        throw error;
      return "success";
    }
  }

  private async solveCaptcha() {
    var lastError;
    for (var i = 0; i < 3; i++) {
      try {
        await this.page.solveRecaptchas();
        return;
      } catch (error: any) {
        lastError = error;
      }
    }
    throw new BotError("solve captcha failed", {
      where: "FancentroBrowser::solveCaptcha",
      error: lastError.message,
    });
  }

  public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
    try {
      // goto login page
      await this.page.locator("header button.mui-style-ctfnfu").waitFor();
      await this.page.locator("header button.mui-style-ctfnfu").click();
      await this.page.locator("form button", { hasText: "Log in with email" }).click();

      // await this.page.waitForLoadState('load');
      await this.page.locator('input[name="email"]').waitFor();

      // input login credentials
      await this.page.locator('input[name="email"]').fill(`${setting.email}`);
      await this.page.locator('input[name="password"]').fill(`${setting.password}`);
      // await this.page.locator('input[name="remember_me"]').setChecked(true);

      // click login button
      await this.page.waitForTimeout(500);
      this.logger.info("try to login");
      await this.solveCaptcha();
      let authResult = await this.getAuthResult();
      if (authResult == "captcha") {
        await this.solveCaptcha();
        this.logger.info("solve captcha");
        authResult = await this.getAuthResult();
      }
      if (authResult == "captcha")
        throw new BotError("captcha failed", {
          where: "FancentroBrowser::login",
          error: "solve captcha failed",
        });
      if (authResult == "twofa") {
        if (!setting.device)
          throw new AuthError("no security key", {
            where: "FancentroBrowser::login",
            error: "no security key",
          });
        const code = await this.generate2FACode(setting.device)
        await this.page.locator("input[name='verification_code']").waitFor();
        await this.page.locator("input[name='verification_code']").fill(code);
        authResult = await this.getAuthResult(true);
      }
      if (authResult != "success") {
        throw new BotError(`${authResult} failed`, {
          where: "FancentroBrowser::login",
          error: "invalid security key",
        });
      }
      const profilePromise = this.page.waitForResponse(response =>
        response.request().url().includes("https://fancentro.com/api/v2/api/user/data"), { timeout: 120000 });
      const profileResp = await profilePromise;
      const profileData = await profileResp.json();
      this.profile = profileData;
      this.apiHeader = await profileResp.request().allHeaders();
      if (profileData.showCompleteProfileModal == 'NO_PURCHASES_USER')
        throw new AuthError("profile consent required", {
          where: "FancentroBrowser::login",
          profile: await profileResp.text()
        });
      if (profileData.twoFactorAuthenticationStatus == 'inactive')
        throw new AuthError("two factor required", {
          where: "FancentroBrowser::login",
          profile: await profileResp.text()
        });
      this.profile.alias = setting.alias;
      // go to dashboard page
      await this.page.locator("a[aria-label='chat']").first().click();
      await this.page.waitForURL("https://fancentro.mainhub.com/messaging/messages", { waitUntil: "domcontentloaded" });
      const linkElement = await this.page.locator("div.profileAvatar a").first().elementHandle();
      if (linkElement) {
        const linkAddr = await linkElement.getAttribute("href");
        if (linkAddr) {
          const parts = linkAddr.split('/'); // Split by slash
          this.profile.alias = parts[parts.length - 1];
        }
      }
      // goto main dashboard
      await this.page.goto("https://fancentro.mainhub.com/dashboard/overview");
      const channelPromise = this.page.waitForRequest(request => {
        return request.url().includes('fancentro.mainhub.com/dashboard-insights/get-channel-performance-ajax');
      });
      const channelReq = await channelPromise;
      this.headers = await channelReq.allHeaders();
      this.logger.info("go to dashboard page");
      return { alias: this.profile.alias, id: `${this.profile.id}` }
    } catch (error: any) {
      console.error(error)
      if (error instanceof BotError)
        throw error;
      else
        throw new BotError("login failed", {
          where: "FancentroBrowser::login",
          error: error.message
        })
    }
  }

  public async findOrCreateFolder(folderName: string): Promise<number> {
    try {
      // go to label page and find token
      const tokenPromise = this.page.waitForRequest(request => {
        return request.url().includes('/vault/label/get-by-user');
      });
      await this.page.goto("https://fancentro.mainhub.com/vault/labels");
      const tokenRequest = await tokenPromise;
      const url = tokenRequest.url();
      const urlObj = new URL(url);
      const token = urlObj.searchParams.get('token');
      this.token = token || "";

      let label;
      let page = 1
      // find folder(label)
      while (true) {
        const params = {
          search: folderName,
          time: "newest",
          orderBy: "created_at",
          sortDirection: "desc",
          page: page,
          limit: 20,
          token: this.token,
        }
        const getResp = await this.page.request.get("https://fancentro.mainhub.com/vault/label/get-by-user", {
          headers: this.headers,
          params,
        });
        if (!getResp.ok()) throw new BotError("find label failed", {
          where: "FancentroBrowser::findOrCreateFolder",
          method: "GET",
          endpoint: "https://fancentro.mainhub.com/vault/label/get-by-user",
          params,
          status: getResp.statusText(),
          response: await getResp.text(),
        });
        const getRespData = await getResp.json();
        const labels: IFancentroLabel[] = getRespData;
        label = labels.find(item => item.name.toLowerCase() == folderName.toLowerCase())
        if (label)
          break;
        if (labels.length < 20)
          break;
        page += 1
      }
      // if found, return folder id
      if (label)
        return label.id;
      // create label
      const postResp = await this.page.request.post("https://fancentro.mainhub.com/vault/label/save", {
        headers: this.headers,
        data: { name: folderName, token: this.token },
      });
      if (!postResp.ok()) throw new BotError("create label failed", {
        where: "BrowserUtils::findOrCreateLabelInHub",
        method: "POST",
        endpoint: "https://fancentro.mainhub.com/vault/label/save",
        params: { name: folderName, token: this.token },
        status: postResp.statusText(),
        response: await postResp.text(),
      });
      const postRespData = await postResp.json();
      const labelId = postRespData.label?.id;
      // pin label
      const pinResp = await this.page.request.post("https://fancentro.mainhub.com/vault/label/update", {
        headers: this.headers,
        data: { labelId, isPinned: true, token: this.token },
      });
      if (!pinResp.ok()) throw new BotError("pin label failed", {
        where: "BrowserUtils::findOrCreateLabelInHub",
        method: "POST",
        endpoint: "https://fancentro.mainhub.com/vault/label/update",
        params: { labelId, isPinned: true, token: this.token },
        status: pinResp.statusText(),
        response: await pinResp.text(),
      });
      if (!labelId)
        throw new BotError("folder create failed", {
          where: "FancentroBrowser::findOrCreateFolder",
          error: "cannot create folder"
        })
      return labelId;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("find or create folder failed", {
        where: "FancentroBrowser::findOrCreateFolder",
        error: error.message
      })
    }
  }

  public async getVault(folderId: number, vaultName: string, vaultId?: string): Promise<string> {
    try {
      const tokenPromise = this.page.waitForRequest(request => {
        return request.url().includes('/vault/label/get-by-user');
      });
      await this.page.goto("https://fancentro.mainhub.com/vault/index");
      const tokenRequest = await tokenPromise;
      const url = tokenRequest.url();
      const urlObj = new URL(url);
      const token = urlObj.searchParams.get('token');
      this.token = token || "";
      let mediaId = undefined;
      if (vaultId) {
        let offset = 0;
        let vault;
        while (true) {
          const params = {
            "token": this.token,
            "offset": offset,
            "limit": 96,
            "mediaType": "",
            "contentType": "",
            "publishedStatus": "",
            "siteId": 0,
            "order": "created_at",
            "cleanCache": true,
            "IDsOfLabels": [],
            "search": "",
            "filter": "all"
          }
          const resp = await this.page.request.post("https://fancentro.mainhub.com/vault/get-vault-items-ajax", {
            headers: this.headers,
            data: params
          });
          if (!resp.ok()) throw new BotError("find vaults failed", {
            where: "FancentroBrowser::getVault",
            method: "POST",
            endpoint: "https://fancentro.mainhub.com/vault/get-vault-items-ajax",
            params,
            status: resp.statusText(),
            response: await resp.text(),
          });
          const respData = await resp.json();
          const vaultItems: IFancentroVaultItem[] = respData.vault?.vaultItems || [];
          if (vaultItems.length == 0)
            break;
          vault = vaultItems.find(item => item.id.toString() == vaultId);
          if (vault) {
            break;
          }
          const vaultCount = respData.vault?.howManyVaultItems;
          offset += 96;
          if (offset >= vaultCount)
            break;
        }
        mediaId = vault?.id
      }
      this.logger.info("uploading new vault....")
      if (!mediaId) {
        const mediaPath = await this.downloadFile(vaultName);
        this.logger.info(`download media(${mediaPath})`);
        const uploadPromise = this.page.waitForResponse(response => {
          return response.url().includes('/videouploading4');
        }, { timeout: 600000 });
        await this.page.locator("input.dz-hidden-input").first().setInputFiles(mediaPath);
        const uploadResponse = await uploadPromise;
        const uploadUrl = uploadResponse.url();
        const uploadUrlObj = new URL(uploadUrl);
        mediaId = uploadUrlObj.searchParams.get('cid');
        if (!mediaId)
          throw new BotError("get vault failed", {
            where: "FancentroBrowser::getVault"
          });
        //   await this.page.waitForTimeout(3000);
        //   const token = await this.page.evaluate(() => {
        //     return MH_GLOBAL?.token || "";
        //   });
        //   this.token = token;
        //   console.log("Token : ", this.token)
        //   const assignResp = await this.page.request.post("https://fancentro.mainhub.com/vault/label/assign", {
        //     headers: this.headers,
        //     form: {
        //       itemIds: mediaId,
        //       labelIds: folderId,
        //       token: this.token,
        //     }
        //   });
        //   if (!assignResp.ok()) throw new BotError("upload vault failed", {
        //     where: "FancentroBrowser::getVault",
        //     method: "POST",
        //     endpoint: "https://fancentro.mainhub.com/vault/label/assign",
        //     params: {
        //       itemIds: mediaId,
        //       labelIds: folderId,
        //       token: this.token,
        //     },
        //     status: assignResp.statusText(),
        //     response: await assignResp.text(),
        //   });
      }
      return mediaId.toString();
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get vault failed", {
        where: "FancentroBrowser::getVault",
        error: error.message

      })
    }
  }

  public async getPosts() {
    try {
      let postIds = [];
      let page = 1;
      while (true) {
        const params = {
          itemsPerPage: 20,
          page,
          emitFrom: "fetchMore",
          token: this.token,
          hasOffset: true,
          status: "published"
        };
        const resp = await this.page.request.get(`https://fancentro.mainhub.com/posts/find`, {
          headers: this.headers,
          params
        });
        if (!resp.ok())
          throw new BotError("find posts failed", {
            where: "FancentroBrowser::getPosts",
            method: "GET",
            endpoint: `https://fancentro.mainhub.com/posts/find`,
            params,
            status: resp.statusText(),
            response: await resp.text(),
          });

        const respData = await resp.json();
        let posts: IFancentroPost[] = [];
        if (respData.data) {
          if (Array.isArray(respData.data))
            posts = respData.data || [];
          else
            posts.push(respData.data)
        }
        page += 1
        postIds.push(...(posts.map(post => `${post.id}`)))
        if (posts.length < 20 || page > 5)
          break;
      }
      return postIds;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "FancentroBrowser::getPosts",
        error: error.message

      })
    }
  }

  public async deletePost(postId: string) {
    try {
      const resp = await this.page.request.post(`https://fancentro.mainhub.com/posts/${postId}/delete`, {
        headers: this.headers,
        data: { token: this.token }
      });
      if (!resp.ok()) throw new BotError("delete post failed", {
        where: "FancentroBrowser::deletePost",
        method: "POST",
        endpoint: `https://fancentro.mainhub.com/posts/${postId}/delete`,
        params: { token: this.token },
        status: resp.statusText(),
        response: await resp.text(),
      })
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete post failed", {
        where: "FancentroBrowser::deletePost",
        error: error.message

      })
    }
  }

  private async getTagId(tag: string): Promise<number | undefined> {
    try {
      const resp = await this.page.request.post("https://fancentro.mainhub.com/post/getPostTags", {
        headers: this.headers,
        data: { partialString: tag, token: this.token }
      });
      if (!resp.ok())
        return undefined;
      const respData = await resp.json();
      const tags = respData.data || [];
      if (tags.length > 0)
        return tags[0].id;
      return undefined;
    } catch (error: any) {
      return undefined
    }
  }

  public async schedulePost(scheduledAt: Date, mediaIds: string[], title: string, tags: string[], postType?: number, price?: number) {
    try {
      const tokenPromise = this.page.waitForRequest(request => {
        return request.url().includes('/collaboration/search');
      });
      await this.page.goto("https://fancentro.mainhub.com/posts/create-page");
      const tokenRequest = await tokenPromise;
      const url = tokenRequest.url();
      const urlObj = new URL(url);
      const token = urlObj.searchParams.get('token');
      this.token = token || "";
      let tagIds: number[] = [];
      let tagInfos: { id: number, name: string }[] = [];
      let postTags: string[] = tags;
      if (tags.length < 3)
        postTags.push("sexy", "hot", "booty");
      for (var tag of postTags) {
        const tagId = await this.getTagId(tag);
        if (tagId && !tagIds.includes(tagId)) {
          tagIds.push(tagId)
          tagInfos.push({ id: tagId, name: tag });
        }
      }
      let params;
      switch (postType) {
        case PostType.FANS:
          params = {
            "title": title,
            "description": "",
            "published_at": moment().isAfter(scheduledAt, "hour") ? moment().add(1, "hour").format('YYYY-MM-DD HH:mm:ss') : moment(scheduledAt).format('YYYY-MM-DD HH:mm:ss'),
            "expired_at": "",
            "privacy": "paid_subscribers",
            "publication_channel": "instant",
            "tagIds": tagIds,
            "tags": tagInfos,
            "media": mediaIds.map((mediaId, index) => ({ "id": mediaId, "isFreePreview": false, "order": index + 1 })),
            "token": this.token
          }
          break;
        case PostType.PAID:
          params = {
            "title": title,
            "description": "",
            "published_at": moment().isAfter(scheduledAt, "hour") ? moment().add(1, "hour").format('YYYY-MM-DD HH:mm:ss') : moment(scheduledAt).format('YYYY-MM-DD HH:mm:ss'),
            "expired_at": "",
            "privacy": "paid_subscribers",
            "price": `${price || 0}`,
            "publication_channel": "instant",
            "tagIds": tagIds,
            "tags": tagInfos,
            "media": mediaIds.map((mediaId, index) => ({ "id": mediaId, "isFreePreview": false, "order": index + 1 })),
            "token": this.token
          }
          break;
        default:
          params = {
            "title": title,
            "description": "",
            "published_at": moment().isAfter(scheduledAt, "hour") ? moment().add(1, "hour").format('YYYY-MM-DD HH:mm:ss') : moment(scheduledAt).format('YYYY-MM-DD HH:mm:ss'),
            "expired_at": "",
            "privacy": "public",
            "publication_channel": "instant",
            "tagIds": tagIds,
            "tags": tagInfos,
            "media": mediaIds.map((mediaId, index) => ({ "id": mediaId, "isFreePreview": false, "order": index + 1 })),
            "token": this.token
          }
          break
      }
      const resp = await this.page.request.post("https://fancentro.mainhub.com/posts/create", {
        headers: this.headers,
        data: params,
      });
      if (!resp.ok()) throw new BotError("schedule post failed", {
        where: "FancentroBrowser::schedulePost",
        method: "POST",
        endpoint: "https://fancentro.mainhub.com/posts/create",
        params: JSON.stringify(params),
        status: resp.statusText(),
        response: await resp.text()
      });
      const respData = await resp.json();
      if (!respData.data?.id) throw new BotError("schedule post failed", {
        where: "FancentroBrowser::schedulePost",
        method: "POST",
        endpoint: "https://fancentro.mainhub.com/posts/create",
        params: JSON.stringify(params),
        status: resp.statusText(),
        response: await resp.text()
      });
      return respData.data?.id;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("schedule post failed", {
        where: "FancentroBrowser::schedulePost",
        error: error.message
      })
    }
  }

  private sumAmounts(obj: any) {
    if (!obj)
      return 0;
    let sum = 0;
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (key === 'amount' && typeof val === 'number') {
          sum += val;
        } else {
          sum += this.sumAmounts(val);
        }
      }
    }
    return sum;
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const earningPromise = this.page.waitForResponse(response => response.url().includes("https://fancentro.mainhub.com/earnings/fancentro/by-user-earnings-source"));
      await this.page.goto("https://fancentro.mainhub.com/earnings/fancentro/overview");
      const earningResp = await earningPromise;
      if (!earningResp.ok())
        throw new BotError("get earnings failed");
      const earningData = await earningResp.json();
      const revenue = this.sumAmounts(earningData.data);
      return revenue;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get earnings failed", {
        where: "FancentroBrowser::getMonthlyEarnings",
        error: error.message
      });
    }
  }

  public async getFeed(): Promise<IFancentroFeed[]> {
    try {
      const resp = await this.page.request.get("https://fancentro.com/api/content/content", {
        headers: this.apiHeader,
        params: { page: 1, page_size: 22, sorting: "newest", filter: "public", source: "discover", type: "post" }
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FancentroBrowser::getFeed"
          });
        throw new BotError("get feed failed", {
          where: "FancentroBrowser::getFeed",
          method: "GET",
          endpoint: "https://fancentro.mainhub.com/posts/feed",
          status: resp.statusText(),
          response: await resp.text()
        })
      }
      const respData = await resp.json();
      const feeds = respData.data || [];
      return feeds;
    }
    catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get feed failed", {
        where: "FancentroBrowser::getFeed",
        error: error.message,

      });
    }
  }

  public async commentPost(postId: number, comment: string) {
    try {
      const resp = await this.page.request.post(`https://fancentro.com/api/content/comment/post`, {
        headers: this.apiHeader,
        data: { post_id: postId, comment }
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FancentroBrowser::commentPost"
          });
        throw new BotError("comment post failed", {
          where: "FancentroBrowser::commentPost",
          method: "POST",
          endpoint: `https://fancentro.com/api/content/comment/post`,
          status: resp.statusText(),
          response: await resp.text()
        });
      }
      // const respData = await resp.json();
      return;
    }
    catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("comment post failed", {
        where: "FancentroBrowser::commentPost",
        error: error.message,
      });
    }
  }

  public async likePost(postId: number): Promise<boolean> {
    try {
      const resp = await this.page.request.post(`https://fancentro.com/api/content/like`, {
        headers: this.apiHeader,
        data: { contentId: postId, contentType: "post" }
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FancentroBrowser::likePost"
          });
        throw new BotError("like post failed", {
          where: "FancentroBrowser::likePost",
          method: "POST",
          endpoint: `https://fancentro.com/api/content/like`,
          status: resp.statusText(),
          response: await resp.text()
        });
      }
      const respData = await resp.json();
      return respData.total > 0;
    }
    catch (error: any) {
      if (error instanceof BotError) throw error;
      throw new BotError("like post failed", {
        where: "FancentroBrowser::likePost",
        error: error.message,
      });
    }
  }

  public async refreshApiSession() {
    try {
      const viewPromise = this.page.waitForResponse("https://fancentro.com/api/v1/api/viewData");
      await this.page.goto(`https://fancentro.com/${this.profile.alias}`);
      const viewResp = await viewPromise;
      if (!viewResp.ok()) {
        throw new BotError("refresh session failed", {
          where: "FancentroBrowser::refreshApiSession",
          method: "GET",
          endpoint: "https://fancentro.com/api/v1/api/viewData",
          status: viewResp.statusText(),
        });
      }
      this.apiHeader = await viewResp.request().allHeaders();
      this.logger.info("refresh api session");
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("refresh session failed", {
        where: "FancentroBrowser::refreshApiSession",
        error: error.message,
      });
    }
  }
}

