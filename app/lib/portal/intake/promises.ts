/**
 * What a client-facing string must never contain (portal phase B spec 2.2): money, dates, durations,
 * "included", "free", "guarantee", "will be done", "by {day}". Shared by the intake copy-scan tests
 * and the phase C chat gate.
 */
export const PROMISES: Array<[string, RegExp]> = [
  ['money', /[$€£]\s?\d|\b\d[\d,.]*\s?(dollars?|usd)\b|\bprice\b|\bcost\b|\bquote of\b/i],
  ['calendar date', /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i],
  ['duration', /\b(within|in|about|around|under)?\s*\d+\s*(minutes?|hours?|days?|weeks?|months?|business days?)\b/i],
  ['same-day or next-day', /\b(same day|next day|tomorrow|right away|immediately|asap)\b/i],
  ['included', /\bincluded\b|\bincludes\b/i],
  ['free', /\bfree\b|\bno charge\b|\bat no cost\b/i],
  ['guarantee', /\bguarantee/i],
  ['will be done', /\bwill be (done|finished|ready|completed|fixed)\b/i],
  ['by a day', /\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|end of|the end|noon|tonight|next)\b/i],
];

