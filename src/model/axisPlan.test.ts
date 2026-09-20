import { describe, expect, it } from 'vitest';
import {
  followAxisLabels,
  planYAxes,
  quantityKey,
  sharedAxisLocation,
  sharedAxisMismatches,
} from './axisPlan';
import type { Instrument } from './schema';
import type { AxisConfig, SeriesConfig } from './workspace';

const instrument: Instrument = {
  name: 'LSSTCam',
  detectors: [],
  database: 'cdb_lsstcam',
  tables: [
    {
      name: 'visit1_quicklook',
      columns: [
        { name: 'sky_bg_median', table: 'visit1_quicklook', kind: 'number', unit: 'ct', id: 'a' },
        {
          name: 'zero_point_median',
          table: 'visit1_quicklook',
          kind: 'number',
          unit: 'mag',
          id: 'b',
        },
        { name: 'zero_point_min', table: 'visit1_quicklook', kind: 'number', unit: 'mag', id: 'c' },
        { name: 'wind_speed', table: 'visit1_quicklook', kind: 'number', id: 'd' },
        { name: 'humidity', table: 'visit1_quicklook', kind: 'number', unit: '', id: 'e' },
      ],
    },
  ],
};
const ref = (name: string) => ({ name, schema: 'visit1_quicklook', database: 'cdb_lsstcam' });
const series = (id: string, y: string): SeriesConfig => ({
  id,
  name: id,
  fields: { bottom: ref('seq_num'), left: ref(y) },
  marker: { color: '#000', size: 4 },
  query: null,
});

describe('quantityKey', () => {
  it('is the unit when the schema has one, else the column', () => {
    expect(quantityKey(ref('sky_bg_median'), instrument)).toBe('unit:ct');
    expect(quantityKey(ref('wind_speed'), instrument)).toBe('column:visit1_quicklook.wind_speed');
    expect(quantityKey(ref('humidity'), instrument)).toBe('column:visit1_quicklook.humidity');
    expect(quantityKey(ref('sky_bg_median'), null)).toBe('column:visit1_quicklook.sky_bg_median');
  });
});

describe('planYAxes', () => {
  it('keeps one quantity on the configured axis', () => {
    const plan = planYAxes(
      [series('1', 'sky_bg_median'), series('2', 'sky_bg_median')],
      'left',
      instrument,
    );
    expect([...plan.index.values()]).toEqual([0, 0]);
    expect(plan.secondaryLabel).toBeNull();
    expect(plan.overflow).toEqual([]);
  });

  it('sends the second quantity to a right axis named after its column', () => {
    const plan = planYAxes(
      [series('1', 'sky_bg_median'), series('2', 'wind_speed')],
      'left',
      instrument,
    );
    expect(plan.index.get('2')).toBe(1);
    expect(plan.secondaryLabel).toBe('visit1_quicklook.wind_speed');
  });

  it('names a shared-unit secondary axis by the unit', () => {
    const plan = planYAxes(
      [series('1', 'wind_speed'), series('2', 'zero_point_median'), series('3', 'zero_point_min')],
      'left',
      instrument,
    );
    expect(plan.index.get('2')).toBe(1);
    expect(plan.index.get('3')).toBe(1);
    expect(plan.secondaryLabel).toBe('mag');
  });

  it('reports series of a third quantity, which share the primary axis', () => {
    const plan = planYAxes(
      [series('1', 'sky_bg_median'), series('2', 'wind_speed'), series('3', 'humidity')],
      'left',
      instrument,
    );
    expect(plan.index.get('3')).toBe(0);
    expect(plan.overflow).toEqual(['3']);
  });

  it('ignores series without a field on the axis and charts without that axis', () => {
    const noY: SeriesConfig = { ...series('1', 'wind_speed'), fields: { bottom: ref('seq_num') } };
    expect(planYAxes([noY, series('2', 'sky_bg_median')], 'left', instrument).index.get('2')).toBe(
      0,
    );
    expect(
      planYAxes([series('1', 'sky_bg_median')], undefined, instrument).secondaryLabel,
    ).toBeNull();
  });
});

