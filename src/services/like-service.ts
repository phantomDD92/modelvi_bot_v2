import axios from "axios";
import { IAccountSettings, IBotConfig, IModelInfo } from "../types/interface";
import { Logger } from "../utils/logger";
import { BotError } from "../utils/error";

export class LikeApiService {
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
      await this.logger.warn("init service failed");
      return false;
    }
  }

  // select proxy for proxy pool
  public async pickProxy(): Promise<string> {
    const { proxy } = await this.getRequest(`/proxy`);
    return proxy;
  }

  public async blockProxy(): Promise<void> {
    await this.putRequest(`/proxy`);
  }

  public async pickComments(count: number): Promise<string[]> {
    const { comments } = await this.postRequest(`/comment`, { count });
    return comments || [];
  }

  public async registerAccount(): Promise<void> {
    await this.putRequest(`/account`, { action: "register" });
  }

  public async verifyAccount(): Promise<void> {
    await this.putRequest(`/account`, { action: "verify" });
  }

  public async changeProxy(): Promise<void> {
    await this.putRequest(`/account`, { action: "proxy" });
  }

  public async setDevice(device: string,): Promise<void> {
    await this.putRequest(`/account`, { action: "device", device });
  }

  public async getTeamModels(platform: string): Promise<IModelInfo[]> {
    const { teams } = await this.getRequest(`/team/${platform}`);
    return teams || []
  }

  public async updateFollowSettings(count: number = 0) {
    await this.putRequest("/account", { action: "follow", count })
  }

  public async updateLikeSettings(likeCount: number = 0, commentCount: number = 0) {
    await this.putRequest("/account", { action: "like", likeCount, commentCount })
  }

  public async getAccountSettings(): Promise<IAccountSettings> {
    const { account } = await this.getRequest(`/account`);
    return account;
  }

  public async createHistory(action: string): Promise<void> {
    this.logger.info(action);
    await this.postRequest(`/history`, { action });
  }

  public async setLastError(message: string, disabled?: boolean): Promise<void> {
    this.logger.warn(message);
    await this.putRequest(`/history`, { action: message, disabled });
  }

  public async clearError(): Promise<void> {
    await this.putRequest(`/history`, { action: "" });
  }

  protected async getRequest(path: string, params: any = undefined) {
    try {
      const resp = await axios.get(
        `${this.config.server_root}/api/v2/bot/like${path}`,
        {
          headers: this.token ? { "Authorization": `Bearer ${this.token}` } : {},
          params
        });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new BotError("Bot Api Failed", {
          method: "GET",
          endpoint: `${this.config.server_root}/api/v2/bot/like${path}`,
          params,
          message: message,
        });
      return payload;
    } catch (error: any) {
      if (error instanceof BotError) {
        throw error;
      }
      throw new BotError("Bot Api Failed", {
        method: "GET",
        endpoint: `${this.config.server_root}/api/v2/bot/like${path}`,
        params,
        status: error.response?.status,
        response: error.response?.data
      });
    }
  }

  protected async putRequest(path: string, data: any = undefined, params: any = undefined) {
    try {
      const resp = await axios.put(
        `${this.config.server_root}/api/v2/bot/like${path}`,
        data,
        {
          headers: this.token ? { "Authorization": `Bearer ${this.token}` } : {},
          params
        });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new BotError("Bot Api Failed", {
          method: "PUT",
          endpoint: `${this.config.server_root}/api/v2/bot/like${path}`,
          params,
          data,
          message: message,
        });
      return payload;
    } catch (error: any) {
      if (error instanceof BotError) {
        throw error;
      }
      throw new BotError("Bot Api Failed", {
        method: "PUT",
        endpoint: `${this.config.server_root}/api/v2/bot/like${path}`,
        data,
        params,
        status: error.response?.status,
        response: error.response?.data
      });
    }
  }

  protected async postRequest(path: string, data: any = undefined, params: any = undefined) {
    try {
      const resp = await axios.post(
        `${this.config.server_root}/api/v2/bot/like${path}`,
        data,
        {
          headers: this.token ? { "Authorization": `Bearer ${this.token}` } : {},
          params
        });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new BotError("Bot Api Failed", {
          method: "POST",
          endpoint: `${this.config.server_root}/api/v2/bot/like${path}`,
          params,
          data,
          message: message,
        });
      return payload;
    } catch (error: any) {
      if (error instanceof BotError) {
        throw error;
      }
      throw new BotError("Bot Api Failed", {
        method: "POST",
        endpoint: `${this.config.server_root}/api/v2/bot/like${path}`,
        data,
        params,
        status: error.response?.status,
        response: error.response?.data
      });
    }
  }

  protected async deleteRequest(path: string, data: any = undefined, params: any = undefined) {
    try {
      const resp = await axios.delete(
        `${this.config.server_root}/api/v2/bot/like${path}`,
        {
          headers: this.token ? { "Authorization": `Bearer ${this.token}` } : {},
          data,
          params
        });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new BotError("Bot Api Failed", {
          method: "POST",
          endpoint: `${this.config.server_root}/api/v2/bot/like${path}`,
          params,
          data,
          message: message,
        });
      return payload;
    } catch (error: any) {
      if (error instanceof BotError) {
        throw error;
      }
      throw new BotError("Bot Api Failed", {
        method: "POST",
        endpoint: `${this.config.server_root}/api/v2/bot/like${path}`,
        data,
        params,
        status: error.response?.status,
        response: error.response?.data
      });
    }
  }
}

