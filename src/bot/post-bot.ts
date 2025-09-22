import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import moment from 'moment';
import axios from "axios";

import { BaseBrowser } from "../browser/base-browser";
import { PostApiService } from "../services/post-service";
import { IAccountSettings, IBotConfig, IChatMessage, IProxy } from "../types/interface";
import { ActionType, MAX_ERROR_COUNT } from "../types/constant";
import { Logger } from "../utils/logger";
import { getPlatformName } from "../utils/helper";
import { BaseBot } from './base-bot';
import { AuthError, BotError, ProxyError } from '../utils/error';


export abstract class PostBot extends BaseBot {
  protected abstract browser: BaseBrowser;
  protected abstract service: PostApiService;
  protected config!: IBotConfig;
  protected logger!: Logger;
  protected settings!: IAccountSettings;
  protected proxy!: IProxy;
  protected errorCount: number;
  protected tested: boolean;
  protected lastNotificationSent: number;

  constructor(config: IBotConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.tested = false;
    this.errorCount = 0;
    this.lastNotificationSent = 0;
  }

  async init(): Promise<void> {
    try {
      await this.initService();
      await this.initAccount();
      await this.initBrowser();
      await this.initProxy();
    } catch (error: any) {
      if (error instanceof ProxyError)
        await this.service.changeProxy();
      await this.logger.notifyErrorAndWait(error);
      await this.service.createLog({
        success: false,
        action: ActionType.LOGIN,
        message: `bot closed due to ${error.message}`,
        error: error.message,
      });
      throw error;
    }
  }

  // init api service
  protected async initService(): Promise<void> {
    await this.service.init();
  }

  // init headless browser
  protected async initBrowser(): Promise<void> {
    await this.browser.init(this.proxy);
  }

  // init account
  protected async initAccount(): Promise<void> {
    await this.getAccount();
    if (!this.settings.proxy) {
      throw new ProxyError("no proxy", {
        where: "PostBot::initAccount",
        error: "no proxy for the account",
      });
    }
    const proxy = this.parseProxy(this.settings.proxy);
    if (!proxy) {
      throw new ProxyError("invalid proxy", {
        where: "PostBot::initAccount",
        error: "invalid proxy for the account"
      });
    }
    this.proxy = proxy;
    await this.logger.info(`select proxy(${this.proxy.server})`)
  };

  // init proxy
  protected async initProxy(): Promise<void> {
    await this.browser.checkProxy();
    await this.browser.home();
  }

  async start(): Promise<void> {
    try {
      await this.browser.afterHome();
      const idInfo = await this.browser.login(this.settings);
      if (idInfo) {
        await this.service.updateId(idInfo);
        this.logger.info(`update bot id(${idInfo.alias}, ${idInfo.id})`);
        this.config.alias = idInfo.alias;
        this.settings.alias = idInfo.alias;
      }
      await this.service.createLog({ success: true, action: ActionType.LOGIN, message: "login success" });
      await this.browser.afterLogin();
      await this.logger.info("start scheduling...")
      setTimeout(this.schedule.bind(this), 100);
    } catch (error: any) {
      this.logger.notifyError(error);
      await this.service.createLog({ success: false, action: ActionType.LOGIN, message: `bot closed due to ${error.message}`, disabled: error instanceof AuthError, error: error.message });
      throw error;
    }
  }

  // get account settings
  protected async getAccount(): Promise<void> {
    const settings = await this.service.getAccountSettings();
    this.settings = settings;
  }

  // check if needing to update
  protected needUpdate(): boolean {
    return !this.settings?.params?.recent;
  }

  // check if needing to post
  protected needPost(): boolean {
    // if there is no contents to post, don't post
    if (!this.settings.params || !this.settings.params?.contents || this.settings.params.contents.length == 0)
      return false
    // if current time is before next post time, don't post
    const { postNextTime } = this.settings.params;
    if (!postNextTime)
      return true;
    return moment().isAfter(moment(postNextTime));
  }

  // check if needing to comment
  protected needComment(): boolean {
    if (!this.settings.params || !this.settings.params.commentEnabled)
      return false;
    const { commentNextTime } = this.settings.params;
    if (!commentNextTime)
      return true;
    return moment().isAfter(moment(commentNextTime));
  }

