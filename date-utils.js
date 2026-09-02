import businessTime from "./lib/business-time.cjs";

const {
  addDaysLocal: addDaysLocalByAuthority,
  businessDateFromInstant,
  DEFAULT_BUSINESS_TIME_ZONE,
  localDateKey: localDateKeyByAuthority,
  shiftBusinessDate,
} = businessTime;

export function dateStrInTimeZone(offsetDays = 0, timeZone = DEFAULT_BUSINESS_TIME_ZONE, now = new Date()) {
  return shiftBusinessDate(businessDateFromInstant(now, timeZone), offsetDays);
}

export function localDateKey(date = new Date()) {
  return localDateKeyByAuthority(date);
}

export function addDaysLocal(date, days) {
  return addDaysLocalByAuthority(date, days);
}
