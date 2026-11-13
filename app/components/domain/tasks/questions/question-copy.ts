/** Every sentence the questions UI says. Plain words, no dashes. */
import { QUESTION_TZ } from '@/lib/tasks/question-context';

export const QUESTION_COPY = {
  none: 'No questions on this card.',
  whatItIs: 'What it is.',
  sources: 'Who said what.',
  link: 'Open',
  checked: 'What was checked.',
  unknown: 'What is not known.',
  options: 'The options.',
  why: 'Why this is recommended.',
  ifNobody: 'If nobody decides.',
  waitNote: 'Releasing the card keeps this part waiting for your answer.',
  goNote: 'Releasing the card goes with the recommendation.',
  defaulted: 'released without an answer, the recommendation went ahead',
  answerNow: 'Answer',
  onlyMike: 'Only Mike answers these.',
  loading: 'Loading questions.',
} as const;

/** "12 Nov", in Mike's timezone. */
export function answeredDate(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: QUESTION_TZ, day: 'numeric', month: 'short' }).format(new Date(iso));
}
