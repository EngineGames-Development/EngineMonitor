import type { IconName } from "../design";

export type RouteId =
  | "overview"
  | "cpu"
  | "memory"
  | "gpu"
  | "processes"
  | "storage"
  | "network"
  | "history"
  | "settings";

export interface RouteDef {
  id: RouteId;
  label: string;
  icon: IconName;
  description: string;
  group: "monitor" | "analyze" | "app";
}

/** Sidebar order. Keyboard shortcuts Ctrl/Cmd+1..9 follow this order. */
export const ROUTES: readonly RouteDef[] = [
  { id: "overview", label: "Overview", icon: "overview", group: "monitor", description: "System at a glance" },
  { id: "cpu", label: "CPU", icon: "cpu", group: "monitor", description: "Processor utilisation, cores and frequency" },
  { id: "memory", label: "Memory", icon: "memory", group: "monitor", description: "Physical memory and swap" },
  { id: "gpu", label: "GPU", icon: "gpu", group: "monitor", description: "Graphics adapters, where supported" },
  { id: "processes", label: "Processes", icon: "processes", group: "monitor", description: "Running processes and resource usage" },
  { id: "storage", label: "Storage", icon: "storage", group: "monitor", description: "Volumes, capacity and disk activity" },
  { id: "network", label: "Network", icon: "network", group: "monitor", description: "Interfaces and traffic" },
  { id: "history", label: "History", icon: "history", group: "analyze", description: "Recorded metrics over time" },
  { id: "settings", label: "Settings", icon: "settings", group: "app", description: "Preferences and application information" },
];

export const ROUTE_GROUP_LABELS: Record<RouteDef["group"], string> = {
  monitor: "Monitor",
  analyze: "Analyze",
  app: "Application",
};

export function isRouteId(value: unknown): value is RouteId {
  return typeof value === "string" && ROUTES.some((r) => r.id === value);
}

export function routeById(id: RouteId): RouteDef {
  const route = ROUTES.find((r) => r.id === id);
  if (!route) throw new Error(`Unknown route: ${id}`);
  return route;
}

/** Route for a 1-based shortcut digit, or undefined if out of range. */
export function routeForShortcut(digit: number): RouteDef | undefined {
  return Number.isInteger(digit) && digit >= 1 ? ROUTES[digit - 1] : undefined;
}
