import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

export function useRybixTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    return (localStorage.getItem('rybix-theme') as Theme) || 'system';
  });

  const getSystemTheme = (): 'light' | 'dark' => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const applyTheme = useCallback((t: Theme) => {
    const effective = t === 'system' ? getSystemTheme() : t;
    document.documentElement.classList.toggle('dark', effective === 'dark');
  }, []);

  useEffect(() => {
    applyTheme(theme);

    // Listen to system changes when in 'system' mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') applyTheme('system');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, applyTheme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('rybix-theme', t);
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
