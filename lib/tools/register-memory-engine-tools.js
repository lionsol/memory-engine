import {
  PRODUCTION_DEFAULT_TOP_K,
  PRODUCTION_TOP_K_MAX,
  PRODUCTION_TOP_K_MIN,
} from "../recall/top-k-policy.js";

export const MEMORY_ENGINE_TOOL_NAMES = Object.freeze([
  "memory_engine",
  "memory_engine_search",
  "memory_engine_get",
]);

async function denyMemoryEngineGet() {
  return {
    found: false,
    error: "owner_authorization_required",
    code: "MEMORY_GET_OWNER_AUTH_REQUIRED",
  };
}

function trustedExplicitSearchContext(context) {
  const sessionIdentity = typeof context?.sessionId === "string" && context.sessionId.trim()
    ? context.sessionId.trim()
    : typeof context?.sessionKey === "string" && context.sessionKey.trim()
      ? context.sessionKey.trim()
      : null;
  if (!sessionIdentity) return null;
  return Object.freeze({
    source: "openclaw_runtime",
    sessionIdentity,
    runIdentity: null,
    requestIdentity: null,
  });
}

export function registerMemoryEngineTools(api, executors) {
  const {
    memoryEngine,
    memoryEngineSearch,
    memoryEngineGet,
  } = executors;

  api.registerTool({
    name: "memory_engine",
    label: "Memory Engine",
    description: [
      `智能记忆系统 — 置信度评分 + 时间衰减 + 引用强化。\n`,
      `\n=== 最常用操作 ===\n`,
      `search -> 搜索记忆。写 text=你的查询。返回结果带 id/confidence/score。\n`,
      `cite   -> 引用强化。只可强化本轮 Search 返回的 id，把它们放入 chunk_ids 数组。\n`,
      `add    -> 存新记忆。写 text=内容，推荐指定 category（见下）。\n`,
      `\n=== 其他操作 ===\n`,
      `status -> 查看统计。\n`,
      `archive -> 标记低置信度记忆为已归档。\n`,
      `update -> 手动更新某条记忆的字段。\n`,
      `\n=== category 建议 ===\n`,
      `user_identity: 用户身份/职业/核心特征（protected, 不衰减）\n`,
      `preference: 用户偏好/习惯（τ=30天）\n`,
      `kg_node: 知识图谱结构结论（τ=90天）\n`,
      `raw_log: 日常对话/未提炼想法（τ=7天, 默认）\n`,
      `temporary: 临时/一次性（τ=2天）\n`,
      `episodic: 情节摘要（τ=30天）\n`,
      `\n重要：cite 只接受本轮 Search 返回的 id，否则记忆会衰减。`,
    ].join(""),
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["add", "search", "cite", "update", "status", "archive", "kg-bridge", "detect-conflicts"],
        },
        text: { type: "string" },
        category: {
          type: "string",
          enum: ["temporary", "raw_log", "episodic", "preference", "kg_node", "user_identity"],
        },
        protected: { type: "boolean" },
        chunk_id: { type: "string" },
        chunk_ids: {
          type: "array",
          items: { type: "string" },
          description: "List of chunk ID prefixes returned by Search in the current turn; unrestricted historical IDs are rejected; update-only IDs are rejected",
        },
        hit: { type: "boolean" },
        top_k: {
          type: "integer",
          minimum: PRODUCTION_TOP_K_MIN,
          maximum: PRODUCTION_TOP_K_MAX,
          default: PRODUCTION_DEFAULT_TOP_K,
        },
      },
      required: ["action"],
    },
    execute: memoryEngine,
  });

  api.registerTool(
    context => {
      const trustedRuntimeContext = trustedExplicitSearchContext(context);
      return {
        name: "memory_engine_search",
        label: "Memory Engine Search",
        description: "Search memory-engine and return bounded untrusted snippets plus retrieval metadata.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            text: { type: "string" },
            top_k: {
              type: "integer",
              minimum: PRODUCTION_TOP_K_MIN,
              maximum: PRODUCTION_TOP_K_MAX,
              default: PRODUCTION_DEFAULT_TOP_K,
            },
          },
          required: ["query"],
        },
        execute: (toolCallId, params) => memoryEngineSearch(
          toolCallId,
          params,
          trustedRuntimeContext,
        ),
      };
    },
    { name: "memory_engine_search" },
  );

  api.registerTool(
    context => {
      const ownerAuthorized = context?.senderIsOwner === true;
      return {
        name: "memory_engine_get",
        label: "Memory Engine Get",
        description: "Read one memory by engine id or id prefix and return its text plus source path and line range when available.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
        execute: ownerAuthorized ? memoryEngineGet : denyMemoryEngineGet,
      };
    },
    { name: "memory_engine_get" },
  );
}
