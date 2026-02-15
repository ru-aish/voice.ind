function parseDate(date) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  return { year, month, day };
}

function parseTime(time) {
  const [hour, minute] = String(time || '').split(':').map(Number);
  return { hour, minute };
}

function formatDateInTimeZone(input, timeZone) {
  const parts = getDateTimePartsInTimeZone(input, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function formatLocalDateTime(year, month, day, hour, minute) {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  const min = String(minute).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:00`;
}

function getDateTimePartsInTimeZone(input, timeZone) {
  const date = input instanceof Date ? input : new Date(input);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const byType = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      byType[part.type] = part.value;
    }
  }
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function getTimeZoneOffsetMs(instantMs, timeZone) {
  const parts = getDateTimePartsInTimeZone(instantMs, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - instantMs;
}

function convertLocalDateTimeToInstantMs(year, month, day, hour, minute, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = utcGuess;

  for (let i = 0; i < 2; i += 1) {
    const offset = getTimeZoneOffsetMs(instant, timeZone);
    instant = utcGuess - offset;
  }

  return instant;
}

function convertDateTimeStringsToInstantMs(date, time, timeZone) {
  const { year, month, day } = parseDate(date);
  const { hour, minute } = parseTime(time);
  return convertLocalDateTimeToInstantMs(year, month, day, hour, minute, timeZone);
}

module.exports = {
  parseDate,
  parseTime,
  formatDateInTimeZone,
  formatLocalDateTime,
  getDateTimePartsInTimeZone,
  getTimeZoneOffsetMs,
  convertLocalDateTimeToInstantMs,
  convertDateTimeStringsToInstantMs,
};
