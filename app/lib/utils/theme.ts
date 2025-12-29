export type Theme = 'light' | 'dim' | 'dark' | 'system';

export function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;

  // Remove all theme classes
  root.classList.remove('theme-light', 'theme-dim', 'theme-dark');

  // Apply the appropriate theme class
  if (theme === 'light') {
    root.classList.add('theme-light');
  } else if (theme === 'dim') {
    root.classList.add('theme-dim');
  } else if (theme === 'dark') {
    root.classList.add('theme-dark');
  }
  // 'system' - no class added, uses CSS media query

  // Store in localStorage for fast initial load
  localStorage.setItem('indelible-theme', theme);
}

export function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('indelible-theme') as Theme | null;
}
