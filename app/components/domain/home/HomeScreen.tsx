'use client';

import * as React from 'react';
import './home-tokens.css';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { TaskPeekProvider, useTaskPeek } from '@/lib/contexts/task-peek-context';
import { ProjectDrawer } from '@/components/domain/oracle/modes/projects/ProjectDrawer';
import { useOracleProjects, type OracleProjectCard } from '@/lib/hooks/use-oracle-projects';
import { useHome, useHomeAct, useHomeItemAction } from '@/lib/hooks/use-home';
import type { HomeActResponse, HomeItem, HomeItemAction, HomeResponse, HomeTileId, HomeTodayActRequest } from '@/lib/home/types';
import { TileStrip } from './TileStrip';
import { ItemList } from './ItemList';
import { ItemCard } from './ItemCard';
import { WorkingOnBar } from './WorkingOnBar';
import { TodayList } from './TodayList';
import {
  addCandidates,
  buildTiles,
  collapsedLine,
  detailForHandled,
  detailForProject,
  detailForRest,
  findItem,
  initialKey,
  isItemTile,
  itemsForTile,
  plain,
  resolveKey,
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
  const itemActions = useHomeItemAction({ openTask: openTaskPeek });
  const act = useHomeAct();

  const [tile, setTile] = React.useState<HomeTileId>('today');
  // undefined = nothing chosen yet (open the tile's first row); null = nothing to open.
  // `index` is where it sat, so a removed row hands the card to the row now in its place.
  const [chosen, setChosen] = React.useState<Chosen | undefined>(undefined);
  const [openProjectId, setOpenProjectId] = React.useState<string | null>(null);
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
  else if (tile === 'everything_else') detail = detailForRest(res, selectedKey);
  else if (tile === 'projects') detail = detailForProject(projects, selectedKey);

  const selectItemKey = (key: string) => {
    p.setChosen({ key, index: Math.max(keys.indexOf(key), 0) });
  };
  const pickTile = (id: HomeTileId) => {
    p.setTile(id);
    p.setChosen(undefined);
  };

  const groupKey = res.today?.group_key;
  const onAction = (action: HomeItemAction, item: HomeItem) => {
    void itemActions.run(action, item, groupKey ? { groupKey } : {});
  };
  const onTodayAct = (request: HomeTodayActRequest): Promise<HomeActResponse> => p.act(request);

  const selectedItem = itemTile ? findItem(res, selectedKey) : null;
  const card = (item: HomeItem | null, empty: string, hideActions = false) => (
    <ItemCard
      item={item}
      emptyText={empty}
      onAction={onAction}
      pendingAction={itemActions.pendingFor(item)}
      statusText={itemActions.statusFor(item)}
      prompt={itemActions.promptFor(item)}
      onOpenProject={(id) => p.setOpenProjectId(id)}
      hideActions={hideActions}
    />
  );

  const lists = (
    <>
      <TileStrip tiles={tiles} selected={tile} onSelect={pickTile} />
      <div className="home-work">
        <div className="home-pane">
          {tile === 'today' ? (
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
          ) : (
            <ItemList rows={rows} selectedKey={selectedKey} onSelect={selectItemKey} emptyText={res.empty[tile]} />
          )}
        </div>
        <div className="home-pane">
          {itemTile ? (
            card(selectedItem, res.empty[tile])
          ) : (
            <DetailCard detail={detail} emptyText={res.empty[tile]} onOpenProject={(id) => p.setOpenProjectId(id)} />
          )}
        </div>
      </div>
    </>
  );

  const openProject = projects.find((x) => x.id === p.openProjectId) ?? null;

  return (
    <div data-home className="home">
      <div className="home-top">
        <h1>{plain(res.screen_date_line)}</h1>
      </div>
      {pinned ? (
        <>
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
      <ProjectDrawer
        project={openProject}
        open={openProject !== null}
        onOpenChange={(o) => {
          if (!o) p.setOpenProjectId(null);
        }}
      />
    </div>
  );
}

function DetailCard({
  detail,
  emptyText,
  onOpenProject,
}: {
  detail: DetailInfo | null;
  emptyText: string;
  onOpenProject: (id: string) => void;
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
      {detail.button || detail.link ? (
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
