/**
 * Geometry for sector selection on a polar chart. Pure functions so the
 * wrap-around and direction handling can be tested without ECharts.
 */

export interface PolarGeometry {
  /** Centre of the polar area in chart pixels. */
  readonly cx: number;
  readonly cy: number;
  /** Outer radius in pixels. */
  readonly r: number;
}

/** Screen angle of a point about the centre, in degrees; increases clockwise because y points down. */
export function screenAngle(g: PolarGeometry, x: number, y: number): number {
  return (Math.atan2(y - g.cy, x - g.cx) * 180) / Math.PI;
}

/** Signed change from one screen angle to the next, taking the short way round: in (-180, 180]. */
export function unwrapDelta(from: number, to: number): number {
  let d = to - from;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
}

/** The same angle in [0, 360). */
export function normalizeAngle(a: number): number {
  const m = a % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Angular ranges within [0, 360] covered by sweeping `sweep` degrees (signed)
 * from `start`. A full turn or more covers every angle; a sweep across zero
 * splits in two so each piece can be a single KD-tree range query.
 */
export function angleIntervals(start: number, sweep: number): [number, number][] {
  if (Math.abs(sweep) >= 360) return [[0, 360]];
  const s = normalizeAngle(start);
  const e = s + sweep;
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  if (lo < 0)
    return [
      [lo + 360, 360],
      [0, hi],
    ];
  if (hi > 360)
    return [
      [lo, 360],
      [0, hi - 360],
    ];
  return [[lo, hi]];
}

/**
 * SVG path for the annular sector between pixel radii r0 and r1 (either
 * order), starting at screen angle `a0` and sweeping `sweep` degrees, clockwise
 * positive. Radii are clamped to the outer radius. A full turn draws an annulus
 * to be filled with the even-odd rule. Empty when there is nothing to draw.
 */
export function sectorPath(
  g: PolarGeometry,
  r0: number,
  r1: number,
  a0: number,
  sweep: number,
): string {
  const inner = Math.max(0, Math.min(g.r, Math.min(r0, r1)));
  const outer = Math.max(0, Math.min(g.r, Math.max(r0, r1)));
  if (outer < 0.5) return '';
  const pt = (r: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(g.cx + r * Math.cos(rad)).toFixed(2)},${(g.cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  const rr = (r: number) => r.toFixed(2);
  if (Math.abs(sweep) >= 360) {
    const ring = (r: number) =>
      `M ${pt(r, 0)} A ${rr(r)} ${rr(r)} 0 1 0 ${pt(r, 180)} A ${rr(r)} ${rr(r)} 0 1 0 ${pt(r, 0)} Z`;
    return inner >= 0.5 ? `${ring(outer)} ${ring(inner)}` : ring(outer);
  }
  const a1 = a0 + sweep;
  const large = Math.abs(sweep) > 180 ? 1 : 0;
  const forward = sweep > 0 ? 1 : 0;
  const head = `M ${pt(outer, a0)} A ${rr(outer)} ${rr(outer)} 0 ${large} ${forward} ${pt(outer, a1)}`;
  if (inner < 0.5) return `${head} L ${rr(g.cx)},${rr(g.cy)} Z`;
  return `${head} L ${pt(inner, a1)} A ${rr(inner)} ${rr(inner)} 0 ${large} ${1 - forward} ${pt(inner, a0)} Z`;
}
