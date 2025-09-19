export interface IMymFansMedia {
  id: string,
  status: string,
  type: string,
  url: string,
  preview: string
}

export interface IMymFansPost {
  id: string,
  caption: string,
  private: boolean,
  publishedAt: string,
}