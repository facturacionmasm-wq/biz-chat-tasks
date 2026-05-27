/**
 * useDarkMode — light/dark/system theme switcher.
 *
 * NOTE: This hook is intentionally separate from useRybixTheme (the day/night
 * auto-time-based theme). Do NOT rename this export — it was previously
 * misnamed `useRybixTheme`, which caused a naming collision.
 */
import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

export function useDarkMode() {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      if (typeof window === 'undefined') return 'system';
      return (localStorage.getItem('rybix-theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });

  const getSystemTheme = (): 'light' | 'dark' => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  };

  const applyTheme = useCallback((t: Theme) => {
    const effective = t === 'system' ? getSystemTheme() : t;
    document.documentElement.classList.toggle('dark', effective === 'dark');
  }, []);

  useEffect(() => {
    applyTheme(theme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') applyTheme('system');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, applyTheme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem('rybix-theme', t);
    } catch { /* ignore storage errors */ }
    setThemeState(t);
    applyTheme(t);
  }, [applyTheme]);

  const toggle = useCallback(() => {
    const effective = theme === 'system' ? getSystemTheme() : theme;
    setTheme(effective === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const isDark = theme === 'dark' || (theme === 'system' && getSystemTheme() === 'dark');

  return { theme, setTheme, toggle, isDark };
}
