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

  constructor(config: IConsoleConfig, logger: ConsoleLogger) {
    this.config = config;
    this.logger = logger;
    this.service = new ConsoleService(config);
    this.running_processes = [];
    this.position = 0;
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
      this.running_processes.push({ _id: bot._id, alias: bot.alias, pid: proc.pid });
      this.logger.info(`START ${bot.alias}`);
      this.logger.notify(`START ${bot.alias}`);
      proc.on('close', () => {
        const processIndex = this.running_processes.findIndex(el => (el.pid == proc.pid));
        if (processIndex >= 0) {
          this.logger.notify(`CLOSE ${this.running_processes[processIndex]?.alias}`);
          this.logger.warn(`CLOSE ${this.running_processes[processIndex]?.alias}`);
          this.running_processes.splice(processIndex, 1);
        }
      })
    }
  }
}