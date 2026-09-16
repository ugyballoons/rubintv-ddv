import { assignYAxes, type AxisLocation, type YAxisIndex } from 'rubin-charts';
import type { Instrument } from './schema';
import { columnRefId, type ColumnRef, type SeriesConfig } from './workspace';

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
  const onSecondary = refs.filter((_, i) => assignment.index[i] === 1);
  const columns = [...new Set(onSecondary.map(columnRefId))];
  // One column names the axis; several (sharing a unit) are named by that unit.
  const secondaryLabel =
    columns.length === 0
      ? null
      : columns.length === 1
        ? columns[0]
        : quantityKey(onSecondary[0], instrument).replace(/^unit:/, '');
  return {
    index,
    secondaryLabel,
    overflow: assignment.overflow.map((i) => withField[i].name),
  };
}
