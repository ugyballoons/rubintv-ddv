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
import { ChartTooltip, fmt, type TooltipData } from './ChartTooltip';

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
  resetToken?: number;
  registryId?: string;
  /** Rows selected anywhere; shown as inner bars. */
  selected?: ReadonlySet<DataIdKey>;
  onSelect(ids: ReadonlySet<DataIdKey>, committed: boolean): void;
  onInfo?(msg: string): void;
}

type BinHit = { series: string; bin: number } | null;

/**
 * Histogram with the Flutter bin-selection semantics: click, cmd/ctrl-click
 * toggle, shift-click range, arrow keys with wrap-around, shift+arrow extend.
 * The state machine lives in rubin-charts; this component maps mouse and key
 * events to it and resolves selected bins to DataIds for the shared selection.
 */
export function HistogramPanel({
  series,
  mainAxis,
  nBins,
  registryId,
  resetToken,
  onSelect,
  onInfo,
  selected,
}: Props) {
  const chart = useRef<EChartsInstance | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [binSel, setBinSel] = useState<BinSelectionState>(emptyBinSelection);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Handlers are registered once; they read the latest hit-test through these refs.
  const binAtPixelRef = useRef<(px: number, py: number) => BinHit>(() => null);
  const tooltipAtRef = useRef<(px: number, py: number) => TooltipData | null>(() => null);

  const input = useMemo(
    () => ({
      series: series.map((s) => ({ id: s.id, name: s.name, values: s.values, color: s.color })),
      mainAxis,
      nBins,
    }),
    [series, mainAxis, nBins],
  );
  const bins = useMemo(() => computeHistogramBins({ ...input, selected: new Map() }), [input]);
  // Rows selected in any chart, counted per bin, for the inner bars.
  const selectedCounts = useMemo(() => {
    if (!selected || selected.size === 0) return undefined;
    const out = new Map<string, Uint32Array>();
    for (const s of series) {
      const members = bins.perSeries.get(s.id)?.members ?? [];
      const counts = new Uint32Array(members.length);
      members.forEach((idx, b) => {
        let n = 0;
        for (const i of idx) if (selected.has(s.dataIds[i])) n++;
        counts[b] = n;
      });
      out.set(s.id, counts);
    }
    return out;
  }, [selected, series, bins]);
  const option = useMemo(
    () => buildHistogramOption({ ...input, selected: binSel.selected, selectedCounts }, bins),
    [input, bins, binSel, selectedCounts],
  );
  const binLabel = (b: number) =>
    mainAxis.kind === 'category' && mainAxis.categories
      ? (mainAxis.categories[b] ?? String(b))
      : `${fmt(bins.edges[b])} – ${fmt(bins.edges[b + 1])}`;

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
    (px: number, py: number): BinHit => {
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
      let hit: BinHit = null;
      for (const s of series) {
        const counts = bins.perSeries.get(s.id)?.counts;
        if (counts && count <= counts[b]) hit = { series: s.id, bin: b };
      }
      return hit;
    },
    [bins, mainAxis.location, series],
  );
  binAtPixelRef.current = binAtPixel;
  tooltipAtRef.current = (px, py) => {
    const hit = binAtPixel(px, py);
    if (!hit) return null;
    const s = series.find((x) => x.id === hit.series)!;
    const counts = bins.perSeries.get(s.id)!.counts;
    return {
      x: px,
      y: py,
      title: s.name,
      entries: [
        { label: 'bin', value: binLabel(hit.bin) },
        { label: 'count', value: counts[hit.bin].toLocaleString() },
      ],
    };
  };

  const onReady = useCallback((c: EChartsInstance) => {
    chart.current = c;
    const zr = c.getZr();
    zr.on('click', (e) => {
      host.current?.focus();
      const raw = e.event as MouseEvent;
      setBinSel((s) =>
        clickBin(s, binAtPixelRef.current(e.offsetX, e.offsetY), {
          shift: raw.shiftKey,
          cmdCtrl: raw.metaKey || raw.ctrlKey,
        }),
      );
    });
    zr.on('mousemove', (e) => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      setTooltip(null);
      const px = e.offsetX;
      const py = e.offsetY;
      tooltipTimer.current = setTimeout(() => setTooltip(tooltipAtRef.current(px, py)), 500);
    });
    zr.on('globalout', () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
      setTooltip(null);
    });
  }, []);

  useEffect(
    () => () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    },
    [],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setBinSel((s) =>
      navigateBins(s, e.key === 'ArrowLeft' ? 'left' : 'right', bins.edges.length - 1, {
        shift: e.shiftKey,
      }),
    );
  };

  return (
    <div
      ref={host}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`histogram of ${series.map((s) => s.name).join(', ')}`}
      style={{ width: '100%', height: '100%', outline: 'none', position: 'relative' }}
    >
      <EChart option={option} resetToken={resetToken} registryId={registryId} onReady={onReady} />
      <ChartTooltip data={tooltip} />
    </div>
  );
}
