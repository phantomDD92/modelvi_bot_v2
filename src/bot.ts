import dotenv from 'dotenv';
import { program } from 'commander';
import { Platform } from "./types/constant";
import { FanslyBot } from "./bot/fansly-bot";
import { IBotConfig } from './types/interface';
import { Logger } from './utils/logger';
import { F2fBot } from './bot/f2f-bot';
import { FancentroBot } from './bot/fancentro-bot';
import { FanvueBot } from './bot/fanvue-bot';
import { KnKyBot } from './bot/knky-bot';
import { MaloumBot } from './bot/maloum-bot';
import { OnlyFansBot } from './bot/onlyfans-bot';
import { MymFansBot } from './bot/mymfans-bot';
import { FourBasedBot } from './bot/fourbased-bot';
import { FanslyLikeBot } from './bot/fansly-like-bot';
import { BaseBot } from './bot/base-bot';
import { FetLifeBot } from './bot/fetlife-bot';
import { LoyalFansBot } from './bot/loyalfans-bot';
import { FetLifeLikeBot } from './bot/fetlife-like-bot';
import { BestFansBot } from './bot/bestfans-bot';

dotenv.config();

program.option('-d, --debug').option('-f, --force');
program.parse();
const opts = program.opts();
if (program.args.length < 2) {
  console.log("Invalid command format\nex: node bot FAN alias [--debug] [--force]");
  process.exit();
}

let config: IBotConfig = {
  platform: program.args[0],
  alias: program.args[1],
  schedule_interval: parseInt(process.env.SCHEDULE_INTERVAL || "30000"),
  graylog_host: process.env.GRAYLOG_HOST,
  captcha_key: process.env.CAPTCHA_KEY || "",
  server_root: process.env.SERVER_ROOT || "http://localhost:5000",
  image_root: process.env.IMAGE_ROOT || "https://modelvi.com",
  console_log: process.env.CONSOLE_LOG == "true",
  channel_notify: process.env.DISCORD_WEBHOOK_NOTIFY,
  // debug: opts.debug,
  // force: opts.force,
  debug: true,
  force: true,
};

const logger: Logger = new Logger(config);

process.on("uncaughtException", (err) => {
  logger.notifyError(err);
  logger.warn(`bot rejected : ${err}`);
  process.exit();
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  // const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.notifyError(new Error(String(reason)));
  logger.warn(`bot rejected : ${reason}`);
  process.exit();
});

process.on('SIGINT', () => {
  logger.warn(`bot closed`);
  process.exit();
});


(async () => {
  let bot: BaseBot
  switch (config.platform) {
    case Platform.FANSLY:
      bot = new FanslyBot(config, logger)
      break
    case Platform.F2F:
      bot = new F2fBot(config, logger)
      break
    case Platform.FANCENTRO:
      bot = new FancentroBot(config, logger)
      break
    case Platform.FANVUE:
      bot = new FanvueBot(config, logger)
      break
    case Platform.KNKY:
      bot = new KnKyBot(config, logger)
      break
    case Platform.MALOUM:
      bot = new MaloumBot(config, logger)
      break
    case Platform.ONLYFANS:
      bot = new OnlyFansBot(config, logger)
      break
    case Platform.MYMFANS:
      bot = new MymFansBot(config, logger)
      break
    case Platform.FOURBASED:
      bot = new FourBasedBot(config, logger)
      break
    case Platform.FETLIFE:
      bot = new FetLifeBot(config, logger)
      break
    case Platform.LOYALFANS:
      bot = new LoyalFansBot(config, logger)
      break

    case Platform.FANLIKE:
      bot = new FanslyLikeBot(config, logger)
      break
    case Platform.FETLIFELIKE:
      bot = new FetLifeLikeBot(config, logger)
      break
    case Platform.BESTFANS:
      bot = new BestFansBot(config, logger)
      break
    default:
      logger.warn("platform not found");
      process.exit()
  }

  await bot.init()
  await bot.start();
})();