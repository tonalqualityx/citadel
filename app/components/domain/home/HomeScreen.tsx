'use client';

import * as React from 'react';
import './home-tokens.css';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { TaskPeekProvider, useTaskPeek } from '@/lib/contexts/task-peek-context';
import { HomeProjectDrawer } from './HomeProjectDrawer';
import { useOracleProjects, type OracleProjectCard } from '@/lib/hooks/use-oracle-projects';
import { useHome, useHomeAct, useHomeChecklist, useHomeItemAction, useHomeReconcile, useHomeRule, useHomeUndo } from '@/lib/hooks/use-home';
import type { HomeActRequest, HomeActResponse, HomeItem, HomeItemAction, HomeResponse, HomeTileId, HomeTodayActRequest } from '@/lib/home/types';
import { HomeRefreshButton } from './HomeRefreshButton';
import { TileStrip } from './TileStrip';
import { ItemList } from './ItemList';
import { ItemCard } from './ItemCard';
import { HandsCard } from './HandsCard';
import { HandledMailList } from './HandledMailList';
import { FinishedCard } from './FinishedCard';
import { TriageBoard } from './TriageBoard';
import { openTriageConversation } from './triage-talk';
import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';
import { AttachCard } from './AttachCard';
import { WorkingOnBar } from './WorkingOnBar';
import { TodayList } from './TodayList';
import { CalendarStrip, CalendarSoonLine } from './CalendarStrip';
import { CalendarDrawer } from './CalendarDrawer';
import { useHomeCalendar } from '@/lib/hooks/use-home-calendar';
import { RestGroupCard } from './RestGroupCard';
import { LOG_TIME_PROMPT } from '@/lib/home/reconcile/copy';
import { usePageBastChat, useBastChatShell } from '@/components/domain/bast-chat/BastChatProvider';
import {
  addCandidates,
  buildTiles,
  collapsedLine,
  detailForHandled,
  detailForProject,
  findItem,
  initialKey,
  isItemTile,
  itemsForTile,
  plain,
  resolveKey,
  restGroup,
  restHeadingLines,
  rowsFromHandled,
  rowsFromItems,
  rowsFromProjects,
  rowsFromRest,
  type DetailInfo,
  type ListRow,
} from './home-screen-logic';

/** Mike's home screen. Takes no props; /dashboard renders <HomeScreen />. */
export function HomeScreen() {
  return (
    <TaskPeekProvider>
      <HomeScreenInner />
    </TaskPeekProvider>
  );
}

