import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildBoxOption,
  clickBin,
  computeBoxBins,
  emptyBinSelection,
  navigateBins,
  selectedBinsOf,
  type AxisSpec,
  type BinSelectionState,
  type DataIdKey,
} from 'rubin-charts';
import { EChart } from './EChart';
import type { EChartsInstance } from './echarts';
import { useLatest } from './useLatest';

export interface BoxSeries {
  readonly id: string;
  readonly name: string;
  readonly main: Float64Array;
  readonly cross: Float64Array;
  readonly dataIds: readonly DataIdKey[];
  readonly color: string;
}

interface Props {
  series: readonly BoxSeries[];
  mainAxis: AxisSpec;
  crossAxis: AxisSpec;
  nBins: number;
  resetToken?: number;
  registryId?: string;
  onSelect(ids: ReadonlySet<DataIdKey>, committed: boolean): void;
}

/** Binned box chart with the same bin-selection semantics as the histogram. */
export function BoxPanel({
  series,
  mainAxis,
  crossAxis,
  nBins,
  registryId,
  resetToken,
  onSelect,
}: Props) {
  const chart = useRef<EChartsInstance | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [binSel, setBinSel] = useState<BinSelectionState>(emptyBinSelection);

  const input = useMemo(
    () => ({
      series: series.map((s) => ({
        id: s.id,
        name: s.name,
        main: s.main,
        cross: s.cross,
        color: s.color,
      })),
      mainAxis,
      crossAxis,
      nBins,
    }),
    [series, mainAxis, crossAxis, nBins],
  );
  const bins = useMemo(() => computeBoxBins({ ...input, selected: new Map() }), [input]);
  const option = useMemo(
    () => buildBoxOption({ ...input, selected: binSel.selected }, bins),
    [input, bins, binSel],
  );

  const lastEmitted = useRef<BinSelectionState>(emptyBinSelection);
  useEffect(() => {
    if (lastEmitted.current === binSel) return;
    lastEmitted.current = binSel;
    const ids = new Set<DataIdKey>();
    for (const s of series) {
      const members = bins.members.get(s.id) ?? [];
      for (const b of selectedBinsOf(binSel, s.id))
        for (const i of members[b] ?? []) ids.add(s.dataIds[i]);
    }
    onSelect(ids, true);
  }, [binSel, bins, series, onSelect]);

  const binAtPixel = useCallback(
    (px: number, py: number): { series: string; bin: number } | null => {
      const c = chart.current;
      if (!c) return null;
      const vertical = mainAxis.location === 'bottom' || mainAxis.location === 'top';
      const [dx, dy] = c.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [px, py]) as number[];
      const v = vertical ? dx : dy;
      const edges = bins.edges;
      if (!(v >= edges[0] && v <= edges[edges.length - 1])) return null;
      let b = edges.findIndex((e, i) => i < edges.length - 1 && v >= e && v < edges[i + 1]);
      if (b < 0) b = edges.length - 2;
      // Series share a bin side by side; pick by position within the bin.
      const frac = (v - edges[b]) / (edges[b + 1] - edges[b]);
      const k = Math.min(
        series.length - 1,
        Math.max(0, Math.floor(((frac - 0.1) / 0.8) * series.length)),
      );
      const s = series[k];
      return s && bins.perSeries.get(s.id)?.[b] ? { series: s.id, bin: b } : null;
    },
    [bins, mainAxis.location, series],
  );

  // Handlers are registered once; they read the latest hit-test through this ref.
  const binAtPixelRef = useLatest(binAtPixel);

  const onReady = useCallback(
    (c: EChartsInstance) => {
      chart.current = c;
      c.getZr().on('mousemove', (e) => {
        if (!host.current) return;
        const inside = c.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]);
        host.current.style.cursor = !inside
          ? 'default'
          : binAtPixelRef.current(e.offsetX, e.offsetY)
            ? 'pointer'
            : 'crosshair';
      });
      c.getZr().on('globalout', () => {
        if (host.current) host.current.style.cursor = 'default';
      });
      c.getZr().on('click', (e) => {
        host.current?.focus();
        const raw = e.event as MouseEvent;
        setBinSel((s) =>
          clickBin(s, binAtPixelRef.current(e.offsetX, e.offsetY), {
            shift: raw.shiftKey,
            cmdCtrl: raw.metaKey || raw.ctrlKey,
          }),
        );
      });
    },
    [binAtPixelRef],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setBinSel((s) =>
      navigateBins(s, e.key === 'ArrowLeft' ? 'left' : 'right', nBins, { shift: e.shiftKey }),
    );
  };

  return (
    <div
      ref={host}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`box chart of ${series.map((s) => s.name).join(', ')}`}
      style={{ width: '100%', height: '100%', outline: 'none' }}
    >
      <EChart option={option} resetToken={resetToken} registryId={registryId} onReady={onReady} />
    </div>
  );
}
