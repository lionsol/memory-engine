const DEFAULT_MAX_BYTES = 64 * 1024;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function readJsonBody(req, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const limit = Math.max(1, Number(maxBytes) || DEFAULT_MAX_BYTES);
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ""));
    totalBytes += buffer.byteLength;
    if (totalBytes > limit) {
      throw createHttpError(413, "payload too large");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw createHttpError(400, "invalid json");
  }
}
