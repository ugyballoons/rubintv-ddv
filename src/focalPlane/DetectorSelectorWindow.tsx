import { useCallback } from 'react';
import { useWorkspace } from '../store/workspace';
import { FocalPlaneView } from './FocalPlaneView';

/** Pick the workspace's current detector by clicking the focal plane. */
export function DetectorSelectorWindow() {
  const instrument = useWorkspace((s) => s.instrument);
  const detectorId = useWorkspace((s) => s.globalQuery.detectorId);
  const setGlobalQuery = useWorkspace((s) => s.setGlobalQuery);
  const onSelect = useCallback(
    (id: number | null) => setGlobalQuery({ detectorId: id }),
    [setGlobalQuery],
  );
  if (!instrument) return <div className="centered-note">Select an instrument first.</div>;
  const det = instrument.detectors.find((d) => d.id === detectorId);
  return (
    <>
      <div className="window-toolbar">
        <span className="meta">{det ? `${det.id}: ${det.name}` : 'No detector selected'}</span>
      </div>
      <div className="window-body focal-body">
        <FocalPlaneView
          detectors={instrument.detectors}
          selectedId={detectorId}
          onSelect={onSelect}
        />
      </div>
    </>
  );
}
