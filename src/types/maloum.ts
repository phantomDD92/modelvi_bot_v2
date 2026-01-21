export interface IMaloumFolder {
  _id: string;
  name: string;
}

export interface IMaloumUser {
  _id: string;
  username: string;
  isCreator: boolean;
  contentSettings: {
    canCreatorsComment: boolean;
  };
}

export interface IMaloumPost {
  _id: string;
  createdAt: string;
  publishedAt: string;
  type: string;
  active: boolean;
  categories: [{ _id: string; name: string; type: string }];
  createdBy: IMaloumUser;
  media: [
    {
      uploadId: string;
      uploadStatus: string;
      type: string;
      url: string;
      width: number;
      height: number;
    },
  ];
  public: boolean;
  isVisible: boolean;
  isAgeVerificationRequired: boolean;
  isSubscribed: boolean;
  caption: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
}

export interface IMaloumMedia {
  uploadId: string;
  type: string;
  url: string;
}
export interface IMaloumMediaInfo {
  media: IMaloumMedia;
  thumbnail: IMaloumMedia;
}

export interface IMaloumCategory {
  _id: string;
  name: string;
  type?: string;
}

export interface IMaloumChat {
  chatPartner: {
    username: string;
    _id: string;
  };
  lastRelevantMessage: {
    text: string;
    type: string;
    sentAt: string;
  };
  unReadMessages: boolean;
}

export interface IMaloumEarning {
  category: string;
  executedAt: string;
  price: {
    payoutAmount: number;
    net: number;
    currency: string;
  };
  status: string;
}

export interface IMaloumProfile {
  email: string;
  hasCompletedSetup: boolean;
  isAgeVerified: boolean;
  isCreator: boolean;
  isTrusted: boolean;
  isVerified: boolean;
  language: string;
  madeProductPurchase: boolean;
  madeProductSale: boolean;
  needsAgeVerification: boolean;
  registeredAt: string;
  subscriptionPrice: number;
  username: string;
  _id: string;
}