function HomeScreenInner() {
  const { data, isLoading, isError, refetch } = useHome();
  const projectsQuery = useOracleProjects();
  const { openTaskPeek } = useTaskPeek();
  const [openProjectId, setOpenProjectId] = React.useState<string | null>(null);
  const itemActions = useHomeItemAction({ openTask: openTaskPeek, openProject: setOpenProjectId });
  const act = useHomeAct();
  const saveRule = useHomeRule();
  const checklist = useHomeChecklist();
  // Only the keeper's Handled lines undo from here, so the toast says what happened to them.
  const undo = useHomeUndo({ doneText: 'Put back.' });
  // Slice 9a: "This was wrong" on a note from his sent mail, and "Log time?" on a task marked done from a card (the session-only route).
  const wrong = useHomeUndo({ doneText: 'Hidden. Bast will not change that task from your mail for 90 days.', wrong: true });
  const reconcile = useHomeReconcile();

  const [tile, setTile] = React.useState<HomeTileId>('today');
  // undefined = nothing chosen yet (open the tile's first row); null = nothing to open.
  // `index` is where it sat, so a removed row hands the card to the row now in its place.
  const [chosen, setChosen] = React.useState<Chosen | undefined>(undefined);
  const [showLists, setShowLists] = React.useState(false);

  const projects = projectsQuery.data?.projects ?? [];

  if (isLoading) {
    return (
      <div data-home className="home" aria-busy="true">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div data-home className="home">
        <div className="home-pane home-card">
          <p>This screen did not load. Nothing was changed.</p>
          <div className="home-actions">
            <Button variant="secondary" onClick={() => void refetch()}>
              Try again
            </Button>
            <a className="home-btn" href="/dashboard?view=overlook">
              Open the Overlook
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <HomeBody
      res={data}
      projects={projects}
      projectCount={projectsQuery.data ? projects.length : null}
      onRefresh={() => Promise.all([refetch(), projectsQuery.refetch?.()])}
      tile={tile}
      chosen={chosen}
      setTile={setTile}
      setChosen={setChosen}
      openProjectId={openProjectId}
      setOpenProjectId={setOpenProjectId}
      showLists={showLists}
      setShowLists={setShowLists}
      itemActions={itemActions}
      act={act}
      saveRule={saveRule}
      checklist={checklist}
      undo={undo}
      wrong={wrong}
      reconcile={reconcile}
    />
  );
}

interface Chosen {
  key: string;
  index: number;
}

type ItemActions = ReturnType<typeof useHomeItemAction>;

interface BodyProps {
  res: HomeResponse;
  projects: OracleProjectCard[];
  projectCount: number | null;
  onRefresh: () => Promise<unknown>;
  tile: HomeTileId;
  chosen: Chosen | undefined;
  setTile: (t: HomeTileId) => void;
  setChosen: (c: Chosen | undefined) => void;
  openProjectId: string | null;
  setOpenProjectId: (id: string | null) => void;
  showLists: boolean;
  setShowLists: (v: boolean) => void;
  itemActions: ItemActions;
  act: ReturnType<typeof useHomeAct>;
  saveRule: ReturnType<typeof useHomeRule>;
  checklist: ReturnType<typeof useHomeChecklist>;
  undo: ReturnType<typeof useHomeUndo>;
  wrong: ReturnType<typeof useHomeUndo>;
  reconcile: ReturnType<typeof useHomeReconcile>;
}

function HomeBody(p: BodyProps) {
  const { res, projects, tile, itemActions } = p;
  const pinned: HomeItem | null = res.sections.working_on[0] ?? null;
  const tiles = React.useMemo(() => buildTiles(res, p.projectCount), [res, p.projectCount]);

  // The rows behind the selected tile, in the order the server sent them.
  let rows: ListRow[] = [];
  let keys: string[] = [];
  let detail: DetailInfo | null = null;
  const itemTile = isItemTile(tile);
  if (itemTile) {
    keys = itemsForTile(res, tile).map((i) => i.key);
  } else if (tile === 'triage') {
    // The Triage tab is a grid of cards, not a list: no rows, no selection.
  } else if (tile === 'handled') {
    rows = rowsFromHandled(res);
    keys = rows.map((r) => r.key);
  } else if (tile === 'everything_else') {
    rows = rowsFromRest(res);
    keys = rows.map((r) => r.key);
  } else {
    rows = rowsFromProjects(projects);
    keys = rows.map((r) => r.key);
  }
  if (itemTile && tile !== 'today') rows = rowsFromItems(itemsForTile(res, tile));

  const selectedKey = p.chosen === undefined ? (tile === 'today' || itemTile ? initialKey(res, tile) : (keys[0] ?? null)) : resolveKey(keys, p.chosen.key, p.chosen.index);
  if (tile === 'handled') detail = detailForHandled(res, selectedKey);
  else if (tile === 'projects') detail = detailForProject(projects, selectedKey);

  // Talk about this (Triage): the card the chat is about, and a count that opens the chat each time it is tapped.
  const [talkCard, setTalkCard] = React.useState<OpenCardInput | null>(null);
  const chatShell = useBastChatShell();
  const onTalk = (card: OpenCardInput) =>
    openTriageConversation(card, (c) => {
      setTalkCard(c);
      chatShell.talkAbout(c);
    });
  // The card page's Reopen link: /dashboard?talk=<task id>&title=<title> opens that card's own conversation once, then tidies the address.
  React.useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const id = q.get('talk');
      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
      const title = (q.get('title') ?? '').slice(0, 120) || 'This card';
      q.delete('talk');
      q.delete('title');
      const rest = q.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
      onTalk({ key: `task:${id.toLowerCase()}`, title, type: 'task', task_id: id.toLowerCase(), tile: 'triage' });
    } catch {
      // an address that cannot be read just means no chat opens
    }
  }, []);
  const selectItemKey = (key: string) => {
    setTalkCard(null);
    p.setChosen({ key, index: Math.max(keys.indexOf(key), 0) });
  };
  const pickTile = (id: HomeTileId) => {
    setTalkCard(null);
    p.setTile(id);
    p.setChosen(undefined);
  };

  const groupKey = res.today?.group_key;
  const onAction = (action: HomeItemAction, item: HomeItem) => {
    void itemActions.run(action, item, groupKey ? { groupKey } : {});
  };
  const onTodayAct = (request: HomeTodayActRequest): Promise<HomeActResponse> => p.act(request);
  const onFinishedAct = (request: HomeActRequest): Promise<HomeActResponse> => p.act(request);

  const [movingKey, setMovingKey] = React.useState<string | null>(null);
  // Slice 10a: today's calendar (a time and who per row) and the meeting drawer that loads on open.
  const calendar = useHomeCalendar();
  const [openEventId, setOpenEventId] = React.useState<string | null>(null);
  const bringForward = (itemKey: string) => {
    setMovingKey(itemKey);
    p.act({ action: 'bring_forward', item_key: itemKey })
      .catch(() => undefined)
      .finally(() => setMovingKey(null));
  };

  const selectedItem = itemTile ? findItem(res, selectedKey) : null;
  const card = (item: HomeItem | null, empty: string, hideActions = false, inDrawer = false) =>
    item?.attach ? (
      <AttachCard item={item} onAction={onAction} onAct={onFinishedAct} busy={itemActions.pendingFor(item) != null} />
    ) : item?.finished ? (
      <FinishedCard item={item} onAction={onAction} onAct={onFinishedAct} busy={itemActions.pendingFor(item) != null} />
    ) : item?.hands ? (
      <HandsCard item={item} onAction={onAction} pendingFor={itemActions.pendingFor} />
    ) : (
    <ItemCard
      item={item}
      emptyText={empty}
      onAction={onAction}
      pendingAction={itemActions.pendingFor(item)}
      statusText={itemActions.statusFor(item)}
      prompt={itemActions.promptFor(item)}
      onOpenProject={inDrawer ? undefined : (id) => p.setOpenProjectId(id)}
      onSaveRule={p.saveRule}
      onChecklistTick={p.checklist.tick}
      onChecklistAnswer={p.checklist.answer}
      onChecklistNote={p.checklist.note}
      hideActions={hideActions}
    />
    );

  const lists = (
    <>
      <TileStrip tiles={tiles} selected={tile} onSelect={pickTile} />
      {tile === 'triage' && res.triage ? (
        <TriageBoard triage={res.triage} onAct={onFinishedAct} onTalk={onTalk} busy={itemActions.busy} />
      ) : (
      <div className="home-work">
        <div className="home-pane">
          {tile === 'today' ? (
            <>
            <CalendarStrip strip={calendar.data} selectedId={openEventId} onOpen={setOpenEventId} />
            <TodayList
              today={res.today}
              emptyText={res.empty.today}
              selectedKey={selectedKey}
              onSelect={(item) => selectItemKey(item.key)}
              addCandidates={addCandidates(res)}
              userId={res.user_id}
              onAct={onTodayAct}
              busy={itemActions.busy}
            />
            </>
          ) : (
            <ItemList rows={rows} selectedKey={selectedKey} onSelect={selectItemKey} emptyText={res.empty[tile]} />
          )}
        </div>
        <div className="home-pane">
          {itemTile ? (
            card(selectedItem, res.empty[tile])
          ) : tile === 'everything_else' ? (
            <RestGroupCard
              headingLines={restHeadingLines(res)}
              group={restGroup(res, selectedKey)}
              emptyText={res.empty[tile]}
              busyKey={movingKey}
              onBringForward={bringForward}
            />
          ) : (
            <DetailCard
              detail={detail}
              emptyText={res.empty[tile]}
              onOpenProject={(id) => p.setOpenProjectId(id)}
              onUndo={(id) => void p.undo(id)}
              onWrong={(id) => void p.wrong(id)}
              onReopen={(key) => void p.act({ action: 'reopen_ask', item_key: key }).catch(() => undefined)}
              onLogTime={(prompt, minutes) => void p.reconcile({ action: 'log_time', task_id: prompt.task_id, minutes, day: prompt.day })}
            />
          )}
        </div>
      </div>
      )}
    </>
  );

  const openProject = projects.find((x) => x.id === p.openProjectId) ?? null;

  // The card Mike is looking at, for the Bast chat's "About" line. Kind and id only leave the browser.
  const shown = pinned && !p.showLists ? pinned : selectedItem;
  const chatCard = talkCard
    ? talkCard
    : shown
    ? { key: shown.key, title: shown.title, type: shown.type, task_id: shown.opened.task_id, tile }
    : tile === 'projects' && detail && selectedKey
      ? { key: selectedKey, title: detail.title, tile }
      : null;

  usePageBastChat(chatCard);

  return (
    <div data-home className="home">
      <div className="home-top">
        <h1>{plain(res.screen_date_line)}</h1>
        <HomeRefreshButton onRefresh={p.onRefresh} />
      </div>
      {pinned ? (
        <>
          <CalendarSoonLine row={calendar.data?.soon} onOpen={setOpenEventId} />
          <WorkingOnBar
            item={pinned}
            collapsedLine={collapsedLine(res, pinned.key)}
            onDone={() => void itemActions.done(pinned)}
            onStop={(note) => void itemActions.stop(pinned, note)}
            busy={itemActions.busy}
          />
          <div>
            <button
              type="button"
              className="home-btn"
              aria-expanded={p.showLists}
              onClick={() => p.setShowLists(!p.showLists)}
            >
              {p.showLists ? 'Hide my lists' : 'Show my lists'}
            </button>
          </div>
          {p.showLists ? lists : <div className="home-pane">{card(pinned, '', true)}</div>}
        </>
      ) : (
        lists
      )}
      <CalendarDrawer
        eventId={openEventId}
        renderItem={(item) => card(item, '', false, true)}
        onOpenProject={(id) => {
          setOpenEventId(null);
          p.setOpenProjectId(id);
        }}
        onClose={() => setOpenEventId(null)}
      />
      <HomeProjectDrawer
        projectId={p.openProjectId}
        card={openProject}
        userId={res.user_id}
        timeZone={res.timezone}
        renderItem={(item) => card(item, '', false, true)}
        onClose={() => p.setOpenProjectId(null)}
      />
    </div>
  );
}

