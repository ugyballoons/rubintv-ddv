import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Instrument } from '../model/schema';
import type { ColumnRef } from '../model/workspace';

interface Props {
  instrument: Instrument;
  field: ColumnRef | null;
  onCancel(): void;
  onAccept(field: ColumnRef): void;
}

/** Table (CCD-level only) and numeric column shown on the focal plane. */
export function FocalColumnEditor({ instrument, field, onCancel, onAccept }: Props) {
  const tables = instrument.tables.filter(
    (t) => /^ccd/.test(t.name) && t.columns.some((c) => c.name === 'detector'),
  );
  const [table, setTable] = useState(field?.schema ?? tables[0]?.name ?? '');
  const columns =
    tables
      .find((t) => t.name === table)
      ?.columns.filter((c) => c.kind === 'number' && c.name !== 'detector') ?? [];
  const [column, setColumn] = useState(field?.name ?? columns[0]?.name ?? '');
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Focal plane column"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>Focal plane column</h3>
        {tables.length === 0 ? (
          <p className="meta warn">
            This instrument has no CCD-level table with a detector column.
          </p>
        ) : (
          <>
            <div className="field">
              <span>Table</span>
              <select
                aria-label="focal table"
                value={table}
                onChange={(e) => {
                  setTable(e.target.value);
                  setColumn(
                    tables
                      .find((t) => t.name === e.target.value)
                      ?.columns.find((c) => c.kind === 'number' && c.name !== 'detector')?.name ??
                      '',
                  );
                }}
              >
                {tables.map((t) => (
                  <option key={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>Column</span>
              <select
                aria-label="focal column"
                value={column}
                onChange={(e) => setColumn(e.target.value)}
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.unit ? ` (${c.unit})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="buttons">
          <button onClick={onCancel}>Cancel</button>
          <button
            disabled={!table || !column || !instrument.database}
            onClick={() =>
              onAccept({ name: column, schema: table, database: instrument.database! })
            }
          >
            Accept
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
