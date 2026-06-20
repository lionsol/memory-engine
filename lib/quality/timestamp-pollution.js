export const TIMESTAMP_POLLUTION_PATTERNS = [
  {
    id: "iso_utc_datetime",
    regex: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/,
  },
  {
    id: "spaced_datetime",
    regex: /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/,
  },
  {
    id: "bracketed_time_prefix",
    regex: /^\[[^\]]*\d{2}:\d{2}:\d{2}[^\]]*\]/m,
  },
];

export function detectTimestampPollution(text) {
  const value = String(text ?? "");
  for (const pattern of TIMESTAMP_POLLUTION_PATTERNS) {
    const match = value.match(pattern.regex);
    if (match?.[0]) {
      return {
        detected: true,
        detected_pattern: pattern.id,
        matched_text: match[0],
      };
    }
  }
  return {
    detected: false,
    detected_pattern: null,
    matched_text: null,
  };
}

export function hasTimestampPollution(text) {
  return detectTimestampPollution(text).detected;
}
