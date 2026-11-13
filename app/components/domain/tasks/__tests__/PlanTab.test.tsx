import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';

const m = vi.hoisted(() => ({ plan: undefined as unknown, loading: false, remove: vi.fn(), markWrong: vi.fn() }));
vi.mock('@/lib/hooks/use-task-plan', () => ({
  useTaskPlan: () => ({ data: m.plan, isLoading: m.loading }),
  usePlanItemActions: () => ({ remove: m.remove, markWrong: m.markWrong }),
}));

import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlanTab, PlanView } from '../PlanTab';
import { PLAN_EMPTY_LINES, PLAN_SECTIONS, PLAN_SECTION_TITLES, type PlanOut, type PlanItemOut, type PlanSectionName } from '@/lib/tasks/plan-schema';

const SRC = { label: 'Signed SOW, section 3', date: '2026-10-20' };
let n = 0;
const item = (fields: Record<string, unknown>): PlanItemOut => ({ id: `i${++n}`, position: 0, marked_wrong: false, marked_wrong_at: null, marked_wrong_by: null, updated_at: '2026-11-13T12:00:00Z', updated_by: 'the chat', ...fields });
const plan = (by: Partial<Record<PlanSectionName, PlanItemOut[]>> = {}, over: Partial<PlanOut> = {}): PlanOut => ({
  task_id: 't1',
  status: 'triage',
  triage_rev: 3,
  viewer: { can_write: true, is_owner: true },
  sections: PLAN_SECTIONS.map((s) => ({ section: s, title: PLAN_SECTION_TITLES[s], items: by[s] ?? [], updated_at: null, updated_by: null, note: null })),
  updated_at: null,
  updated_by: null,
  answered_questions: [],
  project: null,
  ...over,
});
const req = (text: string, extra: Record<string, unknown> = {}) => item({ text, source: SRC, mark: 'original', ...extra });

beforeEach(() => {
  m.remove.mockReset();
  m.markWrong.mockReset();
  m.loading = false;
  n = 0;
});

