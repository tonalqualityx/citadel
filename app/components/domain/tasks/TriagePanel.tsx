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
import { TriageProjectBlock } from '@/components/domain/home/TriageProject';
import { LooksDoneEvidence, ReleaseLine } from '@/components/domain/home/TriageBoard';
import { LOOKS_DONE_BADGE, ageFromDays, kindLabel } from '@/lib/tasks/triage-copy';

/**
 * The card page's Triage panel, above the Card | Questions strip: what Bast thinks the card is, the "On release" line, the same
 * actions as the grid card, the looks-done evidence when marked, and for a project card the full project block. Every action is the
 * existing home act; the server's checks (owner only, the release version) are the only checks. It renders only for Mike on a card
 * that is in Triage: the route answers 403 or 404 to everyone else and the panel is then simply not there.
 */
export function TriagePanel({ taskId, enabled = true }: { taskId: string; enabled?: boolean }) {
  const { data: card } = useTriageCard(taskId, enabled);
  const act = useHomeAct();
  const shell = useBastChatShell();
  const queryClient = useQueryClient();
  if (!card) return null;
  const age = ageFromDays(card.age_days);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: triageCardKeys.task(taskId) });
    void queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
  };
  return (
    <div data-home data-testid="triage-panel-wrap">
      <section className="home-tpanel" data-testid="triage-panel" data-looks-done={card.looks_done ? 'true' : undefined} aria-label="Triage">
        <div className="home-tcard-top">
          {card.looks_done ? <span className="home-pill home-pill-done">{LOOKS_DONE_BADGE}</span> : null}
          <span className="home-tkind" data-unsorted={card.kind === null ? 'true' : undefined}>
            {kindLabel(card.kind)}
          </span>
          {age ? <span className="home-tage">{age}</span> : null}
        </div>
        {card.looks_done ? <LooksDoneEvidence looksDone={card.looks_done} /> : <ReleaseLine card={card} showDetails />}
        {card.project ? <TriageProjectBlock project={card.project} variant="full" /> : null}
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
