import axios from "axios";
import { IBotInfo, IConsoleConfig } from "../types/interface";
import { ConsoleError } from "./error";
import { Platform } from "../types/constant";

export class ConsoleService {
  private config: IConsoleConfig;

  constructor(config: IConsoleConfig) {
    this.config = config;
  }

  public async getRunnableBots(): Promise<IBotInfo[]> {
    try {
      let endpoint = `/post/platform/${this.config.platform}`;
      if (this.config.platform == Platform.FANLIKE)
        endpoint = `/like/platform/${this.config.platform}`;
      const payload = await this.getRequest(endpoint)
      return payload?.accounts || [];
    } catch (e) {
      return [];
    }
  }

  protected async getRequest(path: string, params: any = undefined) {
    try {
      const resp = await axios.get(`${this.config.server_root}/api/v2/bot${path}`, { params, timeout: 15000 });
      const { success, message, payload } = resp.data;
      if (!success)
        throw new ConsoleError(message, path);
      return payload;
    } catch (error: any) {
      console.error(error);
      if (error instanceof ConsoleError) {
        throw error;
      } else if (error.response?.status === 401) {
        throw new ConsoleError("permission denied", path);
      } else if (error.response?.status === 404) {
        throw new ConsoleError("invalid api", path);
      } else {
        throw new ConsoleError("server connection failed", path);
      }
    }
  }
};
