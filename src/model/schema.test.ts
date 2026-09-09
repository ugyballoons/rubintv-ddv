import { describe, expect, it } from 'vitest';
import { columnKind, parseInstrument } from './schema';

describe('schema model', () => {
  it('maps SDM datatypes including date and datetime', () => {
    expect(columnKind('long')).toBe('number');
    expect(columnKind('char')).toBe('string');
    expect(columnKind('date')).toBe('datetime');
    expect(columnKind('datetime')).toBe('datetime');
    expect(columnKind('timestamp')).toBe('datetime');
    expect(columnKind('boolean')).toBe('boolean');
    expect(columnKind('weird')).toBe('string');
  });

  it('parses instrument info and hides flexdata tables', () => {
    const inst = parseInstrument({
      instrument: 'testdb',
      detectors: [],
      schema: {
        name: 'testdb',
        tables: [
          { name: 'exposure', columns: [{ name: 'ra', datatype: 'double', unit: 'degree' }] },
          { name: 'exposure_flexdata', columns: [] },
        ],
      },
    });
    expect(inst.tables.map((t) => t.name)).toEqual(['exposure']);
    expect(inst.tables[0].columns[0]).toMatchObject({
      id: 'exposure.ra',
      kind: 'number',
      unit: 'degree',
    });
  });

  it('falls back to the instrument name when the schema is unnamed (sqlite testdb)', () => {
    const inst = parseInstrument({
      instrument: 'testdb',
      detectors: [],
      schema: { name: null, tables: [] },
    });
    expect(inst.database).toBe('testdb');
  });

  it('tolerates a missing schema', () => {
    const inst = parseInstrument({ instrument: 'LSSTCam', detectors: [] });
    expect(inst.database).toBeNull();
    expect(inst.tables).toEqual([]);
  });
});
