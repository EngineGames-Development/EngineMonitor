import { useCallback, useEffect, useState, type RefObject } from "react";

export interface VirtualWindow {
  /** Index of the first row to render. */
  start: number;
  /** One past the last row to render. */
  end: number;
  /** Height of the spacer above the rendered rows. */
  offsetTop: number;
  /** Total scrollable height. */
  totalHeight: number;
}

/** Fallback viewport when the container has no measurable height (e.g. tests). */
const FALLBACK_VIEWPORT = 600;

/** Pure windowing maths; unit-tested. */
export function computeWindow(
  rowCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): VirtualWindow {
  const viewport = viewportHeight > 0 ? viewportHeight : FALLBACK_VIEWPORT;
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(rowCount, first + Math.ceil(viewport / rowHeight) + overscan);
  return { start, end: Math.max(start, end), offsetTop: start * rowHeight, totalHeight: rowCount * rowHeight };
}

/**
 * Fixed-height row virtualisation for a scroll container. Small on purpose:
 * the process table is the only list long enough to need it, which does not
 * justify a dependency.
 */
export function useVirtualRows(
  containerRef: RefObject<HTMLElement | null>,
  rowCount: number,
  rowHeight: number,
  overscan = 8,
): VirtualWindow {
  const [scroll, setScroll] = useState({ top: 0, height: 0 });

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (el) setScroll({ top: el.scrollTop, height: el.clientHeight });
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [containerRef, measure]);

  return computeWindow(rowCount, rowHeight, scroll.top, scroll.height, overscan);
}
