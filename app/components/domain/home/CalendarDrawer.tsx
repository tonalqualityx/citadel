'use client';

import * as React from 'react';
import Link from 'next/link';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerBody, DrawerCloseButton } from '@/components/ui/drawer';
import { useHomeCalendarEvent } from '@/lib/hooks/use-home-calendar';
import type { HomeItem } from '@/lib/home/types';
import type { HomeCalendarLink } from '@/lib/home/calendar/types';
import { BEFORE_HEADING, INVITE_HEADING, ITEMS_HEADING, LINKS_HEADING, LOADING_TEXT, LOAD_FAILED_TEXT, RETRY_LABEL, WITH_HEADING } from '@/lib/home/calendar/copy';
import { plain } from './home-screen-logic';

export interface CalendarDrawerProps {
  /** CalendarEvent.id to show, or null when the drawer is closed. */
  eventId: string | null;
  /** Renders one of his items with the main list's own card and button wiring. */
  renderItem: (item: HomeItem) => React.ReactNode;
  /** A project link (or "and N more") was chosen: the caller closes this drawer and opens the project drawer. */
  onOpenProject: (projectId: string) => void;
  onClose: () => void;
}

function LinkLine({ link, onOpenProject }: { link: HomeCalendarLink; onOpenProject: (id: string) => void }) {
  const label = plain(link.label);
  if (link.project_id) {
    const id = link.project_id;
    return (
      <button type="button" className="text-left underline underline-offset-2" onClick={() => onOpenProject(id)}>
        {label}
      </button>
    );
  }
  if (!link.href) return <span>{label}</span>;
  if (link.href.startsWith('/')) {
    return (
      <Link className="underline underline-offset-2" href={link.href}>
        {label}
      </Link>
    );
  }
  return (
    <a className="underline underline-offset-2" href={link.href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/**
 * The meeting drawer on Mike's home screen (Slice 10a), loaded on open from its own GET.
 * Nothing in it acts: the only buttons that do anything are his item cards, unchanged.
 * Event text is plain text, and links only come from the server's https checks.
 */
export function CalendarDrawer({ eventId, renderItem, onOpenProject, onClose }: CalendarDrawerProps) {
  const query = useHomeCalendarEvent(eventId);
  const data = query.data;

  return (
    <Drawer open={eventId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent side="right" size="lg">
        <DrawerHeader>
          <div>
            {data?.client ? <div className="text-xs font-semibold uppercase tracking-wide text-text-sub">{plain(data.client.name)}</div> : null}
            <DrawerTitle>{data ? plain(data.event.title) : 'Meeting'}</DrawerTitle>
            {data ? <p className="home-muted home-small m-0 mt-1">{plain(data.event.when)}</p> : null}
            {data?.event.location ? <p className="home-muted home-small m-0">{plain(data.event.location)}</p> : null}
          </div>
          <DrawerCloseButton />
        </DrawerHeader>
        <DrawerBody>
          <div data-home data-testid="home-calendar-drawer" className="flex flex-col gap-6">
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
                {data.event.join ? (
                  <p>
                    <a className="home-btn" data-filled="true" href={data.event.join.href} target="_blank" rel="noopener noreferrer">
                      {data.event.join.label}
                    </a>
                  </p>
                ) : null}

                <section data-testid="calendar-with">
                  <h3 className="mb-2 text-sm font-semibold">{WITH_HEADING}</h3>
                  {data.people.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {data.people.map((p) => (
                        <li key={`${p.name}-${p.detail ?? ''}`} className="home-small">
                          {[plain(p.name), p.detail ? plain(p.detail) : null, p.reply].filter(Boolean).join(', ')}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="home-muted home-small mt-1">{plain(data.matched_by)}</p>
                  {data.also_with.length > 0 ? <p className="home-muted home-small">Also with: {data.also_with.map(plain).join(', ')}</p> : null}
                </section>

                {data.hints.length > 0 ? (
                  <section data-testid="calendar-hints">
                    <h3 className="mb-2 text-sm font-semibold">{BEFORE_HEADING}</h3>
                    <ul className="flex flex-col gap-1">
                      {data.hints.map((h) => (
                        <li key={h.text} className={h.muted ? 'home-muted home-small' : 'home-small'}>
                          {plain(h.text)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {data.items.length > 0 ? (
                  <section data-testid="calendar-items">
                    <h3 className="mb-2 text-sm font-semibold">{data.client ? `${ITEMS_HEADING} for ${plain(data.client.name)}` : ITEMS_HEADING}</h3>
                    <div className="flex flex-col gap-3">
                      {data.items.map((x) => (
                        <div key={x.item.key} data-testid="calendar-item">
                          <p className="home-muted home-small mb-1">{plain(x.where)}</p>
                          {renderItem(x.item)}
                        </div>
                      ))}
                    </div>
                    {data.more_items > 0 ? (
                      <p className="home-small mt-2">
                        {data.more_project_id ? (
                          <button type="button" className="underline underline-offset-2" onClick={() => onOpenProject(data.more_project_id as string)}>
                            and {data.more_items} more
                          </button>
                        ) : (
                          <span className="home-muted">and {data.more_items} more</span>
                        )}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                {data.links.length > 0 ? (
                  <section data-testid="calendar-links">
                    <h3 className="mb-2 text-sm font-semibold">{LINKS_HEADING}</h3>
                    <ul className="flex flex-col gap-1">
                      {data.links.map((l) => (
                        <li key={`${l.label}-${l.href ?? l.project_id}`} className="home-small">
                          <LinkLine link={l} onOpenProject={onOpenProject} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {data.event.invite_text ? (
                  <section data-testid="calendar-invite">
                    <h3 className="mb-2 text-sm font-semibold">{INVITE_HEADING}</h3>
                    <p className="home-muted home-small whitespace-pre-wrap break-words">{data.event.invite_text}</p>
                    {data.event.invite_links.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-1">
                        {data.event.invite_links.map((l) => (
                          <li key={l.href} className="home-small">
                            <a className="underline underline-offset-2" href={l.href} target="_blank" rel="noopener noreferrer">
                              {plain(l.label)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : null}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
