import type { InfoContract } from "../types/type";
import { PLUGIN_ID } from "./common";

export function buildPluginInfo(): InfoContract {
  return {
    name: "包子漫画",
    uuid: PLUGIN_ID,
    iconUrl: "https://www.baozimh.com/favicon.ico",
    creator: {
      name: "",
      describe: "",
    },
    describe: "包子漫画抓取插件",
    version: "0.0.1",
    home: "https://github.com/deretame/Breeze-plugin-baozimh",
    updateUrl:
      "https://api.github.com/repos/deretame/Breeze-plugin-baozimh/releases/latest",
    npmName: "breeze-plugin-baozimh",
    function: [],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
