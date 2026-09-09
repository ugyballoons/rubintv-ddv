// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseInstrument } from './schema';
import { SERIES_COLORS } from './workspace';
import {
  colorToArgb,
  argbToColor,
  parseWorkspace,
  serializeWorkspace,
  stringifyWorkspace,
  queryTreeToGraph,
  queryGraphToTree,
} from './workspaceJson';

const text = readFileSync(
  new URL('../../test/fixtures/workspace-flutter.json', import.meta.url),
  'utf8',
);
const instrument = parseInstrument({
  instrument: 'testdb',
  detectors: [],
  schema: {
    name: 'testdb',
    tables: [
      {
        name: 'exposure',
        columns: [
          { name: 'ra', datatype: 'double' },
          { name: 'dec', datatype: 'double' },
          { name: 'obs_start_mjd', datatype: 'double' },
        ],
      },
      { name: 'visit1_quicklook', columns: [{ name: 'exp_time', datatype: 'double' }] },
    ],
  },
});

describe('parseWorkspace', () => {
  const ws = parseWorkspace(text, instrument, SERIES_COLORS);

  it('reads chart windows with both fields forms, qualified tool and axis ids', () => {
    expect(Object.keys(ws.windows).sort()).toEqual(['12', '3', '8']);
    const w3 = ws.windows['3'];
    expect(w3).toMatchObject({
      type: 'cartesianScatter',
      x: 20,
      y: 20,
      width: 600,
      height: 400,
      title: 'Scatter plot',
    });
    expect(w3.chart?.series[0].fields).toEqual({
      bottom: { name: 'ra', schema: 'exposure', database: 'testdb' },
      left: { name: 'dec', schema: 'exposure', database: 'testdb' },
    });
    expect(w3.chart?.series[0].marker).toMatchObject({
      color: '#000000',
      size: 5,
      edgeColor: '#ffffff',
    });
    expect(w3.chart?.axes[1]).toMatchObject({ location: 'left', mapping: 'log10', inverted: true });
    const w8 = ws.windows['8'];
    expect(w8).toMatchObject({ type: 'histogram', title: 'Seeing histogram' });
    expect(w8.chart).toMatchObject({ nBins: 25, useGlobalQuery: false, tool: 'drillDown' });
    expect(w8.chart?.series[0].fields.bottom?.name).toBe('obs_start_mjd');
    expect(w8.chart?.axes[0].location).toBe('bottom');
  });

  it('skips windows whose columns are not in the schema, like the Flutter loader', () => {
    expect(ws.skipped).toEqual([{ id: '9', reason: 'column exposure.nope not found' }]);
  });

  it('reads focal plane windows into a focal config', () => {
    expect(ws.windows['12']).toMatchObject({ type: 'focalPlane', chart: null });
    expect(ws.windows['12'].focal).toMatchObject({
      playbackSpeed: 1,
      loop: false,
      field: { name: 'ra', schema: 'exposure' },
    });
  });

  it('reads the instrument, day and a compound global query (top-level operator)', () => {
    expect(ws.instrumentName).toBe('testdb');
    expect(ws.database).toBe('testdb');
    expect(ws.dayObs).toBe('2025-11-05');
    expect(ws.globalQuery).toMatchObject({
      type: 'ParentQuery',
      operator: 'AND',
      children: [
        { type: 'EqualityQuery', rightOperator: 'lt', rightValue: 30 },
        { type: 'EqualityQuery', leftOperator: 'gt', leftValue: -20 },
      ],
    });
  });
});

describe('real saved workspace from the Flutter app', () => {
  const real = readFileSync(
    new URL('../../test/fixtures/example_saved_workspace.json', import.meta.url),
    'utf8',
  );

  it('parses every window without a schema to validate against', () => {
    const ws = parseWorkspace(real, null, SERIES_COLORS);
    expect(ws.skipped).toEqual([]);
    expect(ws.instrumentName).toBe('LsstCam');
    expect(ws.database).toBe('cdb_lsstcam');
    expect(ws.detectors).toHaveLength(205);
    expect(ws.detectors[0].corners[0]).toHaveLength(2);
    const w1 = ws.windows['1'];
    expect(w1).toMatchObject({
      type: 'cartesianScatter',
      x: 540,
      y: 83.5,
      width: 600,
      height: 400,
    });
    expect(w1.chart?.series[0]).toMatchObject({ id: '1-1', name: 'Series-1' });
    expect(w1.chart?.series[0].fields.bottom).toEqual({
      name: 's_ra',
      schema: 'exposure',
      database: 'cdb_lsstcam',
    });
    expect(w1.chart?.axes.map((a) => [a.location, a.inverted])).toEqual([
      ['bottom', false],
      ['left', true],
    ]);
  });

  it('re-serialises with the same window geometry, fields and axis info', () => {
    const ws = parseWorkspace(real, null, SERIES_COLORS);
    const original = JSON.parse(real);
    let n = 1000;
    const out = serializeWorkspace({
      windows: ws.windows,
      instrument: {
        name: ws.instrumentName!,
        database: ws.database,
        detectors: ws.detectors,
        tables: [],
      },
      globalQuery: ws.globalQuery,
      dayObs: ws.dayObs,
      detectorId: ws.detectorId,
      version: '1.0.0',
      newId: () => String(n++),
    }) as any;
    for (const id of Object.keys(original.windows)) {
      expect(out.windows[id].offset).toEqual(original.windows[id].offset);
      expect(out.windows[id].size).toEqual(original.windows[id].size);
      const os = original.windows[id].state;
      const ns = out.windows[id].state;
      expect(ns.windowType).toBe(os.windowType);
      expect(ns.tool).toBe(os.tool);
      expect(ns.useGlobalQuery).toBe(os.useGlobalQuery);
      expect(ns.axisInfo).toEqual(os.axisInfo);
      expect(ns.series.map((s: any) => [s.id, s.name, s.axes, s.fields, s.query])).toEqual(
        os.series.map((s: any) => [s.id, s.name, s.axes, s.fields, s.query]),
      );
    }
    expect(out.instrument.instrument).toBe('LsstCam');
    expect(out.instrument.detectors).toEqual(original.instrument.detectors);
    expect(out.instrument.schema).toEqual({ name: 'cdb_lsstcam' });
  });
});

