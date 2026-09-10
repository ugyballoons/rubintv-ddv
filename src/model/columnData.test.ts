import { describe, expect, it } from 'vitest';
import { parseTimestampMs, toPlottable } from './columnData';

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
  it('keeps numeric columns and flags datetime ones', () => {
    expect(toPlottable(new Float64Array([1, 2]), 'number').kind).toBe('number');
    expect(toPlottable(new Float64Array([1, 2]), 'datetime').kind).toBe('datetime');
  });
});
