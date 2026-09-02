const businessTime = require("../business-time.cjs");

const DEFAULT_TIME_ZONE = businessTime.DEFAULT_BUSINESS_TIME_ZONE;

function todayDateStr(now = null, timeZone = DEFAULT_TIME_ZONE) {
  return dateStringInTimeZone(now ?? Date.now(), timeZone);
}

function yesterdayDateStr(now = null, timeZone = DEFAULT_TIME_ZONE) {
  const businessToday = dateStringInTimeZone(now ?? Date.now(), timeZone);
  return businessTime.shiftBusinessDate(businessToday, -1);
}

function parseDatePartsInTimeZone(dateInput, timeZone = DEFAULT_TIME_ZONE) {
  const parts = businessTime.getTimeZoneLocalParts(dateInput ?? new Date(), timeZone);
  return {
    year: String(parts.year).padStart(4, "0"),
    month: String(parts.month).padStart(2, "0"),
    day: String(parts.day).padStart(2, "0"),
    hour: String(parts.hour).padStart(2, "0"),
    minute: String(parts.minute).padStart(2, "0"),
    second: String(parts.second).padStart(2, "0"),
  };
}

function dateStringInTimeZone(dateInput, timeZone = DEFAULT_TIME_ZONE) {
  return businessTime.businessDateFromInstant(dateInput ?? new Date(), timeZone);
}

function shiftDateString(dateStr, days) {
  return businessTime.shiftBusinessDate(dateStr, days);
}

function buildNightlyEntryId({
  targetDate,
  category = "episodic",
  generatedAt = null,
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  const effectiveGeneratedAt = generatedAt ?? Date.now();
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
