import { useEffect, useState } from 'react';
import { parseDataIdKey } from 'rubin-charts';
import type { DdvClient } from '../protocol/client';
import { loadColumns } from '../protocol/commands';
import { columnRefId, type ColumnRef } from '../model/workspace';
import { toFocalPlaneFrames, type FocalPlaneFrames } from '../model/focalPlane';
import { useSelection } from '../store/selection';
import { useWorkspace } from '../store/workspace';

export interface FocalLoad {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly frames: FocalPlaneFrames | null;
  readonly error: string | null;
  readonly source: 'selection' | 'night' | 'none';
}

/** The detector column that pairs with a CCD-level value column (ccdexposure or ccdvisit1). */
export function detectorColumnFor(field: ColumnRef): ColumnRef {
  return { name: 'detector', schema: field.schema, database: field.database };
}

/**
 * Loads per-detector rows for the chosen column: for the selected exposures
 * when there is a selection (debounced, as in the Flutter app), otherwise for
 * the toolbar night. Without either there is nothing to show.
 */
export function useFocalPlaneLoader(client: DdvClient, field: ColumnRef | null): FocalLoad {
  const selected = useSelection((s) => s.selected);
  const dayObs = useWorkspace((s) => s.globalQuery.dayObs);
  const [state, setState] = useState<FocalLoad>({
    status: 'idle',
    frames: null,
    error: null,
    source: 'none',
  });
  const selectedKey = selected.size ? [...selected].sort().join(',') : '';

  useEffect(() => {
    if (!field) return;
    const source = selected.size ? 'selection' : dayObs ? 'night' : 'none';
    if (source === 'none') {
      setState({ status: 'idle', frames: null, error: null, source });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        setState((s) => ({ ...s, status: 'loading', error: null, source }));
        try {
          const reply = await loadColumns(client, {
            database: field.database,
            columns: [columnRefId(field), columnRefId(detectorColumnFor(field))],
            data_ids:
              source === 'selection'
                ? [...selected]
                    .map((k) => parseDataIdKey(k))
                    .map((d) => [d.dayObs, d.seqNum] as [number, number])
                : null,
            day_obs: source === 'night' ? dayObs : null,
          });
          if (cancelled) return;
          const frames = toFocalPlaneFrames(reply);
          setState({
            status: frames ? 'ready' : 'error',
            frames,
            error: frames ? null : 'reply had no detector column',
            source,
          });
        } catch (e) {
          if (!cancelled)
            setState({ status: 'error', frames: null, error: (e as Error).message, source });
        }
      },
      source === 'selection' ? 500 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // selectedKey stands in for the Set identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, field?.name, field?.schema, field?.database, selectedKey, dayObs]);

  return state;
}
