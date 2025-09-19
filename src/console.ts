import dotenv from 'dotenv';
import { program } from 'commander';
import { IConsoleConfig } from './types/interface';
import { ConsoleLogger } from './console/logger';
import { PostBotConsole } from './console/post-console';
import { Platform } from './types/constant';
import { BaseConsole } from './console/base-console';
import { LikeBotConsole } from './console/like-console';
dotenv.config();

program.parse();
if (program.args.length < 1) {
  console.warn(`Please specify platform for bot console.\nex: node console (F2F|FNC|FAN)`);
  process.exit();
}
if (![
  Platform.F2F,
  Platform.FANCENTRO,
  Platform.FANSLY,
  Platform.KNKY,
  Platform.MALOUM,
  Platform.FANVUE,
  Platform.ONLYFANS,
  Platform.FOURBASED,
  Platform.LOYALFANS,
  Platform.FETLIFE,
  Platform.MYMFANS,
  Platform.FANLIKE
].includes(program.args[0])) {
  console.warn(`Please specify the correct platform for bot console.\nex: node console (F2F|FNC|FAN|KNKY|MALOUM|FANVUE|ONLYFANS|MYMFANS)`);
  process.exit();
}

let config: IConsoleConfig = {
  platform: program.args[0],
  id: process.env.CONSOLE_ID || "con1",
  schedule_interval: parseInt(process.env.CONSOLE_SCHEDULE_INTERVAL || "30000"),
  console_log: process.env.CONSOLE_LOG == "true",
  channel_notify: process.env.DISCORD_WEBHOOK_NOTIFY,
  bot_limit: parseInt(process.env.BOT_LIMIT || "30"),
  server_root: process.env.SERVER_ROOT || "http://localhost:5000",
  bot_path: process.env.BOT_PATH || "dist/bot.js"
};

const logger: ConsoleLogger = new ConsoleLogger(config);
let botConsole: BaseConsole;

// Handle uncaught exceptions
process.on("uncaughtException", async (err) => {
  logger.warn(`bot console rejected : ${err}`);
  await botConsole.clear();
  process.exit();
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  // const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.warn(`bot console rejected : ${reason}`);
  process.exit();
});

process.on('SIGINT', async () => {
  await botConsole.clear();
  logger.warn(`bot console closed`);
  process.exit();
});

process.on('SIGTSTP', async () => {
  await botConsole.clear();
  logger.warn(`bot console closed`);
  process.exit();
});

(async () => {
  switch (config.platform) {
    case Platform.FANSLY:
    case Platform.F2F:
    case Platform.FANCENTRO:
    case Platform.FANVUE:
    case Platform.KNKY:
    case Platform.MALOUM:
    case Platform.ONLYFANS:
    case Platform.MYMFANS:
    case Platform.FOURBASED:
    case Platform.FETLIFE:
    case Platform.LOYALFANS:
      botConsole = new PostBotConsole(config, logger)
      break
    case Platform.FANLIKE:
      botConsole = new LikeBotConsole(config, logger)
      break
    default:
      logger.warn("platform not found");
      process.exit()
  }
  await botConsole.init()
  await botConsole.start();
})();

