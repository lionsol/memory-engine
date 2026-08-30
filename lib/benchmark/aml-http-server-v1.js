import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const AML_HTTP_SERVER_SCHEMA = "memory_engine_aml_http_server_v1";
export const AML_HTTP_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
export const AML_HTTP_DEFAULT_HOST = "0.0.0.0";
export const AML_HTTP_DEFAULT_PORT = 8080;
export const AML_HTTP_DEFAULT_AUTH_MODE = "auto";
export const AML_HTTP_AUTH_MODES = Object.freeze(["none", "auto", "bearer", "token", "x-api-key"]);
const AML_SEARCH_ITEM_ALLOWED_KEYS = new Set(["id", "content", "score", "created_at"]);

class AmlHttpError extends Error {
  constructor(status, reason) {
    super(reason);
    this.name = "AmlHttpError";
    this.status = status;
    this.reason = reason;
  }
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" ||
      typeof adapter.add !== "function" ||
      typeof adapter.search !== "function" ||
      typeof adapter.close !== "function") {
    throw new Error("aml_http_adapter_required");
  }
  return adapter;
}

function assertAuthConfig(mode, key) {
  if (!AML_HTTP_AUTH_MODES.includes(mode)) throw new Error("aml_http_auth_mode_invalid");
  if (mode !== "none" && !asNonEmptyString(key)) throw new Error("aml_http_auth_key_required");
  return {
    mode,
    key: mode === "none" ? null : key,
  };
}

function constantTimeStringEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left)).digest();
  const rightDigest = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function parseAuthorizationHeader(value) {
  if (typeof value !== "string") return null;
  const match = /^(Bearer|Token)\s+(.+)$/u.exec(value);
  if (!match || match[2].length === 0) return null;
  return {
    scheme: match[1].toLowerCase(),
    key: match[2],
  };
}

function requestAuthScheme(req, mode) {
  if (mode === "x-api-key" || (mode === "auto" && req.headers["x-api-key"] !== undefined)) {
    const key = req.headers["x-api-key"];
    return typeof key === "string" && key.length > 0 ? { scheme: "x-api-key", key } : null;
  }
  const authorization = parseAuthorizationHeader(req.headers.authorization);
  if (!authorization) return null;
  return authorization;
}

function isAuthorized(req, auth) {
  if (auth.mode === "none") return true;
  const presented = requestAuthScheme(req, auth.mode);
  if (!presented) return false;
  if (auth.mode === "bearer" && presented.scheme !== "bearer") return false;
  if (auth.mode === "token" && presented.scheme !== "token") return false;
  if (auth.mode === "x-api-key" && presented.scheme !== "x-api-key") return false;
  if (auth.mode === "auto" && !["bearer", "token", "x-api-key"].includes(presented.scheme)) return false;
  return constantTimeStringEqual(presented.key, auth.key);
}

function writeJson(res, status, value, headers = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function writeError(res, status, reason) {
  writeJson(res, status, { detail: { reason } });
}

function errorCode(error) {
  return String(error?.code || error?.reason || error?.message || "");
}

function classifyAdapterError(error) {
  const code = errorCode(error).toLowerCase();
  if (code === "aml_request_id_payload_conflict") {
    return { status: 422, reason: "aml_request_id_payload_conflict" };
  }
  if (code.includes("semantic") || code.includes("vector") || code.includes("lance") ||
      code.includes("cache") || code.includes("provider") || code.includes("backend") ||
      code.includes("host_memory") || code.includes("fallback") || code.includes("data_plane") ||
      code.includes("canonical") || code.includes("engine_") || code.includes("core_") ||
      code.includes("adapter_closed")) {
    return { status: 503, reason: "backend_unavailable" };
  }
  if (code.includes("unknown_field") || code.includes("must_be") || code.includes("required") ||
      code.includes("top_k") || code.includes("messages") || code.includes("request_")) {
    return { status: 422, reason: "adapter_schema_validation" };
  }
  return { status: 500, reason: "internal_error" };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJsonBody(req, limit) {
  const contentLength = req.headers["content-length"];
  if (contentLength !== undefined && /^\d+$/u.test(String(contentLength)) &&
      Number(contentLength) > limit) {
    req.resume();
    throw new AmlHttpError(413, "request_body_too_large");
  }
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  await new Promise((resolve, reject) => {
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", resolve);
    req.on("error", reject);
  });
  if (tooLarge) throw new AmlHttpError(413, "request_body_too_large");
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) throw new AmlHttpError(400, "malformed_json");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AmlHttpError(400, "malformed_json");
  }
  if (!isPlainObject(parsed)) throw new AmlHttpError(400, "json_object_required");
  return parsed;
}

function validateAddResponse(value, request) {
  if (!isPlainObject(value) ||
      Object.keys(value).sort().join("\u0000") !== ["request_id", "session_id", "success", "user_id"].join("\u0000") ||
      value.success !== true || value.request_id !== request.request_id ||
      value.user_id !== request.user_id || value.session_id !== request.session_id) {
    throw new AmlHttpError(500, "adapter_add_response_invalid");
  }
  return {
    success: true,
    request_id: value.request_id,
    user_id: value.user_id,
    session_id: value.session_id,
  };
}

