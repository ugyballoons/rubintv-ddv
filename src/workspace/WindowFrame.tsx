import type { DdvClient } from '../protocol/client';
import type { WindowMeta } from '../model/workspace';
import { useWorkspace } from '../store/workspace';
import { useSeriesData } from '../store/seriesData';
import { ChartWindow } from './ChartWindow';
import { Icon } from '../app/Icon';
import { FocalPlaneWindow } from '../focalPlane/FocalPlaneWindow';
import { DetectorSelectorWindow } from '../focalPlane/DetectorSelectorWindow';
import { dropLoad } from '../hooks/useSeriesLoader';

export function WindowFrame({
  window: w,
  focused,
  client,
}: {
  window: WindowMeta;
  focused: boolean;
  client: DdvClient;
}) {
  const removeWindow = useWorkspace((s) => s.removeWindow);
  const focusWindow = useWorkspace((s) => s.focusWindow);
  const removeData = useSeriesData((s) => s.remove);
  const close = () => {
    for (const s of w.chart?.series ?? []) {
      dropLoad(s.id);
      removeData(s.id);
    }
    removeWindow(w.id);
  };
  return (
    <div
      className={`window${focused ? ' focused' : ''}`}
      data-testid={`window-${w.id}`}
      onMouseDownCapture={() => focusWindow(w.id)}
    >
      <div className="window-title">
        <span className="name">{w.title}</span>
        <button
          className="close"
          aria-label={`close ${w.title}`}
          onClick={close}
          title="Remove window"
        >
          <Icon name="clear" size={14} />
        </button>
      </div>
      {w.chart ? (
        <ChartWindow window={w} client={client} />
      ) : w.focal ? (
        <FocalPlaneWindow window={w} client={client} />
      ) : w.type === 'detectorSelector' ? (
        <DetectorSelectorWindow />
      ) : (
        <div className="centered-note">{w.title} is not implemented yet.</div>
      )}
    </div>
  );
}
