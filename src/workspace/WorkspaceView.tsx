import { useEffect } from 'react';
import { Rnd } from 'react-rnd';
import { useSelection } from '../store/selection';
import type { DdvClient } from '../protocol/client';
import { useWorkspace } from '../store/workspace';
import { WindowFrame } from './WindowFrame';

const MIN = { width: 240, height: 160 };

/** Free-floating, draggable, resizable windows; the focused one is on top. */
export function WorkspaceView({ client }: { client: DdvClient }) {
  const windows = useWorkspace((s) => s.windows);
  const nextZ = useWorkspace((s) => s.nextZ);
  const moveWindow = useWorkspace((s) => s.moveWindow);
  const resizeWindow = useWorkspace((s) => s.resizeWindow);
  const focusWindow = useWorkspace((s) => s.focusWindow);
  const list = Object.values(windows);
  const drillDown = useSelection((s) => s.drillDown);
  const setDrillDown = useSelection((s) => s.setDrillDown);
  useEffect(() => {
    if (!drillDown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrillDown(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drillDown, setDrillDown]);

  return (
    <div className="workspace" data-testid="workspace">
      {list.length === 0 && (
        <div className="empty">Select an instrument, then add a chart from the toolbar.</div>
      )}
      {drillDown && (
        <div className="drill-banner" role="status">
          Drilled down to {drillDown.size.toLocaleString()} rows in every chart ·{' '}
          <button onClick={() => setDrillDown(null)}>reset (Esc)</button>
        </div>
      )}
      {list.map((w) => (
        <Rnd
          key={w.id}
          bounds="parent"
          minWidth={MIN.width}
          minHeight={MIN.height}
          size={{ width: w.width, height: w.height }}
          position={{ x: w.x, y: w.y }}
          dragHandleClassName="window-title"
          cancel=".close"
          style={{ zIndex: w.z }}
          onDragStart={() => focusWindow(w.id)}
          onDragStop={(_e, d) => moveWindow(w.id, d.x, d.y)}
          onResizeStart={() => focusWindow(w.id)}
          onResizeStop={(_e, _dir, ref, _delta, pos) =>
            resizeWindow(w.id, pos.x, pos.y, ref.offsetWidth, ref.offsetHeight)
          }
        >
          <WindowFrame window={w} focused={w.z === nextZ - 1} client={client} />
        </Rnd>
      ))}
    </div>
  );
}
