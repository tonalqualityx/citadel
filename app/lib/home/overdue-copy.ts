/** Overdue by others: the words on a row. Plain, no dashes. */
export function overdueDaysLabel(days: number): string {
  return days === 1 ? '1 day overdue' : `${days} days overdue`;
}
