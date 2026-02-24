import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import axios from "axios";
import * as twoFactor from "node-2fa";

import { Browser, BrowserContext, Page } from "playwright";
import { firefox, chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import { Solver } from "2captcha-ts";

import { Platform } from "../types/constant";
import { IAccountID, IAccountSettings, IBotConfig, IProxy, } from "../types/interface";
import { Logger } from "../utils/logger";
import { BotError, ProxyError } from "../utils/error";

export abstract class BaseBrowser {
  protected browser!: Browser;
  protected context!: BrowserContext;
  protected page!: Page;
  protected config: IBotConfig;
  protected logger: Logger;
  protected proxy!: IProxy;
  protected headers!: { [key: string]: string; };
  protected solver: Solver;

  constructor(config: IBotConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.headers = {};
    this.solver = new Solver(this.config.captcha_key);
  }

  // init browser
  async init(proxy: IProxy): Promise<void> {
    // install recaptcha, stealth plugin for headless browser
    // set proxy
    this.proxy = proxy;
    // create browser, context, page
    switch (this.config.platform) {
      case Platform.KNKY:
      case Platform.MALOUM:
        // Use Firefox for KNKY and MALOUM (harder to detect as bot)
        // Don't use stealth plugin for Firefox - causes user-agent errors
        firefox.use(
          RecaptchaPlugin({
            provider: { id: "2captcha", token: this.config.captcha_key },
            throwOnError: true,
            solveScoreBased: true,
          }),
        );
        this.browser = await firefox.launch({
          headless: !this.config.debug,
          proxy,
          firefoxUserPrefs: {
            "dom.webdriver.enabled": false,
            useAutomationExtension: false,
            "privacy.resistFingerprinting": false,
          },
        });
        this.context = await this.browser.newContext({
          serviceWorkers: "block",
          screen: { width: 1200, height: 800 },
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0"
        });
        break;

      default:
        chromium.use(
          RecaptchaPlugin({
            provider: { id: "2captcha", token: this.config.captcha_key },
            throwOnError: true,
            solveScoreBased: true,
          }),
        );
        chromium.use(StealthPlugin());
        if (this.config.debug)
          this.browser = await chromium.launch({
            headless: !this.config.debug,
            args: ["--window-position=500,900"],
            devtools: true,
            proxy,
          });
        else
          this.browser = await chromium.launch({
            headless: !this.config.debug,
            proxy,
          });
        this.context = await this.browser.newContext({
          serviceWorkers: "block",
          screen: { width: 1200, height: 800 },
        });
        break;
    }

    this.page = await this.context.newPage();
    // set default timeout
    this.page.setDefaultTimeout(120000);
    this.page.setDefaultNavigationTimeout(120000);
    // append content filter
    await this.setFilter();
    this.logger.info("init browser success");
  }

  async close() {
    await this.page.close();
    await this.context.close();
    await this.browser.close();
  }

  // set content filter
  protected async setFilter() {
    // filter images
    await this.context.route(
      /(\.png(\?.*)?$)|(\.jpg(\?.*)?$)|(\.webp(\?.*)?$)|(\.jpeg(\?.*)?$)|(blob(.*)?$)/,
      (route) => route.abort(),
    );
    // filter google analytics
    await this.context.route(
      /https:\/\/www\.google-analytics\.com\/.*/,
      (route) => route.abort(),
    );
    // await this.context.route('**/*', (route, request) => {
    //   const resourceType = request.resourceType(); // e.g., 'image'
    //   if (resourceType === 'image' && request.method() == "GET") {
    //     route.abort();
    //   } else {
    //     route.continue();
    //   }
    // });
  }

  // check proxy for browser
  public async checkProxy(): Promise<void> {
    try {
      // go to google home page
      await this.page.goto("https://www.google.com", {
        waitUntil: "domcontentloaded",
      });

      if (this.config.debug) {
        await this.page.waitForTimeout(10000);
      }
    } catch (error: any) {
      throw new ProxyError("proxy blocked", {
        where: "BaseBrowser::checkProxy",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  public abstract home(): Promise<void>;

  public async register(setting: IAccountSettings): Promise<void> {
    return Promise.resolve();
  }

  public async afterHome(): Promise<void> {
    return Promise.resolve();
  }

  public async dumpHtml(): Promise<void> {
    try {
      const html = await this.page.content();
      await fs.promises.writeFile("debug.html", html, "utf8");
    } catch (error: any) { }
  }

  public abstract login(
    setting: IAccountSettings,
  ): Promise<IAccountID | undefined>;

  public async afterLogin(): Promise<void> {
    return Promise.resolve();
  }

  public async waitForTimeout(timeout: number) {
    await new Promise(resolve => setTimeout(resolve, timeout));
  }

  protected async downloadFile(file: string): Promise<string> {
    const url = `${this.config.image_root}/uploads/${file}`;
    const filepath = path.join(os.tmpdir(), file);

    return new Promise((resolve, reject) => {
      let fileStream = fs.createWriteStream(filepath);
      let downloadedBytes = 0;
      let request: http.ClientRequest;

      const handleError = (err: Error) => {
        fs.unlinkSync(filepath);
        reject(
          new BotError("download file failed", {
            where: "BaseBot::downloadFile",
            error: err.message,
            stack: err.stack,
            path: url,
          }),
        );
      };

      const protocol = url.includes("https://") ? https : http;

      request = protocol
        .get(url, (response) => {
          // Check if response has content (not empty)
          response.on("data", (chunk) => {
            downloadedBytes += chunk.length;
          });

          response.pipe(fileStream);

          fileStream.on("finish", () => {
            fileStream.close(() => {
              if (downloadedBytes < 1000) {
                handleError(
                  new Error(
                    `Media size (${downloadedBytes} bytes) is too small`,
                  ),
                );
              } else {
                resolve(filepath);
              }
            });
          });
        })
        .on("error", handleError);
    });
  }

  protected async generate2FACode(securityKey: string) {
    const twoFaCode = twoFactor.generateToken(securityKey);
    if (twoFaCode?.token.length != 6)
      throw new BotError("invalid security key", {
        where: "BaseBrowser::generate2FACode",
        twoFaCode,
      });
    const verification = twoFactor.verifyToken(securityKey, twoFaCode.token);
    if (verification?.delta != 0)
      throw new BotError("invalid security key", {
        where: "BaseBrowser::generate2FACode",
        twoFaCode,
        verification,
      });
    return twoFaCode.token;
  }

  protected async solveTurnstileCaptcha(params: any): Promise<string> {
    try {
      const resp1 = await axios.post("https://api.2captcha.com/createTask", {
        clientKey: this.config.captcha_key,
        task: {
          type: "TurnstileTaskProxyless",
          websiteKey: params.sitekey,
          websiteURL: params.pageurl,
          data: params.data,
          pagedata: params.pagedata,
          action: params.action,
        },
      });
      const { errorId, taskId } = resp1.data;
      if (errorId > 0)
        throw new BotError("captcha solve failed", {
          where: "BaseBrowser::solveTurnstileCaptcha",
          task: "createTask",
          params,
          response: resp1.data,
        });
      for (var i = 0; i < 30; i++) {
        await this.wait(3000);
        const resp2 = await axios.post(
          "https://api.2captcha.com/getTaskResult",
          {
            clientKey: this.config.captcha_key,
            taskId,
          },
        );
        const { errorId, status, ...params } = resp2.data;
        if (errorId > 0)
          throw new BotError("captcha solve failed", {
            where: "BaseBrowser::solveTurnstileCaptcha",
            task: "getTaskResult",
            params,
            response: resp2.data,
          });
        if (status == "ready") {
          return params.solution.token;
        }
      }
      throw new BotError("captcha solve failed", {
        where: "BaseBrowser::solveTurnstileCaptcha",
        error: "solve captcha timeout",
      });
    } catch (error: any) {
      throw new BotError("captcha solve failed", {
        where: "BaseBrowser::solveTurnstileCaptcha",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  protected async solveRecaptchav2(
    pageUrl: string,
    siteKey: string,
  ): Promise<string> {
    try {
      let solveRes2 = await this.solver.recaptcha({
        pageurl: pageUrl,
        googlekey: siteKey,
        version: "v2",
      });
      return solveRes2.data;
    } catch (error: any) {
      throw new BotError("captcha solve failed", {
        where: "BaseBrowser::solveRecaptchav2",
        error: error.message,
        stack: error.stack,
      });
    }
  }

  protected async wait(msecs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, msecs);
    });
  }

  protected async waitAndLog(msecs: number, message: string): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        (this.logger.info(message), resolve());
      }, msecs);
    });
  }

  // retry action
  protected async retryAction(action: any, ...params: any[]): Promise<any> {
    let attempt = 0;
    while (attempt < 3) {
      try {
        const ret = await action(...params);
        return ret;
      } catch (err) {
        attempt++;
        if (attempt >= 3) {
          throw err;
        }
      }
    }
  }

  protected getLastPathFromUrl(url: string): string {
    var segs = url.split("/");
    const path = segs[segs.length - 1];
    return path;
  }
}
