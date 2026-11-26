'use client';

import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { usePageBastChat, useBastChatShell } from '@/components/domain/bast-chat/BastChatProvider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RetainerMonthsBoard } from '@/components/domain/retainer-months/RetainerMonthsBoard';
import { useConfirmRetainerMonth, useRetainerMonths } from '@/lib/hooks/use-retainer-months';
import type { RetainerMonthView } from '@/types/entities';
import { InitiativesBoard } from '@/components/domain/initiatives/InitiativesBoard';
import { monthDay } from '@/components/domain/initiatives/format';
import {
  useInitiativeBoard,
  useInitiativeCheckIn,
  useStopInitiative,
  type BoardInitiative,
} from '@/lib/hooks/use-initiatives';

/** What Check in puts in the chat box (design.md 3.1): the one check-in question, about the open initiative. */
const CHECK_IN_DRAFT = 'Check in on this one: on track, behind, or something changed? ';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The chat card for an initiative: kind and id are all that leave the browser (card-context). */
function chatCard(i: BoardInitiative | null) {
  return i ? { key: `initiative:${i.id}`, title: i.name.slice(0, 120), tile: 'initiatives' } : null;
}

function InitiativesTab() {
  const { data: board, isLoading, error } = useInitiativeBoard();
  const checkIn = useInitiativeCheckIn();
  const stop = useStopInitiative();
  const shell = useBastChatShell();

  // ?focus=<id> opens on that initiative; focusing one keeps the address in step so a link lands on the same view.
  const [focusId, setFocusId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('focus');
    if (id && UUID_RE.test(id)) setFocusId(id);
  }, []);
  const onFocus = React.useCallback((id: string) => {
    setFocusId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('focus', id);
    window.history.replaceState(null, '', url.toString());
  }, []);

  const focused = board ? (board.initiatives.find((i) => i.id === focusId) ?? board.initiatives.find((i) => i.id === board.focus_id) ?? null) : null;
  usePageBastChat(chatCard(focused));

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error || !board) {
    return <EmptyState title="Initiatives did not load" description="Reload the page to try again." />;
  }

  return (
    <InitiativesBoard
      board={board}
      focusId={focusId}
      actions={{
        onFocus,
        onTalk: (i) => shell.talkAbout(chatCard(i) ?? { key: 'initiatives', title: 'Initiatives', tile: 'initiatives' }),
        onCheckInOpen: (i) => shell.talkAbout(chatCard(i)!, { draft: CHECK_IN_DRAFT }),
        onCheckIn: (i, health) => checkIn.mutate({ id: i.id, health }),
        onKeepGoing: (i) =>
          checkIn.mutate({
            id: i.id,
            health: i.numbers.some((n) => n.pace === 'behind') ? 'behind' : 'on_track',
            note: `Kept going at the stop check on ${monthDay(new Date().toISOString())}`,
          }),
        onStop: (i) => stop.mutate({ id: i.id, reason: `Stopped at the stop check on ${monthDay(new Date().toISOString())}: ${i.stop_condition ?? ''}`.trim() }),
        busy: checkIn.isPending || stop.isPending,
      }}
    />
  );
}

function RetainerMonthsTab() {
  const { data, isLoading, error } = useRetainerMonths();
  const confirm = useConfirmRetainerMonth();
  const shell = useBastChatShell();
  const [focusId, setFocusId] = React.useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error || !data) {
    return <EmptyState title="Retainer months did not load" description="Reload the page to try again." />;
  }
  return (
    <RetainerMonthsBoard
      month={data.month}
      retainers={data.retainers}
      upcoming={data.upcoming}
      focusId={focusId}
      onFocus={setFocusId}
      onConfirm={(m: RetainerMonthView) => confirm.mutate(m.id)}
      onTalk={(m: RetainerMonthView) => shell.talkAbout({ key: 'retainer-months', title: `${m.client_name}: retainer month`.slice(0, 120), tile: 'initiatives' })}
      busy={confirm.isPending}
    />
  );
}

export default function InitiativesPage() {
  return (
    <Tabs defaultValue="initiatives">
      <TabsList>
        <TabsTrigger value="initiatives">Initiatives</TabsTrigger>
        <TabsTrigger value="retainer-months">Retainer months</TabsTrigger>
      </TabsList>
      <TabsContent value="initiatives" className="mt-4">
        <InitiativesTab />
      </TabsContent>
      <TabsContent value="retainer-months" className="mt-4">
        <RetainerMonthsTab />
      </TabsContent>
    </Tabs>
  );
}
