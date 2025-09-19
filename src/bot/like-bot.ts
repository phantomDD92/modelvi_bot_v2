import { IAccountSettings, IBotConfig, IProxy } from "../types/interface";
import { Logger } from "../utils/logger";
import { BaseBrowser } from "../browser/base-browser";
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import moment from "moment";
import { BotError } from "../utils/error";
import { LikeApiService } from "../services/like-service";
import { BaseBot } from "./base-bot";
import { EmailReader } from "../utils/email-reader";

export abstract class LikeBot extends BaseBot {
  protected abstract browser: BaseBrowser;
  protected abstract service: LikeApiService;
  protected config!: IBotConfig;
  protected logger!: Logger;
  protected settings!: IAccountSettings;
  protected proxy!: IProxy;
  protected errorCount: number;
  protected tested: boolean;
  protected lastNotificationSent: number;
  protected emailReader: EmailReader;
  constructor(config: IBotConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.tested = false;
    this.errorCount = 0;
    this.lastNotificationSent = 0;
    this.emailReader = new EmailReader({
      host: 'pixel.mxrouting.net',
      port: 993,
      secure: true,
      auth: {
        user: 'catch@voure.nl',
        pass: 'xymQmf2mpyLtQcCWkbVc'
      }
    })
  }

  async init(): Promise<void> {
    try {
      await this.initService();
      await this.initAccount();
      await this.initBrowser();
      await this.initProxy();
      await this.service.createHistory("bot started");
    } catch (error: any) {
      await this.logger.notifyErrorAndWait(error)
      this.logger.warn(`bot closed due to ${error instanceof BotError ? error.message : 'internal error'}`);
      await this.service.setLastError(`${error instanceof BotError ? error.message : 'internal error'}`, false);
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
  };

  // init proxy
  protected async initProxy(): Promise<void> {
    try {
      await this.browser.checkProxy();
      await this.browser.home();
      await this.logger.info(`select proxy(${this.proxy.server})`)
    } catch (error) {
      await this.logger.warn(`invalid proxy(${this.proxy.server})`)
      await this.service.changeProxy();
      throw error;
    }
  }

  async close() {
    this.logger.info("close bot");
    await this.browser.close();
    process.exit()
  }

  async start(): Promise<void> {
    if (!this.settings.registered) {
      await this.register();
      await this.verifyAfterRegister();
    } else {
      await this.login();
      if (!this.settings.verified)
        await this.verifyAfterLogin();
    }
    await this.schedule();
    // await this.browser.waitForTimeout(1800000);
    await this.close();
  }

  protected async register(): Promise<void> {
    try {
      await this.browser.register(this.settings);
      await this.service.registerAccount();
      this.settings.registered = true;
      await this.service.createHistory("register account");
    } catch (error: any) {
      await this.service.setLastError(`${error instanceof BotError ? error.message : 'internal error'}`, true);
      console.error(error);
      throw error;
    }
  }

  protected abstract verifyAfterRegister(): Promise<void>;

  protected abstract verifyAfterLogin(): Promise<void>;

  protected async startSchedule(): Promise<void> {
    await this.logger.info("start scheduling...")
    setTimeout(this.schedule.bind(this), 100);
  }

  protected async login(): Promise<void> {
    try {
      // open home page
      await this.browser.afterHome();
      await this.browser.login(this.settings);
      await this.service.createHistory("login success");
      await this.browser.afterLogin();
    } catch (error: any) {
      await this.service.setLastError(`${error instanceof BotError ? error.message : 'internal error'}`, true);
      console.error(error);
      throw error;
    }
  }

  // get account settings
  protected async getAccount(): Promise<void> {
    const settings = await this.service.getAccountSettings();
    this.settings = settings;
  }

  protected needTest(): boolean {
    return false;
  }

  // check if need schedule
  protected needFollow(): boolean {
    const followNextTime = this.settings.params?.followNextTime;
    if (!followNextTime)
      return true;
    return moment().isAfter(moment(followNextTime));
  }

  // check if need schedule
  protected needLike(): boolean {
    const likeNextTime = this.settings.params?.likeNextTime;
    if (!likeNextTime)
      return true;
    return moment().isAfter(moment(likeNextTime));
  }

  protected async doLike(): Promise<boolean> {
    await this.service.updateLikeSettings();
    return true;
  }

  protected async doFollow(): Promise<boolean> {
    await this.service.updateFollowSettings();
    return true;
  }

  // test action
  protected async doTest(): Promise<boolean> {
    return Promise.resolve(true);
  }

  // schedule function
  async schedule(): Promise<void> {
    try {
      let success = false;
      // get account settings
      // await this.getAccount();
      // if account is disabled and not in force mode, close bot
      if (!this.config.force && !this.settings.status)
        throw new BotError("account disabled", {
          where: "LikeBot::schedule",
          account: this.settings
        });
      if (this.needFollow()) {
        this.logger.info("start follow...")
        success = await this.doFollow();
        this.logger.info("finish follow...")
      }
      if (this.needLike()) {
        this.logger.info("start like...")
        success = await this.doLike();
        this.logger.info("finish like...")
      }
      if (success)
        await this.service.clearError();
    } catch (error: any) {
      console.error(error)
      throw error;
    }
    // setTimeout(this.schedule.bind(this), this.config.schedule_interval);
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
          where: "LikeBot::downloadFile",
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
        where: "LikeBot::parseProxy",
        error: "proxy address has not account or address section"
      });
    }
    const [username, password] = account.split(":");
    if (!username || !password)
      throw new BotError("invalid proxy", {
        where: "LikeBot::parseProxy",
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

}