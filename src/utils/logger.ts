import dotenv from 'dotenv';
import axios from "axios";
import { LOG_TIME_FORMAT, Platform } from "../types/constant";
import { IBotConfig } from "../types/interface";
import moment from 'moment';
import { BotError, ApiError } from "./error";

dotenv.config();

export class Logger {
  protected config: IBotConfig;

  constructor(config: IBotConfig) {
    this.config = config
  }

  public async info(message: string) {
    if (this.config.console_log) {
      console.log(`[${moment().format(LOG_TIME_FORMAT)} : ${this.config.platform} - ${this.config.alias}] : ${message}`)
    }
  }

  public async warn(message: string) {
    if (this.config.console_log) {
      console.warn(`[${moment().format(LOG_TIME_FORMAT)} : ${this.config.platform} - ${this.config.alias}] : ${message}`)
    }
  }

  public async error(error: Error) {
    if (this.config.console_log) {
      if (error instanceof BotError) {
        console.error(`[${moment().format(LOG_TIME_FORMAT)} : ${this.config.platform} - ${this.config.alias}] : [BotError] : ${error.message}`);
        console.error(error.reason);
      } else if (error instanceof ApiError) {
        console.error(`[${moment().format(LOG_TIME_FORMAT)} : ${this.config.platform} - ${this.config.alias}] : [ApiError] : ${error.message}`);
      } else {
        console.error(`[${moment().format(LOG_TIME_FORMAT)} : ${this.config.platform} - ${this.config.alias}] : [InternalError] : ${error.message}`)
      }
    }
  }

  public async notify(message: string): Promise<void> {
    if (this.config.channel_notify) {
      axios.post(this.config.channel_notify, {
        username: `${this.config.platform} - ${this.config.alias}`,
        content: `[ ${moment().format("YYYY-MM-DD HH:mm:ss")} ]\n${message}`,
      }).then(() => { }).catch(() => { });
    }
  }

  public async notifyAndWait(message: string): Promise<void> {
    try {
      if (this.config.channel_notify) {
        await axios.post(this.config.channel_notify, {
          username: `${this.config.platform} - ${this.config.alias}`,
          content: `[ ${moment().format("YYYY-MM-DD HH:mm:ss")} ]\n${message}`,
        });
      }
    } catch (error) {

    }
  }

  public notifyError(error: any): void {
    let channel_error;
    console.error(error);
    switch (this.config.platform) {
      case Platform.F2F:
        channel_error = process.env.DISCORD_ERROR_F2F;
        break;
      case Platform.FANSLY:
        channel_error = process.env.DISCORD_ERROR_FANSLY;
        break;
      case Platform.FANCENTRO:
        channel_error = process.env.DISCORD_ERROR_FANCENTRO;
        break;
      case Platform.KNKY:
        channel_error = process.env.DISCORD_ERROR_KNKY;
        break;
      case Platform.MALOUM:
        channel_error = process.env.DISCORD_ERROR_MALOUM;
        break;
      case Platform.FANVUE:
        channel_error = process.env.DISCORD_ERROR_FANVUE;
        break;
      case Platform.LOYALFANS:
        channel_error = process.env.DISCORD_ERROR_LOYALFANS;
        break;
      case Platform.FOURBASED:
        channel_error = process.env.DISCORD_ERROR_4BASED;
        break;
      case Platform.MYMFANS:
        channel_error = process.env.DISCORD_ERROR_MYMFANS;
        break;
      case Platform.FETLIFE:
        channel_error = process.env.DISCORD_ERROR_FETLIFE;
        break;
      case Platform.ONLYFANS:
        channel_error = process.env.DISCORD_ERROR_ONLYFANS;
        break;
      case Platform.FANLIKE:
        channel_error = process.env.DISCORD_ERROR_FANLIKE;
        break;
      default:
        channel_error = process.env.DISCORD_ERROR_OTHER;
        break;
    }
    if (channel_error) {
      if (error instanceof BotError) {
        axios.post(channel_error, {
          username: `********** [ ${this.config.platform} ] ${this.config.alias}`,
          content: `[ ${moment().format("YYYY-MM-DD HH:mm:ss")} ]\n${error.message}\n${JSON.stringify(error.reason, null, 2)}`.substring(0, 1500),
        })
          .then(() => { })
          .catch(() => { });

      } else {
        axios.post(channel_error, {
          username: `********** [ ${this.config.platform} ] ${this.config.alias}`,
          content: `[ ${moment().format("YYYY-MM-DD HH:mm:ss")} ]\n${error.message}\n${error.stack}`.substring(0, 1500),
        })
          .then(() => { })
          .catch(() => { });
      }
    }
  }

  public async notifyErrorAndWait(error: any) {
    let channel_error;
    console.error(error);
    switch (this.config.platform) {
      case Platform.F2F:
        channel_error = process.env.DISCORD_ERROR_F2F;
        break;
      case Platform.FANSLY:
        channel_error = process.env.DISCORD_ERROR_FANSLY;
        break;
      case Platform.FANCENTRO:
        channel_error = process.env.DISCORD_ERROR_FANCENTRO;
        break;
      case Platform.KNKY:
        channel_error = process.env.DISCORD_ERROR_KNKY;
        break;
      case Platform.MALOUM:
        channel_error = process.env.DISCORD_ERROR_MALOUM;
        break;
      case Platform.FANVUE:
        channel_error = process.env.DISCORD_ERROR_FANVUE;
        break;
      case Platform.LOYALFANS:
        channel_error = process.env.DISCORD_ERROR_LOYALFANS;
        break;
      case Platform.FOURBASED:
        channel_error = process.env.DISCORD_ERROR_4BASED;
        break;
      case Platform.MYMFANS:
        channel_error = process.env.DISCORD_ERROR_MYMFANS;
        break;
      case Platform.FETLIFE:
        channel_error = process.env.DISCORD_ERROR_FETLIFE;
        break;
      case Platform.ONLYFANS:
        channel_error = process.env.DISCORD_ERROR_ONLYFANS;
        break;
      case Platform.FANLIKE:
        channel_error = process.env.DISCORD_ERROR_FANLIKE;
        break;
      default:
        channel_error = process.env.DISCORD_ERROR_OTHER;
        break;
    }
    if (channel_error) {
      if (error instanceof BotError) {
        await axios.post(channel_error, {
          username: `********** [ ${this.config.platform} ] ${this.config.alias}`,
          content: `[ ${moment().format("YYYY-MM-DD HH:mm:ss")} ]\n${error.message}\n${JSON.stringify(error.reason, null, 2)}`.substring(0, 1500),
        });

      } else {
        axios.post(channel_error, {
          username: `********** [ ${this.config.platform} ] ${this.config.alias}`,
          content: `[ ${moment().format("YYYY-MM-DD HH:mm:ss")} ]\n${error.message}\n${error.stack}`.substring(0, 1500),
        });
      }
    }
  }

}
