/**
 * The request intake question tree (portal phase B slice 1, spec section 2.2).
 *
 * Fixed, no model call. Six types, at most three clarifying questions each, then a confirmed
 * summary. Every string a client reads in the intake lives in this file, so one unit test can scan
 * them for promises (money, dates, durations, "free", "guarantee") and for em dashes.
 *
 * The server never trusts a prompt sent by the browser: answers arrive as `{ key, value, detail? }`
 * and the stored prompt and verbatim text are rebuilt from this tree.
 */

export const INTAKE_TYPES = [
  'site_change',
  'new_page_feature',
  'content_article',
  'marketing_question',
  'broken',
  'other',
] as const;
export type IntakeType = (typeof INTAKE_TYPES)[number];

export function isIntakeType(value: unknown): value is IntakeType {
  return typeof value === 'string' && (INTAKE_TYPES as readonly string[]).includes(value);
}

export const ANSWER_MAX = 2000;

export interface IntakeFollowUp {
  prompt: string;
  required: boolean;
}

export interface IntakeChoice {
  key: string;
  label: string;
  /** Line under the label (opening choices only). */
  line?: string;
  /** Asked right after this choice is picked. Part of the same question, not a fourth one. */
  follow_up?: IntakeFollowUp;
  /** The two urgent "broken" choices: skip Q3 and file at once. */
  urgent?: boolean;
}

export interface IntakeQuestion {
  key: 'q1' | 'q2' | 'q3';
  prompt: string;
  required: boolean;
  /** Present for a choice question; absent for a free-text one. */
  choices?: IntakeChoice[];
}

export const TYPE_LABELS: Record<IntakeType, string> = {
  site_change: 'Site change',
  new_page_feature: 'New page or feature',
  content_article: 'Content',
  marketing_question: 'Marketing question',
  broken: 'Something broken',
  other: 'Request',
};

/** Tag kind per type (spec 2.4). */
export const KIND_TAGS: Record<IntakeType, string> = {
  site_change: 'kind:site-change',
  new_page_feature: 'kind:new-feature',
  content_article: 'kind:content',
  marketing_question: 'kind:marketing-question',
  broken: 'kind:troubleshoot',
  other: 'kind:other',
};

export const OPENING_PROMPT = 'What do you need?';

export const OPENING_CHOICES: Array<{ key: IntakeType; label: string; line: string }> = [
  { key: 'site_change', label: 'Change something on my site', line: 'Edit text, swap a photo, fix a link, update hours.' },
  { key: 'new_page_feature', label: 'Add a new page or feature', line: 'A new page, section, form or tool.' },
  { key: 'content_article', label: 'Content or an article', line: 'An article, a blog post or new copy.' },
  { key: 'marketing_question', label: 'A marketing question', line: 'Traffic, search, ads, social, or your plan.' },
  { key: 'broken', label: 'Something is broken', line: 'The site is down, a form or checkout fails, or a page looks wrong.' },
  { key: 'other', label: 'Something else', line: 'Anything that does not fit above.' },
];

export const SITE_PROMPT = 'Which site is this about?';
export const ALL_SITES_LABEL = 'All my sites';
export const SITE_IN_PROGRESS_SUFFIX = '(in progress)';

const skipFollowUp = (prompt: string, required = true): IntakeFollowUp => ({ prompt, required });

const SITE_CHANGE: IntakeQuestion[] = [
  { key: 'q1', prompt: 'What should change? Tell us in your own words.', required: true },
  { key: 'q2', prompt: 'Which page is it on? Paste the link or name the page.', required: true },
  {
    key: 'q3',
    prompt: 'Do you have new text, photos or files?',
    required: false,
    choices: [
      { key: 'yes_link', label: 'Yes, here is a link', follow_up: skipFollowUp('Paste the link.') },
      { key: 'no', label: 'No, it is all in my description' },
      { key: 'wording_help', label: 'I would like help with the wording' },
    ],
  },
];

