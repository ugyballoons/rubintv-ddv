/**
 * Query expressions in the wire/tree form the service accepts. The Flutter
 * app's graph persistence form is converted in workspaceJson.ts. Operations
 * here reproduce its editing semantics: removing the last child of a group
 * removes the group, and a group left with one child collapses into it.
 */
import type {
  EqualityQueryJson,
  ParentQueryJson,
  QueryJson,
  QueryOperator,
} from '../protocol/types';
import type { ColumnRef } from './workspace';

export type GroupOperator = ParentQueryJson['operator'];

/** Operators offered on the right-hand side ("field op value"). */
export const RIGHT_OPERATORS: readonly {
  op: QueryOperator;
  symbol: string;
  forStrings: boolean;
  forNumbers: boolean;
}[] = [
  { op: 'eq', symbol: '=', forStrings: true, forNumbers: true },
  { op: 'ne', symbol: '≠', forStrings: true, forNumbers: true },
  { op: 'lt', symbol: '<', forStrings: false, forNumbers: true },
  { op: 'le', symbol: '≤', forStrings: false, forNumbers: true },
  { op: 'gt', symbol: '>', forStrings: false, forNumbers: true },
  { op: 'ge', symbol: '≥', forStrings: false, forNumbers: true },
  { op: 'startswith', symbol: 'starts with', forStrings: true, forNumbers: false },
  { op: 'endswith', symbol: 'ends with', forStrings: true, forNumbers: false },
  { op: 'contains', symbol: 'contains', forStrings: true, forNumbers: false },
];

/**
 * Operators offered on the left-hand side ("value op field"). The service flips
 * them (lt → gt) so `3 < x` is sent as leftOperator "lt", leftValue 3.
 */
export const LEFT_OPERATORS: readonly { op: QueryOperator; symbol: string }[] = [
  { op: 'lt', symbol: '<' },
  { op: 'le', symbol: '≤' },
];

let counter = 0;
const nextId = (): string => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

export function condition(
  field: ColumnRef,
  init: Partial<Omit<EqualityQueryJson, 'type' | 'id' | 'field'>> = {},
): EqualityQueryJson {
  return { type: 'EqualityQuery', id: nextId(), field, ...init };
}

export function group(operator: GroupOperator, children: QueryJson[]): ParentQueryJson {
  return { type: 'ParentQuery', id: nextId(), operator, children };
}

/** The roots of an expression: a list, because unconnected conditions are allowed while editing. */
export type QueryDraft = readonly QueryJson[];

export function findNode(roots: QueryDraft, id: string): QueryJson | null {
  for (const r of roots) {
    if (r.id === id) return r;
    if (r.type === 'ParentQuery') {
      const hit = findNode(r.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

export function updateNode(
  roots: QueryDraft,
  id: string,
  patch: (n: QueryJson) => QueryJson,
): QueryDraft {
  return roots.map((r) => {
    if (r.id === id) return patch(r);
    if (r.type === 'ParentQuery') return { ...r, children: [...updateNode(r.children, id, patch)] };
    return r;
  });
}

/** Remove a node; a group whose last child goes is removed, a group left with one child collapses into it. */
export function removeNode(roots: QueryDraft, id: string): QueryDraft {
  const out: QueryJson[] = [];
  for (const r of roots) {
    if (r.id === id) continue;
    if (r.type === 'ParentQuery') {
      const children = [...removeNode(r.children, id)];
      if (children.length === 0) continue;
      if (children.length === 1) {
        out.push(children[0]);
        continue;
      }
      out.push({ ...r, children });
    } else {
      out.push(r);
    }
  }
  return out;
}

/** Combine root nodes into a new group, keeping the position of the first. */
export function combineRoots(
  roots: QueryDraft,
  ids: readonly string[],
  operator: GroupOperator,
): QueryDraft {
  const chosen = roots.filter((r) => ids.includes(r.id));
  if (chosen.length < 2) return roots;
  const g = group(operator, chosen);
  const firstIndex = roots.findIndex((r) => ids.includes(r.id));
  const rest = roots.filter((r) => !ids.includes(r.id));
  return [...rest.slice(0, firstIndex), g, ...rest.slice(firstIndex)];
}

/** Replace a group by its children at the same position. */
export function ungroup(roots: QueryDraft, id: string): QueryDraft {
  const out: QueryJson[] = [];
  for (const r of roots) {
    if (r.id === id && r.type === 'ParentQuery') out.push(...r.children);
    else if (r.type === 'ParentQuery') out.push({ ...r, children: [...ungroup(r.children, id)] });
    else out.push(r);
  }
  return out;
}

/** An expression is sendable when it has exactly one root (or none, meaning no query). */
export function toQuery(roots: QueryDraft): QueryJson | null | 'unconnected' {
  if (roots.length === 0) return null;
  if (roots.length > 1) return 'unconnected';
  return roots[0];
}

export function fromQuery(q: QueryJson | null): QueryDraft {
  return q ? [q] : [];
}

/** Every condition has a field and at least one side with an operator and a value. */
export function isComplete(roots: QueryDraft): boolean {
  return roots.every((r) =>
    r.type === 'ParentQuery'
      ? r.children.length > 0 && isComplete(r.children)
      : (r.leftOperator !== undefined && r.leftValue !== undefined && r.leftValue !== '') ||
        (r.rightOperator !== undefined && r.rightValue !== undefined && r.rightValue !== ''),
  );
}

/** Human-readable one-liner, e.g. for the toolbar tooltip. */
export function describe(q: QueryJson | null): string {
  if (!q) return '';
  if (q.type === 'ParentQuery') return `(${q.children.map(describe).join(` ${q.operator} `)})`;
  const f = `${q.field.schema}.${q.field.name}`;
  const left = q.leftOperator
    ? `${q.leftValue} ${LEFT_OPERATORS.find((o) => o.op === q.leftOperator)?.symbol ?? q.leftOperator} `
    : '';
  const right = q.rightOperator
    ? ` ${RIGHT_OPERATORS.find((o) => o.op === q.rightOperator)?.symbol ?? q.rightOperator} ${q.rightValue}`
    : '';
  return `${left}${f}${right}`;
}
