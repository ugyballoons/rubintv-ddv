import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import {
  buildScatterOption,
  mappingFor,
  parseDataIdKey,
  PointIndex,
  selectionOverlaySeries,
  type AxisSpec,
  type DataIdKey,
  type SeriesSpec,
} from 'rubin-charts';
import { EChart } from './EChart';
import type { EChartsInstance } from './echarts';
import { ChartTooltip, fmt, type TooltipData } from './ChartTooltip';
import { useZoomAxisKey } from './zoomKeys';

interface Props {
  series: readonly SeriesSpec[];
  xAxis: AxisSpec;
  yAxis: AxisSpec;
  selected: ReadonlySet<DataIdKey>;
  resetToken?: number;
  registryId?: string;
  onSelect(ids: ReadonlySet<DataIdKey>, committed: boolean): void;
  /** Cursor position in data units, or null when the cursor leaves the plot. */
  onHover?(coords: { x: number; y: number } | null): void;
  onTiming?(msg: string): void;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const TOOLTIP_DELAY_MS = 400;
const PICK_PX = 10;

/**
 * Cartesian scatter with rectangle drag-select. Hit-testing is done in app code
 * with the KDBush index from rubin-charts; ECharts only draws. The base option
 * is rebuilt only when data or axes change; selection changes patch the overlay.
 */
export function ScatterPanel({
  series,
  xAxis,
  yAxis,
  selected,
  registryId,
  resetToken,
  onSelect,
  onHover,
  onTiming,
}: Props) {
  const chart = useRef<EChartsInstance | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<Rect | null>(null);
  const frame = useRef<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomKey = useZoomAxisKey();
  // ECharts handlers are registered once; they read the latest callbacks through these refs.
  const selectRef = useRef<(r: Rect, committed: boolean) => void>(() => {});
  const hoverRef = useRef<(px: number, py: number) => void>(() => {});
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  const option = useMemo(
    () => buildScatterOption({ series, xAxis, yAxis, selected: new Set(), drillDown: null }),
    [series, xAxis, yAxis],
  );
  const patch = useMemo<EChartsCoreOption>(
    () => ({ series: [selectionOverlaySeries(series, selected)] }),
    [series, selected],
  );
  const xMap = mappingFor(xAxis.mapping);
  const yMap = mappingFor(yAxis.mapping);
  const indexes = useMemo(
    () => series.map((s) => new PointIndex(s.x as Float64Array, s.y, xMap, yMap)),
    [series, xMap, yMap],
  );

  // Holding X or Y limits zoom to that axis via the two inside dataZooms.
  useEffect(() => {
    chart.current?.setOption(
      {
        dataZoom: [
          { disabled: !!xAxis.fixedBounds || zoomKey === 'y' },
          { disabled: !!yAxis.fixedBounds || zoomKey === 'x' },
        ],
      },
      { notMerge: false },
    );
  }, [zoomKey, xAxis.fixedBounds, yAxis.fixedBounds]);

  const select = useCallback(
    (r: Rect, committed: boolean) => {
      const c = chart.current;
      if (!c) return;
      const t0 = performance.now();
      const [ax, ay] = c.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [
        r.x0,
        r.y0,
      ]) as number[];
      const [bx, by] = c.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [
        r.x1,
        r.y1,
      ]) as number[];
      const ids = new Set<DataIdKey>();
      let total = 0;
      indexes.forEach((index, k) => {
        total += series[k].dataIds.length;
        for (const i of index.rangeInData(ax, ay, bx, by)) ids.add(series[k].dataIds[i]);
      });
      onSelect(ids, committed);
      onTiming?.(
        `${committed ? 'selected' : 'preview'} ${ids.size} of ${total} in ${(performance.now() - t0).toFixed(1)} ms`,
      );
    },
    [indexes, series, onSelect, onTiming],
  );
  selectRef.current = select;

  const hover = useCallback(
    (px: number, py: number) => {
      const c = chart.current;
      if (!c) return;
      if (!c.containPixel({ gridIndex: 0 }, [px, py])) {
        onHoverRef.current?.(null);
        setTooltip(null);
        return;
      }
      const [dx, dy] = c.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [px, py]) as number[];
      onHoverRef.current?.({ x: dx, y: dy });
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      setTooltip(null);
      tooltipTimer.current = setTimeout(() => {
        // Pick box of ±PICK_PX pixels, converted to linear units for the index.
        const [x1, y1] = c.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [
          px + PICK_PX,
          py + PICK_PX,
        ]) as number[];
        const halfW = Math.abs(xMap.forward(x1) - xMap.forward(dx));
        const halfH = Math.abs(yMap.forward(y1) - yMap.forward(dy));
        let best: { k: number; i: number } | null = null;
        for (let k = 0; k < indexes.length && !best; k++) {
          const i = indexes[k].nearestInLinear(xMap.forward(dx), yMap.forward(dy), halfW, halfH);
          if (i >= 0) best = { k, i };
        }
        if (!best) return;
        const hit: { k: number; i: number } = best;
        const s = series[hit.k];
        const id = parseDataIdKey(s.dataIds[hit.i]);
        setTooltip({
          x: px,
          y: py,
          title: s.name,
          entries: [
            { label: xAxis.label, value: fmt((s.x as Float64Array)[hit.i]) },
            { label: yAxis.label, value: fmt(s.y[hit.i]) },
            {
              label: 'night',
              value: String(id.dayObs).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
            },
            { label: 'seq', value: String(id.seqNum) },
          ],
        });
      }, TOOLTIP_DELAY_MS);
    },
    [indexes, series, xAxis.label, yAxis.label, xMap, yMap],
  );
  hoverRef.current = hover;

  const onReady = useCallback((c: EChartsInstance) => {
    chart.current = c;
    const zr = c.getZr();
    zr.on('mousedown', (e) => {
      const raw = e.event as MouseEvent;
      if (raw.shiftKey || raw.button !== 0) return;
      drag.current = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
      setTooltip(null);
    });
    // Mouse events can arrive faster than frames; coalesce previews to one per frame.
    zr.on('mousemove', (e) => {
      if (!drag.current) {
        hoverRef.current(e.offsetX, e.offsetY);
        return;
      }
      drag.current = { ...drag.current, x1: e.offsetX, y1: e.offsetY };
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (!drag.current) return;
        setRect(drag.current);
        selectRef.current(drag.current, false);
      });
    });
    const finish = () => {
      const r = drag.current;
      drag.current = null;
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      setRect(null);
      if (!r) return;
      if (Math.abs(r.x1 - r.x0) < 3 && Math.abs(r.y1 - r.y0) < 3) {
        onSelectRef.current(new Set(), true); // click on empty space clears
        return;
      }
      selectRef.current(r, true);
    };
    zr.on('mouseup', finish);
    zr.on('globalout', () => {
      finish();
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      setTooltip(null);
      onHoverRef.current?.(null);
    });
  }, []);

  useEffect(
    () => () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    },
    [],
  );

  return (
    <div ref={host} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <EChart
        option={option}
        patch={patch}
        resetToken={resetToken}
        registryId={registryId}
        onReady={onReady}
      />
      {rect && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            left: Math.min(rect.x0, rect.x1),
            top: Math.min(rect.y0, rect.y1),
            width: Math.abs(rect.x1 - rect.x0),
            height: Math.abs(rect.y1 - rect.y0),
            border: '1.5px solid var(--accent)',
            background: 'rgba(5,139,140,0.08)',
          }}
        />
      )}
      <ChartTooltip data={tooltip} host={host.current} />
      {zoomKey && <div className="zoom-hint">zoom {zoomKey} only</div>}
    </div>
  );
}
