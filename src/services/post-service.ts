import axios from "axios";
import { IAccountID, IAccountSettings, IBotConfig, ICommentParams, ICommentUser, ISchedulePost, IScheduleResult } from "../types/interface";
import { Logger } from "../utils/logger";
import { ApiError, BotError } from "../utils/error";
import { PostResultType } from "../types/constant";

export class PostApiService {
  protected config: IBotConfig;
  protected logger: Logger;
  protected token!: string;

  constructor(config: IBotConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  // int api service 
  public async init(): Promise<boolean> {
    try {
      // get bot api-key from server
      const { token } = await this.postRequest(
        `/platform/${this.config.platform}`,
        { alias: Buffer.from(this.config.alias).toString('base64') }
      );
      this.token = token;
      await this.logger.info("init service success");
      return true;
    } catch (error: any) {
      console.error(error);
      await this.logger.warn("init service failed");
      return false;
    }
  }

  public async getTeams(): Promise<string[]> {
    try {
      const { accounts } = await this.getRequest(`/platform/${this.config.platform}`);
      return accounts;
    } catch (error: any) {
      throw new BotError("get teams failed", {
        where: "BaseService::getTeams",
        method: "GET",
        path: `/platform/${this.config.platform}`,
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async checkBalance(revenue: number): Promise<boolean> {
    try {
      const { available } = await this.postRequest(`/balance`, { revenue });
      return available;
    } catch (error: any) {
      throw new BotError("check balance failed");
    }
  }


  public async changeProxy(): Promise<void> {
    try {
      await this.putRequest(`/proxy`);
    } catch (error: any) {
      throw new BotError("change proxy failed", {
        where: "BaseService::changeProxy",
        path: '/proxy',
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async getAccountSettings(): Promise<IAccountSettings> {
    try {
      const { account } = await this.getRequest(`/account`);
      return account;
    } catch (error: any) {
      console.error(error)
      throw new BotError("invalid account", {
        where: "BaseService::getAccountSettings",
        path: '/account',
        error: error.message,
        stack: error.stack,
      })
    }
  }

  public async updateContents(): Promise<void> {
    try {
      const { count } = await this.postRequest(`/account`, { subject: "update_contents" });
      return count;
    } catch (error: any) {
      throw new BotError("update contents failed", {
        where: "BaseService::updateContents",
        path: '/account',
        error: error.message,
      })
    }
  }

  public async updateContentMedia(contentIndex: number, uuid: string): Promise<void> {
    try {
      await this.postRequest(`/account`, { subject: 'content_media', id: contentIndex, uuid });
    } catch (error: any) {
      throw new BotError("update content failed", {
        where: "BaseService::updateContent",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async updatePostSetting(next: boolean = false, postId: string | undefined = undefined, deleteIds: string[]): Promise<string[]> {
    try {
      const payload = await this.postRequest(`/account`, { subject: 'post_setting', postId, next, deleteIds });
      return payload.deleteIds || []
    } catch (error: any) {
      throw new BotError("update post setting failed", {
        where: "BaseService::updatePostSetting",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async updatePostResult(result: number, postId: string | undefined = undefined, deleteIds: string[] = [], nextTimeLimit: Date | undefined = undefined): Promise<void> {
    try {
      await this.postRequest(`/account`, { subject: 'post_result', result, postId, deleteIds, nextTimeLimit });
    } catch (error: any) {
      throw new BotError("update posting result failed", {
        where: "BaseService::updatePostResult",
        path: '/account',
        error: error.message,
      });
    }
  }


  public async updateId(idInfo: IAccountID): Promise<void> {
    try {
      await this.postRequest(`/account`, { subject: 'update_id', alias: idInfo.alias, identifier: idInfo.id });
      return;
    } catch (error: any) {
      throw new BotError("update id failed", {
        where: "BaseService::updateId",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async updateStorySetting(index: number): Promise<void> {
    try {
      await this.postRequest(`/account`, { subject: 'story_setting', index });
    } catch (error: any) {
      throw new BotError("update story setting failed", {
        where: "BaseService::updateStorySetting",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async updateChatSetting(): Promise<void> {
    try {
      await this.postRequest(`/account`, { subject: 'chat_setting' });
    } catch (error: any) {
      throw new BotError("update chat setting failed", {
        where: "BaseService::updateChatSetting",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async updateScheduleSetting(): Promise<ISchedulePost[]> {
    try {
      const payload = await this.postRequest(`/account`, { subject: 'schedule_setting' });
      return payload?.schedules || [];
    } catch (error: any) {
      console.error(error)
      throw new BotError("update schedule setting failed", {
        where: "BaseService::updateScheduleSetting",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async updateScheduleResults(results: IScheduleResult[]): Promise<void> {
    try {
      await this.postRequest(`/account`, { subject: 'schedule_results', results });
    } catch (error: any) {
      throw new BotError("update schedule results failed", {
        where: "BaseService::updateScheduleResults",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async updateScheduleResult(result: IScheduleResult): Promise<void> {
    try {
      await this.postRequest(`/account`, { subject: 'schedule_result', result });
    } catch (error: any) {
      throw new BotError("update schedule results failed", {
        where: "BaseService::updateScheduleResults",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async updateCommentSetting(): Promise<ICommentParams> {
    try {
      const { comments, users } = await this.postRequest(`/account`, { subject: 'comment_setting' });
      return ({
        comments,
        block_users: users.filter((user: ICommentUser) => user.status === "block").map((user: ICommentUser) => user.alias)
      });
    } catch (error: any) {
      throw new BotError("update comment setting failed", {
        where: "BaseService::updateCommentSetting",
        path: '/account',
        error: error.message,
      });
    }
  }

  public async createLog(success: boolean, action: number, log: string, extra: any = {}): Promise<void> {
    try {
      this.logger.info(log);
      await this.postRequest(`/log`, { action, success, log, extra });
    } catch (error: any) {
    }
  }

  public async createHistory(action: string): Promise<void> {
    try {
      this.logger.info(action);
      await this.postRequest(`/history`, { action });
    } catch (error: any) {
    }
  }

  public async setLastError(message: string, disabled: boolean = false): Promise<void> {
    try {
      await this.putRequest(`/history`, { action: message, disabled });
    } catch (error: any) {
    }
  }

  public async clearError(): Promise<void> {
    try {
      await this.deleteRequest(`/history`);
    } catch (error: any) {
      throw new BotError("clear error failed", {
        where: "BaseService::clearError",
        path: '/history',
        error: error.message,
      });
    }
  }

  protected async getRequest(path: string, params: any = undefined) {
    try {
      const resp = await axios.get(
        `${this.config.server_root}/api/v2/bot/post${path}`,
        {
          headers: this.token ? { "Authorization": `Bearer ${this.token}` } : {},
          params
        });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new BotError("Bot api bad response", {
          method: "GET",
          path: path,
          message: message,
          params
        });
      return payload;
    } catch (error: any) {
      if (error instanceof BotError) {
        throw error;
      } else if (error.response?.status === 401) {
        throw new BotError("permission denied", { path });
      } else if (error.response?.status === 404) {
        throw new ApiError("invalid api", path);
      } else {
        throw new ApiError("server connection failed", path);
      }
    }
  }

  protected async putRequest(path: string, data: any = undefined, params: any = undefined) {
    try {
      const resp = await axios.put(
        `${this.config.server_root}/api/v2/bot/post${path}`,
        data,
        {
          headers: this.token ? { "Authorization": `Bearer ${this.token}` } : {},
          params
        });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new ApiError(message, path);
      return payload;
    } catch (error: any) {
      if (error instanceof ApiError) {
        throw error;
      } else if (error.response?.status === 401) {
        throw new ApiError("permission denied", path);
      } else if (error.response?.status === 404) {
        throw new ApiError("invalid api", path);
      } else {
        throw new ApiError("server connection failed", path);
      }
    }
  }

  protected async postRequest(path: string, data: any = undefined, params: any = undefined) {
    try {
      const resp = await axios.post(
        `${this.config.server_root}/api/v2/bot/post${path}`,
        data,
        {
          headers: this.token ? { "Authorization": `Bearer ${this.token}` } : {},
          params
        });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new ApiError(message, path);
      return payload;
    } catch (error: any) {
      console.error(error);
      if (error instanceof ApiError) {
        throw error;
      } else if (error.response?.status === 401) {
        throw new ApiError("permission denied", path);
      } else if (error.response?.status === 404) {
        throw new ApiError("invalid api", path);
      } else {
        throw new ApiError("server connection failed", path);
      }
    }
  }

  protected async deleteRequest(path: string, data: any = undefined, params: any = undefined) {
    try {
      const resp = await axios.delete(
        `${this.config.server_root}/api/v2/bot/post${path}`,
        {
          headers: this.token ? { "Authorization": `Bearer ${this.token}` } : {},
          data,
          params
        });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new ApiError(message, path);
      return payload;
    } catch (error: any) {
      if (error instanceof ApiError) {
        throw error;
      } else if (error.response?.status === 401) {
        throw new ApiError("permission denied", path);
      } else if (error.response?.status === 404) {
        throw new ApiError("invalid api", path);
      } else {
        throw new ApiError("server connection failed", path);
      }
    }
  }

}

