import { describe, expect, it } from 'vitest';
import {
  andQuery,
  describeNights,
  isoToNight,
  nightList,
  nightToIso,
  nightsDayObsParam,
  nightsQuery,
} from './nights';

const inst = {
  name: 'x',
  database: 'cdb',
  detectors: [],
  tables: [
    {
      name: 'visit1_quicklook',
      columns: [
        {
          name: 'day_obs',
          table: 'visit1_quicklook',
          kind: 'number' as const,
          id: 'visit1_quicklook.day_obs',
        },
      ],
    },
  ],
};

describe('nights', () => {
  it('converts between ISO and day_obs ints', () => {
    expect(nightToIso(20260322)).toBe('2026-03-22');
    expect(isoToNight('2026-03-22')).toBe(20260322);
    expect(isoToNight('20260322')).toBe(20260322);
    expect(isoToNight('nope')).toBeNull();
  });
  it('expands ranges day by day across month ends', () => {
    expect(nightList({ kind: 'range', from: 20260228, to: 20260302 })).toEqual([
      20260228, 20260301, 20260302,
    ]);
  });
  it('describes selections', () => {
    expect(describeNights({ kind: 'single', night: 20260322 })).toBe('2026-03-22');
    expect(describeNights({ kind: 'set', nights: [1, 2, 3] })).toBe('3 nights');
  });
  it('sends single nights as day_obs and others as a query on the table own day_obs', () => {
    expect(nightsDayObsParam({ kind: 'single', night: 20260322 })).toBe('2026-03-22');
    expect(nightsQuery({ kind: 'single', night: 1 }, 'exposure', inst)).toBeNull();
    const r = nightsQuery(
      { kind: 'range', from: 20260320, to: 20260322 },
      'visit1_quicklook',
      inst,
    )!;
    expect(r).toMatchObject({
      type: 'EqualityQuery',
      field: { schema: 'visit1_quicklook', name: 'day_obs' },
      leftOperator: 'le',
      leftValue: 20260320,
      rightOperator: 'le',
      rightValue: 20260322,
    });
    const s = nightsQuery({ kind: 'set', nights: [20260320, 20260325] }, 'other', inst)!;
    expect(s).toMatchObject({ type: 'ParentQuery', operator: 'OR' });
    expect((s as any).children[0].field.schema).toBe('exposure');
  });
  it('ANDs conditions', () => {
    const a = nightsQuery({ kind: 'range', from: 1, to: 2 }, 'exposure', inst);
    expect(andQuery(null, a)).toBe(a);
    expect(andQuery(a, a)).toMatchObject({ operator: 'AND' });
  });
});