describe('sharedAxisMismatches', () => {
  it('reports series whose x column is a different quantity from the first series', () => {
    const mjd: SeriesConfig = {
      ...series('2', 'dec'),
      fields: { bottom: ref('wind_speed'), left: ref('dec') },
    };
    const mism = sharedAxisMismatches(
      [series('1', 'dec'), mjd, series('3', 'dec')],
      'bottom',
      instrument,
    );
    expect(mism.map((m) => [m.series.id, m.reference.id])).toEqual([['2', '1']]);
  });

  it('accepts columns of the same unit and ignores charts without the axis', () => {
    const other: SeriesConfig = {
      ...series('2', 'dec'),
      fields: { bottom: ref('zero_point_min'), left: ref('dec') },
    };
    const first: SeriesConfig = {
      ...series('1', 'dec'),
      fields: { bottom: ref('zero_point_median'), left: ref('dec') },
    };
    expect(sharedAxisMismatches([first, other], 'bottom', instrument)).toEqual([]);
    expect(sharedAxisMismatches([first, other], undefined, instrument)).toEqual([]);
  });

  it('names the angular axis for polar charts and the first axis otherwise', () => {
    const axes = [
      { location: 'radial' as const, label: 'r', mapping: 'linear' as const, inverted: false },
      { location: 'angular' as const, label: 't', mapping: 'linear' as const, inverted: false },
    ];
    expect(sharedAxisLocation('polarScatter', axes)).toBe('angular');
    expect(sharedAxisLocation('cartesianScatter', [{ ...axes[0], location: 'bottom' }])).toBe(
      'bottom',
    );
    expect(sharedAxisLocation('histogram', [])).toBeUndefined();
  });
});

describe('axis labels follow the series', () => {
  const axes: readonly AxisConfig[] = [
    { location: 'bottom', label: '<x>', mapping: 'linear', inverted: false },
    { location: 'left', label: '<y>', mapping: 'linear', inverted: true },
  ];
  const follow = (prev: SeriesConfig[], next: SeriesConfig[], a: readonly AxisConfig[] = axes) =>
    followAxisLabels(prev, next, a, 'cartesianScatter', instrument).map((x) => x.label);

  it('names axes after the first series and keeps the primary title when a second quantity joins', () => {
    const one = [series('1', 'sky_bg_median')];
    const two = [...one, series('2', 'wind_speed')];
    const named = followAxisLabels([], one, axes, 'cartesianScatter', instrument);
    expect(named.map((a) => a.label)).toEqual([
      'visit1_quicklook.seq_num',
      'visit1_quicklook.sky_bg_median',
    ]);
    expect(follow(one, two, named)).toEqual([
      'visit1_quicklook.seq_num',
      'visit1_quicklook.sky_bg_median',
    ]);
  });

  it('follows the reference series when its column changes, and names a shared unit by the unit', () => {
    const before = [series('1', 'zero_point_median'), series('2', 'wind_speed')];
    const named = followAxisLabels([], before, axes, 'cartesianScatter', instrument);
    const after = [series('1', 'zero_point_median'), series('2', 'zero_point_min')];
    expect(follow(before, after, named)[1]).toBe('mag');
    const edited = [series('1', 'humidity'), series('2', 'wind_speed')];
    expect(follow(before, edited, named)[1]).toBe('visit1_quicklook.humidity');
  });

  it('relabels when the reference series is deleted, but never a title the user typed', () => {
    const two = [series('1', 'sky_bg_median'), series('2', 'wind_speed')];
    const named = followAxisLabels([], two, axes, 'cartesianScatter', instrument);
    expect(follow(two, [two[1]], named)[1]).toBe('visit1_quicklook.wind_speed');
    const typed = named.map((a) => (a.location === 'left' ? { ...a, label: 'Sky (ADU)' } : a));
    expect(follow(two, [two[1]], typed)[1]).toBe('Sky (ADU)');
  });

  it('treats a bare column name as automatic, as Flutter-saved workspaces have', () => {
    const flutter = [
      { ...axes[0], label: 'seq_num' },
      { ...axes[1], label: 'sky_bg_median' },
    ];
    const prev = [series('1', 'sky_bg_median')];
    // Both titles follow: the x one is renamed into this app's column-id form.
    expect(follow(prev, [series('1', 'humidity')], flutter)).toEqual([
      'visit1_quicklook.seq_num',
      'visit1_quicklook.humidity',
    ]);
  });

  it('treats a label equal to a previous column id as automatic, as older files have', () => {
    const old = [
      { ...axes[0], label: 'visit1_quicklook.seq_num' },
      { ...axes[1], label: 'visit1_quicklook.sky_bg_median' },
    ];
    const prev = [series('1', 'sky_bg_median')];
    expect(follow(prev, [series('1', 'humidity')], old)[1]).toBe('visit1_quicklook.humidity');
  });
});
