const DEFAULT_TIME_ZONE = "Asia/Shanghai";

function todayDateStr(now = null, timeZone = DEFAULT_TIME_ZONE) {
  return dateStringInTimeZone(now || Date.now(), timeZone);
}

function yesterdayDateStr(now = null, timeZone = DEFAULT_TIME_ZONE) {
  const businessToday = dateStringInTimeZone(now || Date.now(), timeZone);
  return shiftDateString(businessToday, -1);
}

function parseDatePartsInTimeZone(dateInput, timeZone = DEFAULT_TIME_ZONE) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) {
    return parseDatePartsInTimeZone(new Date(), timeZone);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function dateStringInTimeZone(dateInput, timeZone = DEFAULT_TIME_ZONE) {
  const p = parseDatePartsInTimeZone(dateInput, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function shiftDateString(dateStr, days) {
  const [y, m, d] = String(dateStr || "").split("-").map(n => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(days) || 0));
  return dt.toISOString().slice(0, 10);
}

function buildNightlyEntryId({
  targetDate,
  category = "episodic",
  generatedAt = null,
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  const effectiveGeneratedAt = generatedAt || Date.now();
  const businessTargetDate = targetDate || yesterdayDateStr(effectiveGeneratedAt, timeZone);
  const p = parseDatePartsInTimeZone(effectiveGeneratedAt, timeZone);
  return `${businessTargetDate}_${category}_nightly_generated_${p.hour}${p.minute}${p.second}`;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  todayDateStr,
  yesterdayDateStr,
  parseDatePartsInTimeZone,
  dateStringInTimeZone,
  shiftDateString,
  buildNightlyEntryId,
};