const NEW_PAGE_FEATURE: IntakeQuestion[] = [
  { key: 'q1', prompt: 'What would you like to add, and what should it do for your visitors?', required: true },
  {
    key: 'q2',
    prompt: 'Where should it live?',
    required: true,
    choices: [
      { key: 'new_page', label: 'A new page' },
      { key: 'existing_page', label: 'On an existing page', follow_up: skipFollowUp('Which page?') },
      { key: 'not_sure', label: 'Not sure' },
    ],
  },
  {
    key: 'q3',
    prompt: 'Is there a date this matters for?',
    required: false,
    choices: [
      { key: 'no_date', label: 'No date' },
      { key: 'yes_date', label: 'Yes', follow_up: skipFollowUp('What is the date, and why does it matter?') },
    ],
  },
];

const CONTENT_ARTICLE: IntakeQuestion[] = [
  { key: 'q1', prompt: 'What is the topic, or what should it cover?', required: true },
  {
    key: 'q2',
    prompt: 'What kind of piece?',
    required: true,
    choices: [
      { key: 'blog', label: 'Blog article' },
      { key: 'page_copy', label: 'Copy for a page' },
      { key: 'social_email', label: 'Something for social or email' },
      { key: 'not_sure', label: 'Not sure' },
    ],
  },
  { key: 'q3', prompt: 'Anything we should read first? Links, notes, or a person to talk to.', required: false },
];

const MARKETING_QUESTION: IntakeQuestion[] = [
  { key: 'q1', prompt: 'What would you like to know?', required: true },
  {
    key: 'q2',
    prompt: 'What is it about?',
    required: true,
    choices: [
      { key: 'traffic_search', label: 'Traffic and search' },
      { key: 'ads', label: 'Ads' },
      { key: 'social', label: 'Social' },
      { key: 'email', label: 'Email' },
      { key: 'plan_report', label: 'My plan or report' },
      { key: 'something_else', label: 'Something else' },
    ],
  },
];

/** The first question of a "broken" request is a choice; two of its answers are urgent. */
const BROKEN_Q1: IntakeQuestion = {
  key: 'q1',
  prompt: 'What is happening?',
  required: true,
  choices: [
    { key: 'site_down', label: 'The whole site is down', urgent: true },
    { key: 'form_checkout', label: 'A form, checkout or payment is not working', urgent: true },
    { key: 'page_link', label: 'A page looks wrong or a link is broken' },
    { key: 'something_else', label: 'Something else' },
  ],
};

const BROKEN_URGENT: IntakeQuestion[] = [
  BROKEN_Q1,
  { key: 'q2', prompt: 'Anything else we should know? A link or error message helps.', required: false },
];

const BROKEN_OTHER: IntakeQuestion[] = [
  BROKEN_Q1,
  { key: 'q2', prompt: 'Where is it, and what do you see? Paste the link and any error.', required: true },
  {
    key: 'q3',
    prompt: 'When did you first notice?',
    required: false,
    choices: [
      { key: 'today', label: 'Today' },
      { key: 'this_week', label: 'This week' },
      { key: 'earlier', label: 'Earlier' },
      { key: 'not_sure', label: 'Not sure' },
    ],
  },
];

const OTHER: IntakeQuestion[] = [
  { key: 'q1', prompt: 'Tell us what you need.', required: true },
  {
    key: 'q2',
    prompt: 'Is this time-sensitive?',
    required: true,
    choices: [
      { key: 'not_really', label: 'Not really' },
      { key: 'yes_urgent', label: 'Yes', follow_up: skipFollowUp('Why is it time-sensitive?') },
    ],
  },
];

/**
 * The questions for a type. `broken` depends on its first answer: an urgent choice has two
 * questions and no third; the others have three.
 */