function validateSearchResponse(value, request) {
  const topK = Number(request.top_k);
  if (!isPlainObject(value) || Object.keys(value).length !== 1 ||
      !Object.hasOwn(value, "data") || !Array.isArray(value.data) ||
      !Number.isInteger(topK) || topK < 1 || value.data.length > topK) {
    throw new AmlHttpError(500, "adapter_search_response_invalid");
  }
  const data = value.data.map(item => {
    const itemKeys = isPlainObject(item) ? Object.keys(item) : [];
    if (!isPlainObject(item) || itemKeys.some(key => !AML_SEARCH_ITEM_ALLOWED_KEYS.has(key)) ||
        !Object.hasOwn(item, "id") || !Object.hasOwn(item, "content") ||
        typeof item.id !== "string" || item.id.length === 0 ||
        typeof item.content !== "string" || item.content.length === 0) {
      throw new AmlHttpError(500, "adapter_search_response_invalid");
    }
    if (Object.hasOwn(item, "score") &&
        (typeof item.score !== "number" || !Number.isFinite(item.score))) {
      throw new AmlHttpError(500, "adapter_search_response_invalid");
    }
    if (Object.hasOwn(item, "created_at") && item.created_at !== null) {
      const createdAtType = typeof item.created_at;
      if (createdAtType === "number" && !Number.isFinite(item.created_at)) {
        throw new AmlHttpError(500, "adapter_search_response_invalid");
      }
      if (createdAtType !== "string" && createdAtType !== "number") {
        throw new AmlHttpError(500, "adapter_search_response_invalid");
      }
    }
    return item;
  });
  return { data };
}

function routeFor(pathname) {
  if (pathname === "/health") return "health";
  if (pathname === "/add") return "add";
  if (pathname === "/search") return "search";
  return null;
}

function methodAllowed(route, method) {
  if (route === "health") return method === "GET";
  return method === "POST";
}

function waitForZero(getCount) {
  if (getCount() === 0) return Promise.resolve();
  return new Promise(resolve => {
    const poll = () => {
      if (getCount() === 0) resolve();
      else setImmediate(poll);
    };
    poll();
  });
}

export function createAmlHttpServer({
  adapter,
  host = AML_HTTP_DEFAULT_HOST,
  port = AML_HTTP_DEFAULT_PORT,
  authMode = AML_HTTP_DEFAULT_AUTH_MODE,
  memorySystemKey = null,
  bodyLimitBytes = AML_HTTP_BODY_LIMIT_BYTES,
  logger = () => {},
} = {}) {
  assertAdapter(adapter);
  if (typeof host !== "string" || host.length === 0) throw new Error("aml_http_host_invalid");
  if (!Number.isInteger(Number(port)) || Number(port) < 0 || Number(port) > 65535) {
    throw new Error("aml_http_port_invalid");
  }
  if (!Number.isInteger(Number(bodyLimitBytes)) || Number(bodyLimitBytes) < 1) {
    throw new Error("aml_http_body_limit_invalid");
  }
  const auth = assertAuthConfig(authMode, memorySystemKey);
  const server = createServer();
  let started = false;
  let closing = false;
  let inFlight = 0;
  let closePromise = null;
  let adapterClosed = false;

  async function handleRequest(req, res) {
    const url = new URL(req.url || "/", "http://aml.invalid");
    const route = routeFor(url.pathname);
    if (!route) {
      writeError(res, 404, "not_found");
      return;
    }
    if (!methodAllowed(route, req.method)) {
      writeError(res, 405, "method_not_allowed");
      return;
    }
    if (route === "health") {
      writeJson(res, 200, { status: "ok" });
      return;
    }
    if (closing) {
      writeError(res, 503, "service_unavailable");
      return;
    }
    if (!isAuthorized(req, auth)) {
      req.resume();
      writeError(res, 401, "authentication_required");
      return;
    }

    inFlight += 1;
    try {
      const body = await readJsonBody(req, Number(bodyLimitBytes));
      let result;
      if (route === "add") {
        result = validateAddResponse(await adapter.add(body), body);
      } else {
        result = validateSearchResponse(await adapter.search(body), body);
      }
      writeJson(res, 200, result);
    } catch (error) {
      const mapped = error instanceof AmlHttpError
        ? { status: error.status, reason: error.reason }
        : classifyAdapterError(error);
      if (mapped.status >= 500 && mapped.status !== 503) {
        try {
          logger("request_error", { route, status: mapped.status, reason: mapped.reason });
        } catch {}
      }
      writeError(res, mapped.status, mapped.reason);
    } finally {
      inFlight -= 1;
    }
  }

  server.on("request", (req, res) => {
    handleRequest(req, res).catch(() => {
      writeError(res, 500, "internal_error");
    });
  });

  async function start() {
    if (started) return server.address();
    if (closing) throw new Error("aml_http_server_closed");
    await new Promise((resolvePromise, rejectPromise) => {
      const onError = error => {
        server.off("listening", onListening);
        rejectPromise(error);
      };
      const onListening = () => {
        server.off("error", onError);
        started = true;
        resolvePromise();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(Number(port), host);
    });
    return server.address();
  }

  async function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      if (started) {
        const stopped = new Promise((resolvePromise, rejectPromise) => {
          server.close(error => error ? rejectPromise(error) : resolvePromise());
        });
        await waitForZero(() => inFlight);
        if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
        await stopped;
      }
      await waitForZero(() => inFlight);
      if (!adapterClosed) {
        adapterClosed = true;
        await adapter.close();
      }
      started = false;
    })();
    return closePromise;
  }

  return {
    schema: AML_HTTP_SERVER_SCHEMA,
    server,
    host,
    port: Number(port),
    auth_mode: auth.mode,
    body_limit_bytes: Number(bodyLimitBytes),
    start,
    close,
    address: () => server.address(),
    get started() {
      return started;
    },
    get closing() {
      return closing;
    },
  };
}
