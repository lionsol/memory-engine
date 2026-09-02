const businessTime = require("../lib/business-time.cjs");

const DEFAULT_BUSINESS_TIME_ZONE = businessTime.DEFAULT_BUSINESS_TIME_ZONE;

function dateStrInTimeZone(offsetDays = 0, timeZone = DEFAULT_BUSINESS_TIME_ZONE, now = new Date()) {
  return businessTime.shiftBusinessDate(
    businessTime.businessDateFromInstant(now, timeZone),
    offsetDays,
  );
}

module.exports = {
  DEFAULT_BUSINESS_TIME_ZONE,
  dateStrInTimeZone,
};