describe('serializeWorkspace', () => {
  it('round-trips through the Dart conventions', () => {
    const ws = parseWorkspace(text, instrument, SERIES_COLORS);
    let n = 100;
    const out = serializeWorkspace({
      windows: ws.windows,
      instrument,
      globalQuery: ws.globalQuery,
      dayObs: ws.dayObs,
      detectorId: null,
      version: '0.1.0',
      newId: () => String(n++),
    });
    const s = stringifyWorkspace(out);
    const back = JSON.parse(s);
    expect(s).toContain('"offset":{"dx":20,"dy":20}');
    expect(s).toContain('"size":{"width":600,"height":400}');
    expect(back.windows['3'].state).toMatchObject({
      windowType: 'cartesianScatter',
      tool: 'MultiSelectionTool.select',
      useGlobalQuery: true,
    });
    expect(back.windows['3'].state.series[0].fields['left,0']).toEqual({
      name: 'dec',
      schema: 'exposure',
      database: 'testdb',
    });
    expect(back.windows['3'].state.axisInfo[1]).toMatchObject({
      axisId: 'left,0',
      mapping: { type: 'log10' },
      isInverted: true,
    });
    expect(back.windows['8'].state).toMatchObject({
      nBins: 25,
      tool: 'MultiSelectionTool.drillDown',
    });
    expect(back.windows['12'].state).toMatchObject({
      windowType: 'focalPlane',
      playbackSpeed: 1,
      loopPlayback: false,
      dayObs: '2025-11-05',
    });
    expect(back.windows['12'].state.series.fields['right,0']).toEqual({
      name: 'ra',
      schema: 'exposure',
      database: 'testdb',
    });
    expect(back.windows['12'].state.axisInfo.axisId).toBe('right,0');
    expect(back.instrument).toEqual({
      instrument: 'testdb',
      detectors: [],
      schema: { name: 'testdb' },
    });
    expect(back.dayObs).toBe('2025-11-05T00:00:00.000');
    expect(back.globalQuery.roots).toEqual(['20']);
    expect(back.globalQuery.children['20']).toEqual(['18', '19']);
    expect(back.globalQuery.nodes['20'].operator).toBe('AND');
    expect(back.globalQuery.nodes['20'].children).toHaveLength(2);
    expect(back).not.toHaveProperty('detector');
    // parses again identically
    const again = parseWorkspace(s, instrument, SERIES_COLORS);
    expect(again.windows['3'].chart).toEqual(ws.windows['3'].chart);
  });

  it('writes compact JSON and colours as ARGB ints', () => {
    expect(stringifyWorkspace({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
    expect(colorToArgb('#058b8c')).toBe(0xff058b8c);
    expect(argbToColor(4278190080)).toBe('#000000');
  });
});

describe('query graph conversion', () => {
  it('mints ids for wire-form queries without numeric ids and converts back', () => {
    let n = 1;
    const g = queryTreeToGraph(
      {
        type: 'ParentQuery',
        id: 'x',
        operator: 'OR',
        children: [
          {
            type: 'EqualityQuery',
            id: 'y',
            field: { name: 'a', schema: 't', database: 'd' },
            rightOperator: 'eq',
            rightValue: 1,
          },
        ],
      },
      () => String(n++),
    );
    expect(g.roots).toEqual(['1']);
    expect(g.children).toEqual({ '1': ['2'] });
    expect(g.parents).toEqual({ '2': '1' });
    expect(queryGraphToTree(g)).toMatchObject({
      type: 'ParentQuery',
      operator: 'OR',
      children: [{ rightValue: 1 }],
    });
    expect(queryGraphToTree({ nodes: {}, roots: [], children: {}, parents: {} })).toBeNull();
  });

  it('tolerates the Flutter content.operator form on load', () => {
    const tree = queryGraphToTree({
      nodes: { '1': { type: 'ParentQuery', id: '1', content: { operator: 'XOR' }, children: [] } },
      roots: ['1'],
      children: { '1': [] },
      parents: {},
    });
    expect(tree).toMatchObject({ operator: 'XOR' });
  });
});
