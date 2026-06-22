export const MEMORY_ENGINE_TOOL_NAMES = Object.freeze([
  "memory_engine",
  "memory_engine_search",
  "memory_engine_get",
]);

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
      `cite   -> 引用强化。把 search 返回的 id 放入 chunk_ids 数组。巩固记忆。\n`,
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
      `\n重要：用 search 后必须 cite（或 update --hit），否则记忆会衰减。`,
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
          description: "List of chunk ID prefixes to cite/reinforce",
        },
        hit: { type: "boolean" },
        deep: { type: "boolean", description: "Use LLM for semantic contradiction check (slow path)" },
        top_k: { type: "number", default: 5 },
      },
      required: ["action"],
    },
    execute: memoryEngine,
  });

  api.registerTool({
    name: "memory_engine_search",
    label: "Memory Engine Search",
    description: "Search memory-engine using the existing hybrid-search path without exposing the multi-action tool surface.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        text: { type: "string" },
        top_k: { type: "number", default: 5 },
      },
      required: ["query"],
    },
    execute: memoryEngineSearch,
  });

  api.registerTool({
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
    execute: memoryEngineGet,
  });
}
