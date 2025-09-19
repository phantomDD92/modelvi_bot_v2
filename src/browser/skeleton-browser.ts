import { IAccountSettings, IAccountID } from "../types/interface";
import { BotError } from "../utils/error";
import { BaseBrowser } from "./base-browser";

export class BestFansBrowser extends BaseBrowser {

    public async home(): Promise<void> {
        try {
            await this.page.goto("https://www.bestfans.com/", { timeout: 120000 });
        } catch (error: any) {
            throw new BotError("proxy blocked", {
                where: "BestFansBrowser:home",
                error: error.message,
                stack: error.stack,
            })
        }
    }

    public async afterHome(): Promise<void> {
        try {
            // close cookie banner dialog
            await this.page.locator("div#cookiebanner button").last().click({timeout: 3000});
        } catch (error:any) {

        }
    }

    public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
        try {
            // input email and 
            await this.page.locator("input#login-email").fill(setting.email);
            await this.page.waitForTimeout(600000);
            return undefined;
        } catch (error: any) {
            if (error instanceof BotError)
                throw error;
            throw new BotError("login failed", {
                where: "BestFansBrowser:login",
                error: error.stack,
                message: error.message,
            })
        }
    }
}