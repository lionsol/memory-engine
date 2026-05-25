export function sanitizeFtsQuery(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildFtsFallbackQuery(text, maxTerms = 8) {
  const sanitized = sanitizeFtsQuery(text);
  const tokens = sanitized.match(/[\p{Script=Han}]{2,}|[\p{L}\p{N}_]{2,}/gu) || [];
  const terms = [];

  for (const token of tokens) {
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 4) {
      for (let index = 0; index <= token.length - 2; index += 1) {
        terms.push(token.slice(index, index + 2));
      }
    } else {
      terms.push(token);
    }
  }

  return [...new Set(terms)].slice(0, maxTerms).join(" OR ");
}
