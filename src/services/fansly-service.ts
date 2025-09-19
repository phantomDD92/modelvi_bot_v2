import { IBotConfig } from "../types/interface";
import { BotError } from "../utils/error";
import { Logger } from "../utils/logger";
import { PostApiService } from "./post-service";

// Api Service For Fansly Bot
export class FanslyService extends PostApiService {

  // constructor
  constructor(config: IBotConfig, logger: Logger) {
    super(config, logger)
  }

  public async updateContentPreview(contentIndex: number, uuid: string): Promise<void> {
    try {
      await this.postRequest(`/account`, { subject: 'content_preview', id: contentIndex, uuid });
    } catch (error: any) {
      throw new BotError("update content preview failed", {
        where: "FanslyService::updateContentPreview",
        endpoint: '/account',
        error: error.message,
        stack: error.stack
      });
    }
  }

}

