import { useState } from 'react';
import type { AxisLocation } from 'rubin-charts';
import type { Instrument } from '../model/schema';
import type { AxisConfig, ColumnRef, SeriesConfig } from '../model/workspace';
import { QueryEditor } from '../query/QueryEditor';
import { describe as describeQuery } from '../model/query';

interface Props {
  instrument: Instrument;
  axes: readonly AxisConfig[];
  series: SeriesConfig;
  isNew: boolean;
  onCancel(): void;
  onAccept(series: SeriesConfig): void;
  onDelete(): void;
}

/** Tables the Flutter editor excluded from series: CCD-level rows are not unique per (day_obs, seq_num). */
const CCD_TABLE = /^ccd/;

/** Name, one column per axis, marker colour and size, and an optional per-series query. */
export function SeriesEditor({
  instrument,
  axes,
  series,
  isNew,
  onCancel,
  onAccept,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<SeriesConfig>(series);
  const [queryOpen, setQueryOpen] = useState(false);
  const tables = instrument.tables.filter((t) => !CCD_TABLE.test(t.name));
  const columnsOf = (table: string) =>
    tables
      .find((t) => t.name === table)
      ?.columns.filter((c) => c.kind === 'number' || c.kind === 'datetime') ?? [];

  const setField = (location: AxisLocation, ref: ColumnRef) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [location]: ref } }));
  const complete = axes.every((a) => draft.fields[a.location]) && draft.name.trim() !== '';

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog series-dialog"
        role="dialog"
        aria-label={isNew ? 'New series' : `Edit ${series.name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>{isNew ? 'New series' : 'Edit series'}</h3>
        <label className="field">
          <span>Name</span>
          <input
            aria-label="series name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        {axes.map((a) => {
          const ref = draft.fields[a.location];
          const table = ref?.schema ?? tables[0]?.name ?? '';
          return (
            <div className="field" key={a.location}>
              <span>{a.location} axis</span>
              <select
                aria-label={`${a.location} table`}
                value={table}
                onChange={(e) => {
                  const first = columnsOf(e.target.value)[0];
                  if (first)
                    setField(a.location, {
                      name: first.name,
                      schema: e.target.value,
                      database: instrument.database!,
                    });
                }}
              >
                {tables.map((t) => (
                  <option key={t.name}>{t.name}</option>
                ))}
              </select>
              <select
                aria-label={`${a.location} column`}
                value={ref?.name ?? ''}
                onChange={(e) =>
                  setField(a.location, {
                    name: e.target.value,
                    schema: table,
                    database: instrument.database!,
                  })
                }
              >
                {!ref && <option value="">choose a column</option>}
                {columnsOf(table).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.unit ? ` (${c.unit})` : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        <div className="field">
          <span>Marker</span>
          <input
            type="color"
            aria-label="marker colour"
            value={draft.marker.color}
            onChange={(e) =>
              setDraft({ ...draft, marker: { ...draft.marker, color: e.target.value } })
            }
          />
          <input
            type="number"
            aria-label="marker size"
            min={1}
            max={20}
            value={draft.marker.size}
            style={{ width: 56 }}
            onChange={(e) =>
              setDraft({
                ...draft,
                marker: { ...draft.marker, size: Math.max(1, Number(e.target.value) || 1) },
              })
            }
          />
          <span className="meta">px</span>
        </div>
        <div className="field">
          <span>Query</span>
          <button onClick={() => setQueryOpen(true)}>
            {draft.query ? 'Edit query' : 'Add query'}
          </button>
          <span className="meta">{draft.query ? describeQuery(draft.query) : 'none'}</span>
          {draft.query && (
            <button className="danger" onClick={() => setDraft({ ...draft, query: null })}>
              clear
            </button>
          )}
        </div>
        <div className="buttons">
          {!isNew && (
            <button className="danger" style={{ marginRight: 'auto' }} onClick={onDelete}>
              Delete series
            </button>
          )}
          <button onClick={onCancel}>Cancel</button>
          <button disabled={!complete} onClick={() => onAccept(draft)}>
            Accept
          </button>
        </div>
        {queryOpen && (
          <QueryEditor
            instrument={instrument}
            initial={draft.query}
            title={`Query for ${draft.name || 'series'}`}
            onCancel={() => setQueryOpen(false)}
            onAccept={(q) => {
              setDraft({ ...draft, query: q });
              setQueryOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
