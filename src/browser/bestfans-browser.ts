import { IAccountSettings, IAccountID } from "../types/interface";
import { BotError } from "../utils/error";
import { BaseBrowser } from "./base-browser";

export class BestFansBrowser extends BaseBrowser {

    public async home(): Promise<void> {
        try {
            await this.page.goto("https://www.bestfans.com/");
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
            await this.page.locator("div#cookiebanner button").last().click({ timeout: 3000 });
        } catch (error: any) {

        }
    }

    public async login(setting: IAccountSettings): Promise<IAccountID | undefined> {
        try {
            // input email and 
            await this.page.locator("input#login-email").fill(setting.email);
            this.logger.info("set email")
            await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();

            await this.page.locator("input#login-password").waitFor();
            await this.page.locator("input#login-password").fill(setting.password);
            this.logger.info("set password")
            await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();
            
            await this.page.locator('iframe[title="reCAPTCHA"]').first().waitFor();
            await this.page.solveRecaptchas();
            this.logger.info("solve recaptcha")
            await this.page.locator("form button", { hasText: "LOGIN NOW!" }).click();
            
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

    public async afterLogin(): Promise<void> {
        try {
            // close enable notification dialog
            await this.page.locator("div.modal-dialog button#pushSubscriptionPermissionModalDeclineButton").last().click({ timeout: 3000 });
        } catch (error: any) {

        }
    }
}