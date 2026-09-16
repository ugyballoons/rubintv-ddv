import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import {
  buildPolarOption,
  mappingFor,
  PointIndex,
  polarSelectionOverlaySeries,
  type AngleUnit,
  type AxisSpec,
  type DataIdKey,
  type SeriesSpec,
} from 'rubin-charts';
import { EChart } from './EChart';
import type { EChartsInstance } from './echarts';
import { useLatest } from './useLatest';
import {
  angleIntervals,
  normalizeAngle,
  screenAngle,
  sectorPath,
  unwrapDelta,
  type PolarGeometry,
} from './polarSelect';

interface Props {
  /** x = angle, y = radius. */
  series: readonly SeriesSpec[];
  radialAxis: AxisSpec;
  angularAxis: AxisSpec;
  angleUnit?: AngleUnit;
  selected: ReadonlySet<DataIdKey>;
  resetToken?: number;
  registryId?: string;
  onSelect?(ids: ReadonlySet<DataIdKey>, committed: boolean): void;
  /** Cursor position as radius (x) and angle (y) in data units, or null when the cursor leaves the plot. */
  onHover?(coords: { x: number; y: number } | null): void;
}

/** A drag in progress: its ends in pixels and the angle swept so far about the centre. */
interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Screen degrees swept since mousedown, clockwise positive, clamped to a full turn. */
  sweep: number;
  /** Screen angle of the last mouse position, to unwrap the next delta. */
  last: number;
  geo: PolarGeometry;
}

// ECharts resolves `polarIndex` at runtime, but its ModelFinder type omits it.
const POLAR = { polarIndex: 0 } as unknown as Parameters<EChartsInstance['containPixel']>[0];

/** Centre and outer radius of the polar area, from the coordinate system ECharts laid out. */
function polarGeometry(c: EChartsInstance): PolarGeometry | null {
  const model = (
    c as unknown as {
      getModel(): { getComponent(name: string): { coordinateSystem?: PolarGeometry } | undefined };
    }
  ).getModel();
  const cs = model.getComponent('polar')?.coordinateSystem;
  return cs ? { cx: cs.cx, cy: cs.cy, r: cs.r } : null;
}

function dragPath(d: Drag): string {
  const r0 = Math.hypot(d.x0 - d.geo.cx, d.y0 - d.geo.cy);
  const r1 = Math.hypot(d.x1 - d.geo.cx, d.y1 - d.geo.cy);
  return sectorPath(d.geo, r0, r1, screenAngle(d.geo, d.x0, d.y0), d.sweep);
}

/**
 * Polar scatter with sector drag-select: the drag's two ends set the radial
 * band and the angle swept about the centre sets the arc, so dragging all the
 * way round selects a full annulus. Hit-testing uses the KDBush index in
 * (angle, radius) space; ECharts only draws.
 */
