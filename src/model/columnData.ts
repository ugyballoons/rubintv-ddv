import type { AxisSpec } from 'rubin-charts';
import type { ColumnKind } from './schema';

/** consdb timestamps arrive as "YYYY-MM-DD HH:MM:SS[.fff]" (TAI/UTC, no zone) or ISO strings. */
export function parseTimestampMs(v: string | number): number {
  if (typeof v === 'number') return v;
  const iso = /^\d{4}-\d{2}-\d{2} /.test(v) ? v.replace(' ', 'T') : v;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? NaN : ms;
}

export interface PlottableColumn {
  readonly values: Float64Array;
  readonly kind: 'number' | 'datetime' | 'category';
  /** Category labels when kind is 'category'; values are indices into it. */
  readonly categories?: readonly string[];
}

/** Turn a loaded column into numbers a chart can plot: datetimes as ms, strings as category indices. */
export function toPlottable(column: Float64Array | string[], kind: ColumnKind): PlottableColumn {
  if (column instanceof Float64Array)
    return { values: column, kind: kind === 'datetime' ? 'datetime' : 'number' };
  if (kind === 'datetime')
    return { values: Float64Array.from(column, parseTimestampMs), kind: 'datetime' };
  const categories = [...new Set(column)].sort();
  const index = new Map(categories.map((c, i) => [c, i]));
  return { values: Float64Array.from(column, (c) => index.get(c)!), kind: 'category', categories };
}

/** Axis spec for a plotted column: kind and categories follow the data, the rest the chart config. */
export function axisFor(
  base: AxisSpec,
  col: PlottableColumn | undefined,
  mjdLabels: boolean,
): AxisSpec {
  if (!col) return base;
  return {
    ...base,
    kind: col.kind,
    ...(col.kind === 'category' && { categories: col.categories, mapping: 'linear' as const }),
    ...(col.kind === 'datetime' && { mapping: 'linear' as const, mjdLabels }),
  };
}
