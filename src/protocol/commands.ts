import type { DdvClient } from './client';
import type { CountResult, InstrumentInfo, LoadColumnsParams, TableColumns } from './types';

/** `load instrument` has no requestId in the Flutter client; the reply arrives as `instrument info`. */
export function loadInstrument(client: DdvClient, instrument: string): Promise<InstrumentInfo> {
  return new Promise((resolve) => {
    const off = client.onMessage((env) => {
      if (env.type === 'instrument info') {
        off();
        resolve(env.content as InstrumentInfo);
      }
    });
    client.send({ name: 'load instrument', parameters: { instrument } });
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
