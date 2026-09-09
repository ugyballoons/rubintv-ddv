import type { DdvClient } from '../protocol/client';
import { KNOWN_INSTRUMENTS } from '../model/schema';
import { useConnection } from '../store/connection';
import { useWorkspace } from '../store/workspace';
import { APP_VERSION } from '../config';

/** Connection dot: red disconnected, yellow connected without an instrument, green ready. */
function StatusDot() {
  const status = useConnection((s) => s.status);
  const instrumentStatus = useWorkspace((s) => s.instrumentStatus);
  const color =
    status !== 'open' ? '#a63d3d' : instrumentStatus === 'ready' ? '#2e7d4f' : '#c9a227';
  const label =
    status !== 'open' ? `connection ${status}` : `connection open, instrument ${instrumentStatus}`;
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: color }}
    />
  );
}

export function Toolbar({ client }: { client: DdvClient }) {
  const connection = useConnection((s) => s.status);
  const instrument = useWorkspace((s) => s.instrument);
  const instrumentStatus = useWorkspace((s) => s.instrumentStatus);
  const selectInstrument = useWorkspace((s) => s.selectInstrument);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: 40,
        padding: '0 12px',
        borderBottom: '1px solid #d3dcde',
        background: '#ecf1f1',
      }}
    >
      <StatusDot />
      <strong>RubinTV DDV</strong>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13 }}>Instrument</span>
        <select
          aria-label="Instrument"
          value={instrument?.name ?? ''}
          disabled={connection !== 'open' || instrumentStatus === 'loading'}
          onChange={(e) => void selectInstrument(client, e.target.value || null)}
        >
          <option value="">Select instrument</option>
          {KNOWN_INSTRUMENTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {instrumentStatus === 'loading' && (
        <span style={{ fontSize: 13, color: '#7a8a91' }}>loading…</span>
      )}
      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#7a8a91' }}>
        v{APP_VERSION} · <code>{client.url}</code>
      </span>
    </header>
  );
}
