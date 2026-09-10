import type { EqualityQueryJson, ParentQueryJson, QueryJson } from '../protocol/types';
import type { Instrument } from './schema';

/** The toolbar's night filter: nothing, one night, a closed range, or a set of nights (all YYYYMMDD ints). */
export type NightSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'single'; readonly night: number }
  | { readonly kind: 'range'; readonly from: number; readonly to: number }
  | { readonly kind: 'set'; readonly nights: readonly number[] };

export const NO_NIGHTS: NightSelection = { kind: 'none' };

export const nightToIso = (n: number): string =>
  String(n).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
export const isoToNight = (iso: string): number | null => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(iso.trim());
  return m ? Number(m[1] + m[2] + m[3]) : null;
};

/** Nights as sorted ints; a range expands day by day. */
export function nightList(sel: NightSelection): number[] {
  switch (sel.kind) {
    case 'none':
      return [];
    case 'single':
      return [sel.night];
    case 'set':
      return [...sel.nights].sort((a, b) => a - b);
    case 'range': {
      const out: number[] = [];
      const d = nightToDate(sel.from);
      const end = nightToDate(sel.to);
      for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(dateToNight(d));
      return out;
    }
  }
}

export const nightToDate = (n: number): Date =>
  new Date(Date.UTC(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100));
export const dateToNight = (d: Date): number =>
  d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

export function describeNights(sel: NightSelection): string {
  switch (sel.kind) {
    case 'none':
      return 'all nights';
    case 'single':
      return nightToIso(sel.night);
    case 'range':
      return `${nightToIso(sel.from)} → ${nightToIso(sel.to)}`;
    case 'set':
      return `${sel.nights.length} nights`;
  }
}

/** Single nights go to the service as `day_obs`; ranges and sets become a query condition. */
export function nightsDayObsParam(sel: NightSelection): string | null {
  return sel.kind === 'single' ? nightToIso(sel.night) : null;
}

/**
 * Query condition for a range or set, on the day_obs column of the table the
 * series reads from (every consdb table with rows per exposure has one), or
 * on exposure.day_obs otherwise. Null when no condition is needed.
 */
export function nightsQuery(
  sel: NightSelection,
  table: string,
  instrument: Instrument | null,
): QueryJson | null {
  if (sel.kind === 'none' || sel.kind === 'single') return null;
  const database = instrument?.database ?? '';
  const has = (t: string) =>
    instrument?.tables.find((x) => x.name === t)?.columns.some((c) => c.name === 'day_obs');
  const schema = has(table) ? table : 'exposure';
  const field = { name: 'day_obs', schema, database };
  const cond = (patch: Partial<EqualityQueryJson>, id: string): EqualityQueryJson => ({
    type: 'EqualityQuery',
    id,
    field,
    ...patch,
  });
  if (sel.kind === 'range')
    return cond(
      { leftOperator: 'le', leftValue: sel.from, rightOperator: 'le', rightValue: sel.to },
      'nights-range',
    );
  if (sel.nights.length === 1)
    return cond({ rightOperator: 'eq', rightValue: sel.nights[0] }, 'nights-0');
  const group: ParentQueryJson = {
    type: 'ParentQuery',
    id: 'nights',
    operator: 'OR',
    children: sel.nights.map((n, i) => cond({ rightOperator: 'eq', rightValue: n }, `nights-${i}`)),
  };
  return group;
}

/** AND a night condition into an existing query. */
export function andQuery(a: QueryJson | null, b: QueryJson | null): QueryJson | null {
  if (!a) return b;
  if (!b) return a;
  return { type: 'ParentQuery', id: 'and-nights', operator: 'AND', children: [a, b] };
}
