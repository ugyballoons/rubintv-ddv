import type { DetectorInfo, InstrumentInfo, Schema } from '../protocol/types';

export type ColumnKind = 'number' | 'string' | 'datetime' | 'boolean';

export interface Column {
  readonly name: string;
  readonly table: string;
  readonly kind: ColumnKind;
  readonly unit?: string;
  readonly description?: string;
  /** Wire name used in `load columns`: "table.column". */
  readonly id: string;
}

export interface Table {
  readonly name: string;
  readonly description?: string;
  readonly columns: readonly Column[];
}

export interface Instrument {
  readonly name: string;
  readonly detectors: readonly DetectorInfo[];
  readonly database: string | null;
  readonly tables: readonly Table[];
}

/** Maps every SDM datatype the consdb schemas use; unknown types fall back to string rather than throwing. */
export function columnKind(datatype: string): ColumnKind {
  switch (datatype.toLowerCase()) {
    case 'int':
    case 'long':
    case 'short':
    case 'float':
    case 'double':
      return 'number';
    case 'timestamp':
    case 'datetime':
    case 'date':
      return 'datetime';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

/** Tables the worker exposes in the schema but excludes from queries. */
const HIDDEN_TABLE = /flexdata/;

export function parseSchema(schema: Schema): Table[] {
  return schema.tables
    .filter((t) => !HIDDEN_TABLE.test(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      columns: t.columns.map((c) => ({
        name: c.name,
        table: t.name,
        kind: columnKind(c.datatype),
        unit: c.unit,
        description: c.description,
        id: `${t.name}.${c.name}`,
      })),
    }));
}

/**
 * The `database` is the key the worker uses for `load columns`. Real consdb
 * schemas carry their name (`cdb_lsstcam`); the sqlite test database has none,
 * and the worker registers it under the instrument name.
 */
export function parseInstrument(info: InstrumentInfo): Instrument {
  return {
    name: info.instrument,
    detectors: info.detectors,
    database: info.schema ? (info.schema.name ?? info.instrument.toLowerCase()) : null,
    tables: info.schema ? parseSchema(info.schema) : [],
  };
}

/** Instruments the Flutter toolbar offered, plus the worker's camera-less test database. */
export const KNOWN_INSTRUMENTS = [
  'testdb',
  'LSSTCam',
  'LSSTComCam',
  'LATISS',
  'LSSTComCamSim',
] as const;
