export interface ILoyalFansUser {
  display_name: string,
  name: string,
  slug: string,
  uid: string,
  user_type: string,
}

export interface ILoyalFansProfile {
  balance: {
    balance: number,
  },
  counters: {
    followers: number,
    total_friends: number,
    total_subscribers: number,
  },
  manager: {
    name: string,
    rate: number,
  },
  messages_count: number,
  user: ILoyalFansUser,
}

export interface ILoyalFansPost {
  uid: string,
  title: string,
  content: string,
  hashtags: string[],
  original_content: string,
  privacy: { privacy_rule: string, privacy_coverage: string }
}

export interface ILoyalFansMedia {
  uid: string,
  name: string,
  type: string,
  size?: number,
  file?: string,
}

export interface ILoyalFansStory {
  uid: string,
  type: string,
  file: string,
}

export interface ILoyalFansObject {
  uid: string,
  type: string,
  processing?: boolean,
}