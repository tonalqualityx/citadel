'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import '@/components/domain/home/home-tokens.css';
import { useHomeAct } from '@/lib/hooks/use-home';
import { useTriageCard, triageCardKeys } from '@/lib/hooks/use-triage-card';
import { taskKeys } from '@/lib/api/query-keys';
import { useBastChatShell } from '@/components/domain/bast-chat/BastChatProvider';
import { openTriageConversation } from '@/components/domain/home/triage-talk';
import { TriageActions } from '@/components/domain/home/TriageActions';
import { TriageFacts } from '@/components/domain/home/TriageProject';
import { DateReason, LooksDoneEvidence, ReleaseLine, SessionChanged } from '@/components/domain/home/TriageBoard';
import { LOOKS_DONE_BADGE, ageFromDays, kindLabel } from '@/lib/tasks/triage-copy';

/** Remembered per device: whether the panel is open. Collapsed by default. */
export const TRIAGE_PANEL_STORAGE_KEY = 'citadel.triagePanel.expanded';

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(TRIAGE_PANEL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeExpanded(v: boolean): void {
  try {
    window.localStorage.setItem(TRIAGE_PANEL_STORAGE_KEY, v ? '1' : '0');
  } catch {
    /* private window or blocked storage: the panel simply starts collapsed next time */
  }
}

/**
 * The card page's Triage panel, above the Card | Questions | Plan strip. Compact by default (about 200px tall at desktop and tablet widths): one header
 * row (what it is, its age, a More toggle), the "On release" line clamped to two lines, ONE summary line of facts, and the actions, always visible.
 * "More" opens the panel in place for the full release line and Details. The shape, what will be his, the sitemap and the deal's items are in the Plan
 * tab. Every action is the existing home act; the server's checks (owner only, the release version) are the only checks. It renders only for Mike on a
 * card that is in Triage: the route answers 403 or 404 to everyone else and the panel is then simply not there.
 */
export function TriagePanel({ taskId, enabled = true }: { taskId: string; enabled?: boolean }) {
  const { data: card } = useTriageCard(taskId, enabled);
  const act = useHomeAct();
  const shell = useBastChatShell();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => setExpanded(readExpanded()), []);
  if (!card) return null;
  const age = ageFromDays(card.age_days);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: triageCardKeys.task(taskId) });
    void queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
  };
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    writeExpanded(next);
  };
  return (
    <div data-home data-testid="triage-panel-wrap">
      <section className="home-tpanel home-tpanel-compact" data-testid="triage-panel" data-expanded={expanded ? 'true' : 'false'} data-looks-done={card.looks_done ? 'true' : undefined} aria-label="Triage">
        <div className="home-tcard-top">
          {card.looks_done ? <span className="home-pill home-pill-done">{LOOKS_DONE_BADGE}</span> : null}
          <span className="home-tkind" data-unsorted={card.kind === null ? 'true' : undefined}>
            {kindLabel(card.kind)}
          </span>
          {age ? <span className="home-tage">{age}</span> : null}
          <button type="button" className="home-linkbtn home-tmore" aria-expanded={expanded} data-testid="triage-more" onClick={toggle}>
            {expanded ? 'Less' : 'More'}
          </button>
        </div>
        <SessionChanged card={card} />
        <DateReason card={card} />
        {card.looks_done ? <LooksDoneEvidence looksDone={card.looks_done} /> : <ReleaseLine card={card} showDetails={expanded} clamp={!expanded} />}
        <TriageFacts project={card.project} openQuestions={card.open_questions} />
        <TriageActions
          card={card}
          onAct={act}
          onDone={refresh}
          onTalk={(c) => openTriageConversation(c, (x) => shell.talkAbout(x, { bindToPage: true }))}
        />
      </section>
    </div>
  );
}
