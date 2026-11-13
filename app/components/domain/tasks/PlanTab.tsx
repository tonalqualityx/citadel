'use client';

import * as React from 'react';
import '@/components/domain/home/home-tokens.css';
import { useTaskPlan, usePlanItemActions } from '@/lib/hooks/use-task-plan';
import { plain } from '@/components/domain/home/home-screen-logic';
import { shortDay } from '@/lib/tasks/plan-summary';
import {
  MARK_LABELS,
  PLAN_EMPTY_LINES,
  WRONG_NOTE,
  type PlanItemOut,
  type PlanOut,
  type PlanSectionName,
  type PlanSectionOut,
  type PlanSource,
} from '@/lib/tasks/plan-schema';

export const PLAN_COPY = {
  loading: 'Loading the plan.',
  nothing: 'Nothing in the plan yet. It fills in as you talk with Dox.',
  lastChanged: (when: string, by: string) => `Plan last changed ${when} by ${by}.`,
  unconfirmed: 'From a document, not yet confirmed.',
  mismatch: "The figures differ from Citadel's records.",
  droppedHeading: (n: number) => `Dropped (${n})`,
  billingKind: {
    retainer: 'Covered by a retainer.',
    hourly: 'Billed hourly.',
    milestones: 'A project billed in milestones.',
    internal: 'Internal work, not billed.',
    unknown: 'How this is billed is not yet known.',
  } as Record<string, string>,
  withheld: 'Not shown to you.',
  yours: 'Yours',
  review: 'Review lines',
  doneReviewing: 'Done reviewing',
  shape: 'Shape',
  sitemap: 'Sitemap',
} as const;

function dayLong(iso: string): string {
  const m = /^(\d{4})-/.exec(iso);
  return m ? `${shortDay(iso)}, ${m[1]}` : iso;
}

