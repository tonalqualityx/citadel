/** Home Slice 9a: the refusals of the card taps. An ApiError, so every route answers it the usual way. Plain sentences. */
import { ApiError } from '@/lib/api/errors';
import { CARD_GONE, CHANGED_SINCE, TAP_ON_SCREEN } from './copy';

export type ReconcileErrorCode = 'card_gone' | 'changed_since' | 'tap_on_screen' | 'not_found' | 'bad_choice' | 'has_time';

export class ReconcileError extends ApiError {
  constructor(code: ReconcileErrorCode, message?: string) {
    const text: Record<ReconcileErrorCode, string> = {
      card_gone: CARD_GONE,
      changed_since: CHANGED_SINCE,
      tap_on_screen: TAP_ON_SCREEN,
      not_found: 'That card was not found.',
      bad_choice: 'That choice is not offered on this card.',
      has_time: 'That task already has time on it.',
    };
    super(message ?? text[code], code === 'tap_on_screen' ? 400 : code === 'not_found' ? 404 : 409, code);
    this.name = 'ReconcileError';
  }
}