export function PolarPanel({
  series,
  radialAxis,
  angularAxis,
  angleUnit,
  selected,
  registryId,
  resetToken,
  onSelect,
  onHover,
}: Props) {
  const chart = useRef<EChartsInstance | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const [sector, setSector] = useState<string | null>(null);
  const onSelectRef = useLatest(onSelect);
  const onHoverRef = useLatest(onHover);

  const option = useMemo(
    () =>
      buildPolarOption({
        series,
        radialAxis,
        angularAxis,
        angleUnit,
        selected: new Set(),
        drillDown: null,
      }),
    [series, radialAxis, angularAxis, angleUnit],
  );
  const patch = useMemo<EChartsCoreOption>(
    () => ({ series: [polarSelectionOverlaySeries(series, selected, angleUnit)] }),
    [series, selected, angleUnit],
  );

  // The index holds angles in degrees on [0, 360), matching what ECharts reports for a pixel.
  const toDegrees = angleUnit === 'radians' ? 180 / Math.PI : 1;
  const radialMap = mappingFor(radialAxis.mapping);
  const indexes = useMemo(
    () =>
      series.map((s) => {
        const x = s.x as Float64Array;
        const angles = new Float64Array(x.length);
        for (let i = 0; i < x.length; i++) angles[i] = normalizeAngle(x[i] * toDegrees);
        return new PointIndex(angles, s.y, mappingFor('linear'), radialMap);
      }),
    [series, toDegrees, radialMap],
  );
  // Data angle grows clockwise on screen unless the axis is inverted (buildPolarOption).
  const clockwise = !angularAxis.inverted;

  const select = useCallback(
    (d: Drag, committed: boolean) => {
      const c = chart.current;
      if (!c) return;
      const [ra, thetaA] = c.convertFromPixel(POLAR, [d.x0, d.y0]);
      const [rb] = c.convertFromPixel(POLAR, [d.x1, d.y1]);
      const rMin = Math.min(ra, rb);
      const rMax = Math.max(ra, rb);
      const ids = new Set<DataIdKey>();
      indexes.forEach((index, k) => {
        for (const [a0, a1] of angleIntervals(thetaA, clockwise ? d.sweep : -d.sweep))
          for (const i of index.rangeInData(a0, rMin, a1, rMax)) ids.add(series[k].dataIds[i]);
      });
      onSelectRef.current?.(ids, committed);
    },
    [indexes, series, clockwise, onSelectRef],
  );
  const selectRef = useLatest(select);

  const hover = useCallback(
    (px: number, py: number) => {
      const c = chart.current;
      if (!c) return;
      const inside = c.containPixel(POLAR, [px, py]);
      if (host.current) host.current.style.cursor = inside ? 'crosshair' : 'default';
      if (!inside) {
        onHoverRef.current?.(null);
        return;
      }
      const [r, theta] = c.convertFromPixel(POLAR, [px, py]);
      onHoverRef.current?.({ x: r, y: theta / toDegrees });
    },
    [toDegrees, onHoverRef],
  );
  const hoverRef = useLatest(hover);

  const onReady = useCallback(
    (c: EChartsInstance) => {
      chart.current = c;
      const zr = c.getZr();
      zr.on('mousedown', (e) => {
        const raw = e.event as MouseEvent;
        if (raw.shiftKey || raw.button !== 0) return;
        const geo = polarGeometry(c);
        if (!geo) return;
        const last = screenAngle(geo, e.offsetX, e.offsetY);
        drag.current = {
          x0: e.offsetX,
          y0: e.offsetY,
          x1: e.offsetX,
          y1: e.offsetY,
          sweep: 0,
          last,
          geo,
        };
      });
      // Mouse events can arrive faster than frames; coalesce previews to one per frame.
      zr.on('mousemove', (e) => {
        const d = drag.current;
        if (!d) {
          hoverRef.current(e.offsetX, e.offsetY);
          return;
        }
        const last = screenAngle(d.geo, e.offsetX, e.offsetY);
        const sweep = Math.max(-360, Math.min(360, d.sweep + unwrapDelta(d.last, last)));
        drag.current = { ...d, x1: e.offsetX, y1: e.offsetY, sweep, last };
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const cur = drag.current;
          if (!cur) return;
          setSector(dragPath(cur));
          selectRef.current(cur, false);
        });
      });
      const finish = () => {
        const d = drag.current;
        drag.current = null;
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
          frame.current = null;
        }
        setSector(null);
        if (!d) return;
        if (Math.abs(d.x1 - d.x0) < 3 && Math.abs(d.y1 - d.y0) < 3) {
          onSelectRef.current?.(new Set(), true); // click on empty space clears
          return;
        }
        selectRef.current(d, true);
      };
      zr.on('mouseup', finish);
      zr.on('globalout', () => {
        if (host.current) host.current.style.cursor = 'default';
        finish();
        onHoverRef.current?.(null);
      });
    },
    [onSelectRef, onHoverRef, hoverRef, selectRef],
  );

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
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
      {sector && (
        <svg
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <path
            d={sector}
            fillRule="evenodd"
            fill="rgba(5,139,140,0.08)"
            stroke="var(--accent)"
            strokeWidth={1.5}
          />
        </svg>
      )}
    </div>
  );
}
