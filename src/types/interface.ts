export interface IBotConfig {
  platform: string,
  alias: string,
  schedule_interval: number,
  captcha_key: string,
  server_root: string,
  image_root: string,
  console_log?: boolean,
  channel_notify?: string,
  like_bot?: boolean,
  debug?: boolean,
  force?: boolean,
  graylog_host?: string,

}

export interface IBotInfo {
  _id: string,
  alias: string,
  pid?: number,
};

export interface IConsoleConfig {
  platform: string, // platform for bot console
  id: string, // bot console id
  schedule_interval: number,  // bot console scheduling interval
  console_log: boolean, // flag if console log enabled
  channel_notify: string | undefined, // discord channel for notification
  bot_limit: number,  // bot limit count,
  server_root: string,
  bot_path: string,
}

export interface ICommentUser {
  alias: string,
  status: string
};
export interface ICommentParams {
  comments: string[],
  block_users: string[],
};

export interface IAccountParams {
  contents: IContent[],
  // post related params
  postMode?: number,
  postContentIndex?: number,
  postCount?: number,
  postNextTime?: any,
  postRemains?: string[],
  // comment related params
  commentEnabled?: boolean,
  commentNextTime?: any,
  commentInterval?: number,
  // story related params
  storyEnabled?: boolean, // story enabled flag
  storyMode?: number, // story mode
  storyIndex?: number,  // current story index
  storyNextTime?: any,  // next story time
  storyOffsets?: number[],  // offsets array when story mode is offsets
  storyInterval?: number, // interval when story mode is interval
  storyMaxCount?: number,
  recent: boolean,
  // balance related
  balanceNextTime?: any,
  // chat related
  chatNextTime?: any,
  chatEnabled?: boolean,
  // schedule
  scheduleNextTime?: any, // next 

  followNextTime?: number,
  likeNextTime?: number,
  likeLimit?: number,
}

export interface IAccountSettings {
  platform: string,
  alias: string,
  email: string,
  password: string,
  status: boolean,
  proxy?: string,
  // for post bot
  actor?: {
    number: number,
    name: string,
  }
  device?: string,
  params?: IAccountParams
  chatTeam?: {
    discord?: string,
  }
  // for like bot
  emailPassword?: string,
  registered?: boolean,
  verified?: boolean,
  name?: string,

  // for fetlife like bot
  gender?: string,
  orientation?: string,
  role?: string,
  birthday?: Date,
  city?: string,
}

export interface IAccountID {
  alias: string,
  id: string,
}

export interface IProxy {
  server: string,
  username: string,
  password: string,
}

export interface IMedia {
  name: string,
  mode: string,
  uuid?: string,
}

export interface IModelInfo {
  alias: string,
  identifier: string,
}

export interface IContent {
  media: IMedia[],
  preview?: IMedia,
  folder: string,
  mode?: string,
  title: string,
  story?: number, // for fancentro
  knkyStoryType?: number,
  knkyStoryPrice?: number,
  f2fStoryType?: number,
  description?: string,
  postTags: string[],
}

export interface ISchedulePost {
  _id: string,
  schedule: {
    media: IMedia,
    preview?: IMedia,
    folder: string,
    title: string,
    tags: string[],
    type: number,
    price?: number,
    scheduledAt: any,
  }
  post?: string
  status: number,
  reason?: string,
}

export interface IScheduleResult {
  id?: string,
  post?: string,
  status: number,
  reason?: string,
}

export interface IProfile {
  name: string,
  alias: string,
}

export interface IChatMessage {
  user: string,
  message: string,
  time: Date,
}

export interface ILog {
  success: boolean,
  action: number,
  message: string,
  disabled?: boolean,
  notified?: boolean,
  error?: string,
  target?: string,
  targets?: string[],
  description?: string,
  time?: Date,
}

export interface IApiInfo {
  action: string,
  function: string,
  method?: string,
  endpoint?:string,
  params?: any,
}