function DetailCard({
  detail,
  emptyText,
  onOpenProject,
  onUndo,
  onWrong,
  onReopen,
  onLogTime,
}: {
  detail: DetailInfo | null;
  emptyText: string;
  onOpenProject: (id: string) => void;
  onUndo: (actionId: string) => void;
  onWrong: (actionId: string) => void;
  onReopen: (askKey: string) => void;
  onLogTime: (prompt: { task_id: string; minutes: number; day: string }, minutes: number) => void;
}) {
  if (!detail) {
    return (
      <div className="home-card">
        <p className="home-muted">{plain(emptyText)}</p>
      </div>
    );
  }
  return (
    <div className="home-card">
      <h2>{detail.title}</h2>
      {detail.lines.map((l, i) => (
        <p key={i} className={i === 0 ? undefined : 'home-muted'}>
          {l}
        </p>
      ))}
      {detail.timePrompt ? (
        <div className="home-prompt" role="group" aria-label={LOG_TIME_PROMPT(detail.timePrompt.minutes)}>
          <p>{LOG_TIME_PROMPT(detail.timePrompt.minutes)}</p>
          <div className="home-actions">
            {[15, 30, 60, 90, 120].map((m) => (
              <button key={m} type="button" className="home-btn" data-filled={m === detail.timePrompt!.minutes ? 'true' : undefined} onClick={() => onLogTime(detail.timePrompt!, m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {detail.mailList ? <HandledMailList rows={detail.mailList} onReopen={onReopen} /> : null}
      {detail.button || detail.link || detail.undoActionId || detail.wrongActionId || detail.reopenKey ? (
        <div className="home-actions">
          {detail.button ? (
            <button
              type="button"
              className="home-btn"
              data-filled="true"
              onClick={() => onOpenProject(detail.button!.projectId)}
            >
              {detail.button.label}
            </button>
          ) : null}
          {detail.undoActionId ? (
            <button type="button" className="home-btn" onClick={() => onUndo(detail.undoActionId!)}>
              Undo
            </button>
          ) : null}
          {detail.reopenKey ? (
            <button type="button" className="home-btn" onClick={() => onReopen(detail.reopenKey!)}>
              Undo
            </button>
          ) : null}
          {detail.wrongActionId ? (
            <button type="button" className="home-btn" onClick={() => onWrong(detail.wrongActionId!)}>
              This was wrong
            </button>
          ) : null}
          {detail.link ? (
            <a className="home-btn" href={detail.link.href} target="_blank" rel="noopener noreferrer">
              {detail.link.label}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
