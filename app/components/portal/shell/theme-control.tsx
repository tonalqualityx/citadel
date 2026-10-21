'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'portal-theme';

function read(): Theme {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme) {
  const root = document.querySelector('[data-portal]');
  if (!root) return;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

const OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'Match my device', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/** System, Light or Dark. Remembered in localStorage when it works; the page is fine without it. */
export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const t = read();
    setTheme(t);
    apply(t);
  }, []);
  function choose(t: Theme) {
    setTheme(t);
    apply(t);
    try {
      if (t === 'system') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, t);
    } catch {
      // Private window or blocked storage: the choice still applies to this page.
    }
  }
  return (
    <div className="seg" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button key={value} type="button" aria-pressed={theme === value} title={label} onClick={() => choose(value)}>
          <Icon className="i" aria-hidden="true" focusable="false" />
          <span className="vh">{label}</span>
        </button>
      ))}
    </div>
  );
}
