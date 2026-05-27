import { useState, useEffect, useCallback, useRef } from 'react';

type Theme = 'day' | 'night';

const STORAGE_KEY = 'rybix-theme';
const OVERRIDE_KEY = 'rybix-theme-override';
const OVERRIDE_DURATION = 30 * 60 * 1000; // 30 min

function getAutoTheme(): Theme {
  const h = new Date().getHours();
  return h >= 7 && h < 19 ? 'day' : 'night';
}

function applyThemeToDom(theme: Theme) {
  if (theme === 'day') {
    document.documentElement.classList.remove('dark');
    document.body.classList.add('day');
    document.body.classList.remove('night');
  } else {
    document.documentElement.classList.add('dark');
    document.body.classList.remove('day');
    document.body.classList.add('night');
  }
}

export function useRybixTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Check for recent manual override
    try {
      const overrideExpiry = Number(localStorage.getItem(OVERRIDE_KEY) || 0);
      if (Date.now() < overrideExpiry) {
        return (localStorage.getItem(STORAGE_KEY) as Theme) || getAutoTheme();
      }
    } catch {}
    return getAutoTheme();
  });

  const overrideTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Apply theme to DOM whenever it changes
  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  // Auto-check every minute
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const overrideExpiry = Number(localStorage.getItem(OVERRIDE_KEY) || 0);
        if (Date.now() >= overrideExpiry) {
          // No active override — use auto
          const auto = getAutoTheme();
          setThemeState(auto);
        }
      } catch {
        setThemeState(getAutoTheme());
      }
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Toggle manually
  const toggle = useCallback(() => {
    const next: Theme = theme === 'day' ? 'night' : 'day';

    try {
      localStorage.setItem(STORAGE_KEY, next);
      localStorage.setItem(OVERRIDE_KEY, String(Date.now() + OVERRIDE_DURATION));
    } catch {}

    setThemeState(next);

    // Clear previous timer and set new expiry
    if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current);
    overrideTimerRef.current = setTimeout(() => {
      try { localStorage.removeItem(OVERRIDE_KEY); } catch {}
      setThemeState(getAutoTheme());
    }, OVERRIDE_DURATION);
  }, [theme]);

  const isDay = theme === 'day';

  return { theme, isDay, toggle };
}