describe('Plan tab', () => {
  it('an empty plan shows each section with one muted line saying what goes there, and "nothing yet" at the top', () => {
    render(<PlanView plan={plan()} />);
    expect(screen.getByTestId('plan-last-changed').textContent).toContain('Nothing in the plan yet');
    for (const s of PLAN_SECTIONS) {
      expect(screen.getByTestId(`plan-empty-${s}`).textContent).toBe(PLAN_EMPTY_LINES[s]);
    }
    expect(screen.queryByTestId('plan-item')).toBeNull();
    // sections in the fixed order
    const heads = Array.from(document.querySelectorAll('h3')).map((h) => (h.textContent ?? '').replace(/^[\u25b8\u25be]\s*/, ''));
    expect(heads).toEqual(['Requirements', 'Dates', 'Team', 'Billing model', 'Work to note', 'Risks', 'Examples', 'Decisions']);
  });

  it('the top line says when the plan last changed and by whom', () => {
    render(<PlanView plan={plan({}, { updated_at: '2026-11-13T15:14:00Z', updated_by: 'the chat' })} />);
    expect(screen.getByTestId('plan-last-changed').textContent).toMatch(/^Plan last changed .* by the chat\.$/);
  });

  it('requirements: one line each with the source under it; a changed line shows the mark and "was ..."; added shows its mark; dropped is struck and collapsed', () => {
    render(
      <PlanView
        plan={plan({
          requirements: [
            req('Eight pages'),
            req('Shop opens in March', { mark: 'changed', was: 'Shop opens in January', changed_by: 'Dan, Nov 9 email' }),
            req('Wholesale page', { mark: 'added' }),
            req('Blog', { mark: 'dropped', changed_by: 'Dan, Nov 9 email' }),
          ],
        })}
      />,
    );
    const sec = screen.getByTestId('plan-requirements');
    expect(within(sec).getByText('Eight pages')).toBeTruthy();
    expect(within(sec).getAllByTestId('plan-source')[0].textContent).toContain('Signed SOW, section 3');
    const marks = within(sec).getAllByTestId('plan-mark');
    expect(marks[0].textContent).toContain('Changed');
    expect(marks[0].textContent).toContain('was Shop opens in January');
    expect(marks[0].textContent).toContain('changed by Dan, Nov 9 email');
    expect(marks[1].textContent).toContain('Added');
    const dropped = within(sec).getByTestId('plan-dropped-requirements') as HTMLDetailsElement;
    expect(dropped.open).toBe(false);
    expect(within(dropped).getByText('Dropped (1)')).toBeTruthy();
    expect((within(dropped).getByText('Blog') as HTMLElement).closest('.home-plan-text')!.getAttribute('style')).toContain('line-through');
  });

  it('a link in the source opens the document', () => {
    render(<PlanView plan={plan({ requirements: [req('Eight pages', { source: { label: 'Signed SOW', url: 'https://example.com/sow.pdf' } })] })} />);
    expect(screen.getByRole('link', { name: 'Signed SOW' }).getAttribute('href')).toBe('https://example.com/sow.pdf');
  });

  it('billing: the kind as a sentence, milestones as a compact list, and "from a document, not yet confirmed" until it matches Citadel', () => {
    const base = item({ type: 'basis', kind: 'milestones', source: SRC, matches_citadel: null, refers_to: { label: 'Grok Rock rebuild deal', href: '/deals/d1' } });
    const miles = [
      item({ type: 'milestone', label: 'Deposit', amount: '$4,500', trigger: 'signing' }),
      item({ type: 'milestone', label: 'Design approved', amount: '$4,500', trigger: 'Mike approves the design', due: '2026-12-01' }),
      item({ type: 'milestone', label: 'Launch', amount: '50% of the fee', trigger: 'the site goes live' }),
    ];
    const { rerender } = render(<PlanView plan={plan({ billing: [base, ...miles] })} />);
    const sec = screen.getByTestId('plan-billing');
    expect(within(sec).getByText('A project billed in milestones.')).toBeTruthy();
    expect(within(sec).getByRole('link', { name: 'Grok Rock rebuild deal' }).getAttribute('href')).toBe('/deals/d1');
    expect(within(sec).getAllByText("$4,500")).toHaveLength(2);
    expect(within(sec).getByText('50% of the fee')).toBeTruthy(); // exactly as stated
    expect(within(sec).getByText(/when Mike approves the design, due Dec 1, 2026/)).toBeTruthy();
    expect(within(sec).getByTestId('plan-unconfirmed').textContent).toBe('From a document, not yet confirmed.');
    rerender(<PlanView plan={plan({ billing: [{ ...base, matches_citadel: false }, ...miles] })} />);
    expect(screen.getByTestId('plan-unconfirmed').textContent).toContain('differ');
    rerender(<PlanView plan={plan({ billing: [{ ...base, matches_citadel: true }, ...miles] })} />);
    expect(screen.queryByTestId('plan-unconfirmed')).toBeNull();
  });

  it('billing withheld from a contractor says so and shows nothing else', () => {
    const p = plan();
    p.sections[3] = { ...p.sections[3], withheld: true };
    render(<PlanView plan={p} />);
    expect(within(screen.getByTestId('plan-billing')).getByText('Not shown to you.')).toBeTruthy();
  });

  it('dates: the project start and launch are read through, then the plan dates in order', () => {
    render(
      <PlanView
        plan={plan(
          { dates: [item({ label: 'Staging', date: '2026-12-15', source: SRC, mark: 'original' }), item({ label: 'Design handoff', date: '2026-11-30', source: SRC, mark: 'original' })] },
          { project: { project_id: 'p1', name: 'P', status: 'queue', start_date: '2026-11-20', target_date: '2027-01-19', mike_parts: [], phases: [], sitemap: [], deal: null } },
        )}
      />,
    );
    const sec = screen.getByTestId('plan-dates');
    expect(within(sec).getAllByTestId('plan-project-date').map((e) => e.textContent)).toEqual(['Start Nov 20, 2026Project dates', 'Launch Jan 19, 2027Project dates']);
    const rows = within(sec).getAllByTestId('plan-item').map((e) => e.textContent);
    expect(rows[0]).toContain('Design handoff');
    expect(rows[1]).toContain('Staging');
  });

  it('team: what is yours first (the project mike_part lines and his own lines), then everyone else', () => {
    render(
      <PlanView
        plan={plan(
          {
            team: [
              item({ person: { name: 'Lisa', org: 'Freelance designer' }, role: 'Designs the pages' }),
              item({ person: { user_id: 'u1' }, person_name: 'Mike', is_mike: true, role: 'Approves the logo' }),
            ],
          },
          { project: { project_id: 'p1', name: 'P', status: 'queue', start_date: null, target_date: null, mike_parts: [{ phase: 'Design', text: 'Pick one home page design.' }], phases: [], sitemap: [], deal: null } },
        )}
      />,
    );
    const rows = within(screen.getByTestId('plan-team')).getByRole('list').children;
    expect(rows[0].textContent).toContain('Pick one home page design.');
    expect(rows[1].textContent).toContain('Approves the logo');
    expect(rows[2].textContent).toContain('Lisa, Freelance designer');
  });

  it('a project card shows its shape and sitemap, read from the project block', () => {
    render(
      <PlanView
        plan={plan(
          {},
          {
            project: {
              project_id: 'p1', name: 'P', status: 'queue', start_date: null, target_date: null, mike_parts: [],
              phases: [{ id: 'a', name: 'Design', summary: 'Lisa designs the home page.', mike_part: null }],
              sitemap: [{ id: 'b', name: 'Home', page_type: 'landing', needs_design: true, notes: null }],
              deal: null,
            },
          },
        )}
      />,
    );
    expect(within(screen.getByTestId('plan-shape')).getByText('Design')).toBeTruthy();
    expect(within(screen.getByTestId('plan-sitemap')).getByText(/Home/)).toBeTruthy();
  });

  it('work to note: title, a one-line note, who and when in small type, no numbers and no "after", a link once a task exists, dropped collapsed, a quiet line past 8 items', () => {
    const a = item({ title: 'Set up staging early', note: 'Two day lead time', for: { kind: 'bast' }, when: 'before design handoff', source: SRC, mark: 'original' });
    const b = item({ title: 'Design the home page', for: { name: 'Lisa', org: 'Freelance designer' }, when: '2026-12-04', source: SRC, mark: 'original' });
    const c = item({ title: 'Build the footer', for: { user_id: 'u1' }, for_name: 'Ken Ortiz', depends_on: ['x'], source: SRC, mark: 'original', task_id: 'task-9' });
    const d = item({ title: 'Blog import', for: { kind: 'dox_decides' }, source: SRC, mark: 'dropped', changed_by: 'Ed, Nov 9' });
    render(<PlanView plan={plan({ planned_tasks: [a, b, c, d] })} />);
    const sec = screen.getByTestId('plan-planned-tasks');
    const rows = within(sec).getAllByTestId('plan-item');
    expect(within(rows[0]).getByTestId('plan-task-meta').textContent).toBe('For Bast \u00b7 before design handoff');
    expect(rows[0].textContent).toContain('Two day lead time');
    expect(within(rows[1]).getByTestId('plan-task-meta').textContent).toBe('For Lisa, Freelance designer \u00b7 Dec 4');
    expect(within(rows[2]).getByTestId('plan-task-meta').textContent).toBe('For Ken Ortiz');
    expect(sec.textContent).not.toMatch(/after \d|when before|\d\./);
    expect(within(rows[2]).getByTestId('plan-task-link').getAttribute('href')).toBe('/tasks/task-9');
    const dropped = within(sec).getByTestId('plan-dropped-planned_tasks') as HTMLDetailsElement;
    expect(dropped.open).toBe(false);
    expect(within(dropped).getByTestId('plan-task-meta').textContent).toBe('For Dox decides');
    expect(screen.queryByTestId('plan-long')).toBeNull();
  });

  it('more than 8 noted items shows the quiet "getting long" line', () => {
    const many = Array.from({ length: 9 }, (_, k) => item({ title: `Thing ${k}`, source: SRC, mark: 'original' }));
    render(<PlanView plan={plan({ planned_tasks: many })} />);
    expect(screen.getByTestId('plan-long').textContent).toBe('This is getting long: routine work belongs to the shape');
  });

  it('a project card says what Dox builds from, without listing tasks', () => {
    render(<PlanView plan={plan({ planned_tasks: [item({ title: 'One', source: SRC, mark: 'original' }), item({ title: 'Two', source: SRC, mark: 'original', task_id: 't' })] }, { project: { project_id: 'p', name: 'P', status: 'queue', start_date: null, target_date: null, mike_parts: [], phases: [{ id: 'a', name: 'Design', summary: null, mike_part: null }, { id: 'b', name: 'Build', summary: null, mike_part: null }], sitemap: [{ id: 's', name: 'Home', page_type: null, needs_design: false, notes: null }], deal: null } })} />);
    expect(screen.getByTestId('plan-shape-line').textContent).toBe('Shape: Design, Build. 1 page. Dox builds the tasks from the shape and the sitemap at setup. 1 thing to note.');
  });

  it('risks: uncovered ones first with a "Not covered" mark, covered ones say what covers them', () => {
    render(
      <PlanView
        plan={plan({
          risks: [
            item({ risk: 'Old domain DNS is with a third party', covered_by: 'Ed gives us the registrar login first', source: SRC }),
            item({ risk: 'Photos arrive late', uncovered: true, source: SRC }),
          ],
        })}
      />,
    );
    const rows = within(screen.getByTestId('plan-risks')).getAllByTestId('plan-item');
    expect(rows[0].textContent).toContain('Photos arrive late');
    expect(within(rows[0]).getByTestId('plan-not-covered').textContent).toBe('Not covered');
    expect(rows[1].textContent).toContain('Covered by Ed gives us the registrar login first');
    expect(within(rows[1]).queryByTestId('plan-not-covered')).toBeNull();
  });

  it('examples are links with their notes; decisions say "Decided:" and answered questions read through as "Mike chose"', () => {
    render(
      <PlanView
        plan={plan(
          {
            examples: [item({ url: 'https://example.com/shop', title: 'Example shop', note: 'A calm product page', source: SRC })],
            decisions: [item({ text: 'Keep the old logo', source: { label: 'Mike, typed in chat' } })],
          },
          { answered_questions: [{ id: 'q1', question: 'Which logo?', answer: 'The old one', answered_at: '2026-11-12T10:00:00Z', by_mike: true }] },
        )}
      />,
    );
    expect(screen.getByRole('link', { name: 'Example shop' }).getAttribute('href')).toBe('https://example.com/shop');
    expect(screen.getByText('A calm product page')).toBeTruthy();
    const dec = screen.getByTestId('plan-decisions');
    expect(within(dec).getByText('Decided:')).toBeTruthy();
    expect(within(dec).getByTestId('plan-answered').textContent).toContain('Mike chose: The old one');
  });

  it('Mark wrong strikes the line and says "Mike marked this wrong"; the owner sees Mark wrong and a two-step Remove, anyone else sees neither', () => {
    const wrong = req('Ten pages', { marked_wrong: true, marked_wrong_by: 'Mike' });
    const ok = req('Eight pages');
    const p = plan({ requirements: [wrong, ok] });
    const { rerender } = render(<PlanView plan={p} canEdit onRemove={m.remove} onMarkWrong={m.markWrong} />);
    expect(screen.queryByRole('button', { name: 'Mark wrong' })).toBeNull(); // quiet until he asks to review
    fireEvent.click(screen.getByRole('button', { name: 'Review lines' }));
    const rows = screen.getAllByTestId('plan-item');
    expect(within(rows[0]).getByTestId('plan-wrong').textContent).toContain('Mike marked this wrong');
    expect(within(rows[0]).getByText('Ten pages').closest('.home-plan-text')!.getAttribute('style')).toContain('line-through');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Mark wrong' }));
    expect(m.markWrong).toHaveBeenCalledWith('requirements', ok.id, true);
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Clear mark' }));
    expect(m.markWrong).toHaveBeenCalledWith('requirements', wrong.id, false);
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Remove' }));
    expect(m.remove).not.toHaveBeenCalled();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Remove for good?' }));
    expect(m.remove).toHaveBeenCalledWith('requirements', ok.id);
    rerender(<PlanView plan={p} />);
    expect(screen.queryByRole('button', { name: 'Review lines' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('the container shows controls only to the owner and renders nothing when the plan is not available', () => {
    m.plan = plan({ requirements: [req('Eight pages')] });
    const { rerender } = render(<PlanTab taskId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Review lines' }));
    expect(screen.getByRole('button', { name: 'Mark wrong' })).toBeTruthy();
    m.plan = plan({ requirements: [req('Eight pages')] }, { viewer: { can_write: false, is_owner: false } });
    rerender(<PlanTab taskId="t1" />);
    expect(screen.queryByRole('button', { name: 'Review lines' })).toBeNull();
    m.plan = null;
    const { container } = render(<PlanTab taskId="t2" />);
    expect(container.textContent).toBe('');
  });
});

describe('Plan tab: requirement progress', () => {
  it('each requirement line says not started, in progress or done when the server sent progress; with none sent it shows nothing', () => {
    render(
      <PlanView
        plan={plan({
          requirements: [
            req('Contact form', { progress: 'not_started', done: 0, total: 0 }),
            req('Home page', { progress: 'in_progress', done: 1, total: 3 }),
            req('Privacy page', { progress: 'done', done: 1, total: 1 }),
          ],
        })}
      />,
    );
    const tags = screen.getAllByTestId('plan-req-progress');
    expect(tags.map((t) => t.getAttribute('data-progress'))).toEqual(['not_started', 'in_progress', 'done']);
    expect(tags.map((t) => (t.textContent ?? '').trim())).toEqual(['· Not started', '· In progress (1 of 3 tasks)', '· Done (1 of 1 task)']);
  });
  it('a plan with no progress on its lines shows no progress at all', () => {
    render(<PlanView plan={plan({ requirements: [req('Contact form'), req('Home page')] })} />);
    expect(screen.queryByTestId('plan-req-progress')).toBeNull();
  });
});

describe('Plan tab: collapsible sections and date sources', () => {
  const KEY = 'citadel.plan.collapsed';
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    // this test environment's own localStorage is not a working Storage, so give the page a plain one
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } });
  });
  afterEach(() => vi.unstubAllGlobals());
  const withReq = () => plan({ requirements: [req('One'), req('Two', { marked_wrong: true })] });

  it('every section header is a button with aria-expanded and aria-controls, all open by default', () => {
    render(<PlanView plan={plan()} />);
    for (const t of ['requirements', 'dates', 'team', 'billing', 'planned-tasks', 'risks', 'examples', 'decisions']) {
      const b = screen.getByTestId(`plan-${t}-toggle`);
      expect(b.getAttribute('aria-expanded')).toBe('true');
      expect(document.getElementById(b.getAttribute('aria-controls') as string)).not.toBeNull();
    }
  });

  it('collapsing hides the body, keeps the title and count, and shows how many lines are marked wrong', () => {
    render(<PlanView plan={withReq()} />);
    const sec = screen.getByTestId('plan-requirements');
    expect(within(sec).queryByTestId('plan-requirements-fix')).toBeNull();
    fireEvent.click(screen.getByTestId('plan-requirements-toggle'));
    expect(screen.getByTestId('plan-requirements-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('plan-requirements-body')?.hidden).toBe(true);
    expect(sec.textContent).toContain('Requirements');
    expect(sec.textContent).toContain('2');
    expect(within(sec).getByTestId('plan-requirements-fix').textContent).toBe('1 to fix');
    fireEvent.click(screen.getByTestId('plan-requirements-toggle'));
    expect(document.getElementById('plan-requirements-body')?.hidden).toBe(false);
    expect(within(sec).queryByTestId('plan-requirements-fix')).toBeNull();
  });

  it('remembers the state per browser under one key and restores it on the next render', () => {
    const first = render(<PlanView plan={withReq()} />);
    fireEvent.click(screen.getByTestId('plan-risks-toggle'));
    expect(JSON.parse(store[KEY])).toEqual(['plan-risks']);
    first.unmount();
    render(<PlanView plan={withReq()} />);
    expect(screen.getByTestId('plan-risks-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('plan-requirements-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('Collapse all / Expand all', () => {
    render(<PlanView plan={withReq()} />);
    fireEvent.click(screen.getByTestId('plan-collapse-all'));
    expect(screen.getByTestId('plan-collapse-all').textContent).toBe('Expand all');
    expect(screen.getAllByRole('button', { expanded: false }).length).toBe(8);
    fireEvent.click(screen.getByTestId('plan-collapse-all'));
    expect(screen.getByTestId('plan-collapse-all').textContent).toBe('Collapse all');
    expect(screen.queryAllByRole('button', { expanded: false }).length).toBe(0);
  });

  it('renders and toggles when storage throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    render(<PlanView plan={withReq()} />);
    expect(screen.getByTestId('plan-requirements-toggle').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('plan-requirements-toggle'));
    expect(screen.getByTestId('plan-requirements-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('dates: shows the recorded source under the project date, and the sourced change lines', () => {
    const project = { project_id: 'p1', name: 'P', status: 'queue', start_date: null, target_date: '2027-05-05', mike_parts: [], phases: [], sitemap: [], deal: null,
      date_sources: { start: null, launch: { kind: 'sow' as const, label: 'Signed SOW v2', dated: '2026-11-02', at: '2026-11-13T12:00:00Z', by: 'the chat' } },
      date_changes: [{ line: 'Launch moved from Mar 1, 2027 to May 5, 2027, from Signed SOW v2', at: '2026-11-13T12:00:00Z', by: 'the chat' }] };
    render(<PlanView plan={plan({}, { project })} />);
    expect(screen.getByTestId('plan-date-source').textContent).toBe('From Signed SOW v2 · Nov 2, 2026');
    expect(screen.getByTestId('plan-date-changes').textContent).toContain('Launch moved from Mar 1, 2027 to May 5, 2027, from Signed SOW v2');
  });
});

describe('Plan tab: what this project is for', () => {
  const proj = (over: Record<string, unknown> = {}) => ({ project_id: 'p1', name: 'P', status: 'queue', start_date: null, target_date: null, mike_parts: [], phases: [], sitemap: [], deal: null, ...over });
  it('shows the project description at the top, read only, for a project card', () => {
    render(<PlanView plan={plan({}, { project: proj({ description_lines: ['What this project is: A new site.', 'Why it matters: Leads.'] }) })} canEdit />);
    const sec = screen.getByTestId('plan-purpose');
    expect(sec.textContent).toContain('What this project is for');
    expect(within(sec).getByTestId('plan-purpose-text').textContent).toContain('Why it matters: Leads.');
    expect(within(sec).queryAllByRole('textbox').length).toBe(0);
    const order = Array.from(document.querySelectorAll('section')).map((e) => e.getAttribute('data-testid'));
    expect(order.indexOf('plan-purpose')).toBeLessThan(order.indexOf('plan-requirements'));
  });
  it('shows nothing when the project has no description, and nothing for a card with no project', () => {
    render(<PlanView plan={plan({}, { project: proj({ description_lines: null }) })} />);
    expect(screen.queryByTestId('plan-purpose')).toBeNull();
  });
});
