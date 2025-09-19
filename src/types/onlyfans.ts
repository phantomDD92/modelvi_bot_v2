export interface IOnlyFansProfile {
  id: number,
  name: string,
  username: string,
  isVerified: boolean,
};

export interface IOnlyFansCategory {
  id: number,
  name: string,
  type: string,
}

export interface IOnlyFansMedia {
  processId: string,
  name: string,
  host: string,
  extra: string,
}

export interface IOnlyFansUpload {
  processId: string,
  sourceUrl: string,
  host: string,
  extra: string,
}