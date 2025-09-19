export interface IF2fApiResponse {
  next: string | null,
  previous: string | null,
  results: any[],
}

export interface IF2fFeed {
  uuid: string,
  access: {
    icon: string,
    label: string,
  }
  bookmarked: boolean,
  bookmarks: number,
  comments: number,
  content: string,
  creator: {
    username: string,
    display_name: string,
  }
  datetime: string,
  liked: boolean,
  likes: number,
}

export interface IF2fExplore {
  avatar: string,
  uuid: string,
  creator: string,
}

export interface IF2fPost {
  uuid: string,
  access: {
    icon: string,
    label: string,
  }
  bookmarked: boolean,
  bookmarks: number,
  comments: number,
  content: string,
  datetime: string,
  liked: boolean,
  likes: number,
  revenue: number,
}


export interface IF2fFolder {
  name: string,
  uuid: string,
  folder_count: number,
}

export interface IF2fMedia {
  name: string,
  uuid: string,
  folder: string,
}


export interface IF2fProfile {
  avatar: string,
  username: string,
  uuid: string,
  email: string,
  display_name: string,
  creator?: {
    agency: boolean,
    agency_name: string,
    fans: number,
    followers: number,
  }
}

export interface F2fResp_GetPagePosts {
  next: string | null,
  previous: string | null,
  results: IF2fPost[],
}

export interface IF2FRevenue {
  date: string,
  message_revenue: number,
  post_revenue: number,
  referral_revenue: number,
  subscription_revenue: number,
  tip_revenue: number,
}

export interface IF2fChat {
  uuid: string,
  unread_message_count: number,
  custom_chat_name: string,
  title: string,
  message: IF2fMessage
}
export interface IF2fMessage {
  content: string,
  datetime: string,
  title: string,
  received: boolean,
  read: boolean,
  message_type: string,
}

export interface IF2fStory {
  stories: string[],
}