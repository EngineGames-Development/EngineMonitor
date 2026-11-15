import type { SVGProps } from "react";

/**
 * EngineMonitor icon set.
 *
 * Hand-drawn on a 24×24 grid, 1.75px stroke, round caps/joins, `currentColor`.
 * Keeping the set in-repo avoids an icon-library dependency and guarantees a
 * consistent visual weight across the app.
 */
const paths = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </>
  ),
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.75" />
      <path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
    </>
  ),
  memory: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="1.5" />
      <path d="M6.5 10.5v3M10 10.5v3M14 10.5v3M17.5 10.5v3M5 17v2.5M19 17v2.5M12 17v2.5" />
    </>
  ),
  gpu: (
    <>
      <path d="M2.5 5.5h17a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-17" />
      <path d="M2.5 4v16" />
      <circle cx="14" cy="11.5" r="3.25" />
      <path d="M6 9h2.5M6 12h2.5M6 15h2.5M8 17.5V20M12 17.5V20" />
    </>
  ),
  processes: (
    <>
      <path d="M8.5 6h12M8.5 12h12M8.5 18h12" />
      <circle cx="4.25" cy="6" r="1.25" />
      <circle cx="4.25" cy="12" r="1.25" />
      <circle cx="4.25" cy="18" r="1.25" />
    </>
  ),
  storage: (
    <>
      <path d="M3.5 13.5 6 5.2A1.75 1.75 0 0 1 7.7 4h8.6A1.75 1.75 0 0 1 18 5.2l2.5 8.3" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="1.75" />
      <path d="M7 16.75h.01M10 16.75h.01" />
    </>
  ),
  network: (
    <>
      <path d="M7 20V5M3.5 8.5 7 5l3.5 3.5" />
      <path d="M17 4v15M13.5 15.5 17 19l3.5-3.5" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 3.5V8H8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8.5 20.5h7M12 17v3.5" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.75h.01" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 0 1-15 5.5M3.5 12a8.5 8.5 0 0 1 15-5.5" />
      <path d="M18.5 2.5v4h-4M5.5 21.5v-4h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20.5 20.5-4.9-4.9" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  construction: (
    <>
      <rect x="2.5" y="8" width="19" height="7" rx="1.5" />
      <path d="M7 8l-3.5 7M13 8l-3.5 7M19 8l-3.5 7M5.5 15v5M18.5 15v5M5.5 8V5M18.5 8V5" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Accessible label. Omit for decorative icons (they are then aria-hidden). */
  label?: string;
}

export function Icon({ name, size = 18, label, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {label ? <title>{label}</title> : null}
      {paths[name]}
    </svg>
  );
}
