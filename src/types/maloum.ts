export interface IMaloumFolder {
  _id: string,
  name: string,
}

export interface IMaloumUser {
  _id: string,
  username: string,
  isCreator: boolean,
}

export interface IMaloumPost {
  _id: string,
  type: string,
  likeCount: number,
  commentCount: number,
  createdAt: string,
  caption: string,
  createdBy: IMaloumUser,
}


export interface IMaloumMedia {
  uploadId: string,
  type: string,
  url: string
}
export interface IMaloumMediaInfo {
  media: IMaloumMedia,
  thumbnail: IMaloumMedia
}

export interface IMaloumCategory {
  _id: string,
  name: string,
  type?: string,
}

export interface IMaloumChat {
  chatPartner: {
    username: string,
    _id: string,
  },
  lastRelevantMessage: {
    text: string,
    type: string,
    sentAt: string,
  },
  unReadMessages: boolean
}

export interface IMaloumEarning {
  category: string,
  executedAt: string,
  price: {
    payoutAmount: number,
    net: number,
    currency: string,
  },
  status: string,
}