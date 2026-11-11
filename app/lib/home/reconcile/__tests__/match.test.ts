import { describe, it, expect } from 'vitest';
import { basisFor, basisValid, overlapOk, titleOverlap, tokens, type BasisTask, type BasisMessage } from '../match';

const task = (over: Partial<BasisTask> = {}): BasisTask => ({
  title: 'Griswold: clean up the hacked site',
  source_ref: null,
  origin_url: null,
  ask_on_thread: false,
  site_domains: ['griswoldcontrols.com'],
  client_contact_emails: ['kue@griswoldcontrols.com'],
  ...over,
});
const msg = (over: Partial<BasisMessage> = {}): BasisMessage => ({
  thread_ids: ['thread-abc-123'],
  rfc_ids: ['m1@mail.example'],
  recipients: ['kue@griswoldcontrols.com'],
  subject: 'Re: Griswold hacked site cleanup',
  new_part: 'I removed the File Manager plugin.',
  ...over,
});

describe('tokens and overlap', () => {
  it('drops stop words, short words and repeats', () => {
    expect(tokens('The Griswold site, the SITE, and a plugin')).toEqual(['griswold', 'plugin']);
  });
  it('needs two shared distinctive tokens and 0.3 overlap', () => {
    expect(titleOverlap('Griswold: clean up the hacked site', 'Griswold hacked').shared).toBe(2);
    expect(overlapOk('Griswold: clean up the hacked site', 'Griswold hacked')).toBe(true);
    expect(overlapOk('Griswold: clean up the hacked site', 'Griswold only')).toBe(false);
    expect(overlapOk('', 'anything at all')).toBe(false);
  });
});

describe('basisFor (rule 4, recomputed from the records)', () => {
  it('thread: an EmailAsk with the task on the thread', () => {
    const b = basisFor(task({ ask_on_thread: true }), msg({ recipients: [], subject: 'x', new_part: 'y' }));
    expect(b).toEqual(['thread']);
    expect(basisValid(b)).toBe(true);
  });
  it('thread: source_ref is an RFC id in the thread set, brackets and case ignored', () => {
    expect(basisFor(task({ source_ref: '<M1@Mail.Example>' }), msg({ recipients: [], subject: 'x', new_part: 'y' }))).toContain('thread');
  });
  it('thread: origin_url names the thread', () => {
    expect(basisFor(task({ origin_url: 'https://mail.google.com/mail/u/0/#all/thread-abc-123' }), msg({ recipients: [], subject: 'x', new_part: 'y' }))).toContain('thread');
  });
  it('client plus subject: a contact of the client and a title overlap', () => {
    const b = basisFor(task(), msg());
    expect(b).toEqual(['client', 'subject']);
    expect(basisValid(b)).toBe(true);
  });
  it('client alone is not enough: the subject must overlap too', () => {
    const b = basisFor(task(), msg({ subject: 'Lunch', new_part: 'Thursday works' }));
    expect(b).toEqual([]);
    expect(basisValid(b)).toBe(false);
  });
  it('a recipient on a site domain of the client counts as the client', () => {
    expect(basisFor(task({ client_contact_emails: [] }), msg({ recipients: ['someone@griswoldcontrols.com'] }))).toEqual(['client', 'subject']);
  });
  it('site plus subject: the site domain appears in the new text', () => {
    const b = basisFor(task({ client_contact_emails: [] }), msg({ recipients: ['x@other.example'], new_part: 'I cleaned griswoldcontrols.com, the hacked pages are gone.' }));
    expect(b).toEqual(['site', 'subject']);
  });
  it('nothing matches an unrelated task', () => {
    expect(basisFor(task({ title: 'Redesign the logo', site_domains: [], client_contact_emails: [] }), msg())).toEqual([]);
  });
});
