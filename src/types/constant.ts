export const Platform = {
  FANCENTRO: 'FNC',
  FANSLY: 'FAN',
  F2F: 'F2F',
  KNKY: "KNKY",
  MALOUM: "MALOUM",
  ONLYFANS: "ONLYFANS",
  LOYALFANS: "LOYALFANS",
  MYMFANS: "MYMFANS",
  FETLIFE: "FETLIFE",
  FOURBASED: "FOURBASED",
  DFANXYZ: "DFANXYZ",
  UNFILTRD: "UNFILTRD",
  MYCLUB: "MYCLUB",
  MANYVIDS: "MANYVIDS",
  FANVUE: "FANVUE",
  PORNHUB: "PORNHUB",
  BESTFANS: "BESTFANS",
  
  FANLIKE: "FANLIKE",
  FETLIFELIKE: "FETLIFELIKE",
};

export const ScheduleStatus = {
  WAITING: 1,
  SCHEDULED: 2,
  FINISHED: 3,
  FAILED: 4,
};

export const LOG_TIME_FORMAT = "MM-DD HH:mm";
export const DEFAULT_LIVING_POSTS = 10;
export const DEFAULT_STORY_MAX_COUNT = 3;
export const MAX_ERROR_COUNT = 5;

export const POST_PROHIBITED = "prohibited";
export const POST_LIMITED = "limited";

export const CONCURRENT_STARTING_BOTS = 3;

export const KnkyStoryType = {
  PUBLIC: 1,
  PRIME: 2,
  PAYTOVIEW: 4,
}

export const F2FStoryType = {
  NONE: 0,
  PUBLIC: 1,
  FOLLOWERS: 2,
  FANS: 4,
}

export const ONLYFANS_SITE_KEY_V3 = "6LcvNcwdAAAAAMWAuNRXH74u3QePsEzTm6GEjx0J"
export const ONLYFANS_SITE_KEY_V2 = "6LddGoYgAAAAAHD275rVBjuOYXiofr1u4pFS5lHn"

export const FANCENTRO_SITE_KEY_V3 = "6LfLzNkaAAAAAElQh7ILVaVUUjnuyQqcWoACqaIs"
export const FANCENTRO_SITE_KEY_V2 = "6LeQ8NoaAAAAAPJUZuO7kQVadg5Du420nyZFadke"

export const PostType = {
  FREE: 1,
  FANS: 2,
  PAID: 3,
}

export const PostResultType = {
  SUCCESS: 0,
  FAILED: 1,
  PROHIBITED: 2,
}

export const F2F_PRICE_MIN = 5;

export const EUROTOUSD = 1.18;

export const ActionType = {
  LOGIN: 0,
  UPDATE: 1,
  UPLOAD: 2,
  POST: 3,
  STORY: 4,
  COMMENT: 5,
  CHAT: 6,
  BALANCE: 7,
  SCHEDULE: 8,
}