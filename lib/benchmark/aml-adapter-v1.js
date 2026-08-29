import {
  AML_DEFAULT_MAX_TOP_K,
  AML_SEARCH_EVIDENCE_SURFACE,
  createAmlDataPlaneRegistry,
} from "./aml-data-plane-v1.js";

export const AML_ADAPTER_VERSION = "memory_engine_aml_adapter_v1";
export const AML_UPSTREAM_REPOSITORY = "https://github.com/AML-memory/agent-memory-leaderboard";
export const AML_UPSTREAM_COMMIT = "1b8142bfe0f20f1c5218d6b554aa0012de34e504";
export const AML_PROTOCOL_SURFACE = "public_add_search_v1";
export const AML_SEARCH_OPTIONS_POLICY = "accepted_but_not_injected_into_query";

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name}_must_be_object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name}_must_be_nonempty_string`);
  }
  return value;
}

function requireTextString(value, name) {
  if (typeof value !== "string") throw new Error(`${name}_must_be_string`);
  return value;
}

function rejectUnknownKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${name}_unknown_field:${unknown.sort().join(",")}`);
}

function normalizeTimestamp(value, name) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name}_must_be_unix_ms_integer`);
  return parsed;
}

function normalizeTopK(value, maxTopK) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("aml_search_top_k_must_be_positive_integer");
  if (parsed > maxTopK) throw new Error(`aml_search_top_k_exceeds_${maxTopK}`);
  return parsed;
}

export function normalizeAmlAddRequest(value) {
  const request = requireObject(value, "aml_add_request");
  rejectUnknownKeys(
    request,
    new Set(["request_id", "messages", "user_id", "session_id"]),
    "aml_add_request",
  );
  const requestId = requireString(request.request_id, "aml_add_request_id");
  const userId = requireString(request.user_id, "aml_add_user_id");
  const sessionId = requireString(request.session_id, "aml_add_session_id");
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error("aml_add_messages_must_be_nonempty_array");
  }
  const messages = request.messages.map((rawMessage, index) => {
    const message = requireObject(rawMessage, `aml_add_message_${index}`);
    rejectUnknownKeys(
      message,
      new Set(["role", "content", "timestamp"]),
      `aml_add_message_${index}`,
    );
    return {
      role: requireString(message.role, `aml_add_message_${index}_role`),
      content: requireTextString(message.content, `aml_add_message_${index}_content`),
      timestamp_ms: normalizeTimestamp(message.timestamp, `aml_add_message_${index}_timestamp`),
    };
  });
  return {
    request_id: requestId,
    user_id: userId,
    session_id: sessionId,
    messages,
  };
}

export function normalizeAmlSearchRequest(value, { maxTopK = AML_DEFAULT_MAX_TOP_K } = {}) {
  const request = requireObject(value, "aml_search_request");
  rejectUnknownKeys(
    request,
    new Set(["query", "options", "user_id", "top_k"]),
    "aml_search_request",
  );
  const normalized = {
    query: requireString(request.query, "aml_search_query"),
    user_id: requireString(request.user_id, "aml_search_user_id"),
    top_k: normalizeTopK(request.top_k, maxTopK),
  };
  if (Object.prototype.hasOwnProperty.call(request, "options")) normalized.options = request.options;
  return normalized;
}

function createPerUserQueue() {
  const tails = new Map();

  function run(userId, operation) {
    const prior = tails.get(userId) || Promise.resolve();
    const execution = prior.catch(() => {}).then(operation);
    const tail = execution.catch(() => {});
    tails.set(userId, tail);
    return execution.finally(() => {
      if (tails.get(userId) === tail) tails.delete(userId);
    });
  }

  async function drain() {
    await Promise.all([...tails.values()]);
  }

  return { run, drain };
}

export function createAmlAdapter({
  registry = null,
  temporaryParent,
  retainedRoot,
  maxTopK = AML_DEFAULT_MAX_TOP_K,
  vectorBackendFactory = null,
  semanticBackendFactory = null,
  embeddingProvider = null,
  embeddingBaseUrl,
  embeddingCacheFactory,
  lancedbConnect,
  nowSecProvider,
  stageHook,
} = {}) {
  const ownedRegistry = registry || createAmlDataPlaneRegistry({
    temporaryParent,
    retainedRoot,
    maxTopK,
    vectorBackendFactory,
    semanticBackendFactory,
    embeddingProvider,
    embeddingBaseUrl,
    embeddingCacheFactory,
    lancedbConnect,
    nowSecProvider,
    stageHook,
  });
  const queue = createPerUserQueue();
  let closed = false;

  async function add(rawRequest) {
    if (closed) throw new Error("aml_adapter_closed");
    const request = normalizeAmlAddRequest(rawRequest);
    return queue.run(request.user_id, async () => {
      const plane = ownedRegistry.getOrCreate(request.user_id);
      await plane.add(request);
      return {
        success: true,
        request_id: request.request_id,
        user_id: request.user_id,
        session_id: request.session_id,
      };
    });
  }

  async function search(rawRequest) {
    if (closed) throw new Error("aml_adapter_closed");
    const request = normalizeAmlSearchRequest(rawRequest, { maxTopK });
    return queue.run(request.user_id, async () => {
      const plane = ownedRegistry.get(request.user_id);
      if (!plane) return { data: [] };
      const result = await plane.search(request);
      return { data: result.data };
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    await queue.drain();
    if (typeof ownedRegistry.close === "function") await ownedRegistry.close();
  }

  return {
    adapter_version: AML_ADAPTER_VERSION,
    upstream_repository: AML_UPSTREAM_REPOSITORY,
    upstream_commit: AML_UPSTREAM_COMMIT,
    protocol_surface: AML_PROTOCOL_SURFACE,
    evidence_surface: AML_SEARCH_EVIDENCE_SURFACE,
    options_policy: AML_SEARCH_OPTIONS_POLICY,
    add,
    search,
    close,
    registry: ownedRegistry,
    get closed() {
      return closed;
    },
  };
}
