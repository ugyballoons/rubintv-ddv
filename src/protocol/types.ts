/**
 * Wire protocol between the browser and the rubintv_analysis_service worker,
 * relayed verbatim by the RubinTV broker. See docs/MIGRATION_PLAN.md §2.4.
 */

export interface Command {
  name: string;
  parameters: Record<string, unknown>;
  requestId?: string;
}

export interface Envelope<T = unknown> {
  type: string;
  content: T;
  requestId?: string;
}

export interface ErrorContent {
  error: string;
  description: string;
  traceback?: string;
}

export interface DetectorInfo {
  id: number;
  name: string;
  corners: [number, number][];
}

export interface SchemaColumn {
  name: string;
  datatype: string;
  unit?: string;
  description?: string;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  description?: string;
}

export interface Schema {
  /** Null for the sqlite test database. */
  name: string | null;
  description?: string;
  tables: SchemaTable[];
}

export interface InstrumentInfo {
  instrument: string;
  detectors: DetectorInfo[];
  /** Absent when the worker has no database connection for the instrument. */
  schema?: Schema;
}

/**
 * Columnar payload: every array has equal length; day_obs and seq_num are always
 * injected. day_obs is an int (YYYYMMDD) from consdb and a "YYYY-MM-DD" string from
 * the sqlite test database.
 */
export interface TableColumns {
  schema: string;
  columns: string[];
  data: Record<string, (number | string)[]> & { day_obs: (number | string)[]; seq_num: number[] };
}

export interface CountResult {
  schema: string;
  columns: string[];
  data: Record<string, number>;
}

export type QueryOperator =
  'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'startswith' | 'endswith' | 'contains';

export interface EqualityQueryJson {
  type: 'EqualityQuery';
  id: string;
  field: { name: string; schema: string; database: string };
  leftOperator?: QueryOperator;
  leftValue?: number | string;
  rightOperator?: QueryOperator;
  rightValue?: number | string;
}

export interface ParentQueryJson {
  type: 'ParentQuery';
  id: string;
  operator: 'AND' | 'OR' | 'XOR' | 'NOT';
  children: QueryJson[];
}

export type QueryJson = EqualityQueryJson | ParentQueryJson;

export interface LoadColumnsParams {
  database: string;
  columns: string[];
  query?: QueryJson | null;
  global_query?: QueryJson | null;
  data_ids?: [number, number][] | null;
  day_obs?: string | null;
  is_new_plot?: boolean | null;
}
