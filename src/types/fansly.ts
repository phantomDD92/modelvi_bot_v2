export interface IFanslyAlbum {
  id: string,
  accountId: string,
  createdAt: number,
  description: string | null,
  itemCount: number,
  lastItemId: string,
  pos: number,
  status: number,
  title: string | null,
  type: number,
  version: number,
}

export interface IFanslyPost {
  id: string,
  accountId: string,
  liked?: boolean,
  attachments: [{
    postId: string,
    contentId: string,
  }]
}

export interface IFanslyAccount {
  id: string,
  username: string,
}

export interface IFanslyAccountMedia {
  id: string,
  accountId: string,
  liked?: boolean,
}
export interface IFanslyMedia {
  id: string,
  accountId: string,
  createdAt: number,
  filename: string,
  flags: number,
  height: number,
  location: string,
  metadata: string,
  mimetype: string,
  status: number,
  type: number,
  updatedAt: number,
  width: number,
}

export interface IFanslyGetHomePostResult {
  posts: IFanslyPost[],
  accounts: IFanslyAccount[],
}

export interface IFanslyAlbumMediaResponse {
  media: IFanslyMedia[]
}
export interface IFanslyAlbumResponse {
  aggregationData: { media: IFanslyMedia[] }
  albums: IFanslyAlbum[]
}


export interface IFanslyStat {
  month: number,
  totalNet: number,
  totalGross: number,
}

export interface IFanslyMessageData {
  account_id: string,
  groupId: string,
  partnerUsername: string,
  unreadCount: number,
}

export interface IFanslyMessageGroup {
  id: string,
  lastMessage: {
    content: string,
    createdAt: number,
  },
}

export interface IFanslyMessageResult {
  data: IFanslyMessageData[],
  groups: IFanslyMessageGroup[],
}

export interface IFanslyProfile {
  id:string,
  username:string,
}