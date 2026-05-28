const DEFAULT_BUSINESS_TIME_ZONE = "Asia/Shanghai";

const dtfCache = new Map();

function formatterFor(timeZone) {
  const tz = String(timeZone || "").trim();
  if (!tz) throw new Error("timeZone is required");
  if (dtfCache.has(tz)) return dtfCache.get(tz);

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dtfCache.set(tz, formatter);
  return formatter;
}

function datePartsInTimeZone(date, timeZone) {
  const formatter = formatterFor(timeZone);
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`unable to resolve date parts for timezone: ${timeZone}`);
  }
  return { year, month, day };
}

function dateStrInTimeZone(offsetDays = 0, timeZone = DEFAULT_BUSINESS_TIME_ZONE, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date input");

  const { year, month, day } = datePartsInTimeZone(date, timeZone);
  const utcCalendarDate = new Date(Date.UTC(year, month - 1, day));
  utcCalendarDate.setUTCDate(utcCalendarDate.getUTCDate() + Number(offsetDays || 0));

  const y = utcCalendarDate.getUTCFullYear();
  const m = String(utcCalendarDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utcCalendarDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

module.exports = {
  DEFAULT_BUSINESS_TIME_ZONE,
  dateStrInTimeZone,
};
