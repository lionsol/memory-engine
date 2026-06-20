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

function detectStructuredContext(value, matchedText) {
  const escaped = String(matchedText ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return null;

  const sessionHeading = new RegExp(`^#\\s+Session:\\s+${escaped}(?:\\s+GMT[+-]\\d+)?\\s*$`, "m");
  if (sessionHeading.test(value)) {
    return {
      classification: "normal_session_heading",
      penalize: false,
      reason: "session heading metadata is structured document framing, not raw-log residue",
    };
  }

  const generatedAtField = new RegExp(`^generatedAt:\\s*${escaped}\\s*$`, "m");
  if (generatedAtField.test(value)) {
    return {
      classification: "structured_generated_metadata",
      penalize: false,
      reason: "generatedAt metadata fields are structured checkpoint metadata",
    };
  }

  const generatedAtFooter = new RegExp(`^_Generated at\\s+${escaped}(?:\\s+[—-].*)?_\\s*$`, "m");
  if (generatedAtFooter.test(value)) {
    return {
      classification: "structured_generated_metadata",
      penalize: false,
      reason: "Generated at footers are structured checkpoint metadata",
    };
  }

  const dateHeading = new RegExp(`^#{1,6}\\s+${escaped}(?:\\b|\\s)`, "m");
  if (dateHeading.test(value)) {
    return {
      classification: "normal_markdown_date_heading",
      penalize: false,
      reason: "markdown date headings are normal document structure rather than timestamp pollution",
    };
  }

  return null;
}

function classifyPollutionContext(value, patternId, matchedText) {
  const structured = detectStructuredContext(value, matchedText);
  if (structured) return structured;

  if (patternId === "bracketed_time_prefix") {
    return {
      classification: "raw_log_operational_residue",
      penalize: true,
      reason: "bracketed time prefixes strongly indicate raw operational or log residue",
    };
  }

  if (
    /\[(?:error|warn|warning|info|debug|trace)\]/i.test(value)
    || /\b(prompt processing progress|streaming response|failed to load model|operation canceled|healthcheck|cron|reset file|session file)\b/i.test(value)
    || /^\[[^\]]*\d{2}:\d{2}:\d{2}[^\]]*\]/m.test(value)
  ) {
    return {
      classification: "raw_log_operational_residue",
      penalize: true,
      reason: "timestamp appears alongside log severity, operational progress, or bracketed log framing",
    };
  }

  return {
    classification: "embedded_log_timestamp",
    penalize: true,
    reason: "timestamp is embedded in memory content rather than isolated as structured document metadata",
  };
}

export function detectTimestampPollution(text) {
  const value = String(text ?? "");
  for (const pattern of TIMESTAMP_POLLUTION_PATTERNS) {
    const match = value.match(pattern.regex);
    if (match?.[0]) {
      const context = classifyPollutionContext(value, pattern.id, match[0]);
      return {
        detected: Boolean(context?.penalize),
        detected_pattern: pattern.id,
        matched_text: match[0],
        classification: context?.classification ?? "embedded_log_timestamp",
        penalize: Boolean(context?.penalize),
        reason: context?.reason ?? "timestamp matched the pollution detector",
      };
    }
  }
  return {
    detected: false,
    detected_pattern: null,
    matched_text: null,
    classification: null,
    penalize: false,
    reason: null,
  };
}

export function hasTimestampPollution(text) {
  return detectTimestampPollution(text).penalize;
}
