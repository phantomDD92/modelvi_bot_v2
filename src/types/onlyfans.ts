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

export interface IOnlyFansPost {
  author: { id: number },
  id: number,
  text: string,
  tipAmount: string,
  postedAt: string,
}