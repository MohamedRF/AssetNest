/**
 * Theme handling: light / dark / system.
 * The persisted choice lives in localStorage under `assetnest-theme`.
 * `index.html` applies the theme before first paint; `initTheme()` wires up
 * the system-preference listener for `system` mode.
 */

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'assetnest-theme';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function getStoredTheme(): Theme {
  try {
    if (typeof window === 'undefined') return 'system';
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    // Storage unavailable (private mode, quota) — fall back to system.
    return 'system';
  }
}

export function getTheme(): Theme {
  return getStoredTheme();
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }
  return resolved;
}

export function setTheme(theme: Theme): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch (error) {
    console.warn('AssetNest: unable to persist theme preference', error);
  }
  applyTheme(theme);
}

/** Toggle between light and dark. `system` resolves first, then flips. */
export function toggleTheme(): Theme {
  const next: Theme = resolveTheme(getStoredTheme()) === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/**
 * Apply the stored theme and, while `system` is selected, follow OS changes.
 * Returns an unsubscribe function.
 */
export function initTheme(): () => void {
  applyTheme(getStoredTheme());

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
