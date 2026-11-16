import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';

import type { Song } from './api';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'song'; bundleId?: string; song?: Song }
  | { name: 'player'; bundleId: string; mode: 'karaoke' | 'original'; keyShift: number; guide: number };

type Nav = {
  route: Route;
  depth: number;
  push: (r: Route) => void;
  replace: (r: Route) => void;
  back: () => boolean;
  /** A screen can intercept Back (e.g. to close an overlay). Return true if handled. */
  setBackInterceptor: (fn: (() => boolean) | null) => void;
};

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const interceptor = useRef<(() => boolean) | null>(null);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const back = useCallback(() => {
    if (interceptor.current?.()) return true;
    if (stackRef.current.length <= 1) return false;
    setStack((s) => s.slice(0, -1));
    return true;
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    let onKey: ((e: KeyboardEvent) => void) | undefined;
    if (Platform.OS === 'web') {
      onKey = (e) => {
        const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
        if (e.key === 'Escape' || (e.key === 'Backspace' && !typing && !e.defaultPrevented)) {
          if (back()) e.preventDefault();
        }
      };
      window.addEventListener('keydown', onKey);
    }
    return () => {
      sub.remove();
      if (onKey) window.removeEventListener('keydown', onKey);
    };
  }, [back]);

  const value = useMemo<Nav>(
    () => ({
      route: stack[stack.length - 1],
      depth: stack.length,
      push: (r) => {
        interceptor.current = null;
        setStack((s) => [...s, r]);
      },
      replace: (r) => {
        interceptor.current = null;
        setStack((s) => [...s.slice(0, -1), r]);
      },
      back,
      setBackInterceptor: (fn) => {
        interceptor.current = fn;
      },
    }),
    [stack, back],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavProvider');
  return nav;
}
