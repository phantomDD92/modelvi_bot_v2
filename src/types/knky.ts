export interface IKnkyFolder {
  _id: string,
  name: string,
}

export interface IKnkyUser {
  _id: string,
  username: string,
}

export interface IKnkyPost {
  _id: string,
  likes: string[],
  created_at: string,
  author: IKnkyUser,
}

export interface IKnkyStory {
  _id: string,
  earnings: string,
  created_at: string,
  visibility: string,
}

export interface IKnkyStoryData {
  _id: string,
  username: string,
  story_data: IKnkyStory[],
}

export interface IKnkyVault {
  _id: string,
  folder: string,
  user: string,
  name: string,
}

export interface IKnkyRevenue {
  _id: string,
  totalAmount: number,
}
export interface IKnkyStat {
  chat_fee: { e: number, f: number },
  other: { e: number, f: number },
  premium_post: { e: number, f: number },
  premium_story: { e: number, f: number },
  promotion: { e: number, f: number },
  shop_items: { e: number, f: number },
  special_options: { e: number, f: number },
  subs: { e: number, f: number },
  tickets: { e: number, f: number },
  tips: { e: number, f: number },
  year: number,
  timestamp: string,
}