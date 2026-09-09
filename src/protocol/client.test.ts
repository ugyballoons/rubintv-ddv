// @vitest-environment node
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DdvClient, ProtocolError } from './client';
import { countRows, loadColumns, loadInstrument } from './commands';

let server: WebSocketServer;
let client: DdvClient;
let received: unknown[];

function fakeWorker(sock: WsSocket) {
  sock.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    received.push(msg);
    if (msg.type === 'ping') return sock.send(JSON.stringify({ type: 'pong' }));
    const reply = (type: string, content: unknown) =>
      sock.send(
        JSON.stringify({ type, content, ...(msg.requestId && { requestId: msg.requestId }) }),
      );
    switch (msg.name) {
      case 'load instrument':
        return reply('instrument info', { instrument: msg.parameters.instrument, detectors: [] });
      case 'load columns':
        if (msg.parameters.aggregator === 'count') {
          return reply(msg.parameters.response_type, {
            schema: 'testdb',
            columns: msg.parameters.columns,
            data: { 'exposure.ra': 42 },
          });
        }
        return reply('table columns', {
          schema: 'testdb',
          columns: msg.parameters.columns,
          data: { 'exposure.ra': [1, 2], day_obs: [20240101, 20240101], seq_num: [1, 2] },
        });
      case 'boom':
        return sock.send(
          JSON.stringify({
            type: 'error',
            content: { error: 'execution error', description: 'no' },
          }),
        );
      default:
        return reply('unknown', {});
    }
  });
}

beforeEach(async () => {
  received = [];
  server = new WebSocketServer({ port: 0 });
  server.on('connection', fakeWorker);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as { port: number };
  client = new DdvClient(`ws://127.0.0.1:${port}/ws/client`, {
    pingIntervalMs: 20,
    pongTimeoutMs: 1000,
  });
  client.connect();
  await new Promise<void>((r) => client.onStatus((s) => s === 'open' && r()));
});

afterEach(async () => {
  client.close();
  await new Promise((r) => server.close(r));
});

describe('DdvClient', () => {
  it('correlates replies by requestId', async () => {
    const cols = await loadColumns(client, { database: 'testdb', columns: ['exposure.ra'] });
    expect(cols.data.seq_num).toEqual([1, 2]);
    const sent = received.find((m: any) => m.name === 'load columns') as any;
    expect(sent.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(sent.parameters).toMatchObject({
      query: null,
      global_query: null,
      data_ids: null,
      day_obs: null,
    });
  });

  it('uses the response_type override for counts', async () => {
    expect(await countRows(client, { database: 'testdb', columns: ['exposure.ra'] })).toBe(42);
  });

  it('handles load instrument, which has no requestId', async () => {
    const info = await loadInstrument(client, 'LSSTCam');
    expect(info.instrument).toBe('LSSTCam');
    const sent = received.find((m: any) => m.name === 'load instrument') as any;
    expect(sent.requestId).toBeUndefined();
  });

  it('surfaces errors without requestId globally and times out the request', async () => {
    const errors: ProtocolError[] = [];
    client.onError((e) => errors.push(e));
    await expect(client.request('boom', {}, { timeoutMs: 50 })).rejects.toThrow(/timed out/);
    expect(errors).toHaveLength(1);
    expect(errors[0].content.error).toBe('execution error');
  });

  it('keeps the heartbeat going', async () => {
    await new Promise((r) => setTimeout(r, 80));
    expect(received.filter((m: any) => m.type === 'ping').length).toBeGreaterThanOrEqual(2);
    expect(client.status).toBe('open');
  });
});
