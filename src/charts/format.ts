/** Compact number for tooltips and readouts: integers as-is, otherwise six significant digits without trailing zeros. */
export const fmt = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, '');
