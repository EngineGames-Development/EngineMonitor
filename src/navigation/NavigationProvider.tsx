import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isRouteId, routeForShortcut, type RouteId } from "./routes";

interface NavigationContextValue {
  current: RouteId;
  navigate: (id: RouteId) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

/** Section named by the URL hash (e.g. `#history`), if valid. Allows deep links. */
export function routeFromHash(hash: string): RouteId | null {
  const id = hash.replace(/^#/, "");
  return isRouteId(id) ? id : null;
}

/**
 * Minimal typed navigation. A desktop app with nine fixed sections does not
 * need URL routing; this keeps the bundle small and the state explicit. The
 * URL hash is only read once at start-up, as a deep link.
 */
export function NavigationProvider({ children, initial }: { children: ReactNode; initial?: RouteId }) {
  const [current, setCurrent] = useState<RouteId>(
    () => initial ?? (typeof window !== "undefined" ? routeFromHash(window.location.hash) : null) ?? "overview",
  );

  // Ctrl/Cmd + 1..9 jumps to a section.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const route = routeForShortcut(Number(e.key));
      if (route) {
        e.preventDefault();
        setCurrent(route.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(() => ({ current, navigate: setCurrent }), [current]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used inside <NavigationProvider>");
  return ctx;
}
