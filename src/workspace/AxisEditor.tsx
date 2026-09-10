import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { AxisConfig } from '../model/workspace';

interface Props {
  axes: readonly AxisConfig[];
  onCancel(): void;
  onAccept(axes: AxisConfig[]): void;
}

/** Label, scale and direction for each axis of a chart window. */
export function AxisEditor({ axes, onCancel, onAccept }: Props) {
  const [draft, setDraft] = useState<AxisConfig[]>([...axes]);
  const patch = (i: number, p: Partial<AxisConfig>) =>
    setDraft((d) => d.map((a, k) => (k === i ? { ...a, ...p } : a)));
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Edit axes"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>Axes</h3>
        {draft.map((a, i) => (
          <div className="field" key={a.location}>
            <span>{a.location}</span>
            <input
              aria-label={`${a.location} label`}
              value={a.label}
              onChange={(e) => patch(i, { label: e.target.value })}
            />
            <select
              aria-label={`${a.location} scale`}
              value={a.mapping}
              onChange={(e) => patch(i, { mapping: e.target.value as AxisConfig['mapping'] })}
            >
              <option value="linear">linear</option>
              <option value="log10">log10</option>
              <option value="logE">ln</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={a.inverted}
                onChange={(e) => patch(i, { inverted: e.target.checked })}
              />{' '}
              inverted
            </label>
          </div>
        ))}
        <div className="buttons">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={() => onAccept(draft)}>Accept</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
