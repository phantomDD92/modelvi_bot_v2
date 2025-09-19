import { Platform } from "../types/constant";
import { IAccountID, IAccountSettings } from "../types/interface";
import { PostApiService } from "./post-service";

export class FakePostService extends PostApiService {

    public async init(): Promise<boolean> {
        return true;
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
            proxy: "cb3ac8e713:zxHGsQ21@163.5.199.72:4444"
        }
    }

    public async updateId(idInfo: IAccountID): Promise<void> {

    }

    public async setLastError(message: string, disabled: boolean = false): Promise<void> {

    }

    public async clearError(): Promise<void> {

    }
}