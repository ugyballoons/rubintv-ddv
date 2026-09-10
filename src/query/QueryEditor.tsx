import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EqualityQueryJson, ParentQueryJson, QueryJson } from '../protocol/types';
import type { Instrument } from '../model/schema';
import type { ColumnRef } from '../model/workspace';
import {
  LEFT_OPERATORS,
  RIGHT_OPERATORS,
  combineRoots,
  condition,
  fromQuery,
  isComplete,
  removeNode,
  toQuery,
  ungroup,
  updateNode,
  type GroupOperator,
  type QueryDraft,
} from '../model/query';

interface Props {
  instrument: Instrument;
  initial: QueryJson | null;
  title: string;
  onCancel(): void;
  onAccept(query: QueryJson | null): void;
}

const GROUP_OPS: GroupOperator[] = ['AND', 'OR', 'XOR'];

/**
 * Builds a query expression. Conditions are added as roots; select two or
 * more roots and combine them into an AND/OR/XOR group. Accept requires a
 * single connected expression (or none, which clears the query).
 */
export function QueryEditor({ instrument, initial, title, onCancel, onAccept }: Props) {
  const [roots, setRoots] = useState<QueryDraft>(() => fromQuery(initial));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [table, setTable] = useState(instrument.tables[0]?.name ?? '');
  const [column, setColumn] = useState(instrument.tables[0]?.columns[0]?.name ?? '');
  const tableObj = instrument.tables.find((t) => t.name === table);
  const result = toQuery(roots);
  const complete = isComplete(roots);
  const kindOf = (ref: ColumnRef) =>
    instrument.tables.find((t) => t.name === ref.schema)?.columns.find((c) => c.name === ref.name)
      ?.kind ?? 'string';

  const add = () => {
    if (!tableObj || !instrument.database) return;
    const ref: ColumnRef = { name: column, schema: table, database: instrument.database };
    const kind = kindOf(ref);
    setRoots([
      ...roots,
      condition(
        ref,
        kind === 'number'
          ? { rightOperator: 'lt', rightValue: 0 }
          : { rightOperator: 'eq', rightValue: '' },
      ),
    ]);
  };
  const combine = (op: GroupOperator) => {
    setRoots(combineRoots(roots, [...picked], op));
    setPicked(new Set());
  };
  const togglePick = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const renderNode = (n: QueryJson, depth: number, isRoot: boolean) => (
    <div key={n.id} className={`qnode depth-${depth % 2}`}>
      {isRoot && roots.length > 1 && (
        <input
          type="checkbox"
          aria-label="select condition"
          checked={picked.has(n.id)}
          onChange={() => togglePick(n.id)}
        />
      )}
      {n.type === 'ParentQuery' ? (
        <div className="qgroup">
          <div className="qrow">
            <select
              aria-label="group operator"
              value={n.operator}
              onChange={(e) =>
                setRoots(
                  updateNode(roots, n.id, (x) => ({
                    ...(x as ParentQueryJson),
                    operator: e.target.value as GroupOperator,
                  })),
                )
              }
            >
              {GROUP_OPS.map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
            <button
              onClick={() => setRoots(ungroup(roots, n.id))}
              title="Replace the group by its conditions"
            >
              ungroup
            </button>
            <button
              className="danger"
              onClick={() => setRoots(removeNode(roots, n.id))}
              title="Remove the whole group"
            >
              ×
            </button>
          </div>
          <div className="qchildren">{n.children.map((c) => renderNode(c, depth + 1, false))}</div>
        </div>
      ) : (
        <ConditionRow
          node={n}
          numeric={kindOf(n.field) === 'number'}
          onChange={(patch) =>
            setRoots(updateNode(roots, n.id, (x) => ({ ...(x as EqualityQueryJson), ...patch })))
          }
          onRemove={() => setRoots(removeNode(roots, n.id))}
        />
      )}
    </div>
  );

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog query-dialog"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <div className="qroots">
          {roots.length === 0 ? (
            <p className="meta">No conditions. Add one below.</p>
          ) : (
            roots.map((r) => renderNode(r, 0, true))
          )}
        </div>
        <div className="qrow qadd">
          <select
            aria-label="table"
            value={table}
            onChange={(e) => {
              setTable(e.target.value);
              setColumn(
                instrument.tables.find((t) => t.name === e.target.value)?.columns[0]?.name ?? '',
              );
            }}
          >
            {instrument.tables.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
          <select aria-label="column" value={column} onChange={(e) => setColumn(e.target.value)}>
            {tableObj?.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={add}>+ condition</button>
          {picked.size >= 2 && (
            <span className="qcombine">
              combine as
              {GROUP_OPS.map((op) => (
                <button key={op} onClick={() => combine(op)}>
                  {op}
                </button>
              ))}
            </span>
          )}
        </div>
        <div className="buttons">
          {result === 'unconnected' && (
            <span className="meta warn">
              Combine all conditions into one expression, or remove extras.
            </span>
          )}
          {!complete && <span className="meta warn">Every condition needs a value.</span>}
          <button onClick={onCancel}>Cancel</button>
          <button
            disabled={result === 'unconnected' || !complete}
            onClick={() => onAccept(result === 'unconnected' ? null : result)}
          >
            Accept
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ConditionRow({
  node,
  numeric,
  onChange,
  onRemove,
}: {
  node: EqualityQueryJson;
  numeric: boolean;
  onChange(patch: Partial<EqualityQueryJson>): void;
  onRemove(): void;
}) {
  const rightOps = useMemo(
    () => RIGHT_OPERATORS.filter((o) => (numeric ? o.forNumbers : o.forStrings)),
    [numeric],
  );
  const parse = (v: string) =>
    numeric ? (v === '' || Number.isNaN(Number(v)) ? '' : Number(v)) : v;
  return (
    <div className="qrow qcondition">
      {numeric && (
        <>
          <input
            aria-label="left value"
            className="qvalue"
            value={node.leftOperator ? String(node.leftValue ?? '') : ''}
            placeholder="min"
            onChange={(e) =>
              e.target.value === ''
                ? onChange({ leftOperator: undefined, leftValue: undefined })
                : onChange({
                    leftOperator: node.leftOperator ?? 'lt',
                    leftValue: parse(e.target.value),
                  })
            }
          />
          <select
            aria-label="left operator"
            value={node.leftOperator ?? 'lt'}
            onChange={(e) =>
              onChange({
                leftOperator: e.target.value as EqualityQueryJson['leftOperator'],
                leftValue: node.leftValue ?? 0,
              })
            }
          >
            {LEFT_OPERATORS.map((o) => (
              <option key={o.op} value={o.op}>
                {o.symbol}
              </option>
            ))}
          </select>
        </>
      )}
      <code className="qfield">
        {node.field.schema}.{node.field.name}
      </code>
      <select
        aria-label="right operator"
        value={node.rightOperator ?? ''}
        onChange={(e) =>
          e.target.value === ''
            ? onChange({ rightOperator: undefined, rightValue: undefined })
            : onChange({
                rightOperator: e.target.value as EqualityQueryJson['rightOperator'],
                rightValue: node.rightValue ?? (numeric ? 0 : ''),
              })
        }
      >
        {numeric && <option value="">(none)</option>}
        {rightOps.map((o) => (
          <option key={o.op} value={o.op}>
            {o.symbol}
          </option>
        ))}
      </select>
      {node.rightOperator && (
        <input
          aria-label="right value"
          className="qvalue"
          value={String(node.rightValue ?? '')}
          placeholder={numeric ? 'max' : 'text'}
          onChange={(e) => onChange({ rightValue: parse(e.target.value) })}
        />
      )}
      <button className="danger" onClick={onRemove} title="Remove condition">
        ×
      </button>
    </div>
  );
}