function whenWords(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The small muted line under an item: where it came from, with its date and link. */
function SourceLine({ source }: { source: PlanSource | undefined }) {
  if (!source) return null;
  const label = plain(source.label);
  return (
    <span className="home-small home-muted home-plan-src" data-testid="plan-source">
      {source.url ? <a href={source.url}>{label}</a> : label}
      {source.date ? ` · ${dayLong(source.date)}` : ''}
    </span>
  );
}

/** Mark pill and "was ..." for a changed line. */
function MarkLine({ item }: { item: PlanItemOut }) {
  const mark = str(item.mark);
  if (mark !== 'changed' && mark !== 'added') return null;
  return (
    <span className="home-small home-plan-mark" data-testid="plan-mark" data-mark={mark}>
      <span className="home-plan-pill" data-mark={mark}>
        {MARK_LABELS[mark]}
      </span>
      {mark === 'changed' ? (
        <>
          {' '}
          <span className="home-muted">
            was {plain(str(item.was))}
            {item.changed_by ? `, changed by ${plain(str(item.changed_by))}` : ''}
          </span>
        </>
      ) : null}
    </span>
  );
}

interface Controls {
  canEdit: boolean;
  onRemove: (section: PlanSectionName, id: string) => void;
  onMarkWrong: (section: PlanSectionName, id: string, wrong: boolean) => void;
}

function ItemControls({ section, item, c }: { section: PlanSectionName; item: PlanItemOut; c: Controls }) {
  const [confirm, setConfirm] = React.useState(false);
  if (!c.canEdit) return null;
  return (
    <span className="home-plan-ctl">
      <button type="button" className="home-linkbtn" onClick={() => c.onMarkWrong(section, item.id, !item.marked_wrong)}>
        {item.marked_wrong ? 'Clear mark' : 'Mark wrong'}
      </button>
      {confirm ? (
        <button type="button" className="home-linkbtn" onClick={() => c.onRemove(section, item.id)}>
          Remove for good?
        </button>
      ) : (
        <button type="button" className="home-linkbtn" onClick={() => setConfirm(true)}>
          Remove
        </button>
      )}
    </span>
  );
}

/** One line of a section: its body, then marks, source, the wrong note, and the owner's controls. */
function Line({ section, item, c, children, source }: { section: PlanSectionName; item: PlanItemOut; c: Controls; children: React.ReactNode; source?: PlanSource }) {
  const dropped = str(item.mark) === 'dropped';
  const wrong = item.marked_wrong;
  return (
    <li className="home-plan-item" data-testid="plan-item" data-wrong={wrong ? 'true' : undefined} data-dropped={dropped ? 'true' : undefined}>
      <span className="home-plan-text" style={wrong || dropped ? { textDecoration: 'line-through' } : undefined}>
        {children}
      </span>
      <MarkLine item={item} />
      <SourceLine source={source ?? (item.source as PlanSource | undefined)} />
      {wrong ? (
        <span className="home-small home-plan-wrong" data-testid="plan-wrong">
          {WRONG_NOTE}. The chat will correct it.
        </span>
      ) : null}
      {dropped && item.changed_by ? <span className="home-small home-muted">Dropped: {plain(str(item.changed_by))}</span> : null}
      <ItemControls section={section} item={item} c={c} />
    </li>
  );
}

function Empty({ section }: { section: PlanSectionName }) {
  return (
    <p className="home-small home-muted" data-testid={`plan-empty-${section}`}>
      {PLAN_EMPTY_LINES[section]}
    </p>
  );
}

function Block({ title, count, testid, children }: { title: string; count?: number; testid: string; children: React.ReactNode }) {
  return (
    <section className="home-blk home-plan-sec" data-testid={testid} aria-label={title}>
      <h3>
        {title}
        {count ? <span className="home-plan-count"> {count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Dropped({ items, section, c, render }: { items: PlanItemOut[]; section: PlanSectionName; c: Controls; render: (i: PlanItemOut) => React.ReactNode }) {
  if (items.length === 0) return null;
  return (
    <details className="home-plan-dropped" data-testid={`plan-dropped-${section}`}>
      <summary className="home-small home-muted">{PLAN_COPY.droppedHeading(items.length)}</summary>
      <ul className="home-plan-list">
        {items.map((i) => (
          <Line key={i.id} section={section} item={i} c={c}>
            {render(i)}
          </Line>
        ))}
      </ul>
    </details>
  );
}

const live = (s: PlanSectionOut) => s.items.filter((i) => str(i.mark) !== 'dropped');
const droppedOf = (s: PlanSectionOut) => s.items.filter((i) => str(i.mark) === 'dropped');

function Requirements({ s, c }: { s: PlanSectionOut; c: Controls }) {
  const items = live(s);
  return (
    <Block title={s.title} count={items.length} testid="plan-requirements">
      {s.items.length === 0 ? (
        <Empty section="requirements" />
      ) : (
        <>
          <ul className="home-plan-list">
            {items.map((i) => (
              <Line key={i.id} section="requirements" item={i} c={c}>
                {plain(str(i.text))}
              </Line>
            ))}
          </ul>
          <Dropped items={droppedOf(s)} section="requirements" c={c} render={(i) => plain(str(i.text))} />
        </>
      )}
    </Block>
  );
}

function Dates({ s, c, project }: { s: PlanSectionOut; c: Controls; project: PlanOut['project'] }) {
  const fromProject = project
    ? [
        project.start_date ? { label: 'Start', date: project.start_date } : null,
        project.target_date ? { label: 'Launch', date: project.target_date } : null,
      ].filter((x): x is { label: string; date: string } => !!x)
    : [];
  const items = live(s).sort((a, b) => str(a.date).localeCompare(str(b.date)));
  const empty = items.length === 0 && fromProject.length === 0 && droppedOf(s).length === 0;
  const render = (i: PlanItemOut) => (
    <>
      <strong>{plain(str(i.label))}</strong> {dayLong(str(i.date))}
    </>
  );
  return (
    <Block title={s.title} count={items.length + fromProject.length} testid="plan-dates">
      {empty ? (
        <Empty section="dates" />
      ) : (
        <>
          <ul className="home-plan-list">
            {fromProject.map((d) => (
              <li key={d.label} className="home-plan-item" data-testid="plan-project-date">
                <span className="home-plan-text">
                  <strong>{d.label}</strong> {dayLong(d.date)}
                </span>
                <span className="home-small home-muted home-plan-src">Project dates</span>
              </li>
            ))}
            {items.map((i) => (
              <Line key={i.id} section="dates" item={i} c={c}>
                {render(i)}
              </Line>
            ))}
          </ul>
          <Dropped items={droppedOf(s)} section="dates" c={c} render={render} />
        </>
      )}
    </Block>
  );
}

function Team({ s, c, project }: { s: PlanSectionOut; c: Controls; project: PlanOut['project'] }) {
  const mikeParts = project?.mike_parts ?? [];
  const mine = s.items.filter((i) => i.is_mike === true);
  const others = s.items.filter((i) => i.is_mike !== true);
  const nameOf = (i: PlanItemOut) => {
    const p = i.person as { user_id?: string; name?: string; org?: string } | undefined;
    if (i.person_name) return str(i.person_name);
    return p?.name ? `${p.name}${p.org ? `, ${p.org}` : ''}` : 'Someone';
  };
  const body = (i: PlanItemOut) => (
    <>
      <strong>{plain(nameOf(i))}</strong>: {plain(str(i.role))}
      {i.note ? <span className="home-muted"> {plain(str(i.note))}</span> : null}
    </>
  );
  const total = mikeParts.length + s.items.length;
  return (
    <Block title={s.title} count={total} testid="plan-team">
      {total === 0 ? (
        <Empty section="team" />
      ) : (
        <ul className="home-plan-list">
          {mikeParts.map((m, k) => (
            <li key={`mp${k}`} className="home-plan-item" data-testid="plan-mike-part">
              <span className="home-plan-text">
                <span className="home-yours">{PLAN_COPY.yours}</span> {plain(m.text)}
              </span>
              <span className="home-small home-muted home-plan-src">{plain(m.phase)} phase</span>
            </li>
          ))}
          {mine.map((i) => (
            <Line key={i.id} section="team" item={i} c={c}>
              <span className="home-yours">{PLAN_COPY.yours}</span> {body(i)}
            </Line>
          ))}
          {others.map((i) => (
            <Line key={i.id} section="team" item={i} c={c}>
              {body(i)}
            </Line>
          ))}
        </ul>
      )}
    </Block>
  );
}

function Billing({ s, c }: { s: PlanSectionOut; c: Controls }) {
  if (s.withheld) {
    return (
      <Block title={s.title} testid="plan-billing">
        <p className="home-small home-muted">{PLAN_COPY.withheld}</p>
      </Block>
    );
  }
  const basis = s.items.find((i) => i.type === 'basis');
  const miles = s.items.filter((i) => i.type === 'milestone');
  const refers = basis?.refers_to as { label: string; href?: string } | undefined;
  return (
    <Block title={s.title} testid="plan-billing">
      {!basis && miles.length === 0 ? (
        <Empty section="billing" />
      ) : (
        <>
          {basis ? (
            <ul className="home-plan-list">
              <Line section="billing" item={basis} c={c} source={basis.source as PlanSource}>
                <strong>{PLAN_COPY.billingKind[str(basis.kind)] ?? str(basis.kind)}</strong>
                {refers ? (
                  <>
                    {' '}
                    {refers.href ? <a href={refers.href}>{plain(refers.label)}</a> : plain(refers.label)}
                  </>
                ) : null}
                {basis.note ? <span className="home-muted"> {plain(str(basis.note))}</span> : null}
              </Line>
            </ul>
          ) : null}
          {miles.length > 0 ? (
            <ul className="home-plan-list" aria-label="Milestones">
              {miles.map((m) => (
                <Line key={m.id} section="billing" item={m} c={c}>
                  <strong>{plain(str(m.amount))}</strong> {plain(str(m.label))}
                  <span className="home-muted">
                    {' '}
                    when {plain(str(m.trigger))}
                    {m.due ? `, due ${dayLong(str(m.due))}` : ''}
                  </span>
                </Line>
              ))}
            </ul>
          ) : null}
          {basis && basis.matches_citadel !== true ? (
            <p className="home-small home-plan-unconfirmed" data-testid="plan-unconfirmed">
              {basis.matches_citadel === false ? PLAN_COPY.mismatch : PLAN_COPY.unconfirmed}
            </p>
          ) : null}
        </>
      )}
    </Block>
  );
}

function Examples({ s, c }: { s: PlanSectionOut; c: Controls }) {
  return (
    <Block title={s.title} count={s.items.length} testid="plan-examples">
      {s.items.length === 0 ? (
        <Empty section="examples" />
      ) : (
        <ul className="home-plan-list">
          {s.items.map((i) => (
            <Line key={i.id} section="examples" item={i} c={c}>
              <a href={str(i.url)} target="_blank" rel="noreferrer noopener">
                {plain(str(i.title) || str(i.url).replace(/^https?:\/\//, ''))}
              </a>
              <span className="home-muted"> {plain(str(i.note))}</span>
            </Line>
          ))}
        </ul>
      )}
    </Block>
  );
}

function Decisions({ s, c, answered }: { s: PlanSectionOut; c: Controls; answered: PlanOut['answered_questions'] }) {
  const total = s.items.length + answered.length;
  return (
    <Block title={s.title} count={total} testid="plan-decisions">
      {total === 0 ? (
        <Empty section="decisions" />
      ) : (
        <ul className="home-plan-list">
          {s.items.map((i) => (
            <Line key={i.id} section="decisions" item={i} c={c}>
              <strong>Decided:</strong> {plain(str(i.text))}
            </Line>
          ))}
          {answered.map((q) => (
            <li key={q.id} className="home-plan-item" data-testid="plan-answered">
              <span className="home-plan-text">
                <strong>Mike chose:</strong> {plain(q.answer)}
              </span>
              <span className="home-small home-muted home-plan-src">
                Answered question: {plain(q.question)}
                {q.answered_at ? ` · ${whenWords(q.answered_at)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

function ProjectBlocks({ project }: { project: NonNullable<PlanOut['project']> }) {
  return (
    <>
      <Block title={PLAN_COPY.shape} count={project.phases.length} testid="plan-shape">
        {project.phases.length === 0 ? (
          <p className="home-small home-muted">No phases drafted yet.</p>
        ) : (
          <ol className="home-plan-list home-plan-ol">
            {project.phases.map((ph) => (
              <li key={ph.id} className="home-plan-item">
                <span className="home-plan-text">
                  <strong>{plain(ph.name)}</strong>
                  {ph.summary ? <span className="home-muted"> {plain(ph.summary)}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Block>
      <Block title={PLAN_COPY.sitemap} count={project.sitemap.length} testid="plan-sitemap">
        {project.sitemap.length === 0 ? (
          <p className="home-small home-muted">No pages drafted yet.</p>
        ) : (
          <ul className="home-plan-list">
            {project.sitemap.map((p) => (
              <li key={p.id} className="home-plan-item">
                <span className="home-plan-text">
                  {plain(p.name)}
                  {p.page_type ? <span className="home-muted">{` (${plain(p.page_type)})`}</span> : null}
                </span>
                {p.notes ? <span className="home-small home-muted home-plan-src">{plain(p.notes)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Block>
    </>
  );
}

/** The plan as a read: presentational. `canEdit` shows the owner's two controls per line (Mark wrong, Remove); he edits by talking. */
export function PlanView({
  plan,
  canEdit = false,
  onRemove = () => {},
  onMarkWrong = () => {},
}: {
  plan: PlanOut;
  canEdit?: boolean;
  onRemove?: (section: PlanSectionName, id: string) => void;
  onMarkWrong?: (section: PlanSectionName, id: string, wrong: boolean) => void;
}) {
  // The two per-line controls sit behind one "Review lines" switch so the plan stays quiet to read; he edits by talking.
  const [reviewing, setReviewing] = React.useState(false);
  const c: Controls = { canEdit: canEdit && reviewing, onRemove, onMarkWrong };
  const by = (n: PlanSectionName) => plan.sections.find((s) => s.section === n) as PlanSectionOut;
  return (
    <div className="home-plan" data-testid="plan-tab">
      <div className="home-plan-top">
        <p className="home-small home-muted" data-testid="plan-last-changed">
          {plan.updated_at && plan.updated_by ? PLAN_COPY.lastChanged(whenWords(plan.updated_at), plan.updated_by) : PLAN_COPY.nothing}
        </p>
        {canEdit && plan.sections.some((x) => x.items.length > 0) ? (
          <button type="button" className="home-btn" aria-pressed={reviewing} onClick={() => setReviewing((r) => !r)}>
            {reviewing ? PLAN_COPY.doneReviewing : PLAN_COPY.review}
          </button>
        ) : null}
      </div>
      <Requirements s={by('requirements')} c={c} />
      <Dates s={by('dates')} c={c} project={plan.project} />
      <Team s={by('team')} c={c} project={plan.project} />
      <Billing s={by('billing')} c={c} />
      {plan.project ? <ProjectBlocks project={plan.project} /> : null}
      <Examples s={by('examples')} c={c} />
      <Decisions s={by('decisions')} c={c} answered={plan.answered_questions} />
    </div>
  );
}

/** The card page's Plan tab: loads the plan and wires the owner's controls. */
export function PlanTab({ taskId, enabled = true }: { taskId: string; enabled?: boolean }) {
  const { data: plan, isLoading } = useTaskPlan(taskId, enabled);
  const act = usePlanItemActions(taskId);
  if (isLoading) {
    return (
      <div data-home>
        <p className="home-small home-muted">{PLAN_COPY.loading}</p>
      </div>
    );
  }
  if (!plan) return null;
  return (
    <div data-home data-testid="plan-wrap">
      <PlanView plan={plan} canEdit={plan.viewer.is_owner} onRemove={(s, id) => void act.remove(s, id)} onMarkWrong={(s, id, w) => void act.markWrong(s, id, w)} />
    </div>
  );
}
