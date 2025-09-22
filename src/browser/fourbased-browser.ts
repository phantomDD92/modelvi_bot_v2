import moment from "moment";
import { BotError, ProxyError, SessionTimeoutError } from "../utils/error";
import { IFourBasedChat, IFourBasedPost, IFourBasedProfile, IFourBasedUser, IFourBasedVault } from "../types/fourbased";
import { IAccountID, IAccountSettings, IChatMessage } from "../types/interface";
import { BaseBrowser } from "./base-browser";
import { HttpStatusCode } from "axios";

export class FourBasedBrowser extends BaseBrowser {

  protected profile!: IFourBasedProfile;

  public async home(): Promise<void> {
    try {
      await this.page.goto("https://4based.com", { timeout: 120000 });
    } catch (error: any) {
      throw new ProxyError("invalid proxy", {
        where: "FourBasedBrowser::home",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
    try {
      await this.page.goto("https://4based.com/login", { timeout: 120000 });

      await this.page.locator("input#email").fill(setting.email);
      await this.page.locator("input#current-password").fill(setting.password);

      const loginPromise = this.page.waitForResponse(response => {
        return response.url().includes("https://rest.4based.com/api/1.0/auth/login") && response.request().method() === "POST"
      }, { timeout: 180000 });
      const basePromise = this.page.waitForResponse(response => {
        return response.url().includes("https://rest.4based.com/api/1.0/base") && response.request().method() === "GET"
      }, { timeout: 180000 });

      await this.page.locator("auth-login ion-button.submit-button").click();
      const [loginResp, baseResp] = await Promise.all([loginPromise, basePromise]);
      if (!loginResp.ok()) throw new BotError("wrong credentials", {
        where: "FourBasedBrowser::login",
        method: "POST",
        endpoint: "https://rest.4based.com/api/1.0/auth/login",
        params: loginResp.request().postDataJSON(),
        status: loginResp.statusText(),
        response: await loginResp.json()
      })
      const loginData = await loginResp.json();
      this.profile = loginData.user;
      // const baseResp = await basePromise;
      if (!baseResp.ok()) throw new BotError("login failed", {
        where: "FourBasedBrowser::login",
        method: "GET",
        endpoint: "https://rest.4based.com/api/1.0/base",
        status: baseResp.statusText(),
        response: await baseResp.json()
      });
      this.headers = await baseResp.request().allHeaders();
      return { alias: this.profile.name, id: this.profile._id };
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("login failed", {
        where: "FourBasedBrowser::login",
        error: error.message,
        stack: error.stack,
      });
    }

  }

  // public async getProfile(): Promise<void> {
  //   try {
  //     const resp = await this.page.request.get(`https://rest.4based.com/api/1.0/user/${this.profile._id}`, {
  //       headers: this.headers
  //     });
  //     if (!resp.ok())
  //       throw new BotError("get profile failed", {
  //         where: "FourBasedBrowser::getProfile",
  //         method: "GET",
  //         endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}`,
  //         status: resp.statusText(),
  //         response: await resp.text(),
  //         headers: this.headers
  //       });
  //     const respData = await resp.json();
  //     this.profile = respData;
  //   } catch (error: any) {
  //     if (error instanceof BotError)
  //       throw error;
  //     throw new BotError("get profile failed", {
  //       where: "FourBasedBrowser::getProfile",
  //       error: error.message,
  //       stack: error.stack,
  //     });
  //   }
  // }

  public async getFolder(folderName: string) {
    try {
      const resp = await this.page.request.get(`https://rest.4based.com/api/1.0/user/${this.profile._id}`, {
        headers: this.headers
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FourBasedBrowser::getFolder"
          })
        throw new BotError("get folders failed", {
          where: "FourBasedBrowser::getProfile",
          method: "GET",
          endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}`,
          status: resp.statusText(),
          response: await resp.text(),
          headers: this.headers
        });
      }
      const respData = await resp.json();
      const folders = respData.folders || [];
      if (folders.includes(folderName))
        return;
      folders.push(folderName);
      const resp1 = await this.page.request.put(`https://rest.4based.com/api/1.0/user/${this.profile._id}`, {
        headers: this.headers,
        data: { folders }
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FourBasedBrowser::getFolder"
          })
        throw new BotError("create folder failed", {
          where: "FourBasedBrowser::getFolder",
          method: "PUT",
          endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}`,
          params: { folders },
          status: resp.statusText(),
          response: resp1.text(),
        });
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get folder failed", {
        where: "FourBasedBrowser::getFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async findVaultInFolder(folderName: string, vaultId: string): Promise<string | undefined> {
    try {
      let vault;
      let offset = 0;
      while (true) {
        const resp = await this.page.request.get(`https://rest.4based.com/api/1.0/user/${this.profile._id}/vault`, {
          headers: this.headers,
          params: {
            offset: offset,
            limit: 100,
            sort: JSON.stringify({ "created_at": "desc" }),
            with_source: true,
            belongs_to_folders: folderName,
          }
        });
        const respData = await resp.json();
        if (!resp.ok()) {
          if (resp.status() == HttpStatusCode.Unauthorized)
            throw new SessionTimeoutError("session timeout", {
              where: "FourBasedBrowser::findVaultInFolder"
            });
          throw new BotError("find vault failed", {
            where: "FourBasedBrowser::findVaultInFolder",
            method: "GET",
            endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}/vault`,
            params: {
              offset: 0,
              limit: 100,
              sort: JSON.stringify({ "created_at": "desc" }),
              with_source: true,
              belongs_to_folders: folderName,
            },
            status: resp.statusText(),
          });
        }
        if (resp.status() == HttpStatusCode.NoContent)
          break;
        const vaults: IFourBasedVault[] = respData || [];
        vault = vaults.find(item => item._id == vaultId);
        if (vault)
          break;
        if (vaults.length < 100)
          break;
        offset += 100;
      }
      return vault?._id
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("find vault failed", {
        where: "FourBasedBrowser::findVaultInFolder",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async createVault(mediaPath: string): Promise<string | undefined> {
    try {
      await this.page.goto("https://4based.com/cloud");
      await this.page.locator("div.own-toolbar > icon-bar > ion-buttons > ion-button.add").first().click();

      // upload media
      await this.page.locator("ion-modal.modal-upload > modal-upload input#upload").setInputFiles(mediaPath);
      // click continue
      await this.page.locator("ion-modal.modal-upload > modal-upload file-stack-preview").waitFor();
      await this.page.locator("ion-modal.modal-upload > modal-upload > ion-footer > ion-toolbar > ion-button").last().click();

      const vaultPromise = this.page.waitForResponse(response => {
        return response.url().includes("https://storage.4based.com/api/1.0/user") && response.request().method() === "POST"
      }, { timeout: 180000 });
      await this.page.locator("ion-modal.modal-upload > modal-upload file-stack-edit").waitFor();
      await this.page.locator("ion-modal.modal-upload > modal-upload > ion-footer > ion-toolbar > ion-button").last().click();
      const vaultResp = await vaultPromise;
      const vaultData = await vaultResp.json();
      if (!vaultResp.ok() || !vaultData.complete) throw new BotError("create vault failed", {
        where: "FourBasedBrowser::createVault",
        method: "POST",
        endpoint: vaultResp.url(),
        status: vaultResp.statusText(),
        response: vaultData,
      });
      if (vaultData.vault && vaultData.vault.length > 0)
        return vaultData.vault[0]._id;
      return undefined;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("create vault failed", {
        where: "FourBasedBrowser::createVault",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async moveVaultToFolder(vaultId: string, folderName: string) {
    try {
      const resp = await this.page.request.put(`https://rest.4based.com/api/1.0/user/${this.profile._id}/vault`, {
        headers: this.headers,
        data: { belongs_to_folders: [folderName], ids: [vaultId] }
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FourBasedBrowser::moveVaultToFolder"
          });
        throw new BotError("move vault failed", {
          where: "FourBasedBrowser::moveVaultToFolder",
          method: "PUT",
          endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}/vault`,
          status: resp.statusText(),
          response: await resp.json()
        });
      }
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("move vault failed", {
        where: "FourBasedBrowser::moveVaultToFolder",
        error: error.message,
        stack: error.stack,
      });
    }

  }

  private UniqueID() {
    function chr4() {
      return Math.random().toString(16).slice(-4);
    }

    return chr4() + chr4() +
      '-' + chr4() +
      '-' + chr4() +
      '-' + chr4() +
      '-' + chr4() + chr4() + chr4();
  };

  public async schedulePost(scheduledAt: Date, title: string, mediaId: string, type?: number, price?: number) {
    try {
      const guid = this.UniqueID();
      const params = {
        "vaults_to_file_stack": {
          "vaults": [
            { "id": mediaId, "guid": guid, "position": 0 }
          ],
          "description": title,
          "price": (price || 0) * 100,
          "to_be_posted_at": moment(scheduledAt).utc().format("YYYY-MM-DD HH:mm:ss"),
          "status": "to_be_posted",
          "is_subscription_item": false,
          "additional_categories": ["media"],
          "guid": guid
        }
      }
      const resp = await this.page.request.post(`https://rest.4based.com/api/1.0/user/${this.profile._id}/file-stack/`, {
        headers: this.headers,
        data: params
      })
      const respData = await resp.json();
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FourBasedBrowser::schedulePost"
          });
        throw new BotError("schedule post failed", {
          where: "FourBasedBrowser::schedulePost",
          method: "POST",
          endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}/file-stack/`,
          params,
          status: resp.statusText(),
          response: respData
        });
      }
      return respData._id;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("schedule post failed", {
        where: "FourBasedBrowser::schedulePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async deletePost(postId: string): Promise<void> {
    try {
      const resp = await this.page.request.delete(`https://rest.4based.com/api/1.0/user/${this.profile._id}/file-stack/${postId}`, {
        headers: this.headers
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FourBasedBrowser::deletePost"
          });
        throw new BotError("delete post failed", {
          where: "FourBasedBrowser::deletePost",
          method: "DELETE",
          endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}/file-stack/${postId}`,
          status: resp.statusText(),
        });
      }

    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("delete post failed", {
        where: "FourBasedBrowser::deletePost",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getSelfPosts(): Promise<string[]> {
    try {
      let postIds = [];
      let offset = 0;
      let page = 0;
      while (true) {
        const resp = await this.page.request.get(`https://rest.4based.com/api/1.0/user/${this.profile._id}/file-stack`, {
          headers: this.headers,
          params: {
            offset,
            limit: 24,
            categories: "media",
            sort: JSON.stringify({ created_at: "desc" }),
            is_subscription_item: false
          }
        });
        // const respData = await resp.json();
        if (!resp.ok()) {
          if (resp.status() == HttpStatusCode.Unauthorized)
            throw new SessionTimeoutError("session timeout", {
              where: "FourBasedBrowser::getSelfPosts"
            });
          throw new BotError("get self posts failed", {
            where: "FourBasedBrowser::getSelfPosts",
            method: "GET",
            endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}/file-stack`,
            params: {
              offset,
              limit: 24,
              categories: "media",
              sort: JSON.stringify({ created_at: "desc" }),
              is_subscription_item: false
            },
            status: resp.statusText(),
            response: await resp.text()
          });
        }
        if (resp.status() == HttpStatusCode.NoContent)
          break;
        const respData = await resp.json();
        const posts: IFourBasedPost[] = respData || [];
        postIds.push(...posts.map(post => post._id));
        if (posts.length < 24)
          break;
        page += 1;
        if (page > 5)
          break;
        offset += 24;
      }
      return postIds;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get posts failed", {
        where: "FourBasedBrowser::getSelfPosts",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public async getFollowers(userId: string): Promise<IFourBasedUser[]> {
    try {
      const resp = await this.page.request.get(`https://rest.4based.com/api/1.0/user/${this.profile._id}/follower`, {
        headers: this.headers,
        params: { offset: 0, limit: 40, search: "", sort: "%7B%22created_at%22%3A%22desc%22%7D" }
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FourBasedBrowser::getFollowers"
          });
        throw new BotError("get followers failed", {
          where: "FourBasedBrowser::getFollowers",
          method: "GET",
          endpoint: `https://rest.4based.com/api/1.0/user/${userId}/follower`,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData: IFourBasedUser[] = await resp.json();
      return respData.filter(user => !user.creator);
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get followers failed", {
        where: "FourBasedBrowser::getFollowers",
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getMonthlyEarnings(): Promise<number> {
    try {
      const from = moment().subtract(30, "day").startOf("day");
      const to = moment().endOf("day");
      const params = {
        statistic_type: "all",
        limit: 40,
        sort: JSON.stringify({ "created_at": "desc" }),
        offset: 0,
        bookingdate_from: from.format("YYYY-MM-DD HH:mm:ss"),
        bookingdate_to: to.format("YYYY-MM-DD HH:mm:ss"),
        type: "share",
        with_invoice: true,
        with_buyer: true,
        with_file_stack: true,
      }
      const resp = await this.page.request.get(`https://rest.4based.com/api/1.0/user/${this.profile._id}/process/sum/netto`, {
        headers: this.headers,
        params
      });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FourBasedBrowser::getMonthlyEarnings"
          });
        throw new BotError("get earnings failed", {
          where: "FourBasedBrowser::getMonthlyEarnings",
          method: "GET",
          endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}/process/sum/netto`,
          params,
          status: resp.statusText(),
          response: await resp.text()
        })
      }
      const respData = await resp.text();
      return parseFloat(respData || "0");
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get earnings failed", {
        where: "FourBasedBrowser::getMonthlyEarnings",
        error: error.message,
        stack: error.stack
      })
    }
  }

  public async getUnreadChats(): Promise<IChatMessage[]> {
    try {
      const params = {
        with_users: true,
        deleted_user_id: this.profile._id,
        with_last_message: true,
        without_empty_chats: true,
        limit: 30,
        offset: 0,
        sort: JSON.stringify({ "chat_updated_at": "desc" }),
        list_names: "unread"
      }
      const resp = await this.page.request.get(
        `https://rest.4based.com/api/1.0/user/${this.profile._id}/chatsByList`,
        { headers: this.headers, params });
      if (!resp.ok()) {
        if (resp.status() == HttpStatusCode.Unauthorized)
          throw new SessionTimeoutError("session timeout", {
            where: "FourBasedBrowser::getUnreadChats"
          });
        throw new BotError("get chats failed", {
          where: "FourBasedBrowser::getUnreadChats",
          method: "GET",
          endpoint: `https://rest.4based.com/api/1.0/user/${this.profile._id}/chatsByList`,
          params,
          status: resp.statusText(),
          response: await resp.text(),
        });
      }
      const respData = await resp.json();
      const chats: IFourBasedChat[] = respData || [];
      const messages: IChatMessage[] = chats.map(chat => {
        const user = chat.users.find(item => item._id == chat.last_message.user_id);
        return ({ user: user?.name || "", message: chat.last_message.message, time: moment.utc(chat.last_message.created_at, 'YYYY-MM-DD HH:mm:ss').toDate() })
      }).filter(chat => chat.user != "4based")
      return messages;
    } catch (error: any) {
      if (error instanceof BotError)
        throw error;
      throw new BotError("get chats failed", {
        where: "FourBasedBrowser::getUnreadChats",
        error: error.message,
        stack: error.stack
      })
    }
  }

  public async refreshSession(): Promise<void> {
    try {
      const profilePromise = this.page.waitForRequest(`https://rest.4based.com/api/1.0/user/name/${this.profile.name}`);
      await this.page.goto(`https://4based.com/profile/${this.profile.name}`);
      const profileReq = await profilePromise;
      this.headers = await profileReq.allHeaders();
    } catch (error: any) {
      throw new BotError("refresh session failed", {
        where: "FourBasedBrowser::refreshSession",
        error: error.message,
        stack: error.stack,
      })
    }
  }
}