  // check if needing to comment
  protected needStory(): boolean {
    if (!this.settings.params || !this.settings.params?.storyEnabled || !this.settings.params?.contents || this.settings.params.contents.length == 0)
      return false
    const { storyNextTime } = this.settings.params;
    if (!storyNextTime)
      return true;
    return moment().isAfter(moment(storyNextTime));
  }


  // check if need schedule
  protected needSchedule(): boolean {
    if (!this.settings.params)
      return false
    const { scheduleNextTime } = this.settings.params;
    if (!scheduleNextTime)
      return true;
    return moment().isAfter(moment(scheduleNextTime));

  }

  // check if need test
  protected needTest(): boolean {
    // if (!this.tested) {
    //   this.tested = true;
    //   return true;
    // }
    return false;
  }

  // check if need test
  protected needChat(): boolean {
    if (!this.settings.chatTeam?.discord)
      return false;
    if (!this.settings?.params?.chatNextTime)
      return true;
    return moment().isAfter(moment(this.settings.params.chatNextTime));
  }

  // check if need test
  protected needCalibrate(): boolean {
    if (!this.settings?.params?.balanceNextTime)
      return true;
    return moment().isAfter(moment(this.settings?.params?.balanceNextTime));
  }


  protected async doUpdate(): Promise<boolean> {
    try {
      const count = await this.service.updateContents();
      await this.service.createLog({ success: true, action: ActionType.UPDATE, message: `update ${count} contents` })
      return true;
    } catch (error: any) {
      this.logger.error(error);
      return false;
    }
  }

  protected async doPost(): Promise<boolean> {
    this.logger.info("process post success");
    await this.service.updatePostSetting(true, undefined, []);
    return true;
  }

  protected async doStory(): Promise<boolean> {
    await this.service.updateStorySetting(0);
    return true;
  }

  protected async doComment(): Promise<boolean> {
    await this.service.updateCommentSetting();
    return true;
  }

  protected async doChat(): Promise<boolean> {
    await this.service.updateChatSetting();
    return true;
  }

  protected async doCalibrate(): Promise<boolean> {
    try {
      const available = await this.service.checkBalance(0);
      if (!available)
        await this.service.createHistory(`bot closed due to no balance`);
      return available;
    } catch (error: any) {
      this.logger.notifyError(error);
      this.logger.warn(`check balance failed`);
      return false;
    }
  }

  protected async doSchedule(): Promise<boolean> {
    await this.service.updateScheduleSetting();
    return true;
  }

  // test action
  protected async doTest(): Promise<boolean> {
    return Promise.resolve(true);
  }

  // schedule function
  async schedule(): Promise<void> {
    try {
      let success = true;
      // get account settings
      await this.getAccount();
      // if account is disabled and not in force mode, close bot
      if (!this.config.force && !this.settings.status)
        throw new BotError("account disabled", {
          where: "BaseBot::schedule",
          account: this.settings
        });
      if (this.needTest()) {  // check if needs to test
        this.logger.info("start test...")
        success = await this.doTest();
        this.logger.info("finish test...")
      } else if (this.needCalibrate()) {
        this.logger.info("start calibrate...")
        success = await this.doCalibrate();
        this.logger.info("finish calibrate...")
      } else if (this.needUpdate()) { // check if needs to update contents
        this.logger.info("start update...")
        success = await this.doUpdate();
        this.logger.info("finish update...")
        if (!success) {
          await this.service.setLastError("failed to update");
        }
      } else if (this.needSchedule()) {
        this.logger.info("start schedule...")
        success = await this.doSchedule();
        this.logger.info("finish schedule...")
      } else if (this.needPost()) { // check if needs to post
        this.logger.info("start post...")
        success = await this.doPost();
        this.logger.info("finish post...")
        if (!success) {
          await this.service.setLastError("failed to post");
        }
      } else if (this.needStory()) { // check if needs to story
        this.logger.info("start story...")
        success = await this.doStory();
        this.logger.info("finish story...")
        if (!success) {
          await this.service.setLastError("failed to story");
        }
      } else if (this.needComment()) { // check if needs to comment
        this.logger.info("start comment...")
        success = await this.doComment();
        this.logger.info("finish comment...")
        if (!success) {
          await this.service.setLastError("failed to comment");
        }
      } else if (this.needChat()) {
        this.logger.info("start chat...")
        success = await this.doChat();
        this.logger.info("finish chat...")
        if (!success) {
          await this.service.setLastError("failed to chat");
        }
      }

      if (success) {
        await this.service.clearError()
        this.errorCount = 0;
      } else {
        this.errorCount += 1;
      }
      if (this.errorCount > MAX_ERROR_COUNT) {
        throw new BotError("internal error", {
          where: "BaseBot::schedule",
          error: `${this.errorCount} sequence errors`
        });
      }
    } catch (error: any) {
      throw error;
    }
    setTimeout(this.schedule.bind(this), this.config.schedule_interval);
  }

