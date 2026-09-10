import { useCallback, useMemo, useRef, useState } from 'react';
import type { AxisLocation, AxisSpec, DataIdKey, SeriesSpec } from 'rubin-charts';
import type { DdvClient } from '../protocol/client';
import {
  SERIES_COLORS,
  columnRefId,
  isPlaceholderLabel,
  type ColumnRef,
  type SeriesConfig,
  type WindowMeta,
} from '../model/workspace';
import { useWorkspace } from '../store/workspace';
import { useSeriesData, idleEntry, type SeriesEntry } from '../store/seriesData';
import { useSelection, effectiveSelection } from '../store/selection';
import { filterSeriesSpec } from '../model/drillDown';
import { useSeriesLoader, confirmLoad, cancelLoad, dropLoad } from '../hooks/useSeriesLoader';
import { ScatterPanel } from '../charts/ScatterPanel';
import { HistogramPanel } from '../charts/HistogramPanel';
import { PolarPanel } from '../charts/PolarPanel';
import { BoxPanel } from '../charts/BoxPanel';
import { SeriesEditor } from './SeriesEditor';
import { AxisEditor } from './AxisEditor';
import { fmt } from '../charts/ChartTooltip';
import { axisFor, toPlottable, type PlottableColumn } from '../model/columnData';
import type { AxisConfig } from '../model/workspace';

