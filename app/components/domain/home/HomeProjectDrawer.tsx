'use client';

import * as React from 'react';
import Link from 'next/link';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerBody, DrawerCloseButton } from '@/components/ui/drawer';
import { useHomeProject } from '@/lib/hooks/use-home-project';
import { useWorkState } from '@/lib/hooks/use-work-state';
import { projectStatus } from '@/lib/home/projects/status';
import type { HomeItem } from '@/lib/home/types';
import type { ProjectCardLike } from '@/lib/home/projects/types';
import {
  ITEMS_HEADING,
  LOAD_FAILED_TEXT,
  LOADING_TEXT,
  NO_ITEMS_TEXT,
  OPEN_FULL_PROJECT_LABEL,
  RETRY_LABEL,
  WAITING_HEADING,
  dayWithWeekday,
  lastEmailText,
  nextStepOwner,
  nextStepSource,
  sinceWithDays,
  stripMikePrefix,
} from '@/lib/home/projects/copy';
import { plain } from './home-screen-logic';

export interface HomeProjectDrawerProps {
  /** The project to show, or null when the drawer is closed. */
  projectId: string | null;
  /** The Projects card for it (already loaded for the tile), or null when the project is not in that list. */
  card: (ProjectCardLike & { name: string; client: { name: string } }) | null;
  /** The signed-in owner (HomeResponse.user_id). */
  userId: string;
  /** His IANA zone (HomeResponse.timezone). */
  timeZone: string;
  /** Renders one item with the main list's own card and button wiring. */
  renderItem: (item: HomeItem) => React.ReactNode;
  onClose: () => void;
}

/**
 * The project drawer on Mike's home screen (Slice 8a). One status sentence, the next step,
 * his items here with their usual buttons, the last client email and the one way out. It has
 * no Edit, Refresh or Dismiss; the Seeing Stone's ProjectDrawer is a different component.
 */
export function HomeProjectDrawer({ projectId, card, userId, timeZone, renderItem, onClose }: HomeProjectDrawerProps) {
  const query = useHomeProject(projectId);
  // Work stage D: the one state line and everything attached to this project (mail, sessions, sends, deploys, meetings).
  const work = useWorkState(projectId ? `project:${projectId}` : null);
  const data = query.data;
  const now = React.useMemo(() => new Date(), [projectId, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = React.useMemo(() => {
    if (!data) return null;
    return projectStatus({
      now,
      timeZone,
      userId,
      needsNow: data.items.filter((x) => x.item.type === 'emergency').length,
      card,
      waits: data.waits,
    });
  }, [data, card, now, timeZone, userId]);

  const step = card?.next_step ?? null;
  const owner = step ? nextStepOwner(step, userId) : null;
  const source = step ? nextStepSource(step, now, timeZone) : null;
  const lastEmail = card
    ? [...card.linked_emails].sort((a, b) => b.received_at.localeCompare(a.received_at))[0] ?? null
    : null;

  const name = data?.project.name ?? card?.name ?? '';
  const clientName = data?.project.client?.name ?? card?.client.name ?? '';

  return (
    <Drawer open={projectId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent side="right" size="lg">
        <DrawerHeader>
          <div>
            {clientName ? <div className="text-xs font-semibold uppercase tracking-wide text-text-sub">{plain(clientName)}</div> : null}
            <DrawerTitle>{plain(name) || 'Project'}</DrawerTitle>
          </div>
          <DrawerCloseButton />
        </DrawerHeader>
        <DrawerBody>
          <div data-home data-testid="home-project-drawer" className="flex flex-col gap-6">
            {query.isLoading ? <p className="home-muted">{LOADING_TEXT}</p> : null}
            {query.isError ? (
              <div className="flex flex-col gap-2">
                <p>{LOAD_FAILED_TEXT}</p>
                <div>
                  <button type="button" className="home-btn" onClick={() => void query.refetch()}>
                    {RETRY_LABEL}
                  </button>
                </div>
              </div>
            ) : null}

            {data ? (
              <>
                {status ? <p data-testid="home-project-status" className="text-base font-semibold">{status}</p> : null}

                {work.data ? (
                  <section data-testid="home-project-attached">
                    <p data-testid="home-project-work-line" className="home-small">{plain(work.data.line)}</p>
                    {work.data.attached.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {work.data.attached.map((a) => (
                          <li key={a.link_id} className="home-small">
                            {a.href ? (
                              <a href={a.href} target={a.href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">{plain(a.line)}</a>
                            ) : (
                              plain(a.line)
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}

                {step && step.text ? (
                  <section data-testid="home-project-next-step">
                    <p>
                      <strong>Next step:</strong> {stripMikePrefix(step.text)}
                    </p>
                    {owner ? <p className="home-muted home-small">{owner}</p> : null}
                    {source ? <p className="home-muted home-small">{source}</p> : null}
                  </section>
                ) : null}

                <section data-testid="home-project-items">
                  <h3 className="mb-2 text-sm font-semibold">{ITEMS_HEADING}</h3>
                  {data.items.length === 0 ? (
                    <p className="home-muted">{NO_ITEMS_TEXT}</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {data.items.map((x) => (
                        <div key={x.item.key} data-testid="home-project-item">
                          <p className="home-muted home-small mb-1">{plain(x.where)}</p>
                          {renderItem(x.item)}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {data.waits.length > 0 ? (
                  <section data-testid="home-project-waits">
                    <h3 className="mb-2 text-sm font-semibold">{WAITING_HEADING}</h3>
                    <ul className="flex flex-col gap-1">
                      {data.waits.map((w) => (
                        <li key={`${w.who}-${w.since}-${w.title}`} className="home-small">
                          {plain(w.title)}. {plain(w.who)}, since {sinceWithDays(new Date(w.since), now, timeZone)}.
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {lastEmail ? (
                  <p data-testid="home-project-last-email">
                    <a href={lastEmail.deep_link} target="_blank" rel="noopener noreferrer">
                      {lastEmailText(lastEmail, timeZone)}
                    </a>
                  </p>
                ) : null}
              </>
            ) : null}

            {projectId ? (
              <p>
                <Link className="home-btn" href={`/projects/${projectId}`}>
                  {OPEN_FULL_PROJECT_LABEL}
                </Link>
              </p>
            ) : null}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

// Re-exported for tests that want the same date wording the drawer uses.
export { dayWithWeekday };
