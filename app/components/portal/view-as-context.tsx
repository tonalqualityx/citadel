'use client';

import { createContext, useContext } from 'react';
import { VIEW_AS_READ_ONLY_LINE } from '@/lib/portal/view-as-copy';

export interface ViewAsState {
  clientName: string;
  role: string;
}

const ViewAsContext = createContext<ViewAsState | null>(null);
export const ViewAsProvider = ViewAsContext.Provider;

/** The admin's read-only view of this client, or null for a real client session. */
export function useViewAs(): ViewAsState | null {
  return useContext(ViewAsContext);
}

/** The one line shown next to any action that is switched off in a read-only view. */
export function ReadOnlyNote() {
  const viewAs = useViewAs();
  if (!viewAs) return null;
  return (
    <p className="note" role="note" data-view-as-note>
      {VIEW_AS_READ_ONLY_LINE}
    </p>
  );
}
