import { archiveMemory, deleteMemory, getMemory, listMemories, updateConfidence } from "../services/memory-service.js";

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

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
    const id = decodeURIComponent(parts[2]);
    if (parts[3] === "archive") return { status: 200, body: archiveMemory(id) };
    if (parts[3] === "delete") return { status: 200, body: deleteMemory(id) };
    if (parts[3] === "confidence") {
      const body = await readJson(req);
      return { status: 200, body: updateConfidence(id, body.confidence) };
    }
  }
  return null;
}
