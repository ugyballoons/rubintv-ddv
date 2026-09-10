import { useEffect } from 'react';
import { create } from 'zustand';
import type { DdvClient } from '../protocol/client';
import { loadColumns } from '../protocol/commands';
import { dayObsToInt } from './useNightCountsUtil';

interface NightCountsState {
  /** database → night (YYYYMMDD) → number of exposures. */
  byDatabase: Record<string, Record<number, number>>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
}

export const useNightCountsStore = create<NightCountsState>(() => ({
  byDatabase: {},
  loading: {},
  error: {},
}));

const inflight = new Set<string>();

/**
 * Loads exposure.day_obs for the whole database once per instrument and
 * counts exposures per night, so the calendar can mark nights with data.
 */
export function useNightCounts(
  client: DdvClient,
  database: string | null,
): { counts: Record<number, number> | null; loading: boolean; error: string | null } {
  const counts = useNightCountsStore((s) => (database ? (s.byDatabase[database] ?? null) : null));
  const loading = useNightCountsStore((s) => (database ? !!s.loading[database] : false));
  const error = useNightCountsStore((s) => (database ? (s.error[database] ?? null) : null));

  useEffect(() => {
    if (!database || counts || inflight.has(database)) return;
    inflight.add(database);
    useNightCountsStore.setState((s) => ({
      loading: { ...s.loading, [database]: true },
      error: { ...s.error, [database]: null },
    }));
    loadColumns(client, { database, columns: ['exposure.day_obs'] })
      .then((reply) => {
        const out: Record<number, number> = {};
        for (const d of reply.data.day_obs) {
          const n = dayObsToInt(d);
          out[n] = (out[n] ?? 0) + 1;
        }
        useNightCountsStore.setState((s) => ({
          byDatabase: { ...s.byDatabase, [database]: out },
          loading: { ...s.loading, [database]: false },
        }));
      })
      .catch((e: Error) => {
        useNightCountsStore.setState((s) => ({
          loading: { ...s.loading, [database]: false },
          error: { ...s.error, [database]: e.message },
        }));
      })
      .finally(() => inflight.delete(database));
  }, [client, database, counts]);

  return { counts, loading, error };
}
