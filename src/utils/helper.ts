import { Platform } from "../types/constant";

export function getPlatformName(platform: string) {
  switch (platform) {
    case Platform.F2F:
      return "F2F";
    case Platform.FANCENTRO:
      return "Fancentro";
    case Platform.FANSLY:
      return "Fansly";
    case Platform.MALOUM:
      return "Maloum";
    case Platform.KNKY:
      return "Knky";
    case Platform.FANVUE:
      return "Fanvue";
    case Platform.ONLYFANS:
      return "OnlyFans";
    case Platform.MYMFANS:
      return "MymFans";
    case Platform.FOURBASED:
      return "4Based";
    case Platform.DFANXYZ:
      return "DFanXyz";
    case Platform.FETLIFE:
      return "FetLife";
    case Platform.LOYALFANS:
      return "LoyalFans";
    case Platform.MYCLUB:
      return "MyClub";
    case Platform.MANYVIDS:
      return "ManyVids";
    case Platform.PORNHUB:
      return "PornHub";
    default:
      break
  }
  return "";
}

