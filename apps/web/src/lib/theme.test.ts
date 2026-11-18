import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  getStoredTheme,
  getTheme,
  initTheme,
  resolveTheme,
  setTheme,
  toggleTheme,
  THEME_STORAGE_KEY,
} from './theme';

describe('theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('defaults to system when nothing is stored', () => {
    expect(getStoredTheme()).toBe('system');
    expect(getTheme()).toBe('system');
  });

  it('persists the choice under the assetnest-theme key', () => {
    setTheme('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(getStoredTheme()).toBe('dark');
  });

  it('applies and removes the .dark class on the document element', () => {
    setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves system via prefers-color-scheme', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('toggleTheme flips the resolved theme and persists it', () => {
    setTheme('light');
    expect(toggleTheme()).toBe('dark');
    expect(getStoredTheme()).toBe('dark');
    expect(toggleTheme()).toBe('light');
    expect(getStoredTheme()).toBe('light');
  });

  it('ignores invalid persisted values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
    expect(getStoredTheme()).toBe('system');
  });

  it('applyTheme returns the resolved theme', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('initTheme applies the stored theme and returns an unsubscribe function', () => {
    setTheme('dark');
    document.documentElement.classList.remove('dark');
    const unsubscribe = initTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
