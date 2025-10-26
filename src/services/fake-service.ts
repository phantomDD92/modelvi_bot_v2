import { Platform } from "../types/constant";
import { IAccountID, IAccountSettings, ILog } from "../types/interface";
import { PostApiService } from "./post-service";

export class FakePostService extends PostApiService {

    public async init(): Promise<void> {

    }

    public async createLog(log: ILog): Promise<void> {
        this.logger.info(log.message);
    }


    public async createHistory(action: string): Promise<void> {
        this.logger.info(action);
    }

    public async getAccountSettings(): Promise<IAccountSettings> {
        return {
            platform: Platform.BESTFANS,
            alias: "test",
            email: "ssbellathorn@gmail.com",
            password: "HPkpR2ANQ9zxB!b",
            status: true,
            proxy: "8add406bd93a07ecfabccr.nl:97ebad0ee2642aa8@gw.dataimpulse.com:823"
        }
    }

    public async updateId(idInfo: IAccountID): Promise<void> {

    }

    public async setLastError(message: string, disabled: boolean = false): Promise<void> {

    }

    public async clearError(): Promise<void> {

    }
}