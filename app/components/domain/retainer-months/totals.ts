export function totalRangeOf(items: { estimate_min_low: number; estimate_min_high: number }[]): { low: number; high: number } {
  return items.reduce((a, i) => ({ low: a.low + i.estimate_min_low, high: a.high + i.estimate_min_high }), { low: 0, high: 0 });
}
