import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

export const EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-4B";
export const DEFAULT_SF_BASE_URL = "https://api.siliconflow.cn";

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function getByPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function extractSFKeyFromConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return "";
  const paths = [
    ["models", "providers", "siliconflow", "apiKey"],
    ["providers", "siliconflow", "apiKey"],
    ["siliconflow", "apiKey"],
    ["siliconflowApiKey"],
    ["SILICONFLOW_API_KEY"],
    ["SF_API_KEY"],
  ];
  for (const path of paths) {
    const value = normalizeNonEmptyString(getByPath(cfg, path));
    if (value) return value;
  }
  return "";
}

export function getSFBaseUrl({ env = process.env } = {}) {
  const fromEnv =
    normalizeNonEmptyString(env?.SILICONFLOW_BASE_URL) ||
    normalizeNonEmptyString(env?.SF_BASE_URL);
  const candidate = fromEnv || DEFAULT_SF_BASE_URL;
  try {
    return new URL(candidate).toString();
  } catch {
    return DEFAULT_SF_BASE_URL;
  }
}

export function resolveSFKey(options = {}) {
  const directConfigCandidates = [
    options?.cfg,
    options?.apiConfig,
    options?.config,
  ];
  for (const cfg of directConfigCandidates) {
    const key = extractSFKeyFromConfig(cfg);
    if (key) return key;
  }

  const env = options?.env || process.env;
  const envKey =
    normalizeNonEmptyString(env?.SILICONFLOW_API_KEY) ||
    normalizeNonEmptyString(env?.SF_API_KEY);
  if (envKey) return envKey;

  const readFile = typeof options?.readFile === "function" ? options.readFile : readFileSync;
  const homeDir = normalizeNonEmptyString(options?.homeDir) || homedir();
  try {
    const raw = readFile(resolve(homeDir, ".openclaw/openclaw.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return extractSFKeyFromConfig(parsed);
  } catch (e) {
    return "";
  }
}

/**
 * Generate embedding via SiliconFlow embedding API.
 */
export async function generateEmbedding(text, options = {}) {
  const apiKey = resolveSFKey(options);
  if (!apiKey) throw new Error("SiliconFlow API key not found");

  const requestImpl = typeof options.requestImpl === "function"
    ? options.requestImpl
    : (await import("node:https")).request;
  const url = new URL("/v1/embeddings", options.baseUrl || getSFBaseUrl({ env: options.env }));
  const body = JSON.stringify({
    model: EMBEDDING_MODEL,
    input: String(text || "").slice(0, 8000),
  });

  return new Promise((resolvePromise, rejectPromise) => {
    const req = requestImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const statusCode = Number(res?.statusCode || 0);
        if (statusCode < 200 || statusCode >= 300) {
          return rejectPromise(new Error(`SiliconFlow embedding request failed: HTTP ${statusCode}`));
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed?.error) {
            return rejectPromise(new Error(`SiliconFlow embedding request failed: HTTP ${statusCode}`));
          }
          const embedding = parsed?.data?.[0]?.embedding;
          if (Array.isArray(embedding)) return resolvePromise(embedding);
          if (ArrayBuffer.isView(embedding)) return resolvePromise(Array.from(embedding));
          return resolvePromise([]);
        } catch (e) {
          rejectPromise(new Error("SiliconFlow embedding response parse failed"));
        }
      });
    });
    req.on("error", (e) => {
      rejectPromise(new Error(`SiliconFlow embedding request failed: ${e?.message || "network error"}`));
    });
    req.write(body);
    req.end();
  });
}
