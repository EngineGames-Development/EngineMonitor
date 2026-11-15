import { useId } from "react";

/** EngineMonitor mark: a tachometer gauge. Same geometry as app-icon.svg. */
export function LogoMark({ size = 24 }: { size?: number }) {
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="180 220 664 664" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2BC4B0" />
          <stop offset="0.55" stopColor="#FF9A4D" />
          <stop offset="1" stopColor="#FF7A1A" />
        </linearGradient>
      </defs>
      <path
        d="M 299.9 772.1 A 300 300 0 1 1 724.1 772.1"
        fill="none"
        stroke="var(--em-line-strong)"
        strokeWidth="84"
        strokeLinecap="round"
      />
      <path
        d="M 299.9 772.1 A 300 300 0 1 1 800.4 482.4"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="84"
        strokeLinecap="round"
      />
      <line x1="512" y1="560" x2="700" y2="400" stroke="var(--em-fg)" strokeWidth="48" strokeLinecap="round" />
      <circle cx="512" cy="560" r="62" fill="var(--em-fg)" />
    </svg>
  );
}
