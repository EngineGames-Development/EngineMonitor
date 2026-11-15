import { Fragment } from "react";
import { cx, Icon } from "../design";
import { LogoMark } from "../design/Logo";
import { useNavigation } from "../navigation/NavigationProvider";
import { ROUTE_GROUP_LABELS, ROUTES, type RouteDef } from "../navigation/routes";
import { useTheme } from "../theme/ThemeProvider";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  version?: string;
}

export function Sidebar({ collapsed, onToggleCollapsed, version }: SidebarProps) {
  const { current, navigate } = useNavigation();
  const { resolved, setPreference } = useTheme();

  let lastGroup: RouteDef["group"] | null = null;

  return (
    <aside
      className={cx(
        "flex h-full shrink-0 flex-col border-r border-line bg-surface",
        "transition-[width] duration-200 ease-out-soft",
        collapsed ? "w-[60px]" : "w-[216px]",
      )}
    >
      <div className={cx("flex h-14 items-center gap-2.5", collapsed ? "justify-center" : "px-4")}>
        <LogoMark size={24} />
        {!collapsed && (
          <span className="font-display text-[15px] font-semibold tracking-tight text-fg">
            Engine<span className="text-primary">Monitor</span>
          </span>
        )}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-2">
        {ROUTES.map((route, index) => {
          const showGroup = route.group !== lastGroup;
          lastGroup = route.group;
          const active = route.id === current;
          const shortcut = `${MOD}${index + 1}`;
          return (
            <Fragment key={route.id}>
              {showGroup &&
                (collapsed ? (
                  index > 0 && <div className="mx-3 my-2 border-t border-line" />
                ) : (
                  <div className="px-2.5 pt-4 pb-1.5 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
                    {ROUTE_GROUP_LABELS[route.group]}
                  </div>
                ))}
              <button
                type="button"
                onClick={() => navigate(route.id)}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? route.label : undefined}
                title={collapsed ? `${route.label} (${shortcut})` : shortcut}
                className={cx(
                  "group relative mb-0.5 flex h-8 w-full items-center gap-2.5 rounded-md text-sm transition-colors duration-150",
                  collapsed ? "justify-center" : "px-2.5",
                  active ? "bg-primary-soft text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                )}
              >
                {active && (
                  <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-full bg-primary" />
                )}
                <Icon name={route.icon} size={17} className={active ? "text-primary" : undefined} />
                {!collapsed && <span className="truncate font-medium">{route.label}</span>}
              </button>
            </Fragment>
          );
        })}
      </nav>

      <div className={cx("flex items-center gap-1 border-t border-line p-2", collapsed && "flex-col")}>
        <button
          type="button"
          onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
          className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={resolved === "dark" ? "Light theme" : "Dark theme"}
        >
          <Icon name={resolved === "dark" ? "sun" : "moon"} size={16} />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
        </button>
        {!collapsed && version && (
          <span className="tabular ml-auto pr-1.5 text-2xs text-fg-subtle" title="EngineMonitor version">
            v{version}
          </span>
        )}
      </div>
    </aside>
  );
}
