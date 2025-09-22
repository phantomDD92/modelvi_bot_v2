import axios from "axios";
import { IAccountID, IAccountSettings, IBotConfig, ICommentParams, ICommentUser, ILog, ISchedulePost, IScheduleResult } from "../types/interface";
import { Logger } from "../utils/logger";
import { ApiError, BotError } from "../utils/error";

export class PostApiService {
  protected config: IBotConfig;
  protected logger: Logger;
  protected token!: string;

  constructor(config: IBotConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  // int api service 
  public async init(): Promise<void> {
    // get bot api-key from server
    const { token } = await this.postRequest(
      `/platform/${this.config.platform}`,
      { alias: Buffer.from(this.config.alias).toString('base64') }
    );
    this.token = token;
    await this.logger.info("init service success");
  }

  public async getTeams(): Promise<string[]> {
    const payload = await this.getRequest(`/platform/${this.config.platform}`);
    return payload.accounts || [];
  }

  public async checkBalance(revenue: number): Promise<boolean> {
    const payload = await this.postRequest(`/balance`, { revenue });
    return payload.available;
  }

  public async changeProxy(): Promise<void> {
    await this.putRequest(`/proxy`);
  }

  public async getAccountSettings(): Promise<IAccountSettings> {
    const payload = await this.getRequest(`/account`);
    return payload.account;
  }

  public async updateContents(): Promise<void> {
    const payload = await this.postRequest(`/account`, { subject: "update_contents" });
    return payload.count || 0;
  }

  public async updateContentMedia(contentIndex: number, uuid: string): Promise<void> {
    await this.postRequest(`/account`, { subject: 'content_media', id: contentIndex, uuid });
  }

  public async updatePostSetting(next: boolean = false, postId: string | undefined = undefined, deleteIds: string[]): Promise<string[]> {
    const payload = await this.postRequest(`/account`, { subject: 'post_setting', postId, next, deleteIds });
    return payload.deleteIds || []
  }

  public async updatePostResult(result: number, postId: string | undefined = undefined, deleteIds: string[] = [], nextTimeLimit: Date | undefined = undefined): Promise<void> {
    await this.postRequest(`/account`, { subject: 'post_result', result, postId, deleteIds, nextTimeLimit });

  }


  public async updateId(idInfo: IAccountID): Promise<void> {
    await this.postRequest(`/account`, { subject: 'update_id', alias: idInfo.alias, identifier: idInfo.id });

  }

  public async updateStorySetting(index: number): Promise<void> {
    await this.postRequest(`/account`, { subject: 'story_setting', index });

  }

  public async updateChatSetting(): Promise<void> {
    await this.postRequest(`/account`, { subject: 'chat_setting' });
  }

  public async updateScheduleSetting(): Promise<ISchedulePost[]> {
    const payload = await this.postRequest(`/account`, { subject: 'schedule_setting' });
    return payload?.schedules || [];
  }

  public async updateScheduleResults(results: IScheduleResult[]): Promise<void> {
    await this.postRequest(`/account`, { subject: 'schedule_results', results });

  }

  public async updateScheduleResult(result: IScheduleResult): Promise<void> {
    await this.postRequest(`/account`, { subject: 'schedule_result', result });

  }

  public async updateCommentSetting(): Promise<ICommentParams> {
    const { comments, users } = await this.postRequest(`/account`, { subject: 'comment_setting' });
    return ({
      comments: comments || [],
      block_users: (users || []).filter((user: ICommentUser) => user.status === "block").map((user: ICommentUser) => user.alias)
    });
  }

  public async createLog(log: ILog): Promise<void> {
    this.logger.info(log.message);
    await this.postRequest(`/log`, log);
  }

  public async createHistory(action: string): Promise<void> {
    await this.postRequest(`/history`, { action });
  }

  public async setLastError(message: string, disabled: boolean = false): Promise<void> {
    await this.putRequest(`/history`, { action: message, disabled });
  }

  public async clearError(): Promise<void> {
    await this.deleteRequest(`/history`);
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
        throw new ApiError("bad api response", {
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
        throw new ApiError("bad api permission", { method: "GET", path: path, });
      } else if (error.response?.status === 404) {
        throw new ApiError("bad api request", { method: "GET", path: path, });
      } else {
        throw new ApiError("internal api failure", { method: "GET", path: path, });
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
      if (error instanceof BotError) {
        throw error;
      } else if (error.response?.status === 401) {
        throw new ApiError("bad api permission", { method: "PUT", path: path, });
      } else if (error.response?.status === 404) {
        throw new ApiError("bad api request", { method: "PUT", path: path, });
      } else {
        throw new ApiError("internal api failure", { method: "PUT", path: path, });
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
      if (error instanceof BotError) {
        throw error;
      } else if (error.response?.status === 401) {
        throw new ApiError("bad api permission", { method: "POST", path: path, });
      } else if (error.response?.status === 404) {
        throw new ApiError("bad api request", { method: "POST", path: path, });
      } else {
        throw new ApiError("internal api failure", { method: "POST", path: path, });
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
      if (error instanceof BotError) {
        throw error;
      } else if (error.response?.status === 401) {
        throw new ApiError("bad api permission", { method: "DELETE", path: path, });
      } else if (error.response?.status === 404) {
        throw new ApiError("bad api request", { method: "DELETE", path: path, });
      } else {
        throw new ApiError("internal api failure", { method: "DELETE", path: path, });
      }
    }
  }
}

