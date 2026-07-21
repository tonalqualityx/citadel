// Clarity Phase 3 — The Oracle Face: Today picks (the day's chosen commitments).
// Pure, dependency-free helpers so the ref-validation, WIP cap, and primary-action
// derivation are unit-testable without a DB or Next.js request/response.

export type TodayPickItemType = 'arc' | 'task' | 'session' | 'lead' | 'note';

// WIP ceiling per the evidence-bound design rules: a 6th uncompleted pick for a date is
// rejected (409). The UI applies a warning tint once a day carries more than 3 — that's a
// display nudge, not a hard stop, so it lives below the hard cap, not instead of it.
export const TODAY_PICK_WIP_CAP = 5;
export const TODAY_PICK_WARNING_THRESHOLD = 3;

export interface TodayPickRefInput {
  item_type: TodayPickItemType;
  arc_id?: string | null;
  task_id?: string | null;
  session_external_id?: string | null;
  charter_id?: string | null;
  label?: string | null;
}

export interface TodayPickValidationResult {
  valid: boolean;
  error?: string;
}

const REF_FIELD_BY_TYPE: Record<Exclude<TodayPickItemType, 'note'>, keyof TodayPickRefInput> = {
  arc: 'arc_id',
  task: 'task_id',
  session: 'session_external_id',
  lead: 'charter_id',
};

const ALL_REF_FIELDS: (keyof TodayPickRefInput)[] = [
  'arc_id',
  'task_id',
  'session_external_id',
  'charter_id',
];

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/**
 * Exactly one ref (or, for `note`, the free-form label) must be present per pick — enforced
 * here in the API layer, not the DB (a XOR-of-4 constraint isn't expressible declaratively).
 * `label` is always allowed alongside a ref on non-note types (an override display string),
 * but never counts as satisfying the "exactly one ref" requirement for those types.
 */
export function validateTodayPickRef(input: TodayPickRefInput): TodayPickValidationResult {
  if (input.item_type === 'note') {
    if (!isPresent(input.label)) {
      return { valid: false, error: 'note picks require a non-empty label' };
    }
    const strayRefs = ALL_REF_FIELDS.filter((f) => isPresent(input[f]));
    if (strayRefs.length > 0) {
      return { valid: false, error: 'note picks may not carry arc_id/task_id/session_external_id/charter_id' };
    }
    return { valid: true };
  }

  const requiredField = REF_FIELD_BY_TYPE[input.item_type];
  if (!requiredField) {
    return { valid: false, error: `unknown item_type: ${input.item_type}` };
  }
  if (!isPresent(input[requiredField])) {
    return { valid: false, error: `${input.item_type} picks require ${requiredField}` };
  }

  const otherRefFields = ALL_REF_FIELDS.filter((f) => f !== requiredField);
  const strayOtherRefs = otherRefFields.filter((f) => isPresent(input[f]));
  if (strayOtherRefs.length > 0) {
    return {
      valid: false,
      error: `${input.item_type} picks may only set ${requiredField} (got ${strayOtherRefs.join(', ')} too)`,
    };
  }

  return { valid: true };
}

/** True once a date already holds the max allowed uncompleted picks — a 6th is rejected. */
export function isAtWipCap(uncompletedCount: number): boolean {
  return uncompletedCount >= TODAY_PICK_WIP_CAP;
}

/** UI-only nudge: past 3 uncompleted picks, the day reads as over-committed (warning tint),
 *  well before the hard 5-pick cap actually blocks a new one. */
export function isPastWarningThreshold(uncompletedCount: number): boolean {
  return uncompletedCount > TODAY_PICK_WARNING_THRESHOLD;
}

// ============================================
// Primary action derivation
// ============================================
// Every Today pick card ends in one obvious action. The kind is derived here (pure,
// testable); the API route attaches whatever joined data (remote_url, arc name, etc.) the
// frontend needs to actually render the button/link — this function only says WHICH kind.

export type TodayPickPrimaryActionKind =
  | 'respond' // session -> Remote Control deep-link (falls back to 'resume' if no remote_url)
  | 'resume' // session with no remote_url — no live deep-link, resume handle only
  | 'arc' // arc -> arc board
  | 'quest' // task -> task detail
  | 'charter' // lead -> charter/accord detail
  | 'toggle'; // note -> done-toggle, no navigation

export function primaryActionKindForPick(
  itemType: TodayPickItemType,
  opts: { hasRemoteUrl?: boolean } = {}
): TodayPickPrimaryActionKind {
  switch (itemType) {
    case 'session':
      return opts.hasRemoteUrl ? 'respond' : 'resume';
    case 'arc':
      return 'arc';
    case 'task':
      return 'quest';
    case 'lead':
      return 'charter';
    case 'note':
    default:
      return 'toggle';
  }
}
