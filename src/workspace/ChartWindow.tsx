import { useCallback, useMemo } from 'react';
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
import { useSeriesData, idleEntry } from '../store/seriesData';
import { useSelection, effectiveSelection } from '../store/selection';
import { useSeriesLoader, confirmLoad, cancelLoad } from '../hooks/useSeriesLoader';
import { ScatterPanel } from '../charts/ScatterPanel';
import { HistogramPanel } from '../charts/HistogramPanel';
import { PolarPanel } from '../charts/PolarPanel';

export function ChartWindow({ window: w, client }: { window: WindowMeta; client: DdvClient }) {
  const chart = w.chart!;
  const instrument = useWorkspace((s) => s.instrument);
  const updateChart = useWorkspace((s) => s.updateChart);
  const numeric = useMemo(
    () => instrument?.tables.flatMap((t) => t.columns.filter((c) => c.kind === 'number')) ?? [],
    [instrument],
  );

  const addSeries = () => {
    if (!instrument?.database || numeric.length === 0) return;
    const fields: Partial<Record<AxisLocation, ColumnRef>> = {};
    chart.axes.forEach((a, i) => {
      const c = numeric[Math.min(i, numeric.length - 1)];
      fields[a.location] = { name: c.name, schema: c.table, database: instrument.database! };
    });
    // Flutter series ids are "<windowId>-<n>"; keep that so saved files interoperate.
    const taken = new Set(chart.series.map((s) => s.id));
    let n = chart.series.length + 1;
    while (taken.has(`${w.id}-${n}`)) n++;
    const series: SeriesConfig = {
      id: `${w.id}-${n}`,
      name: `Series ${chart.series.length + 1}`,
      fields,
      marker: { color: SERIES_COLORS[chart.series.length % SERIES_COLORS.length], size: 4 },
      query: null,
    };
    updateChart(w.id, (c) => ({
      ...c,
      series: [...c.series, series],
      axes: c.axes.map((a) =>
        isPlaceholderLabel(a.label) && fields[a.location]
          ? { ...a, label: columnRefId(fields[a.location]!) }
          : a,
      ),
    }));
  };

  const setField = (seriesId: string, location: AxisLocation, id: string) => {
    const col = numeric.find((c) => c.id === id);
    if (!col || !instrument?.database) return;
    const ref: ColumnRef = { name: col.name, schema: col.table, database: instrument.database };
    updateChart(w.id, (c) => ({
      ...c,
      series: c.series.map((s) =>
        s.id === seriesId ? { ...s, fields: { ...s.fields, [location]: ref } } : s,
      ),
      axes: c.axes.map((a) => (a.location === location ? { ...a, label: columnRefId(ref) } : a)),
    }));
  };

  const toggleAxis = (location: AxisLocation, key: 'inverted' | 'mapping') =>
    updateChart(w.id, (c) => ({
      ...c,
      axes: c.axes.map((a) =>
        a.location !== location
          ? a
          : key === 'inverted'
            ? { ...a, inverted: !a.inverted }
            : { ...a, mapping: a.mapping === 'linear' ? 'log10' : 'linear' },
      ),
    }));

  return (
    <>
      <div className="window-toolbar">
        <button onClick={addSeries} disabled={!instrument?.database} title="Add a series">
          + series
        </button>
        {chart.series.map((s) => (
          <span key={s.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                background: s.marker.color,
                display: 'inline-block',
              }}
            />
            {chart.axes.map((a) => (
              <select
                key={a.location}
                aria-label={`${s.name} ${a.location}`}
                value={s.fields[a.location] ? columnRefId(s.fields[a.location]!) : ''}
                onChange={(e) => setField(s.id, a.location, e.target.value)}
              >
                {numeric.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}
                  </option>
                ))}
              </select>
            ))}
          </span>
        ))}
        {chart.axes.map((a) => (
          <label key={a.location} title={`${a.location} axis`}>
            <input
              type="checkbox"
              checked={a.inverted}
              onChange={() => toggleAxis(a.location, 'inverted')}
            />
            invert {a.location}
            {(a.location === 'bottom' || a.location === 'left' || a.location === 'radial') && (
              <>
                <input
                  type="checkbox"
                  checked={a.mapping !== 'linear'}
                  onChange={() => toggleAxis(a.location, 'mapping')}
                />
                log
              </>
            )}
          </label>
        ))}
        {w.type === 'histogram' && (
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
        {chart.series.length === 0 ? (
          <div className="centered-note">Add a series to plot.</div>
        ) : (
          <SeriesChart window={w} client={client} />
        )}
      </div>
    </>
  );
}

/** Loads the first series (multi-series rendering comes with the series editor) and renders the panel for the window type. */
function SeriesChart({ window: w, client }: { window: WindowMeta; client: DdvClient }) {
  const chart = w.chart!;
  const series = chart.series[0];
  useSeriesLoader(client, series, chart.useGlobalQuery);
  const entry = useSeriesData((s) => s.entries[series.id] ?? idleEntry);
  const selected = useSelection(effectiveSelection);
  const setSelection = useSelection((s) => s.setSelection);
  const onSelect = useCallback(
    (ids: ReadonlySet<DataIdKey>, committed: boolean) => setSelection(ids, committed, w.id),
    [setSelection, w.id],
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
  const column = (location: AxisLocation) => {
    const ref = series.fields[location];
    return ref ? entry.data?.columns[columnRefId(ref)] : undefined;
  };

  const spec = useMemo<SeriesSpec | null>(() => {
    if (!entry.data) return null;
    const [ax, ay] =
      w.type === 'histogram' ? ['bottom', 'bottom'] : chart.axes.map((a) => a.location);
    const x = column(ax as AxisLocation);
    const y = column(ay as AxisLocation);
    if (!(x instanceof Float64Array) || !(y instanceof Float64Array)) return null;
    return {
      id: series.id,
      name: series.name,
      x,
      y,
      dataIds: entry.data.dataIds,
      marker: series.marker,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.data, series, chart.axes, w.type]);

  if (entry.status === 'confirm') {
    return (
      <div className="confirm" role="dialog" aria-label="Large dataset warning">
        <div>
          <b>Large dataset</b>
          <p>This series has {entry.pendingRows?.toLocaleString()} rows. Load it anyway?</p>
          <div className="buttons">
            <button onClick={() => cancelLoad(series.id)}>Cancel</button>
            <button onClick={() => confirmLoad(series.id)}>Continue</button>
          </div>
        </div>
      </div>
    );
  }
  if (entry.status === 'error') return <div className="centered-note error">{entry.error}</div>;
  if (!spec)
    return (
      <div className="centered-note">
        {entry.status === 'idle' ? 'Waiting for data…' : `${entry.status}…`}
      </div>
    );

  switch (w.type) {
    case 'cartesianScatter':
      return (
        <ScatterPanel
          series={spec}
          xAxis={axisSpec('bottom')}
          yAxis={axisSpec('left')}
          selected={selected}
          onSelect={onSelect}
        />
      );
    case 'polarScatter':
      return (
        <PolarPanel
          series={spec}
          radialAxis={axisSpec('radial')}
          angularAxis={axisSpec('angular')}
          selected={selected}
        />
      );
    case 'histogram':
      return (
        <HistogramPanel
          series={{
            id: series.id,
            name: series.name,
            values: spec.x as Float64Array,
            dataIds: spec.dataIds,
            color: series.marker.color,
          }}
          mainAxis={axisSpec('bottom')}
          nBins={chart.nBins}
          onSelect={onSelect}
        />
      );
    default:
      return <div className="centered-note">{w.title} is not implemented yet.</div>;
  }
}
