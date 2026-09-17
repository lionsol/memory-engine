import { request as httpsRequest } from "node:https";

import {
  buildQ4RecallHintC1BSiliconFlowRequestBodyV1,
  parseQ4RecallHintC1BSiliconFlowResponseV1,
  Q4_C1B_SF_API_KEY_ENV,
  Q4_C1B_SF_ENDPOINT,
} from "./q4-recall-hint-c1b-siliconflow-v4flash-v1.js";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveExactCredential(env, envName) {
  if (envName !== Q4_C1B_SF_API_KEY_ENV) throw fail("Q4_C1B_SF_CREDENTIAL_BINDING_MISMATCH");
  const value = typeof env?.[envName] === "string" ? env[envName].trim() : "";
  if (!value) throw fail("Q4_C1B_SF_CREDENTIAL_UNAVAILABLE");
  return value;
}

function chunkBytes(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk) && !(chunk instanceof DataView)) return chunk.byteLength;
  return Buffer.byteLength(String(chunk));
}

function redactedTransportError(error, fallback) {
  const message = String(error?.message || fallback)
    .replace(/authorization\s*:\s*bearer\s+[^\s]+/giu, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/giu, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]");
  return message.slice(0, 300);
}

function requestJson({ requestImpl, endpoint, apiKey, body, signal, maxResponseBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let response = null;
    let request = null;
    let fallbackTimer = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      signal?.removeEventListener?.("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const terminate = error => {
      if (settled) return;
      try { response?.destroy?.(); } catch {}
      try { request?.destroy?.(); } catch {}
      finish(error);
    };
    const onAbort = () => terminate(signal?.reason instanceof Error
      ? signal.reason
      : fail("Q4_C1B_SF_ABORTED"));

    try {
      request = requestImpl(new URL(endpoint), {
        method: "POST",
        signal,
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      }, res => {
        response = res;
        let text = "";
        let bytes = 0;
        let ended = false;
        res.on("data", chunk => {
          if (settled) return;
          bytes += chunkBytes(chunk);
          if (bytes > maxResponseBytes) {
            terminate(fail("Q4_C1B_SF_RESPONSE_TOO_LARGE"));
            return;
          }
          text += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          ended = true;
          const statusCode = Number(res.statusCode || 0);
          if (statusCode < 200 || statusCode >= 300) {
            terminate(fail("Q4_C1B_SF_HTTP_ERROR", `SiliconFlow HTTP ${statusCode}`));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            terminate(fail("Q4_C1B_SF_RESPONSE_JSON_INVALID"));
            return;
          }
          try {
            finish(null, parseQ4RecallHintC1BSiliconFlowResponseV1(parsed));
          } catch (error) {
            terminate(error);
          }
        });
        res.on("error", error => terminate(fail(
          "Q4_C1B_SF_RESPONSE_FAILED",
          redactedTransportError(error, "SiliconFlow response failed"),
        )));
        res.on("aborted", () => terminate(fail("Q4_C1B_SF_RESPONSE_ABORTED")));
        res.on("close", () => {
          if (!ended && !settled) terminate(fail("Q4_C1B_SF_RESPONSE_CLOSED"));
        });
      });
      request.on("error", error => terminate(fail(
        "Q4_C1B_SF_REQUEST_FAILED",
        redactedTransportError(error, "SiliconFlow request failed"),
      )));
      request.on("timeout", () => terminate(fail("Q4_C1B_SF_REQUEST_TIMEOUT")));
      signal?.addEventListener?.("abort", onAbort, { once: true });
      fallbackTimer = setTimeout(
        () => terminate(fail("Q4_C1B_SF_REQUEST_TIMEOUT")),
        timeoutMs,
      );
      fallbackTimer.unref?.();
      request.write(JSON.stringify(body));
      request.end();
    } catch (error) {
      terminate(fail(
        "Q4_C1B_SF_REQUEST_FAILED",
        redactedTransportError(error, "SiliconFlow request failed"),
      ));
    }
  });
}

export function createQ4RecallHintC1BSiliconFlowTransportV1({
  packet,
  env = process.env,
  requestImpl = httpsRequest,
} = {}) {
  if (!packet || typeof packet !== "object") throw fail("Q4_C1B_SF_PACKET_REQUIRED");
  if (packet.endpoint !== Q4_C1B_SF_ENDPOINT) throw fail("Q4_C1B_SF_ENDPOINT_MISMATCH");
  if (typeof requestImpl !== "function") throw fail("Q4_C1B_SF_REQUEST_IMPL_REQUIRED");
  return async ({ request, signal, apiKeyEnv, provider, model, endpoint } = {}) => {
    if (provider !== packet.provider || model !== packet.model || endpoint !== packet.endpoint) {
      throw fail("Q4_C1B_SF_TRANSPORT_BINDING_MISMATCH");
    }
    const apiKey = resolveExactCredential(env, apiKeyEnv);
    const body = buildQ4RecallHintC1BSiliconFlowRequestBodyV1({ packet, request });
    return requestJson({
      requestImpl,
      endpoint: packet.endpoint,
      apiKey,
      body,
      signal,
      maxResponseBytes: request.max_response_bytes,
      timeoutMs: request.deadline_ms,
    });
  };
}

export function q4RecallHintC1BSiliconFlowCredentialPreflightV1({ env = process.env } = {}) {
  resolveExactCredential(env, Q4_C1B_SF_API_KEY_ENV);
  return Object.freeze({
    credential_env: Q4_C1B_SF_API_KEY_ENV,
    available: true,
  });
}
