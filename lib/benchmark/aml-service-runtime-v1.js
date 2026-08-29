import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

import { createAmlAdapter } from "./aml-adapter-v1.js";
import {
  AML_HTTP_DEFAULT_AUTH_MODE,
  AML_HTTP_DEFAULT_HOST,
  AML_HTTP_DEFAULT_PORT,
  createAmlHttpServer,
} from "./aml-http-server-v1.js";
import {
  DEFAULT_SF_BASE_URL,
  EMBEDDING_MODEL,
} from "../siliconflow-runtime.js";
import {
  normalizeEmbeddingBaseUrlIdentity,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  SEMANTIC_EMBEDDING_MODEL_REVISION,
  SEMANTIC_EMBEDDING_PROVIDER,
} from "./longmemeval-semantic-retrieval-runner-v1.js";

export const AML_SERVICE_RUNTIME_SCHEMA = "memory_engine_aml_service_runtime_v1";
export const AML_DEFAULT_RETAINED_ROOT = "/tmp/memory-engine-aml-data";
export const AML_DEFAULT_MAX_TOP_K = 100;
export const AML_SEMANTIC_RUNTIME_ENABLED = true;
export const AML_EMBEDDING_API_PATH = "/v1/embeddings";
export const AML_EMBEDDING_TIMEOUT_MS = 45_000;

function nonEmptyEnv(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim();
}

function positivePort(value) {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) throw new Error("aml_service_port_invalid");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("aml_service_port_invalid");
  return parsed;
}

function assertTemporaryRetainedRoot(value) {
  const candidate = resolve(String(value || ""));
  const temporaryRoot = resolve(tmpdir());
  if (candidate === temporaryRoot || !candidate.startsWith(`${temporaryRoot}${sep}`)) {
    throw new Error("aml_service_retained_root_invalid");
  }
  return candidate;
}

function assertBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("aml_service_base_url_invalid");
  }
  if (![
    "http:",
    "https:",
  ].includes(parsed.protocol)) throw new Error("aml_service_base_url_invalid");
  return parsed.toString();
}

export function parseAmlServiceConfig({
  env = process.env,
  semanticEnabled = true,
  allowInjectedProvider = false,
} = {}) {
  const host = nonEmptyEnv(env, "AML_HOST") || AML_HTTP_DEFAULT_HOST;
  const port = positivePort(nonEmptyEnv(env, "AML_PORT") || String(AML_HTTP_DEFAULT_PORT));
  const authMode = nonEmptyEnv(env, "AML_AUTH_MODE") || AML_DEFAULT_AUTH_MODE;
  if (!["none", "auto", "bearer", "token", "x-api-key"].includes(authMode)) {
    throw new Error("aml_service_auth_mode_invalid");
  }
  const memorySystemKey = nonEmptyEnv(env, "AML_MEMORY_SYSTEM_KEY");
  if (authMode !== "none" && !memorySystemKey) throw new Error("aml_service_auth_key_required");
  const retainedRoot = assertTemporaryRetainedRoot(
    nonEmptyEnv(env, "AML_RETAINED_ROOT") || AML_DEFAULT_RETAINED_ROOT,
  );
  const baseUrl = assertBaseUrl(nonEmptyEnv(env, "SILICONFLOW_BASE_URL") || DEFAULT_SF_BASE_URL);
  const embeddingApiKey = nonEmptyEnv(env, "SILICONFLOW_API_KEY");
  if (semanticEnabled && !embeddingApiKey && !allowInjectedProvider) {
    throw new Error("aml_service_embedding_key_required");
  }
  return Object.freeze({
    schema: AML_SERVICE_RUNTIME_SCHEMA,
    host,
    port,
    retainedRoot,
    authMode,
    memorySystemKey,
    maxTopK: AML_DEFAULT_MAX_TOP_K,
    semanticEnabled: Boolean(semanticEnabled),
    embeddingProvider: SEMANTIC_EMBEDDING_PROVIDER,
    embeddingModel: EMBEDDING_MODEL,
    embeddingModelRevision: SEMANTIC_EMBEDDING_MODEL_REVISION,
    embeddingDimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
    embeddingBaseUrl: baseUrl,
    embeddingBaseUrlIdentity: normalizeEmbeddingBaseUrlIdentity(baseUrl),
    embeddingApiKey,
  });
}

function sanitizedProviderError() {
  return new Error("aml_embedding_provider_request_failed");
}

