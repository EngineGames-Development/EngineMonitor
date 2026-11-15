import { useEffect, useState, type ReactNode } from "react";
import { getAppInfo } from "../ipc/commands";
import { useCommand } from "../ipc/useCommand";
import { useNavigation } from "../navigation/NavigationProvider";
import { Sidebar } from "./Sidebar";

/** Below this width the sidebar collapses to an icon rail. */
const COMPACT_QUERY = "(max-width: 1023px)";

function matchesCompact(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { current } = useNavigation();
  const appInfo = useCommand(getAppInfo);
  const [collapsed, setCollapsed] = useState(matchesCompact);

  // Follow window-size changes; a manual toggle holds until the next crossing.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(COMPACT_QUERY);
    const onChange = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        version={appInfo.status === "ready" ? appInfo.value.version : undefined}
      />
      <main className="min-w-0 flex-1 overflow-y-auto" id="main-content">
        <div key={current} className="mx-auto w-full max-w-[1600px] animate-fade-in px-6 py-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
