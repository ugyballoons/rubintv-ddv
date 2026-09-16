import { describe, expect, it } from 'vitest';
import type { AxisSpec } from 'rubin-charts';
import { fmt, formatBinRange, formatTimestamp, formatValue } from './format';

const axis = (extra: Partial<AxisSpec>): AxisSpec => ({
  location: 'bottom',
  label: 'x',
  mapping: 'linear',
  inverted: false,
  kind: 'number',
  ...extra,
});

describe('format', () => {
  it('fmt keeps integers and trims floats to six significant digits', () => {
    expect(fmt(2025110100123)).toBe('2025110100123');
    expect(fmt(1 / 3)).toBe('0.333333');
    expect(fmt(2.5)).toBe('2.5');
  });
  it('formats timestamps in the worker wire form, without a trailing .000', () => {
    expect(formatTimestamp(Date.UTC(2025, 10, 1, 1, 12, 0, 377))).toBe('2025-11-01 01:12:00.377');
    expect(formatTimestamp(Date.UTC(2025, 10, 1, 1, 12))).toBe('2025-11-01 01:12:00');
    expect(formatTimestamp(NaN)).toBe('');
  });
  it('rounds a hover position on an integer axis and leaves float axes alone', () => {
    expect(formatValue(2025110100122.6, axis({ integer: true }))).toBe('2025110100123');
    expect(formatValue(2.6, axis({}))).toBe('2.6');
    expect(formatValue(Infinity, axis({ integer: true }))).toBe('');
  });
  it('shows dates, or MJD when the axis is labelled so', () => {
    const t = Date.UTC(2000, 0, 1, 12);
    expect(formatValue(t, axis({ kind: 'datetime' }))).toBe('2000-01-01 12:00:00');
    expect(formatValue(t, axis({ kind: 'datetime', mjdLabels: true }))).toBe('51544.50000');
  });
  it('names the category under the cursor', () => {
    const cat = axis({ kind: 'category', categories: ['g', 'r'] });
    expect(formatValue(1.2, cat)).toBe('r');
    expect(formatValue(7, cat)).toBe('7');
  });
  it('labels integer bins by the whole values they hold', () => {
    expect(formatBinRange(2.5, 3.5, axis({ integer: true }))).toBe('3');
    expect(formatBinRange(2.5, 5.5, axis({ integer: true }))).toBe('3 – 5');
    expect(formatBinRange(0, 0.5, axis({}))).toBe('0 – 0.5');
    expect(
      formatBinRange(Date.UTC(2000, 0, 1), Date.UTC(2000, 0, 2), axis({ kind: 'datetime' })),
    ).toBe('2000-01-01 00:00:00 – 2000-01-02 00:00:00');
  });
});
