import cp from "child_process";
import { CONCURRENT_STARTING_BOTS, Platform } from "../types/constant";
import { IBotInfo, IConsoleConfig } from "../types/interface";
import { ConsoleLogger } from "./logger";
import { ConsoleService } from "./service";

export class PostBotConsole {
  private config: IConsoleConfig;
  private logger: ConsoleLogger;
  private service: ConsoleService;
  private running_processes: IBotInfo[];
  private position: number;
  private crashHistory: any;

  constructor(config: IConsoleConfig, logger: ConsoleLogger) {
    this.config = config;
    this.logger = logger;
    this.service = new ConsoleService(config);
    this.running_processes = [];
    this.position = 0;
    // Track crash history for backoff: { botId: { count, lastCrash } }
    this.crashHistory = {};
  }

  public async init(): Promise<void> {
    this.logger.info(`bot console init`);
    return Promise.resolve();
  }

  public async clear(): Promise<void> {
    this.logger.info(`bot console clear`);
    for (let child of this.running_processes) {
      if (child.pid)
        process.kill(child.pid, "SIGKILL");
    }
    setTimeout(this.schedule.bind(this), 100);
  }

  public async start(): Promise<void> {
    this.logger.info(`bot console start`);
    setTimeout(this.schedule.bind(this), 100);
  }

  // Get backoff delay for a bot based on crash history
  private getBackoffDelay(botId: string) {
    const history = this.crashHistory[botId];
    if (!history || history.count === 0)
      return 0;
    // Exponential backoff: 2min, 4min, 8min, 16min, max 30min
    const isRateLimited = history.rateLimit || false;
    const baseDelay = isRateLimited ? 60 * 60 * 1000 : 2 * 60 * 1000; // 60min for rate limit, 2min normal
    const maxDelay = isRateLimited ? 4 * 60 * 60 * 1000 : 30 * 60 * 1000; // 4h for rate limit, 30min normal
    const delay = Math.min(baseDelay * Math.pow(2, history.count - 1), maxDelay);
    const elapsed = Date.now() - history.lastCrash;
    if (elapsed >= delay) {
      return 0; // Enough time has passed
    }
    return delay - elapsed; // Still need to wait
  }
  // Record a crash for a bot
  private recordCrash(botId: string, alias: string, exitCode: number | null) {
    if (!this.crashHistory[botId]) {
      this.crashHistory[botId] = { count: 0, lastCrash: 0 };
    }
    this.crashHistory[botId].count++;
    this.crashHistory[botId].lastCrash = Date.now();
    if (exitCode === 42) {
      this.crashHistory[botId].rateLimit = true;
      this.logger.warn(`RATE LIMITED ${alias} - long backoff active`);
    }
    const delay = this.getBackoffDelay(botId);
    const delaySec = Math.round(delay / 1000);
    this.logger.warn(`CRASH ${alias} (attempt ${this.crashHistory[botId].count}, next retry in ${delaySec}s)`);
  }
  // Clear crash history for a bot (on successful run)
  private clearCrashHistory(botId: string) {
    delete this.crashHistory[botId];
  }

  protected async schedule(): Promise<void> {
    try {
      const runnableBots = await this.service.getRunnableBots();
      const runningBots = this.running_processes.map(info => info._id);
      if (runnableBots.length > 0) {
        let addCount = runnableBots.length - runningBots.length;
        if (addCount > CONCURRENT_STARTING_BOTS) {
          addCount = CONCURRENT_STARTING_BOTS;
        }
        // only for like bot console
        if (this.config.platform == Platform.FANLIKE)
          addCount = 1;
        this.position = this.position % runnableBots.length;
        while (addCount > 0) {
          const selectedBot = runnableBots[this.position];
          if (!runningBots.includes(selectedBot._id)) {
            // Check backoff before starting
            const backoffRemaining = this.getBackoffDelay(selectedBot._id);
            if (backoffRemaining > 0) {
              const waitSec = Math.round(backoffRemaining / 1000);
              this.logger.info(`BACKOFF ${selectedBot.alias} (${waitSec}s remaining)`);
            }
            else {
              this.startBot(selectedBot);
            }
            this.startBot(selectedBot);
            addCount--;
          }
          this.position = (this.position + 1) % runnableBots.length;
        }
      }
      this.logger.info(`${runningBots.length} bots running`);
    } catch (error) {

    }
    setTimeout(this.schedule.bind(this), this.config.schedule_interval);
  }

  protected async startBot(bot: IBotInfo) {
    const proc = cp.spawn('node', [this.config.bot_path, this.config.platform, bot.alias]);
    if (proc.pid) {
      const startTime = Date.now();
      this.running_processes.push({ _id: bot._id, alias: bot.alias, pid: proc.pid });
      this.logger.notify(`START ${bot.alias}`);
      proc.on('close', (code) => {
        var _a, _b;
        const processIndex = this.running_processes.findIndex(el => (el.pid == proc.pid));
        if (processIndex >= 0) {
          const alias = (_a = this.running_processes[processIndex]) === null || _a === void 0 ? void 0 : _a.alias;
          this.logger.notify(`CLOSE ${alias}`);
          this.running_processes.splice(processIndex, 1);
          // If bot ran for less than 5 minutes, count as a crash
          const runDuration = Date.now() - startTime;
          if (runDuration < 5 * 60 * 1000) {
            this.recordCrash(bot._id, bot.alias, code);
            this.logger.notify(`RECORD CRASH ${bot.alias}`);
          } else {
            // Bot ran long enough - reset crash counter
            this.clearCrashHistory(bot._id);
          }
        }
      })
    }
  }
}