import { dataIdKey, type DataIdKey } from 'rubin-charts';
import type { TableColumns } from '../protocol/types';

export interface NumericSeriesData {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly dataIds: readonly DataIdKey[];
}

/** day_obs arrives as an int (consdb) or "YYYY-MM-DD" (sqlite test database). */
export function dayObsToInt(v: number | string): number {
  if (typeof v === 'number') return v;
  return Number(v.replace(/-/g, ''));
}

/** Convert a columnar reply into typed arrays plus one DataId key per row. */
export function toNumericSeries(reply: TableColumns, xId: string, yId: string): NumericSeriesData {
  const xs = reply.data[xId];
  const ys = reply.data[yId];
  const days = reply.data.day_obs;
  const seqs = reply.data.seq_num;
  if (!xs || !ys) throw new Error(`reply lacks ${!xs ? xId : yId}`);
  const n = xs.length;
  if (ys.length !== n || days.length !== n || seqs.length !== n) {
    throw new Error('columnar reply has unequal column lengths');
  }
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const dataIds: DataIdKey[] = new Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = Number(xs[i]);
    y[i] = Number(ys[i]);
    dataIds[i] = dataIdKey({ dayObs: dayObsToInt(days[i]), seqNum: seqs[i] });
  }
  return { x, y, dataIds };
}
