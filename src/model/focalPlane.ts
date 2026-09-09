import { compareDataId, dataIdKey, parseDataIdKey, type DataIdKey } from 'rubin-charts';
import type { DetectorInfo, TableColumns } from '../protocol/types';
import { dayObsToInt } from './columns';

export interface FocalPlaneFrames {
  /** Sorted by (dayObs, seqNum). */
  readonly dataIds: readonly DataIdKey[];
  /** Per data id: detector id → value. */
  readonly frames: ReadonlyMap<DataIdKey, ReadonlyMap<number, number>>;
  readonly min: number;
  readonly max: number;
  readonly valueColumn: string;
}

/**
 * Reshape a columnar reply with a detector column into per-exposure frames.
 * The detector column is the one named `*.detector`; the value column is the
 * remaining non-id column, as in the Flutter focal plane.
 */
export function toFocalPlaneFrames(reply: TableColumns): FocalPlaneFrames | null {
  const keys = Object.keys(reply.data);
  const detectorKey = keys.find((k) => k.endsWith('.detector'));
  const valueKey = keys.find((k) => k !== 'day_obs' && k !== 'seq_num' && k !== detectorKey);
  if (!detectorKey || !valueKey) return null;
  const n = reply.data.seq_num.length;
  const frames = new Map<DataIdKey, Map<number, number>>();
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const key = dataIdKey({
      dayObs: dayObsToInt(reply.data.day_obs[i]),
      seqNum: reply.data.seq_num[i],
    });
    let frame = frames.get(key);
    if (!frame) frames.set(key, (frame = new Map()));
    const v = Number(reply.data[valueKey][i]);
    frame.set(Number(reply.data[detectorKey][i]), v);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const dataIds = [...frames.keys()].sort((a, b) =>
    compareDataId(parseDataIdKey(a), parseDataIdKey(b)),
  );
  if (!Number.isFinite(min)) [min, max] = [0, 1];
  if (min === max) [min, max] = [min - 0.5, max + 0.5];
  return { dataIds, frames, min, max, valueColumn: valueKey };
}

// ---------------------------------------------------------------- geometry

export interface DetectorShape {
  readonly id: number;
  readonly name: string;
  /** Corners in focal-plane units. */
  readonly corners: readonly (readonly [number, number])[];
  readonly cx: number;
  readonly cy: number;
}

export interface FocalPlaneLayout {
  readonly detectors: readonly DetectorShape[];
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export function layoutFocalPlane(detectors: readonly DetectorInfo[]): FocalPlaneLayout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const shapes = detectors.map((d) => {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of d.corners) {
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return {
      id: d.id,
      name: d.name,
      corners: d.corners.map(([x, y]) => [x, y] as const),
      cx: sx / d.corners.length,
      cy: sy / d.corners.length,
    };
  });
  if (!shapes.length) return { detectors: [], minX: 0, minY: 0, width: 1, height: 1 };
  return { detectors: shapes, minX, minY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

/** Nearest detector strictly in the arrow direction, by squared distance between centres; null if none. */
export function nearestDetector(
  layout: FocalPlaneLayout,
  fromId: number,
  dir: 'left' | 'right' | 'up' | 'down',
): number | null {
  const from = layout.detectors.find((d) => d.id === fromId);
  if (!from) return layout.detectors[0]?.id ?? null;
  let best: number | null = null;
  let bestD = Infinity;
  for (const d of layout.detectors) {
    if (d.id === fromId) continue;
    const dx = d.cx - from.cx;
    const dy = d.cy - from.cy;
    const ok =
      dir === 'left'
        ? dx < 0 && Math.abs(dy) <= Math.abs(dx)
        : dir === 'right'
          ? dx > 0 && Math.abs(dy) <= Math.abs(dx)
          : dir === 'up'
            ? dy > 0 && Math.abs(dx) <= Math.abs(dy)
            : dy < 0 && Math.abs(dx) <= Math.abs(dy);
    if (!ok) continue;
    const dist = dx * dx + dy * dy;
    if (dist < bestD) {
      bestD = dist;
      best = d.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------- colorbar

export interface ColorStop {
  readonly value: number;
  readonly color: string; // #rrggbb
}

export const DEFAULT_STOPS: readonly ColorStop[] = [
  { value: 0, color: '#2196f3' },
  { value: 100, color: '#f44336' },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((c) =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Piecewise-linear colour between the bracketing stops; clamped outside. */
export function colorAt(stops: readonly ColorStop[], value: number): string {
  const sorted = [...stops].sort((a, b) => a.value - b.value);
  if (sorted.length === 0) return '#888888';
  if (value <= sorted[0].value) return sorted[0].color;
  if (value >= sorted[sorted.length - 1].value) return sorted[sorted.length - 1].color;
  for (let i = 1; i < sorted.length; i++) {
    if (value <= sorted[i].value) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const t = b.value === a.value ? 0 : (value - a.value) / (b.value - a.value);
      const [r1, g1, b1] = hexToRgb(a.color);
      const [r2, g2, b2] = hexToRgb(b.color);
      return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
    }
  }
  return sorted[sorted.length - 1].color;
}

/** Map stops proportionally from [oldMin, oldMax] onto [newMin, newMax], as the Flutter colorbar did when data bounds changed. */
export function rescaleStops(
  stops: readonly ColorStop[],
  oldMin: number,
  oldMax: number,
  newMin: number,
  newMax: number,
): ColorStop[] {
  const span = oldMax - oldMin || 1;
  return stops.map((s) => ({
    ...s,
    value: newMin + ((s.value - oldMin) / span) * (newMax - newMin),
  }));
}

/** CSS gradient for the bar, from min to max. */
export function stopsGradient(stops: readonly ColorStop[], min: number, max: number): string {
  const span = max - min || 1;
  const sorted = [...stops].sort((a, b) => a.value - b.value);
  return `linear-gradient(to top, ${sorted.map((s) => `${s.color} ${(((s.value - min) / span) * 100).toFixed(2)}%`).join(', ')})`;
}
