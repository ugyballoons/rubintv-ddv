import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipEntry {
  readonly label: string;
  readonly value: string;
}

export interface TooltipData {
  /** Cursor position relative to the chart host. */
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly entries: readonly TooltipEntry[];
}

const OFFSET = 14;

/**
 * Small overlay near the cursor listing label/value rows, like the Flutter
 * chart tooltip. Rendered through a portal and confined to the chart host:
 * it flips to the left of or above the cursor rather than run off the chart
 * (the equivalent of ECharts' `tooltip.confine`), and other windows cannot
 * cover it.
 */
export function ChartTooltip({
  data,
  hostRef,
}: {
  data: TooltipData | null;
  hostRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!data || !host || !ref.current) {
      setPos(null);
      return;
    }
    const h = host.getBoundingClientRect();
    const { width, height } = ref.current.getBoundingClientRect();
    let left = h.left + data.x + OFFSET;
    let top = h.top + data.y + OFFSET;
    if (left + width > h.right) left = Math.max(h.left, h.left + data.x - OFFSET - width);
    if (top + height > h.bottom) top = Math.max(h.top, h.top + data.y - OFFSET - height);
    setPos({ left, top });
  }, [data, hostRef]);

  if (!data) return null;
  return createPortal(
    <div
      ref={ref}
      className="chart-tooltip"
      role="tooltip"
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="chart-tooltip-title">{data.title}</div>
      {data.entries.map((e) => (
        <div key={e.label} className="chart-tooltip-row">
          <span>{e.label}</span>
          <span>{e.value}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export const fmt = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, '');
