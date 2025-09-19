import moment from "moment"
import { IConsoleConfig } from "../types/interface"
import axios from "axios"

export class ConsoleLogger {
  protected config: IConsoleConfig
  
  constructor(config: IConsoleConfig) {
    this.config = config
  }

  public info(message: string): Promise<void> {
    if (this.config.console_log) {
      console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")} : ${this.config.platform} CON - ${this.config.id}] : ${message}`)
    }
    return Promise.resolve();
  }

  public warn(message: string) {
    if (this.config.console_log) {
      console.warn(`[${moment().format("YYYY-MM-DD HH:mm:ss")} : ${this.config.platform} CON - ${this.config.id}] : ${message}`)
    }
  }

  public async notify(message: string): Promise<void> {
    if (this.config.channel_notify) {
      axios.post(this.config.channel_notify, {
        username: `${this.config.platform} CON - ${this.config.id}`,
        content: `[ ${moment().format("YYYY-MM-DD HH:mm:ss")} ]\n${message}`,
      }).then(() => { }).catch(() => { });
    }
  }
}