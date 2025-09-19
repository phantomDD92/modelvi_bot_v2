export interface IFancentroLabel {
  id: number,
  name: string,
}

export interface IFancentroVaultItem {
  id: number,
}

export interface IFancentroPost {
  id: number,
  created_at: string,
  comments_count: number,
  likes_count: number,
  view_count: number,
  status: string,
  privacy: string,
  title: string,
}

export interface IFancentroProfile {
  id: number,
  username: string,
  followingCount: number,
  subscribedCount: number,
  alias?: string,
}
export interface IFncVault {
  type: string,
  id: string,
  relationships: {
    storageResource: {
      data: {
        type: string,
        id: string,
      }
    }
  }
};

export interface IFncStory {
  id: number,
  resourceId: number,
  access: number,
}

export interface IFncVaultsResp {
  total: number,
  vaults: IFncVault[],
}

export interface IFncFolder {
  type: string,
  id: string,
  attributes: {
    name: string,
    role: string,
    imagesCount: number,
    videosCount: number,
    audiosCount: number,
  }
}