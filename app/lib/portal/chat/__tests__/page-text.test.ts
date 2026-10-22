// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { decodeEntities, findInSections, htmlToSections, normFind, sectionedText, PAGE_TEXT_MAX_CHARS } from '../page-text';
import { buildProvenance } from '../provenance';
import { gateReply, type GateContext } from '../gate';
import { pageTextStrings } from '@/lib/engine/tool-calls';

// The shape of the Abbott home page where the pilot finding happened (2026-10-21), trimmed.
const HOME = `<!doctype html><html><head><title>Septic Pumping | Example Septic</title><style>h2{color:red}</style>
<script>var x = "done right the first time";</script></head>
<body><nav><ul><li><a href="/">Home</a></li><li><a href="/contact/">Contact</a></li></ul></nav>
<h1>Serving the Lake Region</h1><p>Family owned &amp; operated.</p>
<h2>Why customers choose us</h2><h3>Experienced</h3><p>Decades in the trade.</p>
<h2 id="what">What we do</h2>
<p>Septic tank pumping for homes across the Lake Region, done <strong>right</strong> the first time. Call us today.</p>
<h3>Fully Permitted &amp; Done Right</h3><p>Licensed and insured.</p>
<!-- done right the first time (a comment never counts) -->
<footer><p>&copy; Example Septic</p></footer></body></html>`;

describe('page_text parsing', () => {
  it('sections by h1, h2 and h3, keeps visible text only, decodes entities', () => {
    const { title, sections } = htmlToSections(HOME);
    expect(title).toBe('Septic Pumping | Example Septic');
    expect(sections.map((s) => s.heading)).toEqual([null, 'Serving the Lake Region', 'Why customers choose us', 'Experienced', 'What we do', 'Fully Permitted & Done Right']);
    const what = sections.find((s) => s.heading === 'What we do')!;
    expect(what.level).toBe(2);
    expect(what.blocks).toEqual(['Septic tank pumping for homes across the Lake Region, done right the first time. Call us today.']);
    const all = JSON.stringify(sections);
    expect(all).not.toContain('var x');
    expect(all).not.toContain('color:red');
    expect(all).not.toContain('a comment never counts');
  });

  it('find: the heading and the sentence the phrase sits in', () => {
    const { sections } = htmlToSections(HOME);
    expect(findInSections(sections, 'done right the first time')).toEqual([
      { heading: 'What we do', level: 2, sentence: 'Septic tank pumping for homes across the Lake Region, done right the first time.', in_heading: false },
    ]);
  });

  it('find is case, quote and dash insensitive, and ignores trailing punctuation', () => {
    const { sections } = htmlToSections(HOME);
    for (const q of ["'Done Right the First Time'", '“done right the first time.”', 'done right the first-time', 'DONE RIGHT THE FIRST—TIME!']) {
      expect(findInSections(sections, q).map((m) => m.heading), q).toEqual(['What we do']);
    }
    // A heading holds a phrase too.
    expect(findInSections(sections, 'fully permitted')).toEqual([{ heading: 'Fully Permitted & Done Right', level: 3, sentence: 'Fully Permitted & Done Right', in_heading: true }]);
  });

  it('find miss returns nothing', () => {
    const { sections } = htmlToSections(HOME);
    expect(findInSections(sections, 'satisfaction guaranteed')).toEqual([]);
    expect(findInSections(sections, ' ')).toEqual([]);
  });

  it('caps the sectioned text', () => {
    const big = `<h2>One</h2><p>${'word '.repeat(600)}</p><h2>Two</h2><p>${'more '.repeat(600)}</p><h2>Three</h2><p>end</p>`;
    const out = sectionedText(htmlToSections(big).sections);
    expect(out.truncated).toBe(true);
    const chars = out.sections.reduce((n, s) => n + (s.heading?.length ?? 0) + s.text.length, 0);
    expect(chars).toBeLessThanOrEqual(PAGE_TEXT_MAX_CHARS);
    expect(out.sections.map((s) => s.heading)).toEqual(['One', 'Two']);
    expect(sectionedText(htmlToSections(HOME).sections).truncated).toBe(false);
  });

  it('decodes numeric and named entities; normFind folds quotes and dashes', () => {
    expect(decodeEntities('A&#8217;s &#x2014; &nbsp;&amp;')).toBe('A\u2019s \u2014  &');
    expect(normFind('It’s “Done”–Right')).toBe('its done right');
  });
});

describe('page_text provenance: a phrase quoted from the page is sourced text', () => {
  const ctx = (pageTexts: string[]): GateContext => ({
    provenance: buildProvenance([], [], ['Fix the wording on the What we Do section'], pageTexts),
    staffNames: [],
    otherClientNames: [],
    pageNames: ['Home'],
    clientDomains: ['example.test'],
    portalOrigins: ['https://portal.example.test'],
    reportUrls: [],
    contactEmail: null,
  });
  const stored = {
    page: { id: 'p', title: 'Home', path: '/' },
    find: 'free estimates',
    found: true,
    matches: [{ heading: 'What we do', level: 2, sentence: 'Free estimates since 1998, done right the first time.', in_heading: false }],
  };

  it('pageTextStrings reads headings, sentences and section text', () => {
    expect(pageTextStrings(stored)).toEqual(['What we do', 'Free estimates since 1998, done right the first time.']);
    expect(pageTextStrings({ sections: [{ heading: 'A', text: 'one\ntwo' }] })).toEqual(['A', 'one', 'two']);
    expect(pageTextStrings(null)).toEqual([]);
  });

  it('a quoted sentence from the page passes; the same words unquoted or without the lookup do not', () => {
    const summary = 'Remove "done right the first time" from the What we do section on the Home page. The sentence now reads "Free estimates since 1998, done right the first time."';
    expect(gateReply(summary, ctx(pageTextStrings(stored)), 'summary')).toEqual({ ok: true });
    // Without the lookup, the year and "free" are ours: refused.
    expect(gateReply(summary, ctx([]), 'summary').ok).toBe(false);
    // Unquoted page words are our words: refused.
    expect(gateReply('Free estimates since 1998 are on the Home page.', ctx(pageTextStrings(stored)), 'summary').ok).toBe(false);
  });
});

describe('the name rule and sourced quotes', () => {
  const ctx = (pageTexts: string[]): GateContext => ({
    provenance: buildProvenance([], [], ["Drop the 'done right the first time' wording"], pageTexts),
    staffNames: [],
    otherClientNames: ['First Congregational Church'],
    pageNames: ['Home'],
    clientDomains: ['example.test'],
    portalOrigins: ['https://portal.example.test'],
    reportUrls: [],
    contactEmail: null,
  });

  it('an ordinary word that is another client\'s short name passes inside a sourced quote, and still fails outside one', () => {
    const summary = 'Remove "done right the first time" from the What we do section on the Home page.';
    expect(gateReply(summary, ctx([]), 'summary')).toEqual({ ok: true });
    expect(gateReply('Remove "first rate" from the Home page.', ctx([]), 'summary')).toMatchObject({ ok: false, rule: 'name' });
    expect(gateReply('First Congregational Church asked too.', ctx([]), 'reply')).toMatchObject({ ok: false, rule: 'name' });
  });
});
