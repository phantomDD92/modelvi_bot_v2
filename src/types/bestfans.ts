export interface IBestfansProfile {
  alias: string;
  name: string;
}

export interface IBestfansUpload {
  status: string,
  fileAvailable: boolean,
  uploadLogID: string,
  type: string,
  fileData: {
    url: string,
    filename: string,
    mimetype: string,
    filesize: number,
    id: string
  }
}