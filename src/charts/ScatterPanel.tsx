import { useCallback, useMemo, useRef, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import {
  buildScatterOption,
  mappingFor,
  PointIndex,
  selectionOverlaySeries,
  type AxisSpec,
  type DataIdKey,
  type SeriesSpec,
} from 'rubin-charts';
import { EChart } from './EChart';
import type { EChartsInstance } from './echarts';

interface Props {
  series: SeriesSpec;
  xAxis: AxisSpec;
  yAxis: AxisSpec;
  selected: ReadonlySet<DataIdKey>;
  onSelect(ids: ReadonlySet<DataIdKey>, committed: boolean): void;
  onTiming?(msg: string): void;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Cartesian scatter with rectangle drag-select. Hit-testing is done in app code
 * with the KDBush index from rubin-charts; ECharts only draws. The base option
 * is rebuilt only when data or axes change; selection changes patch the overlay.
 */
export function ScatterPanel({ series, xAxis, yAxis, selected, onSelect, onTiming }: Props) {
  const chart = useRef<EChartsInstance | null>(null);
  const drag = useRef<Rect | null>(null);
  const frame = useRef<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const option = useMemo(
    () =>
      buildScatterOption({ series: [series], xAxis, yAxis, selected: new Set(), drillDown: null }),
    [series, xAxis, yAxis],
  );
  const patch = useMemo<EChartsCoreOption>(
    () => ({ series: [selectionOverlaySeries([series], selected)] }),
    [series, selected],
  );
  const index = useMemo(
    () =>
      new PointIndex(
        series.x as Float64Array,
        series.y,
        mappingFor(xAxis.mapping),
        mappingFor(yAxis.mapping),
      ),
    [series, xAxis.mapping, yAxis.mapping],
  );

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
      const hits = index.rangeInData(ax, ay, bx, by);
      const ids = new Set<DataIdKey>();
      for (const i of hits) ids.add(series.dataIds[i]);
      onSelect(ids, committed);
      onTiming?.(
        `${committed ? 'selected' : 'preview'} ${ids.size} of ${series.dataIds.length} in ${(performance.now() - t0).toFixed(1)} ms`,
      );
    },
    [index, series, onSelect, onTiming],
  );

  const onReady = useCallback(
    (c: EChartsInstance) => {
      chart.current = c;
      const zr = c.getZr();
      zr.on('mousedown', (e) => {
        const raw = e.event as MouseEvent;
        if (raw.shiftKey || raw.button !== 0) return;
        drag.current = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
      });
      // Mouse events can arrive faster than frames; coalesce previews to one per frame.
      zr.on('mousemove', (e) => {
        if (!drag.current) return;
        drag.current = { ...drag.current, x1: e.offsetX, y1: e.offsetY };
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          if (!drag.current) return;
          setRect(drag.current);
          select(drag.current, false);
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
          onSelect(new Set(), true); // click on empty space clears
          return;
        }
        select(r, true);
      };
      zr.on('mouseup', finish);
      zr.on('globalout', finish);
    },
    [select, onSelect],
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <EChart option={option} patch={patch} onReady={onReady} />
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
            border: '1.5px solid #058b8c',
            background: 'rgba(5,139,140,0.08)',
          }}
        />
      )}
    </div>
  );
}
