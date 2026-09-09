import type { DataIdKey, SeriesSpec } from 'rubin-charts';

/** Keep only the rows whose DataId is in `keep`; used by every chart while a drill-down is active. */
export function filterSeriesSpec(spec: SeriesSpec, keep: ReadonlySet<DataIdKey>): SeriesSpec {
  const idx: number[] = [];
  for (let i = 0; i < spec.dataIds.length; i++) if (keep.has(spec.dataIds[i])) idx.push(i);
  if (idx.length === spec.dataIds.length) return spec;
  const y = new Float64Array(idx.length);
  idx.forEach((j, k) => (y[k] = spec.y[j]));
  let x: Float64Array | string[];
  if (spec.x instanceof Float64Array) {
    const out = new Float64Array(idx.length);
    idx.forEach((j, k) => (out[k] = (spec.x as Float64Array)[j]));
    x = out;
  } else {
    x = idx.map((j) => (spec.x as readonly string[])[j]);
  }
  return { ...spec, x, y, dataIds: idx.map((j) => spec.dataIds[j]) };
}
