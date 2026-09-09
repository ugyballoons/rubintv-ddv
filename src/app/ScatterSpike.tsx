import { useCallback, useMemo, useState } from 'react';
import type { AxisSpec, DataIdKey, SeriesSpec } from 'rubin-charts';
import type { DdvClient } from '../protocol/client';
import { countRows, loadColumns } from '../protocol/commands';
import { toNumericSeries } from '../model/columns';
import { useWorkspace } from '../store/workspace';
import { ScatterPanel } from '../charts/ScatterPanel';

const ROW_CONFIRM_THRESHOLD = 100_000;

interface Loaded {
  a: SeriesSpec;
  b: SeriesSpec;
}

/**
 * Phase-0 spike: two scatters of the same rows (x1/y and x2/y) sharing one
 * selection keyed by DataId. Dragging on either highlights the other live.
 */
export function ScatterSpike({ client }: { client: DdvClient }) {
  const instrument = useWorkspace((s) => s.instrument);
  const numeric = useMemo(
    () => instrument?.tables.flatMap((t) => t.columns.filter((c) => c.kind === 'number')) ?? [],
    [instrument],
  );
  const [x1, setX1] = useState('exposure.ra');
  const [x2, setX2] = useState('exposure.obs_start_mjd');
  const [yId, setY] = useState('exposure.dec');
  const [x1Log, setX1Log] = useState(false);
  const [yInverted, setYInverted] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<DataIdKey>>(new Set());
  const [status, setStatus] = useState('');
  const [timing, setTiming] = useState('');

  const load = useCallback(async () => {
    if (!instrument?.database) return;
    const params = { database: instrument.database, columns: [x1, x2, yId] };
    setStatus('counting…');
    const t0 = performance.now();
    const n = await countRows(client, params);
    if (n > ROW_CONFIRM_THRESHOLD && !window.confirm(`Load ${n.toLocaleString()} rows?`)) {
      setStatus('cancelled');
      return;
    }
    setStatus(`loading ${n.toLocaleString()} rows…`);
    const reply = await loadColumns(client, params);
    const t1 = performance.now();
    const a = toNumericSeries(reply, x1, yId);
    const b = toNumericSeries(reply, x2, yId);
    const marker = { color: '#058b8c', size: 4 };
    setLoaded({
      a: { id: 'a', name: `${yId} vs ${x1}`, x: a.x, y: a.y, dataIds: a.dataIds, marker },
      b: { id: 'b', name: `${yId} vs ${x2}`, x: b.x, y: b.y, dataIds: b.dataIds, marker },
    });
    setSelected(new Set());
    setStatus(
      `${a.x.length.toLocaleString()} rows in ${((t1 - t0) / 1000).toFixed(2)} s fetch + ${(performance.now() - t1).toFixed(0)} ms convert`,
    );
  }, [client, instrument, x1, x2, yId]);

  const axis = (
    location: 'bottom' | 'left',
    label: string,
    log: boolean,
    inverted: boolean,
  ): AxisSpec => ({
    location,
    label,
    mapping: log ? 'log10' : 'linear',
    inverted,
    kind: 'number',
  });
  const xAxisA = useMemo(() => axis('bottom', x1, x1Log, false), [x1, x1Log]);
  const xAxisB = useMemo(() => axis('bottom', x2, false, false), [x2]);
  const yAxis = useMemo(() => axis('left', yId, false, yInverted), [yId, yInverted]);

  const onSelect = useCallback((ids: ReadonlySet<DataIdKey>) => setSelected(ids), []);

  if (!instrument?.database) return null;
  const pick = (value: string, set: (v: string) => void, label: string) => (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        {numeric.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section style={{ marginTop: 20 }}>
      <div
        style={{
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        <b>Linked scatter spike</b>
        {pick(x1, setX1, 'x1')}
        {pick(x2, setX2, 'x2')}
        {pick(yId, setY, 'y')}
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={x1Log} onChange={(e) => setX1Log(e.target.checked)} /> log
          x1
        </label>
        <label style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={yInverted}
            onChange={(e) => setYInverted(e.target.checked)}
          />{' '}
          invert y
        </label>
        <button onClick={() => void load()}>Load</button>
      </div>
      {/* Fixed-height status line so the charts never shift when text appears. */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          height: 20,
          fontSize: 13,
          color: '#4b5c64',
          alignItems: 'center',
        }}
      >
        <span data-testid="spike-status">{status}</span>
        <span data-testid="spike-selected">
          {loaded ? `selected ${selected.size.toLocaleString()}` : ''}
        </span>
        <span
          data-testid="spike-timing"
          style={{ fontFamily: 'monospace', fontSize: 12, color: '#7a8a91' }}
        >
          {timing}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#7a8a91' }}>
          drag selects · click clears · scroll pans · shift+scroll zooms
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, height: 440 }}>
        {(['a', 'b'] as const).map((k) => (
          <div
            key={k}
            style={{ border: '1px solid #d3dcde', borderRadius: 6, minWidth: 0 }}
            data-testid={`panel-${k}`}
          >
            {loaded && (
              <ScatterPanel
                series={loaded[k]}
                xAxis={k === 'a' ? xAxisA : xAxisB}
                yAxis={yAxis}
                selected={selected}
                onSelect={onSelect}
                onTiming={setTiming}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
