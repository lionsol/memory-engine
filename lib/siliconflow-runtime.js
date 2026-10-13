import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { AUTO_RECALL_CANCELLATION_CODE } from "./recall/request-budget.js";

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
    let settled = false;
    let req = null;
    let response = null;
    let timer = null;
    let data = "";
    const signal = options?.signal;
    const deadlineMs = Number(options?.deadlineMs);

    const cleanup = () => {
      signal?.removeEventListener?.("abort", onAbort);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const cancellationError = (stage = "embedding") => {
      if (signal?.reason?.code === AUTO_RECALL_CANCELLATION_CODE) return signal.reason;
      const error = new Error(AUTO_RECALL_CANCELLATION_CODE);
      error.code = AUTO_RECALL_CANCELLATION_CODE;
      error.stage = stage;
      return error;
    };
    const terminate = error => {
      if (settled) return;
      try { response?.destroy?.(); } catch {}
      try { req?.destroy?.(); } catch {}
      finish(rejectPromise, error);
    };
    const onAbort = () => terminate(cancellationError());

    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (signal?.addEventListener) signal.addEventListener("abort", onAbort, { once: true });
    if (Number.isFinite(deadlineMs) && deadlineMs >= 0) {
      timer = setTimeout(() => terminate(cancellationError("embedding_deadline")), deadlineMs);
      timer?.unref?.();
    }

    try {
      req = requestImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        ...(signal ? { signal } : {}),
      }, (res) => {
        if (settled) {
          res?.resume?.();
          return;
        }
        response = res;
        res.on("data", chunk => {
          if (!settled) data += chunk;
        });
        res.on("error", e => terminate(new Error(
          `SiliconFlow embedding request failed: ${e?.message || "response error"}`,
        )));
        res.on("aborted", () => terminate(new Error("SiliconFlow embedding response aborted")));
        res.on("end", () => {
          if (settled) return;
          const statusCode = Number(res?.statusCode || 0);
          if (statusCode < 200 || statusCode >= 300) {
            finish(rejectPromise, new Error(`SiliconFlow embedding request failed: HTTP ${statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed?.error) {
              finish(rejectPromise, new Error(`SiliconFlow embedding request failed: HTTP ${statusCode}`));
              return;
            }
            const embedding = parsed?.data?.[0]?.embedding;
            if (Array.isArray(embedding)) {
              finish(resolvePromise, embedding);
              return;
            }
            if (ArrayBuffer.isView(embedding)) {
              finish(resolvePromise, Array.from(embedding));
              return;
            }
            finish(resolvePromise, []);
          } catch {
            finish(rejectPromise, new Error("SiliconFlow embedding response parse failed"));
          }
        });
      });
      req.on("error", e => finish(
        rejectPromise,
        new Error(`SiliconFlow embedding request failed: ${e?.message || "network error"}`),
      ));
      req.write(body);
      req.end();
    } catch (error) {
      finish(rejectPromise, error);
    }
  });
}