export function ChartWindow({ window: w, client }: { window: WindowMeta; client: DdvClient }) {
  const chart = w.chart!;
  const instrument = useWorkspace((s) => s.instrument);
  const updateChart = useWorkspace((s) => s.updateChart);
  const removeData = useSeriesData((s) => s.remove);
  const [editing, setEditing] = useState<{ series: SeriesConfig; isNew: boolean } | null>(null);
  const [axesOpen, setAxesOpen] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const requestReload = useSeriesData((s) => s.requestReload);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const newSeries = (): SeriesConfig | null => {
    if (!instrument?.database) return null;
    const numeric = instrument.tables
      .filter((t) => !/^ccd/.test(t.name))
      .flatMap((t) => t.columns.filter((c) => c.kind === 'number'));
    const fields: Partial<Record<AxisLocation, ColumnRef>> = {};
    chart.axes.forEach((a, i) => {
      const c = numeric[Math.min(i, numeric.length - 1)];
      if (c) fields[a.location] = { name: c.name, schema: c.table, database: instrument.database! };
    });
    // Flutter series ids are "<windowId>-<n>"; keep that so saved files interoperate.
    const taken = new Set(chart.series.map((s) => s.id));
    let n = chart.series.length + 1;
    while (taken.has(`${w.id}-${n}`)) n++;
    return {
      id: `${w.id}-${n}`,
      name: `Series ${n}`,
      fields,
      marker: { color: SERIES_COLORS[chart.series.length % SERIES_COLORS.length], size: 4 },
      query: null,
    };
  };

  const commitSeries = (s: SeriesConfig) => {
    updateChart(w.id, (c) => {
      const exists = c.series.some((x) => x.id === s.id);
      return {
        ...c,
        series: exists ? c.series.map((x) => (x.id === s.id ? s : x)) : [...c.series, s],
        // Placeholder axis labels take the field name the first time a series is committed.
        axes: c.axes.map((a) =>
          isPlaceholderLabel(a.label) && s.fields[a.location]
            ? { ...a, label: columnRefId(s.fields[a.location]!) }
            : a,
        ),
      };
    });
    setEditing(null);
  };

  const deleteSeries = (id: string) => {
    dropLoad(id);
    removeData(id);
    updateChart(w.id, (c) => ({ ...c, series: c.series.filter((x) => x.id !== id) }));
    setEditing(null);
  };

  return (
    <>
      <div className="window-toolbar">
        <button
          onClick={() => {
            const s = newSeries();
            if (s) setEditing({ series: s, isNew: true });
          }}
          disabled={!instrument?.database}
          title="Add a series"
        >
          + series
        </button>
        <span className="legend" aria-label="series legend">
          {chart.series.map((s) => (
            <button
              key={s.id}
              onClick={() => setEditing({ series: s, isNew: false })}
              title={`Edit ${s.name}`}
            >
              <span className="swatch" style={{ background: s.marker.color }} />
              {s.name}
              {s.query && <span className="meta">⧩</span>}
            </button>
          ))}
        </span>
        {(w.type === 'cartesianScatter' || w.type === 'polarScatter') && (
          <span className="tool-switch" role="radiogroup" aria-label="cursor tool">
            <button
              role="radio"
              aria-checked={chart.tool === 'select'}
              className={chart.tool === 'select' ? 'on' : ''}
              onClick={() => updateChart(w.id, { tool: 'select' })}
              title="Drag to select points"
            >
              select
            </button>
            <button
              role="radio"
              aria-checked={chart.tool === 'drillDown'}
              className={chart.tool === 'drillDown' ? 'on' : ''}
              onClick={() => updateChart(w.id, { tool: 'drillDown' })}
              title="Drag to keep only those points in every chart (Esc clears)"
            >
              drill down
            </button>
          </span>
        )}
        <button onClick={() => setAxesOpen(true)} title="Axis labels, scales and directions">
          axes…
        </button>
        <button
          onClick={() => setResetToken((t) => t + 1)}
          title="Reset pan and zoom to fit the data"
        >
          reset axes
        </button>
        <button
          onClick={() => chart.series.forEach((s) => requestReload(s.id))}
          title="Fetch this chart's data again"
        >
          sync
        </button>
        {(w.type === 'histogram' || w.type === 'box') && (
          <label>
            bins
            <input
              type="number"
              min={1}
              max={500}
              value={chart.nBins}
              style={{ width: 52 }}
              onChange={(e) =>
                updateChart(w.id, { nBins: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
        )}
        <label title="Apply the toolbar date and global query to this chart">
          <input
            type="checkbox"
            checked={chart.useGlobalQuery}
            onChange={(e) => updateChart(w.id, { useGlobalQuery: e.target.checked })}
          />
          global query
        </label>
      </div>
      <div className="window-body">
        {chart.series.map((s) => (
          <SeriesLoader
            key={s.id}
            client={client}
            series={s}
            useGlobalQuery={chart.useGlobalQuery}
          />
        ))}
        {chart.series.length === 0 ? (
          <div className="centered-note">Add a series to plot.</div>
        ) : (
          <SeriesChart window={w} resetToken={resetToken} onHover={setHover} />
        )}
      </div>
      {chart.series.length > 0 && (
        <WindowStatus seriesIds={chart.series.map((s) => s.id)} hover={hover} axes={chart.axes} />
      )}
      {axesOpen && (
        <AxisEditor
          axes={chart.axes}
          onCancel={() => setAxesOpen(false)}
          onAccept={(axes) => {
            updateChart(w.id, { axes });
            setAxesOpen(false);
          }}
        />
      )}
      {editing && instrument && (
        <SeriesEditor
          instrument={instrument}
          axes={chart.axes}
          series={editing.series}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onAccept={commitSeries}
          onDelete={() => deleteSeries(editing.series.id)}
        />
      )}
    </>
  );
}

/** Renders nothing; keeps one series' data loaded. One per series so hooks stay unconditional. */
function SeriesLoader({
  client,
  series,
  useGlobalQuery,
}: {
  client: DdvClient;
  series: SeriesConfig;
  useGlobalQuery: boolean;
}) {
  useSeriesLoader(client, series, useGlobalQuery);
  return null;
}

function WindowStatus({
  seriesIds,
  hover,
  axes,
}: {
  seriesIds: string[];
  hover: { x: number; y: number } | null;
  axes: readonly AxisConfig[];
}) {
  const entries = useSeriesData((s) => s.entries);
  const parts = seriesIds.map((id) => {
    const e = entries[id] ?? idleEntry;
    return e.status === 'ready'
      ? `${e.data!.rowCount.toLocaleString()} rows`
      : e.status === 'error'
        ? e.error
        : e.status === 'confirm'
          ? `${e.pendingRows?.toLocaleString()} rows, awaiting confirmation`
          : `${e.status}…`;
  });
  const hasError = seriesIds.some((id) => entries[id]?.status === 'error');
  return (
    <div className="window-status" data-testid="chart-status">
      <span className={hasError ? 'error' : undefined}>{parts.join(' · ')}</span>
      {hover && (
        <span className="coords">
          {axes[0]?.label ?? 'x'} {fmt(hover.x)}
          {axes[1] && ` · ${axes[1].label} ${fmt(hover.y)}`}
        </span>
      )}
    </div>
  );
}

const EMPTY_ENTRIES: Record<string, SeriesEntry> = {};

/** Returns the previous array while its elements are shallow-equal, so it can be a single memo dependency. */
function useStableArray<T>(next: readonly T[]): readonly T[] {
  const ref = useRef<readonly T[]>(next);
  const prev = ref.current;
  const same = prev.length === next.length && prev.every((v, i) => v === next[i]);
  if (!same) ref.current = next;
  return same ? prev : next;
}

/** Renders the panel for the window type with every series whose data is ready. */
function SeriesChart({
  window: w,
  resetToken,
  onHover,
}: {
  window: WindowMeta;
  resetToken: number;
  onHover(c: { x: number; y: number } | null): void;
}) {
  const chart = w.chart!;
  const ids = chart.series.map((s) => s.id);
  const instrument = useWorkspace((s) => s.instrument);
  const entries = useSeriesData((s) => s.entries) ?? EMPTY_ENTRIES;
  const selected = useSelection(effectiveSelection);
  const drillDown = useSelection((s) => s.drillDown);
  const setSelection = useSelection((s) => s.setSelection);
  const setDrillDown = useSelection((s) => s.setDrillDown);
  const tool = chart.tool;
  // In drill-down mode a committed drag narrows every chart to the dragged points; a click clears it.
  const onSelect = useCallback(
    (sel: ReadonlySet<DataIdKey>, committed: boolean) => {
      if (tool === 'drillDown') {
        if (committed) setDrillDown(sel.size ? sel : null);
        return;
      }
      setSelection(sel, committed, w.id);
    },
    [tool, setSelection, setDrillDown, w.id],
  );

  // Keyed by value: a fresh object per render would make every panel rebuild its
  // option (and re-upload 100k points) on any store change, e.g. moving a window.
  const axisSpecs = useMemo(() => {
    const out = {} as Record<AxisLocation, AxisSpec>;
    for (const a of chart.axes)
      out[a.location] = {
        location: a.location,
        label: a.label,
        mapping: a.mapping,
        inverted: a.inverted,
        kind: 'number',
      };
    return out;
  }, [chart.axes]);
  const axisSpec = (location: AxisLocation): AxisSpec => axisSpecs[location];

  // One dependency that changes only when a series' ready data changes.
  const readyData = useStableArray(
    ids.map((id) => (entries[id]?.status === 'ready' ? entries[id].data : null)),
  );
  const columnKind = (ref: { name: string; schema: string }) =>
    instrument?.tables.find((t) => t.name === ref.schema)?.columns.find((c) => c.name === ref.name)
      ?.kind ?? 'number';
  const [ax, ay] =
    w.type === 'histogram'
      ? (['bottom', 'bottom'] as const)
      : (chart.axes.map((a) => a.location) as [AxisLocation, AxisLocation]);
  const built = useMemo(() => {
    const specs: SeriesSpec[] = [];
    let xCol: PlottableColumn | undefined;
    let yCol: PlottableColumn | undefined;
    chart.series.forEach((s, k) => {
      const data = readyData[k];
      if (!data) return;
      const col = (loc: AxisLocation): PlottableColumn | undefined => {
        const ref = s.fields[loc];
        const raw = ref ? data.columns[columnRefId(ref)] : undefined;
        return raw && ref ? toPlottable(raw, columnKind(ref)) : undefined;
      };
      const x = col(ax);
      const y = col(ay);
      if (!x || !y) return;
      // Axis kinds and category labels come from the first series that has data.
      xCol ??= x;
      yCol ??= y;
      const spec = {
        id: s.id,
        name: s.name,
        x: x.values,
        y: y.values,
        dataIds: data.dataIds,
        marker: s.marker,
      };
      specs.push(drillDown ? filterSeriesSpec(spec, drillDown) : spec);
    });
    return { specs, xCol, yCol };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.series, chart.axes, w.type, readyData, drillDown, instrument]);
  const specs = built.specs;
  const xAxisSpec = useMemo(
    () =>
      axisFor(axisSpecs[ax], built.xCol, !!chart.axes.find((a) => a.location === ax)?.mjdLabels),
    [axisSpecs, ax, built.xCol, chart.axes],
  );
  const yAxisSpec = useMemo(
    () =>
      axisFor(axisSpecs[ay], built.yCol, !!chart.axes.find((a) => a.location === ay)?.mjdLabels),
    [axisSpecs, ay, built.yCol, chart.axes],
  );

  const confirming = chart.series.find((s) => entries[s.id]?.status === 'confirm');
  if (confirming) {
    const e = entries[confirming.id];
    return (
      <div className="confirm" role="dialog" aria-label="Large dataset warning">
        <div>
          <b>Large dataset</b>
          <p>
            {confirming.name} has {e.pendingRows?.toLocaleString()} rows. Load it anyway?
          </p>
          <div className="buttons">
            <button onClick={() => cancelLoad(confirming.id)}>Cancel</button>
            <button onClick={() => confirmLoad(confirming.id)}>Continue</button>
          </div>
        </div>
      </div>
    );
  }
  if (specs.length === 0) {
    const first = entries[ids[0]];
    return (
      <div className="centered-note">
        {first?.status === 'error' ? first.error : 'Waiting for data…'}
      </div>
    );
  }

  switch (w.type) {
    case 'cartesianScatter':
      return (
        <ScatterPanel
          registryId={w.id}
          resetToken={resetToken}
          onHover={onHover}
          series={specs}
          xAxis={axisSpec('bottom')}
          yAxis={axisSpec('left')}
          selected={selected}
          onSelect={onSelect}
        />
      );
    case 'polarScatter':
      return (
        <PolarPanel
          registryId={w.id}
          resetToken={resetToken}
          series={specs}
          radialAxis={axisSpec('radial')}
          angularAxis={axisSpec('angular')}
          selected={selected}
        />
      );
    case 'histogram':
      return (
        <HistogramPanel
          registryId={w.id}
          resetToken={resetToken}
          series={specs.map((s) => ({
            id: s.id,
            name: s.name,
            values: s.x as Float64Array,
            dataIds: s.dataIds,
            color: s.marker.color,
          }))}
          mainAxis={xAxisSpec}
          nBins={chart.nBins}
          onSelect={onSelect}
        />
      );
    case 'box':
      return (
        <BoxPanel
          registryId={w.id}
          resetToken={resetToken}
          series={specs.map((s) => ({
            id: s.id,
            name: s.name,
            main: s.x as Float64Array,
            cross: s.y,
            dataIds: s.dataIds,
            color: s.marker.color,
          }))}
          mainAxis={xAxisSpec}
          crossAxis={yAxisSpec}
          nBins={chart.nBins}
          onSelect={onSelect}
        />
      );
    default:
      return <div className="centered-note">{w.title} is not implemented yet.</div>;
  }
}
