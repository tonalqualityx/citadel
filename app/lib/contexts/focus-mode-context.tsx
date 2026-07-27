'use client';

import * as React from 'react';
import type { TodayPick } from '@/lib/hooks/use-today';
import { FocusMode } from '@/components/domain/oracle/focus/FocusMode';

// Clarity Phase 7 (Seeing Stone Reckoning P2) — Focus Mode (spec Q8/G10). Same "one shared
// full-view instance, exposed via a context" pattern as TaskPeekProvider — entered from any
// Today card's Focus button, mounted once at the Oracle page level.

interface FocusModeContextValue {
  enterFocus: (pick: TodayPick) => void;
}

const noop: FocusModeContextValue = {
  enterFocus: () => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('useFocusMode() called outside a FocusModeProvider — no-op.');
    }
  },
};

const FocusModeContext = React.createContext<FocusModeContextValue>(noop);

export function useFocusMode(): FocusModeContextValue {
  return React.useContext(FocusModeContext);
}

export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const [activePick, setActivePick] = React.useState<TodayPick | null>(null);

  const enterFocus = React.useCallback((pick: TodayPick) => {
    setActivePick(pick);
  }, []);

  const value = React.useMemo<FocusModeContextValue>(() => ({ enterFocus }), [enterFocus]);

  return (
    <FocusModeContext.Provider value={value}>
      {children}
      {activePick && <FocusMode pick={activePick} onExit={() => setActivePick(null)} />}
    </FocusModeContext.Provider>
  );
}
