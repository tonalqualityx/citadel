'use client';

import { useEffect } from 'react';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { applyTheme, getStoredTheme } from '@/lib/utils/theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { data, isSuccess } = usePreferences();

  // Apply stored theme immediately on mount (before API response)
  useEffect(() => {
    const storedTheme = getStoredTheme();
    if (storedTheme) {
      applyTheme(storedTheme);
    }
  }, []);

  // Sync with API preferences when loaded
  useEffect(() => {
    if (isSuccess && data?.preferences?.theme) {
      applyTheme(data.preferences.theme);
    }
  }, [isSuccess, data?.preferences?.theme]);

  return <>{children}</>;
}
