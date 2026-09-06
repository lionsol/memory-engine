import { createHash, timingSafeEqual } from "node:crypto";

export const CONSOLE_AUTH_REQUIRED = "console_auth_required";
export const CONSOLE_HOST_NOT_ALLOWED = "console_host_not_allowed";
export const CONSOLE_ORIGIN_NOT_ALLOWED = "console_origin_not_allowed";
export const CONSOLE_TOKEN_REQUIRED = "MEMORY_CONSOLE_TOKEN_REQUIRED";
export const CONSOLE_ALLOWED_HOSTS_REQUIRED = "MEMORY_CONSOLE_ALLOWED_HOSTS_REQUIRED";

const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "localhost", "::1"]);
const WILDCARD_BIND_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

function normalizeHostname(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.startsWith("[") && raw.endsWith("]")) return raw.slice(1, -1);
  return raw;
}

function parseAuthority(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(`http://${raw}`);
    return {
      hostname: normalizeHostname(parsed.hostname),
      port: parsed.port || null,
    };
  } catch {
    return null;
  }
}

function parseAllowedHosts(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const hosts = rawValues
    .map(item => parseAuthority(item)?.hostname || normalizeHostname(item))
    .filter(Boolean);
  if (hosts.some(host => host === "*" || WILDCARD_BIND_HOSTS.has(host))) {
    throw new Error(CONSOLE_HOST_NOT_ALLOWED);
  }
  return [...new Set(hosts)];
}

function defaultAllowedHosts(bindHost) {
  const normalized = normalizeHostname(bindHost);
  if (LOOPBACK_HOSTS.includes(normalized)) return [...LOOPBACK_HOSTS];
  if (WILDCARD_BIND_HOSTS.has(normalized)) return [];
  return normalized ? [normalized] : [];
}

function secureEquals(left, right) {
  const leftHash = createHash("sha256").update(String(left ?? ""), "utf8").digest();
  const rightHash = createHash("sha256").update(String(right ?? ""), "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function readPresentedToken(authorization) {
  const header = String(authorization || "").trim();
  const bearer = /^Bearer\s+(.+)$/iu.exec(header);
  if (bearer) return bearer[1];

  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/u.exec(header);
  if (!basic) return null;
  try {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    const username = decoded.slice(0, colon);
    const password = decoded.slice(colon + 1);
    return username === "memory" ? password : null;
  } catch {
    return null;
  }
}

export function createConsoleSecurityPolicy({
  token = process.env.MEMORY_CONSOLE_TOKEN,
  bindHost = process.env.MEMORY_CONSOLE_HOST || "127.0.0.1",
  port = Number(process.env.MEMORY_CONSOLE_PORT || 8787),
  allowedHosts = process.env.MEMORY_CONSOLE_ALLOWED_HOSTS,
} = {}) {
  const normalizedToken = typeof token === "string" ? token : "";
  if (normalizedToken.length < 16) throw new Error(CONSOLE_TOKEN_REQUIRED);

  const normalizedBindHost = normalizeHostname(bindHost);
  const explicitAllowedHosts = allowedHosts === undefined || allowedHosts === null || allowedHosts === ""
    ? null
    : parseAllowedHosts(allowedHosts);
  const resolvedAllowedHosts = explicitAllowedHosts || defaultAllowedHosts(normalizedBindHost);
  if (resolvedAllowedHosts.length === 0) throw new Error(CONSOLE_ALLOWED_HOSTS_REQUIRED);

  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new Error("MEMORY_CONSOLE_PORT_INVALID");
  }

  return Object.freeze({
    token: normalizedToken,
    bindHost: normalizedBindHost,
    port: normalizedPort,
    allowedHosts: Object.freeze(resolvedAllowedHosts),
  });
}

function sameRequestOrigin(originValue, requestAuthority, policy) {
  if (!originValue) return true;
  if (String(originValue).trim() === "null") return false;
  try {
    const origin = new URL(String(originValue));
    const originHost = normalizeHostname(origin.hostname);
    const requestPort = requestAuthority.port || null;
    const originPort = origin.port || null;
    return policy.allowedHosts.includes(originHost)
      && originHost === requestAuthority.hostname
      && originPort === requestPort;
  } catch {
    return false;
  }
}

export function evaluateConsoleRequestSecurity(req, policy, { requireAuth = true } = {}) {
  const requestAuthority = parseAuthority(req?.headers?.host);
  if (!requestAuthority || !policy.allowedHosts.includes(requestAuthority.hostname)) {
    return { allowed: false, status: 421, code: CONSOLE_HOST_NOT_ALLOWED };
  }

  const fetchSite = String(req?.headers?.["sec-fetch-site"] || "").trim().toLowerCase();
  if (fetchSite === "cross-site") {
    return { allowed: false, status: 403, code: CONSOLE_ORIGIN_NOT_ALLOWED };
  }
  if (!sameRequestOrigin(req?.headers?.origin, requestAuthority, policy)) {
    return { allowed: false, status: 403, code: CONSOLE_ORIGIN_NOT_ALLOWED };
  }

  if (!requireAuth) return { allowed: true, status: 200, code: null };
  const presented = readPresentedToken(req?.headers?.authorization);
  if (!presented || !secureEquals(presented, policy.token)) {
    return {
      allowed: false,
      status: 401,
      code: CONSOLE_AUTH_REQUIRED,
      headers: {
        "www-authenticate": 'Basic realm="Memory Console", charset="UTF-8"',
      },
    };
  }
  return { allowed: true, status: 200, code: null };
}
