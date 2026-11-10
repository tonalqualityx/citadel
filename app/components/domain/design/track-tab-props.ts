import type { DesignFeedResponse, DesignSessionTrack } from '@/lib/hooks/use-design';

/** Props every tab of a tracked session receives (Brief, Board, Direction). */
export interface TrackTabProps {
  sessionId: string;
  /** The session's design track view from the session load. */
  track: DesignSessionTrack;
  /** The latest feed response, for cadence and freshness. */
  feed: DesignFeedResponse | undefined;
}
