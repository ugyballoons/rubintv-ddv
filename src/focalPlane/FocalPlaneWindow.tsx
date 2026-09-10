import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDataIdKey } from 'rubin-charts';
import type { DdvClient } from '../protocol/client';
import type { WindowMeta } from '../model/workspace';
import { colorAt, rescaleStops, type ColorStop } from '../model/focalPlane';
import { useWorkspace } from '../store/workspace';
import { useFocalPlaneLoader } from '../hooks/useFocalPlaneLoader';
import { FocalPlaneView } from './FocalPlaneView';
import { Colorbar } from './Colorbar';
import { FocalColumnEditor } from './FocalColumnEditor';
import { Icon } from '../app/Icon';

const BASE_INTERVAL_MS = 500;

/** Per-detector values over the selected exposures (or the night), with playback and an editable colorbar. */
export function FocalPlaneWindow({ window: w, client }: { window: WindowMeta; client: DdvClient }) {
  const focal = w.focal!;
  const instrument = useWorkspace((s) => s.instrument);
  const detectorId = useWorkspace((s) => s.globalQuery.detectorId);
  const setGlobalQuery = useWorkspace((s) => s.setGlobalQuery);
  const updateFocal = useWorkspace((s) => s.updateFocal);
  const load = useFocalPlaneLoader(client, focal.field);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const bounds = useRef<{ min: number; max: number } | null>(null);

  // New data: rescale the stops into the new bounds and rewind, as the Flutter chart did.
  useEffect(() => {
    if (!load.frames) return;
    const { min, max } = load.frames;
    const prev = bounds.current;
    bounds.current = { min, max };
    if (!prev || prev.min !== min || prev.max !== max) {
      const lo = prev ? prev.min : Math.min(...focal.stops.map((s) => s.value));
      const hi = prev ? prev.max : Math.max(...focal.stops.map((s) => s.value));
      updateFocal(w.id, { stops: rescaleStops(focal.stops, lo, hi, min, max) });
    }
    setIndex(0);
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.frames]);

  const frameCount = load.frames?.dataIds.length ?? 0;
  useEffect(() => {
    if (!playing || frameCount < 2) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i + 1 < frameCount) return i + 1;
        if (focal.loop) return 0;
        setPlaying(false);
        return i;
      });
    }, BASE_INTERVAL_MS / focal.playbackSpeed);
    return () => clearInterval(t);
  }, [playing, frameCount, focal.loop, focal.playbackSpeed]);

  const current =
    load.frames && frameCount ? load.frames.dataIds[Math.min(index, frameCount - 1)] : null;
  const colors = useMemo(() => {
    if (!load.frames || !current) return undefined;
    const frame = load.frames.frames.get(current);
    const out = new Map<number, string>();
    if (frame) for (const [det, v] of frame) out.set(det, colorAt(focal.stops, v));
    return out;
  }, [load.frames, current, focal.stops]);
  const onSelectDetector = useCallback(
    (id: number | null) => setGlobalQuery({ detectorId: id }),
    [setGlobalQuery],
  );
  const onStops = useCallback(
    (stops: ColorStop[]) => updateFocal(w.id, { stops }),
    [updateFocal, w.id],
  );

  if (!instrument) return <div className="centered-note">Select an instrument first.</div>;
  const id = current ? parseDataIdKey(current) : null;
  const min = load.frames?.min ?? Math.min(...focal.stops.map((s) => s.value));
  const max = load.frames?.max ?? Math.max(...focal.stops.map((s) => s.value));

  return (
    <>
      <div className="window-toolbar">
        <button
          onClick={() => setEditorOpen(true)}
          title="Choose the column shown on the focal plane"
        >
          <Icon name="column" />
          {focal.field ? `${focal.field.schema}.${focal.field.name}` : 'choose column…'}
        </button>
        {id && (
          <>
            <span className="chip">
              night {String(id.dayObs).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}
            </span>
            <span className="chip">seq {id.seqNum}</span>
            <span className="chip">
              {index + 1} / {frameCount}
            </span>
          </>
        )}
        <span className="meta">
          {load.status === 'loading'
            ? 'loading…'
            : load.status === 'error'
              ? load.error
              : load.source === 'none'
                ? 'select exposures or set a night'
                : `${frameCount} exposures from ${load.source}`}
        </span>
      </div>
      <div className="window-body focal-body">
        <FocalPlaneView
          detectors={instrument.detectors}
          colors={colors}
          selectedId={detectorId}
          onSelect={onSelectDetector}
        />
        <Colorbar stops={focal.stops} min={min} max={max} onChange={onStops} />
      </div>
      <div className="window-status focal-controls">
        <button
          className="icon"
          aria-label={playing ? 'pause' : 'play'}
          disabled={frameCount < 2}
          onClick={() => setPlaying((p) => !p)}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button
          className="icon"
          aria-label="previous exposure"
          disabled={frameCount < 2}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <Icon name="prev" />
        </button>
        <button
          className="icon"
          aria-label="next exposure"
          disabled={frameCount < 2}
          onClick={() => setIndex((i) => Math.min(frameCount - 1, i + 1))}
        >
          <Icon name="next" />
        </button>
        <input
          type="range"
          aria-label="exposure index"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={Math.min(index, Math.max(0, frameCount - 1))}
          disabled={frameCount < 2}
          onChange={(e) => setIndex(Number(e.target.value))}
        />
        <label title="Playback speed">
          speed
          <input
            type="range"
            aria-label="playback speed"
            min={0.1}
            max={10}
            step={0.1}
            value={focal.playbackSpeed}
            onChange={(e) => updateFocal(w.id, { playbackSpeed: Number(e.target.value) })}
          />
          <span className="meta">{focal.playbackSpeed.toFixed(1)}×</span>
        </label>
        <label title="Loop playback">
          <input
            type="checkbox"
            checked={focal.loop}
            onChange={(e) => updateFocal(w.id, { loop: e.target.checked })}
          />{' '}
          loop
        </label>
      </div>
      {editorOpen && (
        <FocalColumnEditor
          instrument={instrument}
          field={focal.field}
          onCancel={() => setEditorOpen(false)}
          onAccept={(field) => {
            updateFocal(w.id, { field });
            setEditorOpen(false);
          }}
        />
      )}
    </>
  );
}
