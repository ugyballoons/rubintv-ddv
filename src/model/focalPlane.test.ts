import { describe, expect, it } from 'vitest';
import type { DataIdKey } from 'rubin-charts';
import {
  colorAt,
  layoutFocalPlane,
  nearestDetector,
  rescaleStops,
  toFocalPlaneFrames,
} from './focalPlane';

describe('focal plane frames', () => {
  it('reshapes a columnar reply into sorted per-exposure frames', () => {
    const f = toFocalPlaneFrames({
      schema: 'testdb',
      columns: ['ccdexposure.psf_sigma_median', 'ccdexposure.detector'],
      data: {
        'ccdexposure.psf_sigma_median': [1, 2, 3, 4],
        'ccdexposure.detector': [0, 1, 0, 1],
        day_obs: [20250102, 20250102, 20250101, 20250101],
        seq_num: [5, 5, 9, 9],
      },
    })!;
    expect(f.dataIds).toEqual(['20250101:9', '20250102:5']);
    expect([...f.frames.get('20250102:5' as DataIdKey)!.entries()]).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect([f.min, f.max, f.valueColumn]).toEqual([1, 4, 'ccdexposure.psf_sigma_median']);
  });

  it('returns null without a detector column', () => {
    expect(
      toFocalPlaneFrames({
        schema: 't',
        columns: ['a.b'],
        data: { 'a.b': [1], day_obs: [1], seq_num: [1] },
      }),
    ).toBeNull();
  });
});

describe('geometry', () => {
  const layout = layoutFocalPlane([
    {
      id: 0,
      name: 'L',
      corners: [
        [-3, -1],
        [-1, -1],
        [-1, 1],
        [-3, 1],
      ],
    },
    {
      id: 1,
      name: 'C',
      corners: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
    },
    {
      id: 2,
      name: 'R',
      corners: [
        [1, -1],
        [3, -1],
        [3, 1],
        [1, 1],
      ],
    },
    {
      id: 3,
      name: 'U',
      corners: [
        [-1, 1],
        [1, 1],
        [1, 3],
        [-1, 3],
      ],
    },
  ]);
  it('computes bounds and centres', () => {
    expect([layout.minX, layout.minY, layout.width, layout.height]).toEqual([-3, -1, 6, 4]);
    expect(layout.detectors[1]).toMatchObject({ cx: 0, cy: 0 });
  });
  it('navigates to the nearest detector in a direction', () => {
    expect(nearestDetector(layout, 1, 'left')).toBe(0);
    expect(nearestDetector(layout, 1, 'right')).toBe(2);
    expect(nearestDetector(layout, 1, 'up')).toBe(3);
    expect(nearestDetector(layout, 1, 'down')).toBeNull();
  });
});

describe('colorbar', () => {
  const stops = [
    { value: 0, color: '#000000' },
    { value: 10, color: '#ffffff' },
  ];
  it('interpolates and clamps', () => {
    expect(colorAt(stops, 5)).toBe('#808080');
    expect(colorAt(stops, -1)).toBe('#000000');
    expect(colorAt(stops, 99)).toBe('#ffffff');
  });
  it('rescales stops proportionally into new bounds', () => {
    expect(rescaleStops(stops, 0, 10, 100, 300).map((s) => s.value)).toEqual([100, 300]);
  });
});
