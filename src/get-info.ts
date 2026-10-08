import type { InfoContract } from "breeze-plugin-kit";
import { PLUGIN_ID } from "./common";

export function buildPluginInfo(): InfoContract {
  return {
    name: "包子漫画",
    uuid: PLUGIN_ID,
    iconUrl: "https://baozimh.org/favicon.ico",
    describe: "包子漫画插件",
    version: "0.0.4",
    home: "https://github.com/deretame/Breeze-plugin-baozimh",
    updateUrl: "https://api.github.com/repos/deretame/Breeze-plugin-baozimh/releases/latest",
    npmName: "breeze-plugin-baozimh",
    function: [],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
