import { useCallback, useEffect, useState } from 'react';

export type ViewMode = 'list' | 'cards';
const KEY = 'totetrack.viewMode';
const EVENT = 'totetrack:viewmode';

function read(): ViewMode {
  try {
    return localStorage.getItem(KEY) === 'cards' ? 'cards' : 'list';
  } catch {
    return 'list';
  }
}

/** Persisted list-vs-cards preference for box lists (search results, boxes page). */
export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(read);
  useEffect(() => {
    const sync = () => setModeState(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const setMode = useCallback((m: ViewMode) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* ignore */
    }
    setModeState(m);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [mode, setMode];
}
