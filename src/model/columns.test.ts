import { describe, expect, it } from 'vitest';
import { dayObsToInt, toNumericSeries } from './columns';

describe('columns', () => {
  it('normalises day_obs from int or dashed string', () => {
    expect(dayObsToInt(20250101)).toBe(20250101);
    expect(dayObsToInt('2025-01-01')).toBe(20250101);
  });

  it('converts a columnar reply to typed arrays with data ids', () => {
    const s = toNumericSeries(
      {
        schema: 'testdb',
        columns: ['exposure.ra', 'exposure.dec'],
        data: {
          'exposure.ra': [1, 2],
          'exposure.dec': [3, 4],
          day_obs: ['2025-01-01', 20250102],
          seq_num: [7, 8],
        },
      },
      'exposure.ra',
      'exposure.dec',
    );
    expect(Array.from(s.x)).toEqual([1, 2]);
    expect(Array.from(s.y)).toEqual([3, 4]);
    expect(s.dataIds).toEqual(['20250101:7', '20250102:8']);
  });
});

describe('exposureId', () => {
  it('follows the day_obs * 100000 + seq_num convention', async () => {
    const { exposureId } = await import('./columns');
    expect(exposureId({ dayObs: 20260713, seqNum: 13 })).toBe(2026071300013);
  });
});
