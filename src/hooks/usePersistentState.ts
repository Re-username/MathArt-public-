import { useEffect, useState } from 'react';

export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        if (Array.isArray(initial)) return parsed;
        if (typeof initial === 'object' && initial !== null) {
          return { ...(initial as object), ...(parsed as object) } as T;
        }
        return parsed;
      }
    } catch {
      /* corrupted storage — fall through to initial */
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full/blocked — ignore */
    }
  }, [key, value]);

  return [value, setValue];
}
