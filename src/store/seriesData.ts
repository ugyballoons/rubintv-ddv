import { create } from 'zustand';
import type { DataIdKey } from 'rubin-charts';
import type { TableColumns } from '../protocol/types';

export type LoadStatus = 'idle' | 'counting' | 'confirm' | 'loading' | 'ready' | 'error';

export interface SeriesData {
  readonly columns: Record<string, Float64Array | string[]>;
  readonly dataIds: readonly DataIdKey[];
  readonly rowCount: number;
}

export interface SeriesEntry {
  readonly status: LoadStatus;
  readonly data: SeriesData | null;
  readonly error: string | null;
  /** Row count awaiting confirmation when status is 'confirm'. */
  readonly pendingRows: number | null;
  /** Fingerprint of the request that produced `data`, to skip redundant reloads. */
  readonly requestKey: string | null;
}

interface SeriesDataState {
  entries: Record<string, SeriesEntry>;
  /** Bumped by "sync with server" to force a reload of a series. */
  reload: Record<string, number>;
  requestReload(seriesId: string): void;
  setEntry(seriesId: string, patch: Partial<SeriesEntry>): void;
  remove(seriesId: string): void;
  clear(): void;
}

const IDLE: SeriesEntry = {
  status: 'idle',
  data: null,
  error: null,
  pendingRows: null,
  requestKey: null,
};

export const useSeriesData = create<SeriesDataState>((set) => ({
  entries: {},
  reload: {},
  requestReload(seriesId) {
    set((s) => ({ reload: { ...s.reload, [seriesId]: (s.reload[seriesId] ?? 0) + 1 } }));
  },
  setEntry(seriesId, patch) {
    set((s) => ({
      entries: { ...s.entries, [seriesId]: { ...(s.entries[seriesId] ?? IDLE), ...patch } },
    }));
  },
  remove(seriesId) {
    set((s) => {
      const { [seriesId]: _r, ...rest } = s.entries;
      return { entries: rest };
    });
  },
  clear() {
    set({ entries: {} });
  },
}));

export const idleEntry = IDLE;

/** Convert a columnar reply into typed columns and DataId keys. */
export function toSeriesData(
  reply: TableColumns,
  dataIdKey: (d: { dayObs: number; seqNum: number }) => DataIdKey,
): SeriesData {
  const n = reply.data.seq_num.length;
  const dataIds: DataIdKey[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = reply.data.day_obs[i];
    const dayObs = typeof d === 'number' ? d : Number(String(d).replace(/-/g, ''));
    dataIds[i] = dataIdKey({ dayObs, seqNum: reply.data.seq_num[i] });
  }
  const columns: Record<string, Float64Array | string[]> = {};
  for (const [key, values] of Object.entries(reply.data)) {
    if (key === 'day_obs' || key === 'seq_num') continue;
    columns[key] =
      typeof values[0] === 'string' ? (values as string[]) : Float64Array.from(values as number[]);
  }
  return { columns, dataIds, rowCount: n };
}
