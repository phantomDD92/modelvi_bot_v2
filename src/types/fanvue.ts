export interface IFanvueEarning {
  creator_net: number,
  fanvue_fee: number,
  gross: number,
  paid_at: string,
  invoice_status: string,
}

export interface IFanvueFolder {
  folder_name: string
}

export interface IFanvueVault {
  uuid: string,
  created_at: string,
  media_type: number,
  name: string,
  status: number,
  processed_url: string,
}

export interface IFanvuePost {
  uuid: string,
  published_at: string,
  available_to_group_id: number,
  text: string,
  created_at: string,
}

export interface IFanvueProfile {
  uuid: string,
  nickname: string,
  display_name: string,
  handle: string,
  is_creator: boolean,
}

export interface IFanvueChat {
  displayName: string,
  lastMessage: {
    text?: string,
    sentAt: string,
    mediaType?: number,
  },
  nickname?: string,

}