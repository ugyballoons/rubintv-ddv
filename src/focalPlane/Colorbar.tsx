import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { colorAt, stopsGradient, type ColorStop } from '../model/focalPlane';

interface Props {
  stops: readonly ColorStop[];
  min: number;
  max: number;
  onChange(stops: ColorStop[]): void;
}

/**
 * Vertical colorbar with editable stops: click the bar to add a stop at that
 * value, drag a handle to move it, click a handle to recolour or remove it
 * (at least two stops remain).
 */
export function Colorbar({ stops, min, max, onChange }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const span = max - min || 1;
  const toValue = (clientY: number) => {
    const r = bar.current!.getBoundingClientRect();
    const t = 1 - (clientY - r.top) / r.height;
    return min + Math.max(0, Math.min(1, t)) * span;
  };
  const sorted = stops.map((s, i) => ({ ...s, i })).sort((a, b) => a.value - b.value);

  const startDrag = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (Math.abs(ev.clientY - startY) > 2) moved = true;
      if (!moved) return;
      onChange(stops.map((s, i) => (i === index ? { ...s, value: toValue(ev.clientY) } : s)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (!moved) setEditing(index);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="colorbar" data-testid="colorbar">
      <div className="colorbar-label">{max.toPrecision(4)}</div>
      <div
        ref={bar}
        className="colorbar-bar"
        style={{ background: stopsGradient(stops, min, max) }}
        onClick={(e) => {
          const v = toValue(e.clientY);
          onChange([...stops, { value: v, color: colorAt(stops, v) }]);
        }}
        title="Click to add a colour stop"
      >
        {sorted.map((s) => (
          <button
            key={s.i}
            className="colorbar-handle"
            aria-label={`colour stop at ${s.value.toPrecision(4)}`}
            style={{ bottom: `${((s.value - min) / span) * 100}%`, background: s.color }}
            onMouseDown={(e) => startDrag(s.i, e)}
            onClick={(e) => e.stopPropagation()}
            title={`${s.value.toPrecision(4)} · click to edit, drag to move`}
          />
        ))}
      </div>
      <div className="colorbar-label">{min.toPrecision(4)}</div>
      {editing !== null &&
        stops[editing] &&
        createPortal(
          <div className="dialog-backdrop" onMouseDown={() => setEditing(null)}>
            <div
              className="dialog"
              role="dialog"
              aria-label="Colour stop"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3>Colour stop</h3>
              <div className="field">
                <span>Colour</span>
                <input
                  type="color"
                  aria-label="stop colour"
                  value={stops[editing].color}
                  onChange={(e) =>
                    onChange(
                      stops.map((s, i) => (i === editing ? { ...s, color: e.target.value } : s)),
                    )
                  }
                />
              </div>
              <div className="field">
                <span>Value</span>
                <input
                  type="number"
                  aria-label="stop value"
                  step="any"
                  value={stops[editing].value}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v))
                      onChange(stops.map((s, i) => (i === editing ? { ...s, value: v } : s)));
                  }}
                />
              </div>
              <div className="buttons">
                <button
                  className="danger"
                  disabled={stops.length <= 2}
                  title={stops.length <= 2 ? 'At least two stops are needed' : 'Remove this stop'}
                  onClick={() => {
                    onChange(stops.filter((_s, i) => i !== editing));
                    setEditing(null);
                  }}
                >
                  Remove
                </button>
                <button onClick={() => setEditing(null)}>Ok</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
