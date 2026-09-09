import { describe as d, expect, it } from 'vitest';
import {
  combineRoots,
  condition,
  describe,
  fromQuery,
  group,
  isComplete,
  removeNode,
  toQuery,
  ungroup,
  updateNode,
} from './query';

const f = (name: string) => ({ name, schema: 'exposure', database: 'testdb' });

d('query draft operations', () => {
  it('combines roots into a group at the first position and ungroups back', () => {
    const a = condition(f('ra'), { rightOperator: 'lt', rightValue: 10 });
    const b = condition(f('dec'), { leftOperator: 'lt', leftValue: -30 });
    const c = condition(f('exp_time'), { rightOperator: 'eq', rightValue: 30 });
    const roots = combineRoots([a, b, c], [b.id, c.id], 'OR');
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBe(a);
    expect(roots[1]).toMatchObject({ type: 'ParentQuery', operator: 'OR' });
    expect(ungroup(roots, roots[1].id)).toEqual([a, b, c]);
  });

  it('collapses a group left with one child and drops an empty one', () => {
    const a = condition(f('ra'));
    const b = condition(f('dec'));
    const g = group('AND', [a, b]);
    expect(removeNode([g], b.id)).toEqual([a]);
    expect(removeNode([group('AND', [a])], a.id)).toEqual([]);
  });

  it('updates nested nodes', () => {
    const a = condition(f('ra'));
    const g = group('AND', [a, condition(f('dec'))]);
    const out = updateNode(
      [g],
      a.id,
      (n) => ({ ...n, rightOperator: 'ge', rightValue: 5 }) as typeof n,
    );
    expect((out[0] as typeof g).children[0]).toMatchObject({ rightOperator: 'ge', rightValue: 5 });
  });

  it('reports connectedness and completeness', () => {
    const a = condition(f('ra'), { rightOperator: 'lt', rightValue: 10 });
    expect(toQuery([])).toBeNull();
    expect(toQuery([a, condition(f('dec'))])).toBe('unconnected');
    expect(toQuery([a])).toBe(a);
    expect(isComplete([a])).toBe(true);
    expect(isComplete([condition(f('dec'))])).toBe(false);
    expect(fromQuery(null)).toEqual([]);
  });

  it('describes expressions', () => {
    const a = condition(f('ra'), {
      leftOperator: 'lt',
      leftValue: 3,
      rightOperator: 'le',
      rightValue: 10,
    });
    expect(describe(a)).toBe('3 < exposure.ra ≤ 10');
    expect(
      describe(group('AND', [a, condition(f('dec'), { rightOperator: 'eq', rightValue: 1 })])),
    ).toBe('(3 < exposure.ra ≤ 10 AND exposure.dec = 1)');
  });
});