function defaultRequestImpl({ url, method, headers, body, timeoutMs }) {
  const requestFn = url.protocol === "http:" ? httpRequest : httpsRequest;
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const request = requestFn(url, { method, headers }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => finish(resolvePromise, {
        statusCode: Number(response.statusCode || 0),
        body: Buffer.concat(chunks),
      }));
      response.on("error", error => finish(rejectPromise, error));
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("aml_embedding_provider_timeout"));
    });
    request.on("error", error => finish(rejectPromise, error));
    request.end(body);
  });
}

function parseProviderEmbedding(response) {
  const status = Number(response?.statusCode || 0);
  if (status < 200 || status >= 300) throw sanitizedProviderError();
  const raw = Buffer.isBuffer(response?.body)
    ? response.body.toString("utf8")
    : String(response?.body || "");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("aml_embedding_provider_response_invalid");
  }
  const embedding = parsed?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) && !(ArrayBuffer.isView(embedding) && !(embedding instanceof DataView))) {
    throw new Error("aml_embedding_provider_response_invalid");
  }
  return Array.isArray(embedding) ? embedding : Array.from(embedding);
}

export function createSiliconFlowEmbeddingProvider({
  apiKey,
  baseUrl = DEFAULT_SF_BASE_URL,
  model = EMBEDDING_MODEL,
  requestImpl = defaultRequestImpl,
  timeoutMs = AML_EMBEDDING_TIMEOUT_MS,
} = {}) {
  if (typeof apiKey !== "string" || apiKey.length === 0) throw new Error("aml_service_embedding_key_required");
  if (typeof requestImpl !== "function") throw new Error("aml_service_request_impl_required");
  const parsedBaseUrl = assertBaseUrl(baseUrl);
  const safeBaseUrl = new URL(parsedBaseUrl);
  safeBaseUrl.username = "";
  safeBaseUrl.password = "";
  safeBaseUrl.search = "";
  safeBaseUrl.hash = "";
  const url = new URL(AML_EMBEDDING_API_PATH, safeBaseUrl);
  const identity = normalizeEmbeddingBaseUrlIdentity(parsedBaseUrl);

  async function embed(input) {
    const body = JSON.stringify({ model, input: String(input) });
    let response;
    try {
      response = await requestImpl({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body,
        timeoutMs,
      });
    } catch {
      throw sanitizedProviderError();
    }
    return parseProviderEmbedding(response);
  }

  return Object.freeze({
    provider: SEMANTIC_EMBEDDING_PROVIDER,
    model,
    model_revision: SEMANTIC_EMBEDDING_MODEL_REVISION,
    dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
    base_url_identity: identity,
    api_path: AML_EMBEDDING_API_PATH,
    embed,
  });
}

export function createAmlServiceRuntime({
  env = process.env,
  semanticEnabled = AML_SEMANTIC_RUNTIME_ENABLED,
  adapter = null,
  adapterFactory = createAmlAdapter,
  serverFactory = createAmlHttpServer,
  embeddingProvider = null,
  requestImpl = defaultRequestImpl,
  logger = () => {},
} = {}) {
  const config = parseAmlServiceConfig({
    env,
    semanticEnabled: Boolean(semanticEnabled),
    allowInjectedProvider: typeof embeddingProvider === "function" ||
      (embeddingProvider && typeof embeddingProvider.embed === "function"),
  });
  if (adapter && (typeof adapter.add !== "function" || typeof adapter.search !== "function" ||
      typeof adapter.close !== "function")) {
    throw new Error("aml_service_adapter_invalid");
  }
  if (typeof adapterFactory !== "function" || typeof serverFactory !== "function") {
    throw new Error("aml_service_factory_invalid");
  }

  const provider = config.semanticEnabled
    ? (embeddingProvider || createSiliconFlowEmbeddingProvider({
      apiKey: config.embeddingApiKey,
      baseUrl: config.embeddingBaseUrl,
      requestImpl,
    }))
    : null;
  const selectedAdapter = adapter || adapterFactory({
    retainedRoot: config.retainedRoot,
    maxTopK: config.maxTopK,
    embeddingProvider: provider,
    embeddingBaseUrl: config.embeddingBaseUrl,
  });
  const server = serverFactory({
    adapter: selectedAdapter,
    host: config.host,
    port: config.port,
    authMode: config.authMode,
    memorySystemKey: config.memorySystemKey,
    logger,
  });
  if (!server || typeof server.start !== "function" || typeof server.close !== "function") {
    throw new Error("aml_service_server_invalid");
  }

  return {
    schema: AML_SERVICE_RUNTIME_SCHEMA,
    config,
    adapter: selectedAdapter,
    server,
    provider,
    start: () => server.start(),
    close: () => server.close(),
  };
}
