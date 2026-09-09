import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildHistogramOption,
  clickBin,
  computeHistogramBins,
  emptyBinSelection,
  navigateBins,
  selectedBinsOf,
  type AxisSpec,
  type BinSelectionState,
  type DataIdKey,
} from 'rubin-charts';
import { EChart } from './EChart';
import type { EChartsInstance } from './echarts';

export interface HistogramSeries {
  readonly id: string;
  readonly name: string;
  readonly values: Float64Array;
  readonly dataIds: readonly DataIdKey[];
  readonly color: string;
}

interface Props {
  series: readonly HistogramSeries[];
  mainAxis: AxisSpec;
  nBins: number;
  onSelect(ids: ReadonlySet<DataIdKey>, committed: boolean): void;
  onInfo?(msg: string): void;
}

/**
 * Histogram with the Flutter bin-selection semantics: click, cmd/ctrl-click
 * toggle, shift-click range, arrow keys with wrap-around, shift+arrow extend.
 * The state machine lives in rubin-charts; this component maps mouse and key
 * events to it and resolves selected bins to DataIds for the shared selection.
 */
export function HistogramPanel({ series, mainAxis, nBins, onSelect, onInfo }: Props) {
  const chart = useRef<EChartsInstance | null>(null);
  const [binSel, setBinSel] = useState<BinSelectionState>(emptyBinSelection);
  const host = useRef<HTMLDivElement>(null);
  // The click handler is registered once; it reads the latest hit-test through this ref.
  const binAtPixelRef = useRef<(px: number, py: number) => { series: string; bin: number } | null>(
    () => null,
  );

  const input = useMemo(
    () => ({
      series: series.map((s) => ({ id: s.id, name: s.name, values: s.values, color: s.color })),
      mainAxis,
      nBins,
    }),
    [series, mainAxis, nBins],
  );
  const bins = useMemo(() => computeHistogramBins({ ...input, selected: new Map() }), [input]);
  const option = useMemo(
    () => buildHistogramOption({ ...input, selected: binSel.selected }, bins),
    [input, bins, binSel],
  );

  // Resolve the selected bins to DataIds whenever the bin selection changes.
  const lastEmitted = useRef<BinSelectionState>(emptyBinSelection);
  useEffect(() => {
    if (lastEmitted.current === binSel) return;
    lastEmitted.current = binSel;
    const ids = new Set<DataIdKey>();
    const labels: string[] = [];
    for (const s of series) {
      const members = bins.perSeries.get(s.id)?.members ?? [];
      const sel = selectedBinsOf(binSel, s.id);
      for (const b of sel) for (const i of members[b] ?? []) ids.add(s.dataIds[i]);
      if (sel.length) labels.push(`${s.name}: ${sel.join(',')}`);
    }
    onSelect(ids, true);
    onInfo?.(`${labels.join(' · ') || 'no bins'} → ${ids.size.toLocaleString()} rows`);
  }, [binSel, bins, series, onSelect, onInfo]);

  const binAtPixel = useCallback(
    (px: number, py: number): { series: string; bin: number } | null => {
      const c = chart.current;
      if (!c) return null;
      const vertical = mainAxis.location === 'bottom' || mainAxis.location === 'top';
      const [dx, dy] = c.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [px, py]) as number[];
      const v = vertical ? dx : dy;
      const count = vertical ? dy : dx;
      const edges = bins.edges;
      if (!(v >= edges[0] && v <= edges[edges.length - 1]) || count < 0) return null;
      let b = edges.findIndex((e, i) => i < edges.length - 1 && v >= e && v < edges[i + 1]);
      if (b < 0) b = edges.length - 2;
      // Series are drawn in order, so the last one whose bar reaches the point is on top.
      let hit: { series: string; bin: number } | null = null;
      for (const s of series) {
        const counts = bins.perSeries.get(s.id)?.counts;
        if (counts && count <= counts[b]) hit = { series: s.id, bin: b };
      }
      return hit;
    },
    [bins, mainAxis.location, series],
  );

  binAtPixelRef.current = binAtPixel;

  const onReady = useCallback((c: EChartsInstance) => {
    chart.current = c;
    c.getZr().on('click', (e) => {
      host.current?.focus();
      const raw = e.event as MouseEvent;
      const bin = binAtPixelRef.current(e.offsetX, e.offsetY);
      setBinSel((s) =>
        clickBin(s, bin, { shift: raw.shiftKey, cmdCtrl: raw.metaKey || raw.ctrlKey }),
      );
    });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const key = e.key === 'ArrowLeft' ? 'left' : 'right';
    setBinSel((s) => navigateBins(s, key, nBins, { shift: e.shiftKey }));
  };

  return (
    <div
      ref={host}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`histogram of ${series.map((s) => s.name).join(', ')}`}
      style={{ width: '100%', height: '100%', outline: 'none' }}
    >
      <EChart option={option} onReady={onReady} />
    </div>
  );
}
