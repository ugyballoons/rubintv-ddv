import { msToMjd, type AxisSpec } from 'rubin-charts';

/** Compact number for tooltips and readouts: integers as-is, otherwise six significant digits without trailing zeros. */
export const fmt = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, '');

/** UTC milliseconds as the worker's wire form, "YYYY-MM-DD HH:MM:SS[.fff]" (TAI in consdb, no zone). */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .replace(/(\.000)?Z$/, '');
}

/**
 * A value in the units of an axis, as the user should read it: a category
 * label, a date (or MJD when the axis is labelled so), a whole number on an
 * integer axis (a hover position is rounded to the nearest one), else `fmt`.
 */
export function formatValue(v: number, axis: AxisSpec): string {
  if (axis.kind === 'category')
    return axis.categories?.[Math.round(v)] ?? (Number.isFinite(v) ? fmt(v) : '');
  if (axis.kind === 'datetime') return axis.mjdLabels ? msToMjd(v).toFixed(5) : formatTimestamp(v);
  if (!Number.isFinite(v)) return '';
  return axis.integer ? String(Math.round(v)) : fmt(v);
}

/**
 * Label for a bin [lo, hi). Integer bins have half-integer edges, so the label
 * names the whole values they hold: "3" or "3 – 5".
 */
export function formatBinRange(lo: number, hi: number, axis: AxisSpec): string {
  if (axis.kind === 'number' && axis.integer) {
    const first = Math.ceil(lo);
    const last = Math.ceil(hi) - 1;
    return first >= last ? String(first) : `${first} – ${last}`;
  }
  return `${formatValue(lo, axis)} – ${formatValue(hi, axis)}`;
}
