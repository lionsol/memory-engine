import { getMemory, listMemories } from "../services/memory-service.js";

const WRITE_DISABLED_RESPONSE = {
  status: 403,
  body: { error: "console memory write APIs are disabled" },
};

export async function handleMemoryApi({ req, method, parts, searchParams }) {
  if (parts.length === 2 && method === "GET") {
    return { status: 200, body: listMemories({
      q: searchParams.get("q") || "",
      category: searchParams.get("category") || "",
      archived: searchParams.get("archived") || "active",
      limit: Number(searchParams.get("limit")) || 100,
    }) };
  }
  if (parts.length === 3 && method === "GET") {
    const memory = getMemory(decodeURIComponent(parts[2]));
    return memory ? { status: 200, body: memory } : { status: 404, body: { error: "memory not found" } };
  }
  if (parts.length === 4 && method === "POST") {
    if (["archive", "delete", "confidence"].includes(parts[3])) return WRITE_DISABLED_RESPONSE;
  }
  return null;
}
