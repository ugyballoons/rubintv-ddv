import { describe, expect, it } from 'vitest';
import { planYAxes, quantityKey } from './yAxes';
import type { Instrument } from './schema';
import type { SeriesConfig } from './workspace';

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
