const DEFAULT_BUSINESS_TIME_ZONE = "Asia/Shanghai";

const INVALID_BUSINESS_TIME_ZONE = "INVALID_BUSINESS_TIME_ZONE";
const INVALID_BUSINESS_INSTANT = "INVALID_BUSINESS_INSTANT";
const INVALID_BUSINESS_DATE = "INVALID_BUSINESS_DATE";

const formatterCache = new Map();

function businessTimeError(code, message, cause = null) {
  const error = new RangeError(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function isNonEmpty(value) {
  return value !== undefined
    && value !== null
    && String(value).trim() !== "";
}

function configuredBusinessTimeZone(config) {
  if (!config || typeof config !== "object") return undefined;
  return config?.timezone?.business
    ?? config?.memoryEngine?.timezone?.business
    ?? config?.config?.memoryEngine?.timezone?.business;
}

function validateBusinessTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw businessTimeError(INVALID_BUSINESS_TIME_ZONE, "business timezone must be a valid IANA timezone");
  }
  const timeZone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch (cause) {
    throw businessTimeError(INVALID_BUSINESS_TIME_ZONE, "business timezone must be a valid IANA timezone", cause);
  }
  return timeZone;
}

function resolveBusinessTimeZone({
  explicitTimeZone,
  env = process.env,
  config = null,
  configTimeZone = undefined,
  defaultTimeZone = DEFAULT_BUSINESS_TIME_ZONE,
} = {}) {
  const candidates = [
    explicitTimeZone,
    env?.MEMORY_ENGINE_TIME_ZONE,
    configTimeZone !== undefined ? configTimeZone : configuredBusinessTimeZone(config),
    defaultTimeZone,
  ];
  const selected = candidates.find(isNonEmpty);
  return validateBusinessTimeZone(selected);
}

function formatterFor(timeZone) {
  const resolvedTimeZone = validateBusinessTimeZone(timeZone);
  if (formatterCache.has(resolvedTimeZone)) return formatterCache.get(resolvedTimeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTimeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(resolvedTimeZone, formatter);
  return formatter;
}

function toValidDate(value) {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    if (Number.isFinite(milliseconds)) return new Date(milliseconds);
    throw businessTimeError(INVALID_BUSINESS_INSTANT, "business instant is invalid");
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return new Date(value);
    throw businessTimeError(INVALID_BUSINESS_INSTANT, "business instant is invalid");
  }
  if (typeof value === "string" && value.trim()) {
    const milliseconds = Date.parse(value);
    if (Number.isFinite(milliseconds)) return new Date(milliseconds);
  }
  throw businessTimeError(INVALID_BUSINESS_INSTANT, "business instant is invalid");
}

function getTimeZoneLocalParts(instant = new Date(), timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  const date = toValidDate(instant);
  const formatter = formatterFor(timeZone);
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]),
  );
  const result = {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    offsetMinutes: parseTimeZoneOffsetMinutes(parts.timeZoneName),
  };
  if (![result.year, result.month, result.day, result.hour, result.minute, result.second]
    .every(Number.isInteger)) {
    throw businessTimeError(INVALID_BUSINESS_INSTANT, "business instant could not be represented in business timezone");
  }
  return result;
}

function parseTimeZoneOffsetMinutes(offsetText) {
  const raw = String(offsetText || "").trim();
  if (!raw || raw === "GMT" || raw === "UTC") return 0;
  const match = raw.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) {
    throw businessTimeError(INVALID_BUSINESS_TIME_ZONE, "business timezone offset could not be resolved");
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) {
    throw businessTimeError(INVALID_BUSINESS_TIME_ZONE, "business timezone offset could not be resolved");
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * ((hours * 60) + minutes);
}

function validateBusinessDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw businessTimeError(INVALID_BUSINESS_DATE, "business date must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (
    calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
  ) {
    throw businessTimeError(INVALID_BUSINESS_DATE, "business date must be a real calendar date");
  }
  return { year, month, day };
}

function formatBusinessDate({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function businessDateFromInstant(instant = new Date(), timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  const parts = getTimeZoneLocalParts(instant, timeZone);
  return formatBusinessDate(parts);
}

function normalizeShiftDays(days) {
  if (typeof days === "number" && Number.isInteger(days)) return days;
  if (typeof days === "string" && /^[-+]?\d+$/.test(days.trim())) return Number(days);
  throw businessTimeError(INVALID_BUSINESS_DATE, "business date shift must be an integer");
}

function shiftBusinessDate(dateString, days = 0) {
  const parts = validateBusinessDate(dateString);
  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  calendar.setUTCDate(calendar.getUTCDate() + normalizeShiftDays(days));
  return formatBusinessDate({
    year: calendar.getUTCFullYear(),
    month: calendar.getUTCMonth() + 1,
    day: calendar.getUTCDate(),
  });
}

function localDateTimeToUtcMs(dateString, timeZone, hour = 0, minute = 0, second = 0) {
  const date = validateBusinessDate(dateString);
  const resolvedTimeZone = validateBusinessTimeZone(timeZone);
  const wallClockUtcMs = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second);
  const offsets = new Set();
  for (const delta of [-172800000, -86400000, 0, 86400000, 172800000]) {
    offsets.add(getTimeZoneLocalParts(wallClockUtcMs + delta, resolvedTimeZone).offsetMinutes);
  }
  for (const offsetMinutes of offsets) {
    const candidateMs = wallClockUtcMs - (offsetMinutes * 60 * 1000);
    const candidate = getTimeZoneLocalParts(candidateMs, resolvedTimeZone);
    if (
      candidate.year === date.year
      && candidate.month === date.month
      && candidate.day === date.day
      && candidate.hour === hour
      && candidate.minute === minute
      && candidate.second === second
    ) {
      return candidateMs;
    }
  }
  throw businessTimeError(INVALID_BUSINESS_DATE, "business local datetime is not representable");
}

function businessDateToUtcRange(dateString, timeZone = DEFAULT_BUSINESS_TIME_ZONE) {
  const targetDate = validateBusinessDate(dateString);
  const normalizedDate = formatBusinessDate(targetDate);
  const nextDate = shiftBusinessDate(normalizedDate, 1);
  const startMs = localDateTimeToUtcMs(normalizedDate, timeZone);
  const endMs = localDateTimeToUtcMs(nextDate, timeZone);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw businessTimeError(INVALID_BUSINESS_DATE, "business date range is invalid");
  }
  return {
    startMs,
    endMs,
    startSec: Math.floor(startMs / 1000),
    endSec: Math.floor(endMs / 1000),
  };
}

function localDateKey(date = new Date()) {
  const value = toValidDate(date);
  return formatBusinessDate({
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
  });
}

function addDaysLocal(date, days) {
  const value = toValidDate(date);
  value.setDate(value.getDate() + normalizeShiftDays(days));
  return value;
}

module.exports = {
  DEFAULT_BUSINESS_TIME_ZONE,
  INVALID_BUSINESS_TIME_ZONE,
  INVALID_BUSINESS_INSTANT,
  INVALID_BUSINESS_DATE,
  addDaysLocal,
  businessDateFromInstant,
  businessDateToUtcRange,
  getTimeZoneLocalParts,
  localDateKey,
  resolveBusinessTimeZone,
  shiftBusinessDate,
  validateBusinessDate,
  validateBusinessTimeZone,
};
