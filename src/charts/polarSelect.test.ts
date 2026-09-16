import { describe, expect, it } from 'vitest';
import {
  angleIntervals,
  normalizeAngle,
  screenAngle,
  sectorPath,
  unwrapDelta,
} from './polarSelect';

const g = { cx: 100, cy: 100, r: 50 };

describe('screenAngle and unwrapDelta', () => {
  it('measures clockwise from the +x axis with y pointing down', () => {
    expect(screenAngle(g, 150, 100)).toBeCloseTo(0);
    expect(screenAngle(g, 100, 150)).toBeCloseTo(90);
    expect(screenAngle(g, 100, 50)).toBeCloseTo(-90);
  });
  it('takes the short way round the ±180 seam', () => {
    expect(unwrapDelta(170, -170)).toBeCloseTo(20);
    expect(unwrapDelta(-170, 170)).toBeCloseTo(-20);
    expect(unwrapDelta(10, 30)).toBeCloseTo(20);
  });
});

describe('angleIntervals', () => {
  it('returns one range when the sweep stays inside [0, 360]', () => {
    expect(angleIntervals(30, 60)).toEqual([[30, 90]]);
    expect(angleIntervals(90, -60)).toEqual([[30, 90]]);
  });
  it('splits a sweep that crosses zero either way', () => {
    expect(angleIntervals(350, 20)).toEqual([
      [350, 360],
      [0, 10],
    ]);
    expect(angleIntervals(10, -20)).toEqual([
      [350, 360],
      [0, 10],
    ]);
  });
  it('covers everything after a full turn and normalises the start', () => {
    expect(angleIntervals(45, 360)).toEqual([[0, 360]]);
    expect(angleIntervals(45, -720)).toEqual([[0, 360]]);
    expect(angleIntervals(-30, 10)).toEqual([[330, 340]]);
    expect(normalizeAngle(-30)).toBe(330);
    expect(normalizeAngle(725)).toBe(5);
  });
});

describe('sectorPath', () => {
  it('draws a wedge to the centre when the inner radius is zero', () => {
    const d = sectorPath(g, 0, 40, -90, 90);
    expect(d).toBe('M 100.00,60.00 A 40.00 40.00 0 0 1 140.00,100.00 L 100.00,100.00 Z');
  });
  it('draws an annular sector with the inner arc going back the other way', () => {
    const d = sectorPath(g, 40, 20, 0, -270);
    expect(d).toBe(
      'M 140.00,100.00 A 40.00 40.00 0 1 0 100.00,140.00 L 100.00,120.00 A 20.00 20.00 0 1 1 120.00,100.00 Z',
    );
  });
  it('clamps radii to the outer radius and draws an annulus for a full turn', () => {
    const d = sectorPath(g, 10, 500, 0, 360);
    expect(d.split('M ')).toHaveLength(3);
    expect(d).toContain('A 50.00 50.00');
    expect(d).toContain('A 10.00 10.00');
    expect(sectorPath(g, 0, 0.2, 0, 90)).toBe('');
  });
});