export function questionsFor(type: IntakeType, firstAnswerKey?: string | null): IntakeQuestion[] {
  switch (type) {
    case 'site_change':
      return SITE_CHANGE;
    case 'new_page_feature':
      return NEW_PAGE_FEATURE;
    case 'content_article':
      return CONTENT_ARTICLE;
    case 'marketing_question':
      return MARKETING_QUESTION;
    case 'broken': {
      const first = BROKEN_Q1.choices!.find((c) => c.key === firstAnswerKey);
      return first?.urgent ? BROKEN_URGENT : BROKEN_OTHER;
    }
    case 'other':
      return OTHER;
  }
}

/** True when a broken request's first answer is one of the two urgent choices. */
export function isUrgentChoice(type: IntakeType, firstAnswerKey: string | null | undefined): boolean {
  return type === 'broken' && Boolean(BROKEN_Q1.choices!.find((c) => c.key === firstAnswerKey)?.urgent);
}

/** The largest number of clarifying questions any type can ask. */
export function maxClarifyingQuestions(): number {
  return Math.max(
    ...INTAKE_TYPES.flatMap((t) => {
      if (t === 'broken') return [questionsFor(t, 'site_down').length, questionsFor(t, 'page_link').length];
      return [questionsFor(t).length];
    })
  );
}

// ---- Answers --------------------------------------------------------------------------------

export interface AnswerInput {
  key: string;
  /** Free text for a text question; the choice key for a choice question. Empty = skipped. */
  value: string;
  /** Text for the choice's follow-up question. */
  detail?: string;
}

export interface StoredAnswer {
  key: string;
  prompt: string;
  /** Human text, verbatim. A choice reads "{label}" or "{label}: {detail}". */
  value: string;
}

export type AnswerError = { ok: false; message: string };
export type AnswerOk = {
  ok: true;
  answers: StoredAnswer[];
  /** Raw choice keys and texts by question key, for placement and composing. */
  raw: Record<string, { choice: string | null; text: string }>;
  urgent: boolean;
};

/**
 * Check submitted answers against the tree and rebuild the stored form. Order does not matter;
 * unknown or repeated keys, missing required answers, over-long text and unknown choices fail.
 */
export function validateAnswers(type: IntakeType, input: AnswerInput[]): AnswerOk | AnswerError {
  const byKey = new Map<string, AnswerInput>();
  for (const a of input) {
    if (byKey.has(a.key)) return { ok: false, message: 'Each question can be answered once.' };
    byKey.set(a.key, a);
  }
  const first = byKey.get('q1');
  const questions = questionsFor(type, first?.value ?? null);
  const allowed = new Set(questions.map((q) => q.key));
  for (const k of byKey.keys()) {
    if (!allowed.has(k as IntakeQuestion['key'])) return { ok: false, message: 'That question does not belong to this request.' };
  }

  const answers: StoredAnswer[] = [];
  const raw: AnswerOk['raw'] = {};
  for (const q of questions) {
    const given = byKey.get(q.key);
    const value = (given?.value ?? '').trim();
    if (value === '') {
      if (q.required) return { ok: false, message: `Please answer: ${q.prompt}` };
      continue;
    }
    if (q.choices) {
      const choice = q.choices.find((c) => c.key === value);
      if (!choice) return { ok: false, message: 'That choice is not available.' };
      let text = choice.label;
      let detail = '';
      if (choice.follow_up) {
        detail = (given?.detail ?? '').trim();
        if (detail === '' && choice.follow_up.required) return { ok: false, message: `Please answer: ${choice.follow_up.prompt}` };
        if (detail.length > ANSWER_MAX) return { ok: false, message: `Please keep each answer under ${ANSWER_MAX} characters.` };
        if (detail) text = `${choice.label}: ${detail}`;
      } else if ((given?.detail ?? '').trim() !== '') {
        return { ok: false, message: 'That choice does not take extra text.' };
      }
      answers.push({ key: q.key, prompt: q.prompt, value: text });
      raw[q.key] = { choice: choice.key, text: detail };
    } else {
      if (value.length > ANSWER_MAX) return { ok: false, message: `Please keep each answer under ${ANSWER_MAX} characters.` };
      answers.push({ key: q.key, prompt: q.prompt, value });
      raw[q.key] = { choice: null, text: value };
    }
  }
  return { ok: true, answers, raw, urgent: isUrgentChoice(type, first?.value) };
}