  // download file
  protected async downloadFile(file: string): Promise<string> {
    const url = `${this.config.image_root}/uploads/${file}`;
    const filepath = path.join(os.tmpdir(), file);

    return new Promise((resolve, reject) => {
      let fileStream = fs.createWriteStream(filepath);
      let downloadedBytes = 0;
      let request: http.ClientRequest;

      const handleError = (err: Error) => {
        fs.unlinkSync(filepath);
        reject(new BotError("download file failed", {
          where: "BaseBot::downloadFile",
          error: err.message,
          stack: err.stack,
          path: url
        }));
      };

      const protocol = url.includes("https://") ? https : http;

      request = protocol.get(url, response => {
        // Check if response has content (not empty)
        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            if (downloadedBytes < 1000) {
              handleError(new Error(`Media size (${downloadedBytes} bytes) is too small`));
            } else {
              resolve(filepath);
            }
          });
        });
      }).on('error', handleError);
    });
  }

  // retry action 
  protected async retryAction(action: any, ...params: any[]) {
    let attempt = 0;
    while (attempt < 3) {
      try {
        await action(...params)
        return
      } catch (err) {
        attempt++;
        if (attempt >= 3) {
          throw err;
        }
      }
    }
  }

  // parse proxy string to proxy interface
  protected parseProxy(proxy: String): IProxy {
    const [account, addr] = proxy.trim().split("@");
    if (!account || !addr) {
      throw new BotError("invalid proxy", {
        where: "BaseBot::parseProxy",
        error: "proxy address has not account or address section"
      });
    }
    const [username, password] = account.split(":");
    if (!username || !password)
      throw new BotError("invalid proxy", {
        where: "BaseBot::parseProxy",
        error: "proxy address has not username or password section"
      });
    return ({
      server: `http://${addr}`,
      username,
      password,
    })
  }

  protected pickup(elements: any[]): any {
    const randomIndex = Math.floor(Math.random() * elements.length);
    return (elements[randomIndex] || "").trim();
  }

  protected async sendChatNotification(messages: IChatMessage[]) {
    if (!this.settings.chatTeam?.discord) return;

    // Rate limiting - wait at least 1 second between messages
    const now = Date.now();
    const lastSent = this.lastNotificationSent || 0;
    const delay = Math.max(0, 1000 - (now - lastSent));

    try {
      await new Promise(resolve => setTimeout(resolve, delay));
      let content = messages
        .map(message => `*** [ ${moment(message.time).format("YYYY-MM-DD HH:mm")} ] ${message.user} ***\n${message.message}`)
        .join("\n");
      content = content.slice(0, 2000) + (content.length > 2000 ? "\n..." : "");
      await axios.post(this.settings.chatTeam.discord, {
        username: `*********************** [ ${getPlatformName(this.settings.platform)} ] ${this.settings.actor?.number}. ${this.settings.actor?.name} (${this.settings.alias})`,
        content: content,
      });

      this.lastNotificationSent = Date.now();
    } catch (error: any) {
      if (error.response?.status === 429) {
        // If we hit rate limit, wait for retry-after period
        const retryAfter = error.response.headers['retry-after'] * 1000 || 5000;
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        this.sendChatNotification(messages); // Retry
      }
      throw error;
    }
  }
}