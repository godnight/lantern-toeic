/** Small bounded LRU shared by page and recording date labels. Invalid zones throw. */
const FORMATTER_LIMIT = 32;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function studyDateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const canonicalLocale = Intl.getCanonicalLocales(locale).join(',');
  const fields = Object.keys(options).sort() as (keyof Intl.DateTimeFormatOptions)[];
  const key = JSON.stringify([canonicalLocale, fields.map(field => [field, options[field]])]);
  const cached = formatters.get(key);
  if (cached) {
    formatters.delete(key);
    formatters.set(key, cached);
    return cached;
  }
  // Construct before eviction: invalid inputs cannot poison or flush good entries.
  const formatter = new Intl.DateTimeFormat(canonicalLocale, options);
  formatters.set(key, formatter);
  if (formatters.size > FORMATTER_LIMIT) formatters.delete(formatters.keys().next().value!);
  return formatter;
}

export function isSupportedStudyTimezone(value: string): boolean {
  if (typeof value !== 'string' || !value || value.length > 100 || value.trim() !== value) return false;
  try {
    studyDateFormatter('en-CA', {timeZone: value, year: 'numeric', month: '2-digit', day: '2-digit'});
    return true;
  } catch {
    return false;
  }
}

export function studyDayKey(value: Date | string = new Date(), timezone = 'Asia/Shanghai'): string {
  const parts = studyDateFormatter('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatStudyDate(value: Date | string, timezone: string | undefined,
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>, locale = 'zh-CN'): string {
  return studyDateFormatter(locale, {...options, timeZone: timezone}).format(new Date(value));
}

/** A useful starting list; any other supported IANA zone may be added by the user. */
export function studyTimezoneChoices(current: string): string[] {
  const common = ['Asia/Shanghai', 'Asia/Tokyo', 'Asia/Bangkok', 'Europe/London', 'Europe/Paris',
    'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];
  return [...new Set([...common, current])].filter(isSupportedStudyTimezone);
}
