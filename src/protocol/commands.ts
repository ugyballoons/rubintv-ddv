import type { DdvClient } from './client';
import type { CountResult, InstrumentInfo, LoadColumnsParams, TableColumns } from './types';

/**
 * `load instrument` is answered by an `instrument info` envelope. The Flutter
 * client sent it without a requestId; this one attaches one and, because the
 * broker can misroute stale replies, also checks the instrument name.
 */
export function loadInstrument(
  client: DdvClient,
  instrument: string,
  options: { timeoutMs?: number } = {},
): Promise<InstrumentInfo> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`load instrument ${instrument} timed out`));
    }, options.timeoutMs ?? 60_000);
    const off = client.onMessage((env) => {
      if (env.type !== 'instrument info') return;
      const info = env.content as InstrumentInfo;
      if (info.instrument.toLowerCase() !== instrument.toLowerCase()) return;
      clearTimeout(timer);
      off();
      resolve(info);
    });
    client.request('load instrument', { instrument }).catch(() => {
      /* resolved through the instrument-name match above; errors surface via onError */
    });
  });
}

export async function loadColumns(
  client: DdvClient,
  params: LoadColumnsParams,
): Promise<TableColumns> {
  const env = await client.request<TableColumns>('load columns', withNulls(params));
  return env.content;
}

/** Row count for the same parameters as loadColumns; uses the `response_type` override the service honours. */
export async function countRows(client: DdvClient, params: LoadColumnsParams): Promise<number> {
  const env = await client.request<CountResult>('load columns', {
    ...withNulls(params),
    aggregator: 'count',
    response_type: 'count',
  });
  const first = Object.values(env.content.data)[0];
  return typeof first === 'number' ? first : 0;
}

/** The service dataclass has every optional field defaulting to None; sending explicit nulls matches the Flutter client. */
function withNulls(p: LoadColumnsParams): Record<string, unknown> {
  return {
    database: p.database,
    columns: p.columns,
    query: p.query ?? null,
    global_query: p.global_query ?? null,
    data_ids: p.data_ids ?? null,
    day_obs: p.day_obs ?? null,
    is_new_plot: p.is_new_plot ?? null,
  };
}
