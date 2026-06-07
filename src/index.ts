import {
  fetchImageBytes,
  getChapter,
  getComicDetail,
  getReadSnapshot,
  searchComic,
} from "./baozimh-core";
import { buildPluginInfo } from "./get-info";

async function getInfo() {
  return buildPluginInfo();
}

async function getSettingsBundle() {
  return {
    source: buildPluginInfo().uuid,
    scheme: {
      version: "1.0.0" as const,
      type: "settings" as const,
      sections: [],
    },
    data: { canShowUserInfo: false, values: {} },
  };
}

async function getCapabilitiesBundle() {
  return {
    source: buildPluginInfo().uuid,
    scheme: {
      version: "1.0.0" as const,
      type: "capabilities" as const,
      actions: [],
    },
    data: {},
  };
}

export default {
  getInfo,
  searchComic,
  getComicDetail,
  getChapter,
  getReadSnapshot,
  fetchImageBytes,
  getSettingsBundle,
  getCapabilitiesBundle,
};
