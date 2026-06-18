const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { getRuntime } = require("./runtime");

const configCache = new Map();

function getConfig() {
  const { configJsonPath } = getRuntime();
  if (!configCache.has(configJsonPath)) {
    try {
      configCache.set(configJsonPath, JSON.parse(readFileSync(configJsonPath, "utf-8")));
    } catch (_) {
      configCache.set(configJsonPath, {});
    }
  }
  return configCache.get(configJsonPath);
}

function getSFKey() {
  try {
    return getConfig().models?.providers?.siliconflow?.apiKey || "";
  } catch (e) {
    return "";
  }
}

function getSFBaseUrl() {
  try {
    return getConfig().models?.providers?.siliconflow?.baseUrl || "https://api.siliconflow.cn/v1";
  } catch (e) {
    return "https://api.siliconflow.cn/v1";
  }
}

function getDSKey() {
  try {
    const keyPath = resolve(getRuntime().workspaceDir, "../credentials/deepseek-api-key");
    const key = readFileSync(keyPath, "utf-8").trim();
    if (key) return key;
  } catch (e) { /* file not found */ }
  try {
    return getConfig().models?.providers?.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  } catch (e) {
    return "";
  }
}

function getDSBaseUrl() {
  try {
    return getConfig().models?.providers?.deepseek?.baseUrl || "https://api.deepseek.com";
  } catch (e) {
    return "https://api.deepseek.com";
  }
}

module.exports = {
  getConfig,
  getSFKey,
  getSFBaseUrl,
  getDSKey,
  getDSBaseUrl,
};
