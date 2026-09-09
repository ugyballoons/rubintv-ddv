import { describe, expect, it } from 'vitest';
import { dataIdKey } from 'rubin-charts';
import { filterSeriesSpec } from './drillDown';

describe('filterSeriesSpec', () => {
  const ids = [1, 2, 3].map((s) => dataIdKey({ dayObs: 20250101, seqNum: s }));
  const spec = {
    id: 's',
    name: 's',
    x: new Float64Array([1, 2, 3]),
    y: new Float64Array([4, 5, 6]),
    dataIds: ids,
    marker: { color: '#000', size: 4 },
  };
  it('keeps only the rows in the set and returns the same object when nothing is dropped', () => {
    const f = filterSeriesSpec(spec, new Set([ids[0], ids[2]]));
    expect(Array.from(f.x as Float64Array)).toEqual([1, 3]);
    expect(Array.from(f.y)).toEqual([4, 6]);
    expect(f.dataIds).toEqual([ids[0], ids[2]]);
    expect(filterSeriesSpec(spec, new Set(ids))).toBe(spec);
  });
});