// ---- Copy ------------------------------------------------------------------------------------

export const SUMMARY_HEADING = 'Here is what we will send.';

export function destinationLine(
  where: { chain: 'project' | 'charter' | 'site' | 'client'; project_name?: string | null; plan_name?: string | null; site_name?: string | null }
): string {
  switch (where.chain) {
    case 'project':
      return `This goes to your project: ${where.project_name ?? ''}`.trim();
    case 'charter':
      return `This goes to your retainer: ${where.plan_name ?? ''}`.trim();
    default:
      return `This goes to your requests for ${where.site_name ?? 'your account'}`;
  }
}

export const QUOTE_LINE =
  'New pages, features and changes after content sign-off are quoted separately. We will send you a quote before any work starts on this.';
export const EMERGENCY_LINE = 'We will mark this urgent and alert the team now.';
export const PROJECT_SELECT_PROMPT = 'Which project is this for?';

export function dateEcho(theirWords: string): string {
  return `You mentioned ${theirWords}. The team will confirm timing when they review this.`;
}

export const BUTTONS = { send: 'Send request', change: 'Change an answer', cancel: 'Cancel', back: 'Back', skip: 'Skip', next: 'Next' } as const;

export const SENT_HEADING = 'Request sent.';
export const SENT_URGENT = 'Marked urgent. The team has been alerted.';
// TODO(slice 2): once the work-page conversation ships, restore the line
// "You can add details, links or questions on this request at any time." after SENT_URGENT.
// It is not shown now because there is nowhere to add them yet.
/** Shown when the client chose an urgent option but the daily emergency limit meant no alert went out. */
export const SENT_DOWNGRADED = 'Received. We will look at it in order.';
export const SENT_LINK_LABEL = 'View your request';

export const RATE_LIMIT_MESSAGE =
  'You have sent a lot in a short time. Please try again in a few minutes, or email support@becomeindelible.com.';
export const NO_PERMISSION_MESSAGE = 'Your account can look at requests but not send them. Please ask the account owner.';

/** Client words for the preset "where does it live" labels, used in the summary. */
export function typeLabel(type: IntakeType): string {
  return TYPE_LABELS[type];
}

/** Every client-facing string in the intake, with sample values filled in, for the copy scan. */
export function allIntakeStrings(): string[] {
  const out: string[] = [OPENING_PROMPT, SITE_PROMPT, ALL_SITES_LABEL, SITE_IN_PROGRESS_SUFFIX, SUMMARY_HEADING];
  for (const o of OPENING_CHOICES) out.push(o.label, o.line);
  for (const t of Object.values(TYPE_LABELS)) out.push(t);
  const trees: IntakeQuestion[][] = [
    ...INTAKE_TYPES.filter((t) => t !== 'broken').map((t) => questionsFor(t)),
    questionsFor('broken', 'site_down'),
    questionsFor('broken', 'page_link'),
  ];
  for (const qs of trees) {
    for (const q of qs) {
      out.push(q.prompt);
      for (const c of q.choices ?? []) {
        out.push(c.label);
        if (c.follow_up) out.push(c.follow_up.prompt);
      }
    }
  }
  out.push(
    destinationLine({ chain: 'project', project_name: 'Website relaunch' }),
    destinationLine({ chain: 'charter', plan_name: 'Marketing plan' }),
    destinationLine({ chain: 'site', site_name: 'example.com' }),
    QUOTE_LINE,
    EMERGENCY_LINE,
    PROJECT_SELECT_PROMPT,
    dateEcho('next spring'),
    ...Object.values(BUTTONS),
    SENT_HEADING,
    SENT_URGENT,
    SENT_DOWNGRADED,
    SENT_LINK_LABEL,
    RATE_LIMIT_MESSAGE,
    NO_PERMISSION_MESSAGE
  );
  return out;
}
