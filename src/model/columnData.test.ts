import { describe, expect, it } from 'vitest';
import { axisFor, parseTimestampMs, toPlottable } from './columnData';

describe('column data', () => {
  it('parses consdb timestamps as UTC milliseconds', () => {
    expect(parseTimestampMs('2025-11-01 01:12:00.377')).toBe(Date.UTC(2025, 10, 1, 1, 12, 0, 377));
    expect(parseTimestampMs('2025-11-01T01:12:00Z')).toBe(Date.UTC(2025, 10, 1, 1, 12));
    expect(parseTimestampMs(5)).toBe(5);
  });
  it('maps strings to sorted category indices', () => {
    const p = toPlottable(['r', 'g', 'r', 'i'], 'string');
    expect(p.kind).toBe('category');
    expect(p.categories).toEqual(['g', 'i', 'r']);
    expect(Array.from(p.values)).toEqual([2, 0, 2, 1]);
  });
  it('keeps numeric columns and flags integer and datetime ones', () => {
    expect(toPlottable(new Float64Array([1, 2]), 'number').kind).toBe('number');
    expect(toPlottable(new Float64Array([1, 2]), 'integer').kind).toBe('integer');
    expect(toPlottable(new Float64Array([1, 2]), 'datetime').kind).toBe('datetime');
  });
  it('carries the integer kind to the axis as a number axis flagged integer', () => {
    const base = {
      location: 'bottom',
      label: 'id',
      mapping: 'linear',
      inverted: false,
      kind: 'number',
    } as const;
    const ints = toPlottable(new Float64Array([1, 2]), 'integer');
    expect(axisFor(base, ints, false)).toMatchObject({ kind: 'number', integer: true });
    expect(
      axisFor(base, toPlottable(new Float64Array([1.5]), 'number'), false).integer,
    ).toBeUndefined();
    expect(axisFor(base, toPlottable(['2025-11-01 01:12:00'], 'datetime'), true)).toMatchObject({
      kind: 'datetime',
      mjdLabels: true,
    });
  });
});
