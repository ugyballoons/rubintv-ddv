import { assignYAxes, type AxisLocation, type YAxisIndex } from 'rubin-charts';
import type { Instrument } from './schema';
import {
  columnRefId,
  isPlaceholderLabel,
  type AxisConfig,
  type ColumnRef,
  type SeriesConfig,
  type WindowType,
} from './workspace';

/** Chart types whose series may split across two y axes when they plot different quantities. */
export function twinAxisLocation(
  type: WindowType,
  axes: readonly AxisConfig[],
): AxisLocation | undefined {
  return type === 'cartesianScatter' || type === 'box' ? axes[1]?.location : undefined;
}

/**
 * The automatic title of an axis from the columns drawn against it: one
 * column names it; several sharing a unit are named by the unit; otherwise
 * the first (reference) column names it. Null when nothing is drawn.
 */
export function autoAxisLabel(
  refs: readonly ColumnRef[],
  instrument: Instrument | null,
): string | null {
  const columns = [...new Set(refs.map(columnRefId))];
  if (columns.length === 0) return null;
  if (columns.length === 1) return columns[0];
  const keys = new Set(refs.map((r) => quantityKey(r, instrument)));
  const [key] = keys;
  return keys.size === 1 && key.startsWith('unit:') ? key.slice('unit:'.length) : columns[0];
}

/** Automatic title per axis location for the chart's current series; the twin y axis counts only its primary group. */
export function autoAxisLabels(
  series: readonly SeriesConfig[],
  axes: readonly AxisConfig[],
  type: WindowType,
  instrument: Instrument | null,
): Partial<Record<AxisLocation, string>> {
  const twin = twinAxisLocation(type, axes);
  const plan = planYAxes(series, twin, instrument);
  const out: Partial<Record<AxisLocation, string>> = {};
  for (const a of axes) {
    const refs = series
      .filter((s) => s.fields[a.location] && (a.location !== twin || plan.index.get(s.id) !== 1))
      .map((s) => s.fields[a.location]!);
    const label = autoAxisLabel(refs, instrument);
    if (label !== null) out[a.location] = label;
  }
  return out;
}

/**
 * Axis labels after the series change from `prev` to `next`: a label still
 * automatic (the placeholder, the title the previous series produced, or a
 * previous series' column) follows the new series; a label the user typed
 * stays. Call on every series commit and deletion.
 */
export function followAxisLabels(
  prev: readonly SeriesConfig[],
  next: readonly SeriesConfig[],
  axes: readonly AxisConfig[],
  type: WindowType,
  instrument: Instrument | null,
): AxisConfig[] {
  const before = autoAxisLabels(prev, axes, type, instrument);
  const after = autoAxisLabels(next, axes, type, instrument);
  return axes.map((a) => {
    const wanted = after[a.location];
    if (wanted === undefined || wanted === a.label) return a;
    const automatic =
      isPlaceholderLabel(a.label) ||
      a.label === before[a.location] ||
      prev.some((s) => s.fields[a.location] && a.label === columnRefId(s.fields[a.location]!));
    return automatic ? { ...a, label: wanted } : a;
  });
}

/**
 * What "the same scale" means for a column: its unit when the schema gives
 * one (two magnitudes share an axis whatever their column), else the column
 * itself (two unitless columns each get their own).
 */
export function quantityKey(ref: ColumnRef, instrument: Instrument | null): string {
  const unit = instrument?.tables
    .find((t) => t.name === ref.schema)
    ?.columns.find((c) => c.name === ref.name)
    ?.unit?.trim();
  return unit ? `unit:${unit}` : `column:${columnRefId(ref)}`;
}

export interface YAxisPlan {
  /** Per series id; a series missing here is on the primary axis. */
  readonly index: ReadonlyMap<string, YAxisIndex>;
  /** Title of the secondary axis, or null when no series needs one. */
  readonly secondaryLabel: string | null;
  /** Names of series whose quantity has no axis of its own and share the primary. */
  readonly overflow: readonly string[];
}

const NO_PLAN: YAxisPlan = { index: new Map(), secondaryLabel: null, overflow: [] };

/**
 * Which y axis each series of a chart goes on, by the rubin-charts policy:
 * the first quantity keeps the configured axis, the second gets one on the
 * right, any further one shares the first and is reported.
 */
export function planYAxes(
  series: readonly SeriesConfig[],
  location: AxisLocation | undefined,
  instrument: Instrument | null,
): YAxisPlan {
  if (!location) return NO_PLAN;
  const withField = series.filter((s) => s.fields[location]);
  const refs = withField.map((s) => s.fields[location]!);
  const assignment = assignYAxes(refs.map((r) => quantityKey(r, instrument)));
  const index = new Map(withField.map((s, i) => [s.id, assignment.index[i]]));
  return {
    index,
    secondaryLabel: autoAxisLabel(
      refs.filter((_, i) => assignment.index[i] === 1),
      instrument,
    ),
    overflow: assignment.overflow.map((i) => withField[i].name),
  };
}

/**
 * The axis every series of a chart must agree on: the x-like one. Two y
 * quantities can have two scales, but the x axis is the frame that makes the
 * series comparable at all, so a different x quantity only ever overlays.
 */
export function sharedAxisLocation(
  type: WindowType,
  axes: readonly AxisConfig[],
): AxisLocation | undefined {
  return type === 'polarScatter' ? 'angular' : axes[0]?.location;
}

export interface AxisMismatch {
  /** The series with the odd column. */
  readonly series: SeriesConfig;
  /** The series whose column sets the axis' quantity. */
  readonly reference: SeriesConfig;
}

/**
 * Series whose column on the shared axis is a different quantity from the
 * first series', so they are drawn on a scale that is not theirs.
 */
export function sharedAxisMismatches(
  series: readonly SeriesConfig[],
  location: AxisLocation | undefined,
  instrument: Instrument | null,
): AxisMismatch[] {
  if (!location) return [];
  const withField = series.filter((s) => s.fields[location]);
  const reference = withField[0];
  if (!reference) return [];
  const key = quantityKey(reference.fields[location]!, instrument);
  return withField
    .slice(1)
    .filter((s) => quantityKey(s.fields[location]!, instrument) !== key)
    .map((s) => ({ series: s, reference }));
}
