import { useEffect } from 'react';
import { dataIdKey } from 'rubin-charts';
import type { DdvClient } from '../protocol/client';
import { countRows, loadColumns } from '../protocol/commands';
import { columnRefId, type SeriesConfig } from '../model/workspace';
import { useSeriesData, toSeriesData } from '../store/seriesData';
import { useWorkspace } from '../store/workspace';
import { andQuery, nightsDayObsParam, nightsQuery } from '../model/nights';

export const ROW_CONFIRM_THRESHOLD = 100_000;

interface Params {
  database: string;
  columns: string[];
  query: SeriesConfig['query'];
  global_query: SeriesConfig['query'];
  day_obs: string | null;
}

/**
 * One in-flight load per (series, request). React StrictMode mounts effects
 * twice and windows re-render often, so the fetch itself is keyed here rather
 * than owned by the effect: re-running the effect for the same request joins
 * the existing fetch instead of sending a duplicate the broker would queue.
 */
const inflight = new Map<string, { key: string; continueLoad: (() => void) | null }>();

async function fetchSeries(
  client: DdvClient,
  seriesId: string,
  key: string,
  params: Params,
): Promise<void> {
  const setEntry = useSeriesData.getState().setEntry;
  const stillWanted = () => inflight.get(seriesId)?.key === key;
  const load = async () => {
    if (!stillWanted()) return;
    setEntry(seriesId, { status: 'loading', pendingRows: null });
    const reply = await loadColumns(client, params);
    if (!stillWanted()) return;
    setEntry(seriesId, {
      status: 'ready',
      data: toSeriesData(reply, dataIdKey),
      requestKey: key,
      error: null,
    });
    inflight.delete(seriesId);
  };
  try {
    setEntry(seriesId, { status: 'counting', error: null, requestKey: key, pendingRows: null });
    const n = await countRows(client, params);
    if (!stillWanted()) return;
    if (n > ROW_CONFIRM_THRESHOLD) {
      setEntry(seriesId, { status: 'confirm', pendingRows: n });
      inflight.get(seriesId)!.continueLoad = () => void load().catch(fail);
      return;
    }
    await load();
  } catch (e) {
    fail(e);
  }
  function fail(e: unknown) {
    if (!stillWanted()) return;
    setEntry(seriesId, { status: 'error', error: (e as Error).message });
    inflight.delete(seriesId);
  }
}

/** Keeps one series' data in sync with its config and, when the chart opts in, the global query. */
export function useSeriesLoader(
  client: DdvClient,
  series: SeriesConfig,
  useGlobalQuery: boolean,
): void {
  const instrument = useWorkspace((s) => s.instrument);
  const database = instrument?.database ?? null;
  const globalQuery = useWorkspace((s) => s.globalQuery);
  const columns = Object.values(series.fields).map(columnRefId).sort();
  const firstTable = Object.values(series.fields)[0]?.schema ?? 'exposure';
  const params: Params | null = database
    ? {
        database,
        columns,
        query: series.query,
        global_query: useGlobalQuery
          ? andQuery(globalQuery.query, nightsQuery(globalQuery.nights, firstTable, instrument))
          : null,
        day_obs: useGlobalQuery ? nightsDayObsParam(globalQuery.nights) : null,
      }
    : null;
  const requestKey = params ? JSON.stringify(params) : null;
  const reloadNonce = useSeriesData((s) => (s.reload[series.id] ?? 0) + s.reloadAll * 1000);

  useEffect(() => {
    if (!params || !requestKey || columns.length === 0) return;
    const entry = useSeriesData.getState().entries[series.id];
    const forced = reloadNonce !== lastNonce.get(series.id);
    lastNonce.set(series.id, reloadNonce);
    if (!forced) {
      if (entry?.requestKey === requestKey && entry.status === 'ready') return;
      const running = inflight.get(series.id);
      if (running?.key === requestKey) return; // join the fetch already in progress
    }
    inflight.set(series.id, { key: requestKey, continueLoad: null });
    void fetchSeries(client, series.id, requestKey, params);
    // requestKey captures every input that should trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, series.id, requestKey, reloadNonce]);
}

/** Last reload nonce seen per series, so a bump forces one refetch. */
const lastNonce = new Map<string, number>();

export function confirmLoad(seriesId: string): void {
  inflight.get(seriesId)?.continueLoad?.();
}

export function cancelLoad(seriesId: string): void {
  inflight.delete(seriesId);
  useSeriesData
    .getState()
    .setEntry(seriesId, { status: 'idle', pendingRows: null, requestKey: null });
}

/** Forget any in-flight work for a series (window closed or workspace cleared). */
export function dropLoad(seriesId: string): void {
  inflight.delete(seriesId);
}
