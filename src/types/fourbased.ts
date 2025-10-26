export interface IFourBasedProfile {
  _id: string,
  name: string,
  created_at: string,
  folders: string[],
  roles: [{ name: string }],
  verified: boolean,
  status: string,
  verification_status: string,
}

export interface IFourBasedPost {
  _id: string,
  categories: string[],
  created_at: string,
  description: string,
  user_id: string,
}

export interface IFourBasedVault {
  _id: string,
  categories: string[],
  belongs_to_folders: string[],
  created_at: string,
  description: string,
  user_id: string,
}

export interface IFourBasedUser {
  _id: string,
  verified: boolean,
  name: string,
  creator: boolean
};

export interface IFourBasedChat {
  _id: string,
  users: [{ _id: string, name: string }],
  last_message: {
    _id: string,
    created_at: string,
    message: string,
    user_id: string,
  }
}

export interface IFourBasedUser {
  _id: string,
  name: string,
  creator: boolean,
  cold_communication_status: string,
}